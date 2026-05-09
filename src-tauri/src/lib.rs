mod app_state;
mod audio;
mod commands;
mod finalizer;
mod manifest;
mod native_audio;
mod paths;
mod recorder;
mod recovery;
mod storage;

use app_state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::initialize(app.handle().clone())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_recorder_snapshot,
            commands::start_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::stop_recording,
            commands::list_recordings,
            commands::open_recording_folder,
            commands::open_external_url,
            commands::get_audio_devices,
            commands::select_microphone
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Meetings Assistant");
}
