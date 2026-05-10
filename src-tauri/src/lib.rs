mod app_state;
mod audio;
mod commands;
mod finalizer;
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
            tray::setup(app.handle())?;
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
            commands::save_recording_to_library,
            commands::get_audio_devices,
            commands::get_selected_audio_devices,
            commands::select_audio_device,
            commands::select_microphone
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
