use std::{
    fs,
    path::{Path, PathBuf},
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
    auth::AuthState,
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
    let (recording_dir, final_audio_path) = state.storage.delete_recording_local(&recording_id).map_err(to_message)?;
    let recordings_root = state.storage.recordings_root();
    if recording_dir.starts_with(&recordings_root) && recording_dir.exists() {
        fs::remove_dir_all(&recording_dir).map_err(|error| error.to_string())?;
    }
    if let Some(final_audio_path) = final_audio_path {
        if final_audio_path.exists() {
            let _ = fs::remove_file(&final_audio_path);
        }
        if let Ok(music_root) = music_library_root() {
            prune_empty_library_dirs(final_audio_path.parent(), &music_root);
        }
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

#[derive(Debug, Serialize)]
pub struct AnalysisRetryResult {
    pub accepted: bool,
    pub message: String,
    pub job_id: String,
    pub status: String,
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
pub async fn get_cloud_job_artifacts(
    state: State<'_, AppState>,
    job_id: String,
    include_transcription: bool,
    include_analysis: bool,
) -> Result<CloudJobArtifacts, String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticación")?;
        
    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    
    let transcription = if include_transcription {
        let payload = api.get_json(&format!("/v1/jobs/{job_id}/artifacts/transcription_md/content")).await.map_err(to_message)?;
        Some(payload.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    } else {
        None
    };
    
    let analysis = if include_analysis {
        let payload = api.get_json(&format!("/v1/jobs/{job_id}/artifacts/analysis_md/content")).await.map_err(to_message)?;
        Some(payload.get("content").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    } else {
        None
    };

    Ok(CloudJobArtifacts { transcription, analysis })
}

#[tauri::command]
pub async fn get_auth_state(state: State<'_, AppState>) -> Result<AuthState, String> {
    state.auth.get_auth_state().map_err(to_message)
}

#[tauri::command]
pub async fn start_google_auth(app: AppHandle, state: State<'_, AppState>) -> Result<AuthState, String> {
    state.auth.start_oauth_flow(app).await.map_err(to_message)
}

#[tauri::command]
pub async fn logout_auth(state: State<'_, AppState>) -> Result<(), String> {
    state.auth.delete_tokens().map_err(to_message)
}

#[tauri::command]
pub async fn request_transcription(
    state: State<'_, AppState>,
    recording_id: String,
    client: Option<String>,
    project: Option<String>,
    file_name: Option<String>,
    duration_ms: Option<u64>,
) -> Result<TranscriptionRequestResult, String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticación")?;

    let recording_dir = state.storage.recording_folder(&recording_id);
    let source = recording_source_path(&state, &recording_id, &recording_dir).map_err(to_message)?;
    let upload_file_name = sanitized_file_stem(file_name)
        .map(|name| format!("{name}.opus"))
        .or_else(|| source.file_name().and_then(|name| name.to_str()).map(str::to_string))
        .unwrap_or_else(|| "audio.opus".to_string());
    let relative_path = transcription_relative_path(client, project);
    let source_duration_ms = duration_ms.or_else(|| state.storage.recording_duration_ms(&recording_id).ok().flatten());
    
    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    let (status, body) = api.upload_transcription(
        &source,
        &upload_file_name,
        &relative_path,
        source_duration_ms,
    ).await.map_err(to_message)?;
    
    Ok(TranscriptionRequestResult { status, body })
}

#[tauri::command]
pub async fn sync_cloud_dashboard(state: State<'_, AppState>) -> Result<CloudDashboard, String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticación")?;
        
    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    
    Ok(CloudDashboard {
        clients: api.get_json("/v1/dashboard/clients").await.map_err(to_message)?,
        projects: api.get_json("/v1/dashboard/projects").await.map_err(to_message)?,
        jobs: api.get_json("/v1/jobs/?limit=100&offset=0").await.map_err(to_message)?,
    })
}

#[tauri::command]
pub async fn list_archived_cloud_jobs(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.get_json("/v1/jobs/?limit=100&offset=0&status=archived").await.map_err(to_message)
}

#[tauri::command]
pub async fn request_analysis_retry(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<AnalysisRetryResult, String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticación")?;
        
    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    let payload = api.post_json(&format!("/v1/jobs/{job_id}/analysis/retry")).await.map_err(to_message)?;
    
    Ok(AnalysisRetryResult {
        accepted: payload
            .get("accepted")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        message: payload
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
        job_id: payload
            .get("job_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&job_id)
            .to_string(),
        status: payload
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("analyzing")
            .to_string(),
    })
}

#[tauri::command]
pub async fn archive_cloud_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.post_json(&format!("/v1/jobs/{job_id}/archive")).await.map_err(to_message)?;
    Ok(())
}

#[tauri::command]
pub async fn unarchive_cloud_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃƒÂ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.post_json(&format!("/v1/jobs/{job_id}/unarchive")).await.map_err(to_message)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_cloud_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.delete_json(&format!("/v1/jobs/{job_id}")).await.map_err(to_message)?;
    Ok(())
}

#[tauri::command]
pub async fn archive_cloud_client(
    state: State<'_, AppState>,
    client_slug: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.post_empty(&format!("/v1/dashboard/clients/{client_slug}/archive")).await.map_err(to_message)
}

#[tauri::command]
pub async fn delete_cloud_client(
    state: State<'_, AppState>,
    client_slug: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.delete_empty(&format!("/v1/dashboard/clients/{client_slug}")).await.map_err(to_message)
}

#[tauri::command]
pub async fn archive_cloud_project(
    state: State<'_, AppState>,
    client_slug: String,
    project_slug: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.post_empty(&format!("/v1/dashboard/clients/{client_slug}/projects/{project_slug}/archive")).await.map_err(to_message)
}

#[tauri::command]
pub async fn delete_cloud_project(
    state: State<'_, AppState>,
    client_slug: String,
    project_slug: String,
) -> Result<(), String> {
    let token = state.auth.refresh_token_if_needed().await.map_err(to_message)?
        .ok_or("no hay token de autenticaciÃ³n")?;

    let api_token = token.id_token.unwrap_or(token.access_token);
    let api = crate::api_client::ApiClient::new(api_token);
    api.delete_empty(&format!("/v1/dashboard/clients/{client_slug}/projects/{project_slug}")).await.map_err(to_message)
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

fn prune_empty_library_dirs(start: Option<&Path>, stop_at: &Path) {
    let Some(mut current) = start.map(Path::to_path_buf) else {
        return;
    };

    while current.starts_with(stop_at) && current != stop_at {
        match fs::remove_dir(&current) {
            Ok(()) => {
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                } else {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}
