use std::path::Path;

#[cfg(target_os = "windows")]
pub fn notify_draft_saved(path: &Path) -> anyhow::Result<()> {
    use anyhow::Context;
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };

    let path = path.to_string_lossy();
    let escaped_path = escape_xml(&path);
    let xml = format!(
        r#"
        <toast scenario="reminder">
          <visual>
            <binding template="ToastGeneric">
              <text>Borrador guardado</text>
              <text>{escaped_path}</text>
            </binding>
          </visual>
        </toast>
        "#
    );

    let document = XmlDocument::new().context("creating Windows toast document")?;
    document
        .LoadXml(&HSTRING::from(xml))
        .context("loading Windows toast XML")?;
    let notification = ToastNotification::CreateToastNotification(&document)
        .context("creating Windows toast notification")?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.meetingsassistant.recorder"))
        .or_else(|_| ToastNotificationManager::CreateToastNotifier())
        .context("creating Windows toast notifier")?;
    notifier
        .Show(&notification)
        .context("showing Windows toast notification")?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn notify_draft_saved(_path: &Path) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn escape_xml(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect::<Vec<_>>(),
            '>' => "&gt;".chars().collect::<Vec<_>>(),
            '"' => "&quot;".chars().collect::<Vec<_>>(),
            '\'' => "&apos;".chars().collect::<Vec<_>>(),
            character => vec![character],
        })
        .collect()
}
