use std::io::Write;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context};
use keyring::Entry;
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, CsrfToken, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenUrl,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

fn google_client_id() -> String {
    std::env::var("GOOGLE_CLIENT_ID").expect("GOOGLE_CLIENT_ID must be set")
}

fn google_client_secret() -> String {
    std::env::var("GOOGLE_CLIENT_SECRET").expect("GOOGLE_CLIENT_SECRET must be set")
}
const SERVICE_NAME: &str = "meetings-recorder";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub email: Option<String>,
    pub id_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub is_authenticated: bool,
    pub email: Option<String>,
}

pub struct GoogleAuth {
    client: Arc<Mutex<Option<BasicClient>>>,
}

impl GoogleAuth {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn init(&self, port: u16) -> anyhow::Result<()> {
        let redirect_url = format!("http://localhost:{}/callback", port);
        let client = BasicClient::new(
            ClientId::new(google_client_id()),
            Some(oauth2::ClientSecret::new(google_client_secret())),
            AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
            Some(TokenUrl::new(
                "https://oauth2.googleapis.com/token".to_string(),
            )?),
        )
        .set_redirect_uri(RedirectUrl::new(redirect_url)?);

        let mut c = self.client.lock().await;
        *c = Some(client);
        Ok(())
    }

    pub async fn get_auth_url(&self) -> anyhow::Result<(String, CsrfToken, PkceCodeVerifier)> {
        let client = self.client.lock().await;
        let client = client.as_ref().context("auth no inicializado")?;

        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let auth_url = client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .set_pkce_challenge(pkce_challenge)
            .add_extra_param("access_type", "offline")
            .add_extra_param("prompt", "consent");

        let (url, csrf_state) = auth_url.url();

        let url_str = url.to_string();

        tracing::info!("URL de autorización: {}", url_str);

        Ok((url_str, csrf_state, pkce_verifier))
    }

    pub async fn start_oauth_flow(&self, app: AppHandle) -> anyhow::Result<AuthState> {
        let port = Self::find_available_port()?;
        tracing::info!("Puerto seleccionado: {}", port);

        self.init(port).await?;

        let (auth_url, _csrf_state, pkce_verifier) = self.get_auth_url().await?;
        tracing::info!("Abriendo navegador con URL de OAuth");

        app.opener()
            .open_url(&auth_url, None::<String>)
            .map_err(|e| anyhow::anyhow!("no se pudo abrir navegador: {}", e))?;

        tracing::info!("Esperando callback en puerto {}...", port);
        let code = Self::wait_for_callback(port).await?;
        tracing::info!("Código recibido, intercambiando por tokens");

        let tokens = self.exchange_code_for_tokens(code, pkce_verifier, port).await?;
        tracing::info!("Tokens recibidos, guardando...");

        self.save_tokens(&tokens)?;

        let email = self.get_user_email(&tokens.access_token).await.ok();

        Ok(AuthState {
            is_authenticated: true,
            email,
        })
    }

