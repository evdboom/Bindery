use crate::embeddings::provider::EmbeddingProvider;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[derive(Clone)]
pub struct OnnxProvider {
    url: String,
    model: String,
    /// Standalone ONNX server directory (Windows path), if configured.
    onnx_server_dir: Option<String>,
    /// Windows path to source root (derived from BINDERY_SOURCE_ROOT), used as fallback.
    source_root_win: Option<String>,
}

impl OnnxProvider {
    pub fn new(url: String, model: String, source_root: Option<&Path>, onnx_server_dir: Option<String>) -> Self {
        let source_root_win = source_root.and_then(|p| wsl_to_windows_path(p));
        Self { url, model, onnx_server_dir, source_root_win }
    }

    fn embed_request(&self, input: &str) -> Result<Vec<f32>> {
        // Auto-start server if not running
        self.ensure_server_running()?;

        let endpoint = format!("{}/embeddings", self.url.trim_end_matches('/'));
        let body = EmbeddingRequest {
            model: self.model.clone(),
            input: EmbeddingInput::Single(input.to_string()),
        };
        let body_json = serde_json::to_string(&body)?;
        let response: Result<ureq::Response, ureq::Error> = ureq::post(&endpoint)
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(30))
            .send_string(&body_json);

        match response {
            Ok(resp) => {
                if resp.status() >= 400 {
                    return Err(anyhow!("ONNX embeddings failed: {}", resp.status()));
                }
                let text = resp.into_string().map_err(|e| anyhow!("ONNX response read failed: {e}"))?;
                let parsed: EmbeddingResponse = serde_json::from_str(&text)?;
                parsed.into_single_embedding()
            }
            Err(ureq::Error::Status(code, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                Err(anyhow!("ONNX embeddings failed: {} {}", code, text))
            }
            Err(err) => Err(anyhow!("ONNX request failed: {err}")),
        }
    }

    fn embed_batch_request(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>> {
        self.ensure_server_running()?;

        let endpoint = format!("{}/embeddings", self.url.trim_end_matches('/'));
        let body = EmbeddingRequest {
            model: self.model.clone(),
            input: EmbeddingInput::Batch(inputs.iter().map(|s| s.to_string()).collect()),
        };
        let body_json = serde_json::to_string(&body)?;
        // Longer timeout for batches
        let response: Result<ureq::Response, ureq::Error> = ureq::post(&endpoint)
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(120))
            .send_string(&body_json);

        match response {
            Ok(resp) => {
                if resp.status() >= 400 {
                    return Err(anyhow!("ONNX batch embeddings failed: {}", resp.status()));
                }
                let text = resp.into_string().map_err(|e| anyhow!("ONNX response read failed: {e}"))?;
                let parsed: EmbeddingResponse = serde_json::from_str(&text)?;
                parsed.into_batch_embeddings()
            }
            Err(ureq::Error::Status(code, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                Err(anyhow!("ONNX batch embeddings failed: {} {}", code, text))
            }
            Err(err) => Err(anyhow!("ONNX batch request failed: {err}")),
        }
    }

    fn ping(&self) -> bool {
        let endpoint = format!("{}/health", self.url.trim_end_matches('/'));
        let response: Result<ureq::Response, ureq::Error> = ureq::get(&endpoint)
            .timeout(Duration::from_secs(5))
            .call();
        match response {
            Ok(resp) => resp.status() >= 200 && resp.status() < 300,
            Err(_) => false,
        }
    }

    /// Ensure the ONNX server is running, spawning it via cmd.exe if needed.
    fn ensure_server_running(&self) -> Result<()> {
        if self.ping() {
            return Ok(());
        }

        // Prefer standalone ONNX_SERVER_DIR, fall back to source_root/_src/scripts.
        // Normalize forward slashes to backslashes so cmd.exe is happy regardless
        // of how the path was written in .env.
        let (script_dir, script_path) = if let Some(ref dir) = self.onnx_server_dir {
            let dir = dir.replace('/', "\\");
            let dir = dir.trim_end_matches('\\').to_string();
            let path = format!(r"{}\start_onnx_server.cmd", dir);
            (dir, path)
        } else if let Some(ref win_root) = self.source_root_win {
            let dir = format!(r"{}\_src\scripts", win_root);
            let path = format!(r"{}\start_onnx_server.cmd", dir);
            (dir, path)
        } else {
            return Err(anyhow!("ONNX server not running and neither BINDERY_ONNX_SERVER_DIR nor BINDERY_SOURCE_ROOT configured for auto-start"));
        };
        eprintln!("[onnx] Server not running, spawning: {}", script_path);

        // Spawn via cmd.exe (WSL interop) - /d sets the working directory so
        // relative paths inside the .cmd script (like .venv\) resolve correctly.
        let result = Command::new("cmd.exe")
            .args(["/c", "start", "/b", "/d", &script_dir, "", &script_path])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        match &result {
            Ok(_) => eprintln!("[onnx] Spawn succeeded, waiting for server..."),
            Err(e) => eprintln!("[onnx] Spawn failed: {e}"),
        }

        if let Err(e) = result {
            return Err(anyhow!("Failed to spawn ONNX server: {e}"));
        }

        // Poll until healthy (max 30s - reduced to avoid MCP timeout)
        for i in 0..30 {
            std::thread::sleep(Duration::from_secs(1));
            eprintln!("[onnx] Health check attempt {}...", i + 1);
            if self.ping() {
                eprintln!("[onnx] Server ready after {}s", i + 1);
                return Ok(());
            }
        }
        eprintln!("[onnx] Server startup timeout (30s)");
        Err(anyhow!("ONNX server startup timeout (30s)"))
    }
}

/// Convert WSL path (/mnt/d/Source/MyRepo) to Windows path (D:\Source\MyRepo)
fn wsl_to_windows_path(path: &Path) -> Option<String> {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix("/mnt/") {
        let mut chars = rest.chars();
        let drive = chars.next()?.to_ascii_uppercase();
        let remainder = chars.as_str();
        // remainder starts with / or is empty
        let win_path = format!("{}:{}", drive, remainder.replace('/', "\\"));
        Some(win_path)
    } else {
        // Already a Windows path or not a mount path
        Some(s.replace('/', "\\"))
    }
}

impl EmbeddingProvider for OnnxProvider {
    fn embed(&self, input: &str) -> Result<Vec<f32>> {
        self.embed_request(input)
    }

