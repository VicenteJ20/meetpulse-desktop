use anyhow::{bail, Context};
use reqwest::{
    multipart::{Form, Part},
    Client,
};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub base_url: String,
}

pub fn get_backend_config() -> BackendConfig {
    #[cfg(debug_assertions)]
    let base_url = "http://localhost:8000".to_string();

    #[cfg(not(debug_assertions))]
    let base_url = "https://api.tu-backend-produccion.com".to_string();

    BackendConfig { base_url }
}

pub struct ApiClient {
    client: Client,
    config: BackendConfig,
    api_key: String,
}

impl ApiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            config: get_backend_config(),
            api_key,
        }
    }

    fn join_path(&self, path: &str) -> anyhow::Result<String> {
        let base = self.config.base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            bail!("falta URL del backend");
        }
        Ok(format!("{}/{}", base, path.trim_start_matches('/')))
    }

    pub async fn get_json(&self, path: &str) -> anyhow::Result<serde_json::Value> {
        let url = self.join_path(path)?;
        let response = self
            .client
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .with_context(|| format!("error de red al contactar {url}"))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            bail!(
                "el backend respondio {}: {}",
                status.as_u16(),
                body.trim().lines().next().unwrap_or("sin detalle")
            );
        }

        serde_json::from_str(&body).with_context(|| format!("parsing JSON from {url}"))
    }

    pub async fn post_json(&self, path: &str) -> anyhow::Result<serde_json::Value> {
        let url = self.join_path(path)?;
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .with_context(|| format!("error de red al contactar {url}"))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            bail!(
                "el backend respondio {}: {}",
                status.as_u16(),
                body.trim().lines().next().unwrap_or("sin detalle")
            );
        }

        serde_json::from_str(&body).with_context(|| format!("parsing JSON from {url}"))
    }

    pub async fn upload_transcription(
        &self,
        audio_path: &Path,
        upload_file_name: &str,
        relative_path: &str,
        duration_ms: Option<u64>,
    ) -> anyhow::Result<(u16, String)> {
        let url = self.join_path("/transcription/")?;
        let audio = tokio::fs::read(audio_path)
            .await
            .with_context(|| format!("reading {}", audio_path.display()))?;

        let mime = match audio_path.extension().and_then(|ext| ext.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case("mp3") => "audio/mpeg",
            _ => "audio/ogg",
        };

        // Sanitizamos el nombre para multipart
        let safe_file_name = upload_file_name
            .chars()
            .map(|c| match c {
                '"' | '\r' | '\n' => '-',
                c => c,
            })
            .collect::<String>();

        let safe_file_name = if safe_file_name.trim().is_empty() {
            "audio.opus".to_string()
        } else {
            safe_file_name
        };

        let file_part = Part::bytes(audio)
            .file_name(safe_file_name)
            .mime_str(mime)?;

        let mut form = Form::new()
            .part("file", file_part)
            .text("relative_path", relative_path.to_string());

        if let Some(duration) = duration_ms.filter(|&v| v > 0) {
            form = form.text("duration_ms", duration.to_string());
        }

        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .with_context(|| format!("error enviando audio a {url}"))?;

        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();

        if status != 202 {
            bail!(
                "el servicio respondio {}: {}",
                status,
                body.trim().lines().next().unwrap_or("sin detalle")
            );
        }

        Ok((status, body))
    }
}
