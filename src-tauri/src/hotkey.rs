use tauri::AppHandle;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    setup_platform(app);
    Ok(())
}

#[cfg(not(windows))]
fn setup_platform(_app: &AppHandle) {}

#[cfg(windows)]
fn setup_platform(app: &AppHandle) {
    let app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("widget-hotkey".to_string())
        .spawn(move || run_widget_hotkey(app))
    {
        tracing::warn!(%error, "could not start widget hotkey listener");
    }
}

#[cfg(windows)]
fn run_widget_hotkey(app: AppHandle) {
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, VK_M,
        },
        WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY},
    };

    const WIDGET_HOTKEY_ID: i32 = 0x4d41;
    const WIDGET_HOTKEY_LABEL: &str = "Ctrl+Alt+M";

    unsafe {
        let modifiers = HOT_KEY_MODIFIERS(MOD_CONTROL.0 | MOD_ALT.0);
        if let Err(error) = RegisterHotKey(None, WIDGET_HOTKEY_ID, modifiers, VK_M.0 as u32) {
            tracing::warn!(%error, hotkey = WIDGET_HOTKEY_LABEL, "could not register widget hotkey");
            return;
        }

        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, None, 0, 0);
            if result.0 == -1 {
                tracing::warn!(hotkey = WIDGET_HOTKEY_LABEL, "widget hotkey message loop failed");
                break;
            }

            if result.0 == 0 {
                break;
            }

            if message.message == WM_HOTKEY && message.wParam.0 == WIDGET_HOTKEY_ID as usize {
                let app_for_window = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    crate::tray::show_widget_or_dashboard(&app_for_window);
                }) {
                    tracing::warn!(%error, hotkey = WIDGET_HOTKEY_LABEL, "could not show widget from hotkey");
                }
            }
        }

        if let Err(error) = UnregisterHotKey(None, WIDGET_HOTKEY_ID) {
            tracing::warn!(%error, hotkey = WIDGET_HOTKEY_LABEL, "could not unregister widget hotkey");
        }
    }
}
