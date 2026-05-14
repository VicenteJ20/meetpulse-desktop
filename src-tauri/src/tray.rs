use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const SHOW_WIDGET: &str = "show-widget";
const SHOW_DASHBOARD: &str = "show-dashboard";
const HIDE_ALL: &str = "hide-all";
const QUIT: &str = "quit";

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(SHOW_WIDGET, "Mostrar widget (Ctrl+Alt+M)")
        .text(SHOW_DASHBOARD, "Abrir dashboard")
        .separator()
        .text(HIDE_ALL, "Ocultar ventanas")
        .text(QUIT, "Salir")
        .build()?;

    let mut builder = TrayIconBuilder::with_id("meetings-assistant")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Meetings Assistant")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_WIDGET => show_widget_or_dashboard(app),
            SHOW_DASHBOARD => show_window(app, "main"),
            HIDE_ALL => hide_all_windows(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_widget_or_dashboard(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn show_widget_or_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if app.get_webview_window("widget").is_some() {
        show_window(app, "widget");
    } else {
        show_window(app, "main");
    }
}

pub fn hide_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

fn hide_all_windows<R: Runtime>(app: &AppHandle<R>) {
    hide_window(app, "main");
    hide_window(app, "widget");
}
