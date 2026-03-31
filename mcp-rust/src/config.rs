use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{env, path::{Path, PathBuf}, process::Command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub source_root: PathBuf,
    pub work_root: PathBuf,
    pub index_dir: PathBuf,
    pub mcp_mirror_root: Option<PathBuf>,
    pub embeddings_backend: String,
    pub ollama_url: String,
    pub ollama_model: String,
    pub onnx_url: String,
    pub onnx_model: String,
    /// Optional: standalone directory where the ONNX server lives (Windows path).
    /// Falls back to {source_root}/_src/scripts if not set.
    pub onnx_server_dir: Option<String>,
    pub embed_batch_size: usize,
    pub sync_delete_default: bool,
    pub max_response_bytes: usize,
    pub snippet_max_chars: usize,
    pub default_topk: usize,
    /// Author name for EPUB/DOCX metadata
    pub author: Option<String>,
    /// Path to LibreOffice executable for PDF export.
    /// Defaults to "libreoffice" (Linux/WSL). On Windows, set to full path of soffice.exe.
    pub libreoffice_path: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let source_root = get_required_path("BINDERY_SOURCE_ROOT")?;
        let work_root = get_required_path("BINDERY_WORK_ROOT")?;
        let index_dir = match env::var("BINDERY_INDEX_DIR") {
            Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
            _ => work_root.join(".bindery").join("index"),
        };

        Ok(Self {
            source_root,
            work_root,
            index_dir,
            mcp_mirror_root: env::var("BINDERY_MCP_MIRROR_ROOT").ok().filter(|v| !v.trim().is_empty()).map(PathBuf::from),
            embeddings_backend: env::var("BINDERY_EMBEDDINGS_BACKEND").unwrap_or_else(|_| "none".to_string()),
            ollama_url: env::var("BINDERY_OLLAMA_URL").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string()),
            ollama_model: env::var("BINDERY_OLLAMA_MODEL").unwrap_or_else(|_| "nomic-embed-text".to_string()),
            onnx_url: env::var("BINDERY_ONNX_URL").unwrap_or_else(|_| {
                let port = env_usize("BINDERY_ONNX_PORT", 11435);
                detect_windows_host_url(port).unwrap_or_else(|| format!("http://127.0.0.1:{}", port))
            }),
            onnx_model: env::var("BINDERY_ONNX_MODEL").unwrap_or_else(|_| "bge-m3".to_string()),
            onnx_server_dir: env::var("BINDERY_ONNX_SERVER_DIR").ok().filter(|v| !v.trim().is_empty()),
            embed_batch_size: env_usize("BINDERY_EMBED_BATCH_SIZE", 32),
            sync_delete_default: env_bool("BINDERY_SYNC_DELETE", false),
            max_response_bytes: env_usize("BINDERY_MAX_RESPONSE_BYTES", 60_000),
            snippet_max_chars: env_usize("BINDERY_SNIPPET_MAX_CHARS", 1600),
            default_topk: env_usize("BINDERY_DEFAULT_TOPK", 6),
            author: env::var("BINDERY_AUTHOR").ok().filter(|v| !v.trim().is_empty()),
            libreoffice_path: env::var("BINDERY_LIBREOFFICE_PATH")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "libreoffice".to_string()),
        })
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.work_root.join(".bindery").join("work_manifest.json")
    }

    pub fn config_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.source_root.to_string_lossy().as_bytes());
        hasher.update(self.work_root.to_string_lossy().as_bytes());
        hasher.update(self.index_dir.to_string_lossy().as_bytes());
        hasher.update(self.embeddings_backend.as_bytes());
        hasher.update(self.ollama_url.as_bytes());
        hasher.update(self.ollama_model.as_bytes());
        hasher.update(self.onnx_url.as_bytes());
        hasher.update(self.onnx_model.as_bytes());
        hex::encode(hasher.finalize())
    }
}

pub fn is_mount_path(path: &Path) -> bool {
    path.to_string_lossy().starts_with("/mnt/")
}

fn env_bool(key: &str, default: bool) -> bool {
    env::var(key)
        .ok()
        .and_then(|v| match v.to_lowercase().as_str() {
            "1" | "true" | "yes" | "y" => Some(true),
            "0" | "false" | "no" | "n" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

fn env_usize(key: &str, default: usize) -> usize {
    env::var(key).ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or(default)
}

fn get_required_path(key: &str) -> Result<PathBuf> {
    let value = env::var(key).map_err(|_| anyhow!("Missing required env: {key}"))?;
    if value.trim().is_empty() {
        return Err(anyhow!("Missing required env: {key}"));
    }
    Ok(PathBuf::from(value))
}

/// Detect the Windows host IP from WSL by reading the default gateway via `ip route`.
/// Returns `Some("http://<ip>:<port>")` on success, `None` if detection fails.
fn detect_windows_host_url(port: usize) -> Option<String> {
    let output = Command::new("ip").args(["route"]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let ip = stdout
        .lines()
        .find(|l| l.starts_with("default"))?
        .split_whitespace()
        .nth(2)?
        .to_string();
    if ip.is_empty() { return None; }
    Some(format!("http://{}:{}", ip, port))
}
