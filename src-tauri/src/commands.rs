use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{bail, Context};
use chrono::Local;
use directories::UserDirs;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    app_state::AppState,
    audio::{self, AudioDevice, AudioDeviceSelection},
    manifest::Manifest,
    recorder::RecorderSnapshot,
    storage::RecordingSummary,
};

#[tauri::command]
pub async fn get_recorder_snapshot(state: State<'_, AppState>) -> Result<RecorderSnapshot, String> {
    Ok(state.recorder.lock().await.snapshot())
}

#[tauri::command]
pub async fn start_recording(state: State<'_, AppState>) -> Result<RecorderSnapshot, String> {
    state.recorder.lock().await.start().map_err(to_message)
}

#[tauri::command]
pub async fn pause_recording(state: State<'_, AppState>) -> Result<RecorderSnapshot, String> {
    state.recorder.lock().await.pause().map_err(to_message)
}

#[tauri::command]
pub async fn resume_recording(state: State<'_, AppState>) -> Result<RecorderSnapshot, String> {
    state.recorder.lock().await.resume().map_err(to_message)
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, AppState>) -> Result<RecorderSnapshot, String> {
    state.recorder.lock().await.stop().map_err(to_message)
}

#[tauri::command]
pub async fn list_recordings(state: State<'_, AppState>) -> Result<Vec<RecordingSummary>, String> {
    state.storage.list_recordings().map_err(to_message)
}

