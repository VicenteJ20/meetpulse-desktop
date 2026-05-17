fn main() {
    println!("cargo:rerun-if-env-changed=MEETPULSE_BACKEND_URL");
    println!("cargo:rerun-if-changed=../.env");

    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    let backend_url = std::env::var("MEETPULSE_BACKEND_URL")
        .ok()
        .or_else(|| read_env_file_value(&env_path, "MEETPULSE_BACKEND_URL"))
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());

    if let Some(url) = backend_url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            panic!("MEETPULSE_BACKEND_URL debe comenzar con http:// o https://");
        }
        println!("cargo:rustc-env=MEETPULSE_BACKEND_URL={url}");
    } else if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "Falta MEETPULSE_BACKEND_URL. Define la URL del backend antes de compilar el bundle final."
        );
    }

    tauri_build::build();
}

fn read_env_file_value(path: &std::path::Path, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    content.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }

        let (line_key, value) = line.split_once('=')?;
        if line_key.trim() != key {
            return None;
        }

        Some(value.trim().trim_matches('"').trim_matches('\'').to_string())
    })
}
