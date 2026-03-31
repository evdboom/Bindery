pub mod provider;
pub mod ollama;
pub mod onnx;
pub mod none;

use crate::config::Config;
use anyhow::Result;
use std::sync::Arc;

pub fn build_provider(config: &Config) -> Result<Arc<dyn provider::EmbeddingProvider>> {
    match config.embeddings_backend.to_lowercase().as_str() {
        "ollama" => Ok(Arc::new(ollama::OllamaProvider::new(
            config.ollama_url.clone(),
            config.ollama_model.clone(),
        ))),
        "onnx" => Ok(Arc::new(onnx::OnnxProvider::new(
            config.onnx_url.clone(),
            config.onnx_model.clone(),
            Some(&config.source_root),
            config.onnx_server_dir.clone(),
        ))),
        _ => Ok(Arc::new(none::NoneProvider::default())),
    }
}
