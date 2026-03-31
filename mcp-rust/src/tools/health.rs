use crate::config::Config;
use crate::embeddings::provider::EmbeddingProvider;
use crate::index::lexical::LEXICAL_DIR;
use crate::index::vector::VECTOR_DIR;
use crate::TimingMs;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResult {
    pub cwd: String,
    pub source_root: String,
    pub work_root: String,
    pub index_dir: String,
    pub last_sync: Option<DateTime<Utc>>,
    pub manifest_path: Option<String>,
    pub sync_stale: Option<bool>,
    pub embeddings_backend: String,
    pub embeddings_model: String,
    pub embeddings_url: Option<String>,
    pub embeddings_engine_reachable: bool,
    pub lexical_index_present: bool,
    pub vector_index_present: bool,
    pub last_retrieve_timing: Option<TimingMs>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkManifest {
    pub source_root: String,
    pub work_root: String,
    pub synced_at: DateTime<Utc>,
    pub paths: Vec<String>,
    pub changed_files: Vec<String>,
    pub file_count: usize,
}

pub fn health(config: &Config, provider: &dyn EmbeddingProvider, last_retrieve: Arc<Mutex<Option<TimingMs>>>) -> Result<HealthResult> {
    let cwd = std::env::current_dir()?.to_string_lossy().to_string();
    let manifest_path = config.manifest_path();

    let mut warnings = Vec::new();
    let mut last_sync = None;
    let mut manifest_path_str = None;

    if manifest_path.exists() {
        if let Ok(data) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<WorkManifest>(&data) {
                last_sync = Some(manifest.synced_at);
                manifest_path_str = Some(manifest_path.to_string_lossy().to_string());
            } else {
                warnings.push("manifest parse failed".to_string());
            }
        }
    }

    let lexical_index_present = config.index_dir.join(LEXICAL_DIR).exists();
    let vector_index_present = config.index_dir.join(VECTOR_DIR).exists();

    let last_retrieve_timing = last_retrieve.lock().ok().and_then(|v| v.clone());

    let backend = provider.backend();
    let reachable = match backend.as_str() {
        "onnx" => ping_url(&format!("{}/health", config.onnx_url.trim_end_matches('/'))),
        "ollama" => ping_url(&format!("{}/api/tags", config.ollama_url.trim_end_matches('/'))),
        _ => false,
    };

    Ok(HealthResult {
        cwd,
        source_root: config.source_root.to_string_lossy().to_string(),
        work_root: config.work_root.to_string_lossy().to_string(),
        index_dir: config.index_dir.to_string_lossy().to_string(),
        last_sync,
        manifest_path: manifest_path_str,
        sync_stale: None,
        embeddings_backend: backend,
        embeddings_model: provider.model(),
        embeddings_url: Some(match provider.backend().as_str() {
            "onnx" => config.onnx_url.clone(),
            "ollama" => config.ollama_url.clone(),
            _ => "none".to_string(),
        }),
        embeddings_engine_reachable: reachable,
        lexical_index_present,
        vector_index_present,
        last_retrieve_timing,
        warnings,
    })
}

fn ping_url(url: &str) -> bool {
    let response: Result<ureq::Response, ureq::Error> = ureq::get(url)
        .timeout(Duration::from_secs(2))
        .call();
    match response {
        Ok(resp) => resp.status() >= 200 && resp.status() < 300,
        Err(_) => false,
    }
}
