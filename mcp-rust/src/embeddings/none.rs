use crate::embeddings::provider::EmbeddingProvider;
use anyhow::{Result, anyhow};

#[derive(Default, Clone)]
pub struct NoneProvider {}

impl EmbeddingProvider for NoneProvider {
    fn embed(&self, _input: &str) -> Result<Vec<f32>> {
        Err(anyhow!("Embeddings backend is none"))
    }

    fn is_available(&self) -> bool {
        false
    }

    fn model(&self) -> String {
        "none".to_string()
    }

    fn backend(&self) -> String {
        "none".to_string()
    }
}
