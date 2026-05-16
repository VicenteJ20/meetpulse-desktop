mod api_client;
mod app_state;
mod audio;
mod auth;
mod commands;
mod finalizer;
mod hotkey;
mod manifest;
mod native_audio;
mod notifications;
mod paths;
mod recorder;
mod recovery;
mod storage;
mod tray;

use app_state::AppState;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_log::log::LevelFilter;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Info)
                .level_for("meetings_assistant_recorder_lib", LevelFilter::Debug)
                .level_for("reqwest", LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::initialize(app.handle().clone())?;
            app.manage(state);
            tray::setup(app.handle())?;
            hotkey::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_recorder_snapshot,
            commands::start_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::stop_recording,
            commands::list_recordings,
            commands::cleanup_local_recording,
            commands::open_recording_folder,
            commands::open_external_url,
            commands::save_recording_to_library,
            commands::get_audio_devices,
            commands::get_selected_audio_devices,
            commands::select_audio_device,
            commands::select_microphone,
            commands::request_transcription,
            commands::request_analysis_retry,
            commands::archive_cloud_job,
            commands::delete_cloud_job,
            commands::archive_cloud_client,
            commands::delete_cloud_client,
            commands::archive_cloud_project,
            commands::delete_cloud_project,
            commands::sync_cloud_dashboard,
            commands::get_cloud_job_artifacts,
            commands::get_auth_state,
            commands::start_google_auth,
            commands::logout_auth
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Meetings Assistant")
        .run(|app, event| {
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } = event
            {
                api.prevent_close();
                tray::hide_window(app, &label);
            }
        });
}