    fn find_available_port() -> anyhow::Result<u16> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let addr = listener.local_addr()?;
        drop(listener);
        std::thread::sleep(std::time::Duration::from_millis(100));
        Ok(addr.port())
    }

    async fn wait_for_callback(port: u16) -> anyhow::Result<String> {
        use std::io::Read;

        let addr = format!("127.0.0.1:{}", port);
        tracing::info!("Esperando callback en {}", addr);

        let listener = TcpListener::bind(&addr).map_err(|e| {
            tracing::error!("Error al bindear listener en {}: {}", addr, e);
            anyhow::anyhow!("error bindeando listener: {}", e)
        })?;

        let timeout = Duration::from_secs(120);
        let start = std::time::Instant::now();

        loop {
            if start.elapsed() > timeout {
                bail!("tiempo de espera agotado para callback de OAuth");
            }

            match listener.accept() {
                Ok((mut stream, _)) => {
                    tracing::info!("Conexión recibida");
                    let mut buf = [0u8; 4096];
                    match stream.read(&mut buf) {
                        Ok(n) if n > 0 => {
                            let request = String::from_utf8_lossy(&buf[..n]);
                            tracing::info!("Request: {}", &request[..request.len().min(200)]);

                            if let Some(query) = request.split("GET ").nth(1) {
                                if let Some(path) = query.split_whitespace().next() {
                                    if path.starts_with("/callback?") {
                                        let code = Self::extract_param(path, "code");
                                        tracing::info!("Código extraído: {:?}", code);

                                        let html_content = include_str!("oauth_success.html");
                                        let response = format!(
                                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{}",
                                            html_content
                                        );
                                        let _ = stream.write_all(response.as_bytes());

                                        if let Some(code) = code {
                                            return Ok(code);
                                        }
                                    }
                                }
                            }
                        }
                        Ok(_) => tracing::warn!("Conexión cerrada sin datos"),
                        Err(e) => tracing::error!("Error leyendo stream: {}", e),
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
                Err(e) => {
                    tracing::error!("Error aceptando conexión: {}", e);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
            }
        }
    }

    fn extract_param(path: &str, param: &str) -> Option<String> {
        path.split('?')
            .nth(1)?
            .split('&')
            .filter(|s| s.starts_with(&format!("{}=", param)))
            .next()
            .and_then(|s| {
                let val = s.split('=').nth(1)?;
                Some(urlencoding::decode(val).ok()?.to_string())
            })
    }

    async fn exchange_code_for_tokens(
        &self,
        code: String,
        pkce_verifier: PkceCodeVerifier,
        port: u16,
    ) -> anyhow::Result<AuthTokens> {
        tracing::info!("Intercambiando código por tokens...");
        
        let req_client = reqwest::Client::new();
        let client_id = google_client_id();
        let client_secret = google_client_secret();
        let params = [
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", &code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &format!("http://localhost:{}/callback", port)),
            ("code_verifier", pkce_verifier.secret()),
        ];

        let response = req_client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("error request token: {}", e))?;

        #[derive(Deserialize, Debug)]
        struct TokenResponsePayload {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
            id_token: Option<String>,
        }

        let token_result: TokenResponsePayload = response
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("error parseando respuesta: {}", e))?;

        let expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("error calculando tiempo: {}", e))?
            .as_secs() as i64
            + token_result.expires_in;

        Ok(AuthTokens {
            access_token: token_result.access_token,
            refresh_token: token_result.refresh_token.unwrap_or_default(),
            expires_at,
            email: None,
            id_token: token_result.id_token,
        })
    }

    async fn get_user_email(&self, access_token: &str) -> anyhow::Result<String> {
        let client = reqwest::Client::new();
        let response = client
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("error obteniendo info de usuario: {}", e))?;

        #[derive(Deserialize)]
        struct UserInfo {
            email: String,
        }

        let user_info: UserInfo = response
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("error parseando respuesta: {}", e))?;

        Ok(user_info.email)
    }

    pub fn save_tokens(&self, tokens: &AuthTokens) -> anyhow::Result<()> {
        let entry_main = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry principal: {}", e))?;
            
        let entry_id = Entry::new(SERVICE_NAME, "google_id_token")
            .map_err(|e| anyhow::anyhow!("error creando entry id_token: {}", e))?;

        let mut tokens_to_save = tokens.clone();
        let id_token = tokens_to_save.id_token.take();

        let json = serde_json::to_string(&tokens_to_save)
            .map_err(|e| anyhow::anyhow!("error serializando tokens: {}", e))?;

        entry_main
            .set_password(&json)
            .map_err(|e| anyhow::anyhow!("error guardando tokens: {}", e))?;

        if let Some(id_tok) = id_token {
            let _ = entry_id.set_password(&id_tok);
        } else {
            let _ = entry_id.delete_credential();
        }

        Ok(())
    }

    pub fn load_tokens(&self) -> anyhow::Result<Option<AuthTokens>> {
        let entry_main = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry principal: {}", e))?;
            
        let entry_id = Entry::new(SERVICE_NAME, "google_id_token")
            .map_err(|e| anyhow::anyhow!("error creando entry id_token: {}", e))?;

        match entry_main.get_password() {
            Ok(json) => {
                let mut tokens: AuthTokens =
                    serde_json::from_str(&json).map_err(|e| anyhow::anyhow!("error parseando tokens: {}", e))?;
                
                if let Ok(id_token) = entry_id.get_password() {
                    tokens.id_token = Some(id_token);
                }

                Ok(Some(tokens))
            }
            Err(_) => Ok(None),
        }
    }

    pub fn delete_tokens(&self) -> anyhow::Result<()> {
        let entry_main = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry principal: {}", e))?;
            
        let entry_id = Entry::new(SERVICE_NAME, "google_id_token")
            .map_err(|e| anyhow::anyhow!("error creando entry id_token: {}", e))?;

        let _ = entry_main.delete_credential();
        let _ = entry_id.delete_credential();
        Ok(())
    }

    pub async fn refresh_token_if_needed(&self) -> anyhow::Result<Option<AuthTokens>> {
        let tokens = match self.load_tokens()? {
            Some(t) => t,
            None => return Ok(None),
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("error calculando tiempo: {}", e))?
            .as_secs() as i64;

        // Still valid for more than 5 minutes — return as-is
        if tokens.expires_at - now > 300 {
            return Ok(Some(tokens));
        }

        if tokens.refresh_token.is_empty() {
            tracing::warn!("No hay refresh token guardado; el usuario debe re-autenticarse");
            return Ok(None);
        }

        tracing::info!("Access token expirado, renovando con refresh token...");

        let client = reqwest::Client::new();
        let client_id = google_client_id();
        let client_secret = google_client_secret();
        let params = [
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", &tokens.refresh_token),
            ("grant_type", "refresh_token"),
        ];

        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("error enviando refresh request: {}", e))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<sin cuerpo>".to_string());

        if !status.is_success() {
            tracing::error!("Refresh token falló con status {}: {}", status, &body[..body.len().min(300)]);
            // Google returns 400 for expired/revoked refresh tokens (invalid_grant).
            // Clear the stored credentials so the app can prompt for a fresh login
            // instead of silently looping on every startup.
            if status.as_u16() == 400 || status.as_u16() == 401 {
                tracing::warn!("Credenciales revocadas por Google. Limpiando tokens guardados para forzar re-login.");
                let _ = self.delete_tokens();
            }
            return Ok(None);
        }

        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: i64,
            id_token: Option<String>,
        }

        let refresh_response: RefreshResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("error parseando refresh response: {} — body: {}", e, &body[..body.len().min(200)]))?;

        let new_expires_at = now + refresh_response.expires_in;

        let new_tokens = AuthTokens {
            access_token: refresh_response.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new_expires_at,
            email: tokens.email,
            id_token: refresh_response.id_token.or(tokens.id_token),
        };

        self.save_tokens(&new_tokens)?;
        tracing::info!("Token renovado correctamente, expira en {}s", refresh_response.expires_in);

        Ok(Some(new_tokens))
    }

    pub fn get_auth_state(&self) -> anyhow::Result<AuthState> {
        match self.load_tokens() {
            Ok(Some(tokens)) => Ok(AuthState {
                is_authenticated: true,
                email: tokens.email,
            }),
            _ => Ok(AuthState {
                is_authenticated: false,
                email: None,
            }),
        }
    }
}

impl Default for GoogleAuth {
    fn default() -> Self {
        Self::new()
    }
}