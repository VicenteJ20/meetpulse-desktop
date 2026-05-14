use std::io::Write;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context};
use keyring::Entry;
use oauth2::basic::BasicClient;
use oauth2::reqwest::async_http_client;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, CsrfToken, PkceCodeChallenge, PkceCodeVerifier, Scope,
    TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

const GOOGLE_CLIENT_ID: &str = "YOUR_GOOGLE_CLIENT_ID";
const SERVICE_NAME: &str = "meetings-recorder";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub email: Option<String>,
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

    pub async fn init(&self) -> anyhow::Result<()> {
        let client = BasicClient::new(
            ClientId::new(GOOGLE_CLIENT_ID.to_string()),
            None,
            AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
            Some(TokenUrl::new(
                "https://oauth2.googleapis.com/token".to_string(),
            )?),
        );

        let mut c = self.client.lock().await;
        *c = Some(client);
        Ok(())
    }

    pub async fn get_auth_url(&self, port: u16) -> anyhow::Result<(String, CsrfToken, PkceCodeVerifier)> {
        let client = self.client.lock().await;
        let client = client.as_ref().context("auth no inicializado")?;

        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let auth_url = client
            .authorize_url(CsrfToken::new_random)
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .set_pkce_challenge(pkce_challenge);

        let (url, csrf_state) = auth_url.url();

        let url = format!(
            "{}&access_type=offline&prompt=consent&redirect_uri=http://localhost:{}/callback",
            url, port
        );

        tracing::info!("URL de autorización: {}", url);

        Ok((url, csrf_state, pkce_verifier))
    }

    pub async fn start_oauth_flow(&self, app: AppHandle) -> anyhow::Result<AuthState> {
        self.init().await?;

        let port = Self::find_available_port()?;
        let (auth_url, _csrf_state, pkce_verifier) = self.get_auth_url(port).await?;

        app.opener()
            .open_url(&auth_url, None::<String>)
            .map_err(|e| anyhow::anyhow!("no se pudo abrir navegador: {}", e))?;

        let code = Self::wait_for_callback(port).await?;

        let tokens = self.exchange_code_for_tokens(code, pkce_verifier).await?;

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
        Ok(addr.port())
    }

    async fn wait_for_callback(port: u16) -> anyhow::Result<String> {
        use std::io::Read;

        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))?;
        listener.set_nonblocking(true)?;

        let timeout = Duration::from_secs(120);
        let start = std::time::Instant::now();

        loop {
            if start.elapsed() > timeout {
                bail!("tiempo de espera agotado para callback de OAuth");
            }

            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                if let Ok(n) = stream.read(&mut buf) {
                    let request = String::from_utf8_lossy(&buf[..n]);

                    if let Some(query) = request.split("GET ").nth(1) {
                        if let Some(path) = query.split_whitespace().next() {
                            if path.starts_with("/callback?") {
                                let code = Self::extract_param(path, "code");

                                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Autenticación exitosa. Puedes cerrar esta pestaña.</h1></body></html>";
                                let _ = stream.write_all(response.as_bytes());

                                if let Some(code) = code {
                                    return Ok(code);
                                }
                            }
                        }
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
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
    ) -> anyhow::Result<AuthTokens> {
        let client = self.client.lock().await;
        let client = client.as_ref().context("auth no inicializado")?;

        let token_result = client
            .exchange_code(AuthorizationCode::new(code))
            .set_pkce_verifier(pkce_verifier)
            .request_async(async_http_client)
            .await
            .map_err(|e| anyhow::anyhow!("error intercambiando código por tokens: {}", e))?;

        let access_token = token_result.access_token().secret().to_string();
        let refresh_token = token_result
            .refresh_token()
            .map(|t| t.secret().to_string())
            .unwrap_or_default();
        let expires_in = token_result.expires_in().map(|d| d.as_secs()).unwrap_or(3600);
        let expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("error calculando tiempo: {}", e))?
            .as_secs() as i64
            + expires_in as i64;

        Ok(AuthTokens {
            access_token,
            refresh_token,
            expires_at,
            email: None,
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
        let entry = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry: {}", e))?;

        let json = serde_json::to_string(tokens)
            .map_err(|e| anyhow::anyhow!("error serializando tokens: {}", e))?;

        entry
            .set_password(&json)
            .map_err(|e| anyhow::anyhow!("error guardando tokens: {}", e))?;

        Ok(())
    }

    pub fn load_tokens(&self) -> anyhow::Result<Option<AuthTokens>> {
        let entry = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry: {}", e))?;

        match entry.get_password() {
            Ok(json) => {
                let tokens: AuthTokens =
                    serde_json::from_str(&json).map_err(|e| anyhow::anyhow!("error parseando tokens: {}", e))?;
                Ok(Some(tokens))
            }
            Err(_) => Ok(None),
        }
    }

    pub fn delete_tokens(&self) -> anyhow::Result<()> {
        let entry = Entry::new(SERVICE_NAME, "google_tokens")
            .map_err(|e| anyhow::anyhow!("error creando entry: {}", e))?;

        let _ = entry.delete_credential();
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

        if tokens.expires_at - now > 300 {
            return Ok(Some(tokens));
        }

        if tokens.refresh_token.is_empty() {
            return Ok(None);
        }

        let client = reqwest::Client::new();
        let params = [
            ("client_id", GOOGLE_CLIENT_ID),
            ("refresh_token", &tokens.refresh_token),
            ("grant_type", "refresh_token"),
        ];

        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("error refresh token: {}", e))?;

        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: i64,
        }

        let refresh_response: RefreshResponse = response
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("error parseando refresh response: {}", e))?;

        let new_expires_at = now + refresh_response.expires_in;

        let new_tokens = AuthTokens {
            access_token: refresh_response.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new_expires_at,
            email: tokens.email,
        };

        self.save_tokens(&new_tokens)?;

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