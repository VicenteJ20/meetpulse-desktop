use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    app_state::AppState,
    audio::{self, AudioDevice},
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
    let path = state.storage.recording_folder(&recording_id);
    if !path.exists() {
        return Err("la carpeta de la grabacion no existe".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| error.to_string())
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
