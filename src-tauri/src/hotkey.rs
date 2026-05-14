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
            RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL,
            MOD_NOREPEAT, MOD_SHIFT, VK_M,
        },
        WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY},
    };

    struct WidgetHotkey {
        id: i32,
        label: &'static str,
        modifiers: HOT_KEY_MODIFIERS,
    }

    unsafe {
        let hotkeys = [
            WidgetHotkey {
                id: 0x4d53,
                label: "Ctrl+Shift+M",
                modifiers: HOT_KEY_MODIFIERS(MOD_CONTROL.0 | MOD_SHIFT.0 | MOD_NOREPEAT.0),
            },
            WidgetHotkey {
                id: 0x4d41,
                label: "Ctrl+Alt+M",
                modifiers: HOT_KEY_MODIFIERS(MOD_CONTROL.0 | MOD_ALT.0 | MOD_NOREPEAT.0),
            },
        ];
        let mut registered_hotkeys = Vec::new();

        for hotkey in hotkeys {
            match RegisterHotKey(None, hotkey.id, hotkey.modifiers, VK_M.0 as u32) {
                Ok(()) => {
                    tracing::info!(hotkey = hotkey.label, "registered widget hotkey");
                    registered_hotkeys.push((hotkey.id, hotkey.label));
                }
                Err(error) => {
                    tracing::warn!(%error, hotkey = hotkey.label, "could not register widget hotkey");
                }
            }
        }

        if registered_hotkeys.is_empty() {
            tracing::warn!("no widget hotkeys could be registered");
            return;
        }

        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, None, 0, 0);
            if result.0 == -1 {
                tracing::warn!("widget hotkey message loop failed");
                break;
            }

            if result.0 == 0 {
                break;
            }

            if message.message == WM_HOTKEY
                && registered_hotkeys
                    .iter()
                    .any(|(id, _)| message.wParam.0 == *id as usize)
            {
                let app_for_window = app.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    crate::tray::show_widget_or_dashboard(&app_for_window);
                }) {
                    tracing::warn!(%error, "could not show widget from hotkey");
                }
            }
        }

        for (id, label) in registered_hotkeys {
            if let Err(error) = UnregisterHotKey(None, id) {
                tracing::warn!(%error, hotkey = label, "could not unregister widget hotkey");
            }
        }
    }
}
