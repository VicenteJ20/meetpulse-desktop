use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use chrono::Local;
use directories::UserDirs;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    app_state::AppState,
    audio::{self, AudioDevice},
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
pub async fn select_microphone(_device_id: String) -> Result<(), String> {
    Ok(())
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
    let source = recording_dir.join("final").join("mixed.opus");
    if !source.exists() {
        bail!("el audio final aun no esta disponible");
    }

    let music_root = music_library_root()?;
    let target_dir = if draft {
        music_root.join("drafts")
    } else {
        let client = required_folder_name(client, "cliente")?;
        let project = required_folder_name(project, "proyecto")?;
        music_root.join(client).join(project)
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

fn music_library_root() -> anyhow::Result<PathBuf> {
    let user_dirs = UserDirs::new().context("resolving user directories")?;
    let music = user_dirs
        .audio_dir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| user_dirs.home_dir().join("Music"));
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