#[tauri::command]
pub async fn open_recording_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    recording_id: String,
) -> Result<(), String> {
    let path = state.storage.recording_open_folder(&recording_id).map_err(to_message)?;
    if !path.exists() {
        return Err("la carpeta de la grabacion no existe".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cleanup_local_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    recording_id: String,
) -> Result<(), String> {
    let recording_dir = state.storage.delete_recording_local(&recording_id).map_err(to_message)?;
    let recordings_root = state.storage.recordings_root();
    if recording_dir.starts_with(&recordings_root) && recording_dir.exists() {
        fs::remove_dir_all(&recording_dir).map_err(|error| error.to_string())?;
    }
    let _ = app.emit("recorder://recordings-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if url != "https://vicentejorquera.dev" {
        return Err("url externa no permitida".to_string());
    }

    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
pub struct SavedAudio {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct TranscriptionRequestResult {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Serialize)]
pub struct CloudDashboard {
    pub clients: serde_json::Value,
    pub projects: serde_json::Value,
    pub jobs: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct CloudJobArtifacts {
    pub transcription: Option<String>,
    pub analysis: Option<String>,
}

#[tauri::command]
pub async fn save_recording_to_library(
    state: State<'_, AppState>,
    recording_id: String,
    client: Option<String>,
    project: Option<String>,
    file_name: Option<String>,
    draft: bool,
) -> Result<SavedAudio, String> {
    save_recording(&state, &recording_id, client, project, file_name, draft).map_err(to_message)
}

#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(audio::list_devices())
}

#[tauri::command]
pub async fn get_selected_audio_devices(state: State<'_, AppState>) -> Result<AudioDeviceSelection, String> {
    Ok(state
        .audio_devices
        .lock()
        .map_err(|_| "no se pudo leer la seleccion de audio".to_string())?
        .clone())
}

#[tauri::command]
pub async fn select_audio_device(
    state: State<'_, AppState>,
    kind: String,
    device_id: Option<String>,
) -> Result<AudioDeviceSelection, String> {
    if kind != "input" && kind != "output" {
        return Err("tipo de dispositivo invalido".to_string());
    }

    if let Some(device_id) = device_id.as_deref() {
        let exists = audio::list_devices()
            .into_iter()
            .any(|device| device.kind == kind && device.id == device_id);
        if !exists {
            return Err("dispositivo de audio no disponible".to_string());
        }
    }

    let selection = {
        let mut selection = state
            .audio_devices
            .lock()
            .map_err(|_| "no se pudo actualizar la seleccion de audio".to_string())?;
        if kind == "input" {
            selection.input_device_id = device_id;
        } else {
            selection.output_device_id = device_id;
        }
        selection.clone()
    };

    audio::save_device_selection(&state.audio_device_config, &selection).map_err(to_message)?;
    Ok(selection)
}

#[tauri::command]
pub async fn select_microphone(state: State<'_, AppState>, device_id: String) -> Result<(), String> {
    select_audio_device(state, "input".to_string(), Some(device_id)).await?;
    Ok(())
}

#[tauri::command]
pub async fn request_transcription(
    state: State<'_, AppState>,
    recording_id: String,
    endpoint: String,
    api_key: String,
    client: Option<String>,
    project: Option<String>,
    file_name: Option<String>,
    duration_ms: Option<u64>,
) -> Result<TranscriptionRequestResult, String> {
    let recording_dir = state.storage.recording_folder(&recording_id);
    let source = recording_source_path(&state, &recording_id, &recording_dir).map_err(to_message)?;
    let upload_file_name = sanitized_file_stem(file_name)
        .map(|name| format!("{name}.opus"))
        .or_else(|| source.file_name().and_then(|name| name.to_str()).map(str::to_string))
        .unwrap_or_else(|| "audio.opus".to_string());
    let relative_path = transcription_relative_path(client, project);
    let source_duration_ms = duration_ms.or_else(|| state.storage.recording_duration_ms(&recording_id).ok().flatten());
    send_transcription_request(
        &endpoint,
        &api_key,
        &source,
        &upload_file_name,
        &relative_path,
        source_duration_ms,
    )
    .map_err(to_message)
}

#[tauri::command]
pub async fn sync_cloud_dashboard(base_url: String, api_key: String) -> Result<CloudDashboard, String> {
    sync_cloud_dashboard_request(&base_url, &api_key).map_err(to_message)
}

#[tauri::command]
pub async fn get_cloud_job_artifacts(
    base_url: String,
    api_key: String,
    job_id: String,
    include_transcription: bool,
    include_analysis: bool,
) -> Result<CloudJobArtifacts, String> {
    get_cloud_job_artifacts_request(&base_url, &api_key, &job_id, include_transcription, include_analysis)
        .map_err(to_message)
}

fn to_message(error: anyhow::Error) -> String {
    error.to_string()
}

fn save_recording(
    state: &State<'_, AppState>,
    recording_id: &str,
    client: Option<String>,
    project: Option<String>,
    file_name: Option<String>,
    draft: bool,
) -> anyhow::Result<SavedAudio> {
    let recording_dir = state.storage.recording_folder(recording_id);
    let manifest = Manifest::load(&recording_dir)?;
    let source = recording_source_path(state, recording_id, &recording_dir)?;

    let music_root = music_library_root()?;
    let target_dir = if draft {
        music_root.join("drafts")
    } else {
        let client = required_folder_name(client, "cliente")?;
        match sanitized_folder_name(project) {
            Some(project) => music_root.join(client).join(project),
            None => music_root.join(client),
        }
    };

    fs::create_dir_all(&target_dir).with_context(|| format!("creating {}", target_dir.display()))?;
    let base_name = sanitized_file_stem(file_name).unwrap_or_else(|| {
        manifest
            .created_at
            .with_timezone(&Local)
            .format("grabacion_%d_%m_%Y_%H_%M")
            .to_string()
    });
    let destination = available_opus_path(&target_dir, &base_name);
    copy_atomic(&source, &destination)?;
    state
        .storage
        .update_final_audio_path(recording_id, &destination.to_string_lossy())?;

    Ok(SavedAudio {
        path: destination.to_string_lossy().to_string(),
    })
}

fn recording_source_path(
    state: &State<'_, AppState>,
    recording_id: &str,
    recording_dir: &Path,
) -> anyhow::Result<PathBuf> {
    if let Some(path) = state.storage.recording_final_audio_path(recording_id)? {
        if path.exists() {
            return Ok(path);
        }
    }

    let mixed = recording_dir.join("final").join("mixed.opus");
    if mixed.exists() {
        return Ok(mixed);
    }

    bail!("no se encontro el audio final para copiarlo a la biblioteca")
}

fn music_library_root() -> anyhow::Result<PathBuf> {
    let user_dirs = UserDirs::new().context("resolving user directories")?;
    let music = user_dirs.home_dir().join("Music");
    Ok(music.join("Meetings Assistant"))
}

fn required_folder_name(value: Option<String>, label: &str) -> anyhow::Result<String> {
    sanitized_folder_name(value).with_context(|| format!("falta {label}"))
}

fn sanitized_folder_name(value: Option<String>) -> Option<String> {
    value.and_then(|value| sanitize_path_part(&value))
}

fn sanitized_file_stem(value: Option<String>) -> Option<String> {
    value.and_then(|value| sanitize_path_part(value.trim_end_matches(".opus")))
}

fn transcription_relative_path(client: Option<String>, project: Option<String>) -> String {
    let client = sanitized_folder_name(client);
    let project = sanitized_folder_name(project);
    match (client, project) {
        (Some(client), Some(project)) => format!("{client}/{project}"),
        (Some(client), None) => client,
        _ => "drafts".to_string(),
    }
}

fn sanitize_path_part(value: &str) -> Option<String> {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect::<String>()
        .trim_matches([' ', '.'])
        .to_string();

    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn available_opus_path(dir: &Path, base_name: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base_name}.opus"));
    let mut suffix = 2_u32;
    while candidate.exists() {
        candidate = dir.join(format!("{base_name}_{suffix}.opus"));
        suffix += 1;
    }
    candidate
}

fn copy_atomic(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let tmp = destination.with_extension("opus.tmp");
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    let result = (|| {
        fs::copy(source, &tmp).with_context(|| format!("copying {} to {}", source.display(), tmp.display()))?;
        let file = fs::File::open(&tmp)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, destination)
            .with_context(|| format!("committing {} to {}", tmp.display(), destination.display()))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }

    result
}

fn send_transcription_request(
    endpoint: &str,
    api_key: &str,
    audio_path: &Path,
    upload_file_name: &str,
    relative_path: &str,
    duration_ms: Option<u64>,
) -> anyhow::Result<TranscriptionRequestResult> {
    let target = parse_http_endpoint(endpoint)?;
    let audio = fs::read(audio_path).with_context(|| format!("reading {}", audio_path.display()))?;
    let file_name = multipart_file_name(upload_file_name);
    let mime = match audio_path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("mp3") => "audio/mpeg",
        _ => "audio/ogg",
    };
    let boundary = format!("meetings-assistant-{}", uuid::Uuid::new_v4());
    let mut body = Vec::new();
    write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n"
    )?;
    body.extend_from_slice(&audio);
    write!(
        body,
        "\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"relative_path\"\r\n\r\n{relative_path}\r\n"
    )?;
    if let Some(duration_ms) = duration_ms.filter(|value| *value > 0) {
        write!(
            body,
            "--{boundary}\r\nContent-Disposition: form-data; name=\"duration_ms\"\r\n\r\n{duration_ms}\r\n"
        )?;
    }
    write!(body, "--{boundary}--\r\n")?;

    let mut stream = TcpStream::connect((&*target.host, target.port))
        .with_context(|| format!("connecting to {}:{}", target.host, target.port))?;
    stream.set_read_timeout(Some(Duration::from_secs(60)))?;
    stream.set_write_timeout(Some(Duration::from_secs(60)))?;

    write!(
        stream,
        "POST {} HTTP/1.1\r\nHost: {}\r\nX-API-Key: {}\r\nContent-Type: multipart/form-data; boundary={}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        target.path,
        target.host_header,
        api_key,
        boundary,
        body.len()
    )?;
    stream.write_all(&body)?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let response_text = String::from_utf8_lossy(&response);
    let (head, body) = response_text
        .split_once("\r\n\r\n")
        .map_or((response_text.as_ref(), ""), |(head, body)| (head, body));
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .context("respuesta HTTP invalida del servicio de transcripcion")?;

    if status != 202 {
        bail!(
            "el servicio respondio {status}: {}",
            body.trim().lines().next().unwrap_or("sin detalle")
        );
    }

    Ok(TranscriptionRequestResult {
        status,
        body: body.trim().to_string(),
    })
}

fn sync_cloud_dashboard_request(base_url: &str, api_key: &str) -> anyhow::Result<CloudDashboard> {
    Ok(CloudDashboard {
        clients: send_json_get_request(&join_backend_path(base_url, "/v1/dashboard/clients")?, api_key)?,
        projects: send_json_get_request(&join_backend_path(base_url, "/v1/dashboard/projects")?, api_key)?,
        jobs: send_json_get_request(&join_backend_path(base_url, "/v1/jobs/?limit=100&offset=0")?, api_key)?,
    })
}

fn get_cloud_job_artifacts_request(
    base_url: &str,
    api_key: &str,
    job_id: &str,
    include_transcription: bool,
    include_analysis: bool,
) -> anyhow::Result<CloudJobArtifacts> {
    let transcription = if include_transcription {
        Some(get_job_artifact_content(base_url, api_key, job_id, "transcription_md")?)
    } else {
        None
    };
    let analysis = if include_analysis {
        Some(get_job_artifact_content(base_url, api_key, job_id, "analysis_md")?)
    } else {
        None
    };

    Ok(CloudJobArtifacts { transcription, analysis })
}

fn get_job_artifact_content(
    base_url: &str,
    api_key: &str,
    job_id: &str,
    artifact_type: &str,
) -> anyhow::Result<String> {
    let endpoint = join_backend_path(base_url, &format!("/v1/jobs/{job_id}/artifacts/{artifact_type}/content"))?;
    let payload = send_json_get_request(&endpoint, api_key)?;
    payload
        .get("content")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .with_context(|| format!("artifact {artifact_type} sin content"))
}

fn send_json_get_request(endpoint: &str, api_key: &str) -> anyhow::Result<serde_json::Value> {
    let target = parse_http_endpoint(endpoint)?;
    let mut stream = TcpStream::connect((&*target.host, target.port))
        .with_context(|| format!("connecting to {}:{}", target.host, target.port))?;
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;

    write!(
        stream,
        "GET {} HTTP/1.1\r\nHost: {}\r\nX-API-Key: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        target.path,
        target.host_header,
        api_key
    )?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let response_text = String::from_utf8_lossy(&response);
    let (head, body) = response_text
        .split_once("\r\n\r\n")
        .map_or((response_text.as_ref(), ""), |(head, body)| (head, body));
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .context("respuesta HTTP invalida del backend")?;

    if !(200..300).contains(&status) {
        bail!(
            "el backend respondio {status}: {}",
            body.trim().lines().next().unwrap_or("sin detalle")
        );
    }

    serde_json::from_str(body.trim()).with_context(|| format!("parsing JSON from {endpoint}"))
}

fn join_backend_path(base_url: &str, path: &str) -> anyhow::Result<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        bail!("falta URL del backend");
    }

    Ok(format!("{base}/{}", path.trim_start_matches('/')))
}

fn multipart_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            '"' | '\r' | '\n' => '-',
            character => character,
        })
        .collect::<String>();

    if sanitized.trim().is_empty() {
        "audio.opus".to_string()
    } else {
        sanitized
    }
}

struct HttpEndpoint {
    host: String,
    host_header: String,
    port: u16,
    path: String,
}

fn parse_http_endpoint(endpoint: &str) -> anyhow::Result<HttpEndpoint> {
    let endpoint = endpoint.trim();
    let without_scheme = endpoint
        .strip_prefix("http://")
        .context("solo se soportan endpoints http:// locales por ahora")?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .map_or((without_scheme, "/"), |(host_port, path)| (host_port, path));
    let (host, port) = match host_port.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().context("puerto HTTP invalido")?),
        None => (host_port.to_string(), 80),
    };

    if host.trim().is_empty() {
        bail!("host HTTP invalido");
    }

    Ok(HttpEndpoint {
        host,
        host_header: host_port.to_string(),
        port,
        path: format!("/{}", path.trim_start_matches('/')),
    })
}