    fn embed_batch(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>> {
        self.embed_batch_request(inputs)
    }

    fn is_available(&self) -> bool {
        // Try auto-start if not running
        self.ensure_server_running().is_ok()
    }

    fn model(&self) -> String {
        self.model.clone()
    }

    fn backend(&self) -> String {
        "onnx".to_string()
    }
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: EmbeddingInput,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum EmbeddingInput {
    Single(String),
    Batch(Vec<String>),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum EmbeddingResponse {
    Single { embedding: Vec<f32> },
    Batch { embeddings: Vec<Vec<f32>> },
    Raw(()),
}

impl EmbeddingResponse {
    fn into_single_embedding(self) -> Result<Vec<f32>> {
        match self {
            EmbeddingResponse::Single { embedding } => Ok(embedding),
            EmbeddingResponse::Batch { embeddings } => embeddings
                .into_iter()
                .next()
                .ok_or_else(|| anyhow!("ONNX embeddings missing")),
            EmbeddingResponse::Raw(_) => Err(anyhow!("ONNX embeddings response missing embedding field")),
        }
    }

    fn into_batch_embeddings(self) -> Result<Vec<Vec<f32>>> {
        match self {
            EmbeddingResponse::Single { embedding } => Ok(vec![embedding]),
            EmbeddingResponse::Batch { embeddings } => Ok(embeddings),
            EmbeddingResponse::Raw(_) => Err(anyhow!("ONNX embeddings response missing embeddings field")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{wsl_to_windows_path, EmbeddingResponse};
    use std::path::Path;

    #[test]
    fn parses_single_embedding_response() {
        let value = serde_json::json!({"embedding": [0.1, 0.2, 0.3]});
        let parsed: EmbeddingResponse = serde_json::from_value(value).expect("parse");
        let vector = parsed.into_single_embedding().expect("vector");
        assert_eq!(vector.len(), 3);
    }

    #[test]
    fn parses_batch_embedding_response() {
        let value = serde_json::json!({"embeddings": [[0.1, 0.2]]});
        let parsed: EmbeddingResponse = serde_json::from_value(value).expect("parse");
        let vector = parsed.into_single_embedding().expect("vector");
        assert_eq!(vector.len(), 2);
    }

    #[test]
    fn converts_wsl_path_to_windows() {
        let wsl = Path::new("/mnt/d/Source/MyRepo");
        let win = wsl_to_windows_path(wsl).unwrap();
        assert_eq!(win, r"D:\Source\MyRepo");
    }

    #[test]
    fn converts_wsl_path_lowercase_drive() {
        let wsl = Path::new("/mnt/c/Users/test");
        let win = wsl_to_windows_path(wsl).unwrap();
        assert_eq!(win, r"C:\Users\test");
    }

    #[test]
    fn passes_through_windows_path() {
        let win_in = Path::new("D:/Source/MyRepo");
        let win = wsl_to_windows_path(win_in).unwrap();
        assert_eq!(win, r"D:\Source\MyRepo");
    }
}
