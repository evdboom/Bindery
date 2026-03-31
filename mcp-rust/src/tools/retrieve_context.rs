use crate::config::Config;
use crate::embeddings::provider::EmbeddingProvider;
use crate::retrieve::{retrieve_context as retrieve, RetrieveInput, RetrieveResult};
use crate::TimingMs;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveContextInput {
    pub query: String,
    pub language: String,
    pub top_k: Option<u32>,
    pub act: Option<String>,
    pub chapter_range: Option<String>,
}

pub fn retrieve_context(
    config: &Config,
    provider: &dyn EmbeddingProvider,
    input: RetrieveContextInput,
    last_timing: Arc<Mutex<Option<TimingMs>>>,
) -> Result<RetrieveResult> {
    let top_k = input.top_k.map(|v| v as usize).unwrap_or(config.default_topk);
    let result = retrieve(config, provider, RetrieveInput {
        query: input.query,
        language: input.language,
        top_k,
        act: input.act,
        chapter_range: input.chapter_range,
    })?;
    if let Ok(mut guard) = last_timing.lock() {
        *guard = Some(result.timing_ms.clone());
    }
    Ok(result)
}
