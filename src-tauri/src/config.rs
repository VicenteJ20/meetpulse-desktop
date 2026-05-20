use std::fs;
use std::path::PathBuf;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub google_client_id: String,
    pub google_client_secret: String,
    pub backend_url: String,
}

impl AppConfig {
    pub fn load() -> anyhow::Result<Self> {
        let config_path = Self::config_path();

        if !config_path.exists() {
            bail!(
                "Configuration file not found at '{}'.\n\n\
                 Please create it based on 'config.example.json' from the repository:\n\
                 {{\n  \"google_client_id\": \"your_google_client_id\",\n  \"google_client_secret\": \"your_google_client_secret\",\n  \"backend_url\": \"http://localhost:8000\"\n}}",
                config_path.display()
            );
        }

        let content = fs::read_to_string(&config_path)
            .with_context(|| format!("reading config file at '{}'", config_path.display()))?;

        let config: AppConfig = serde_json::from_str(&content)
            .with_context(|| format!("parsing config file at '{}'", config_path.display()))?;

        if config.google_client_id.is_empty() {
            bail!("google_client_id is empty in config file");
        }
        if config.google_client_secret.is_empty() {
            bail!("google_client_secret is empty in config file");
        }

        Ok(config)
    }

    pub fn config_path() -> PathBuf {
        let base = directories::BaseDirs::new()
            .expect("could not determine user directories");
        base.data_local_dir()
            .join("MeetingsAssistant")
            .join("config")
            .join("app.json")
    }
}
