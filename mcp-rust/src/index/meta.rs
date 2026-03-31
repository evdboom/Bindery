use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMeta {
    pub schema_version: u32,
    pub built_at: DateTime<Utc>,
    pub work_root: String,
    pub index_dir: String,
    pub language: String,
    pub scope: String,
    pub act: Option<String>,
    pub chapter_range: Option<String>,
    pub embeddings_backend: String,
    pub embeddings_model: String,
    pub embeddings_dim: Option<usize>,
    pub chunking: ChunkingMeta,
    pub chunk_count: usize,
    pub config_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkingMeta {
    pub strategy: String,
    pub min_lines: u32,
    pub max_lines: u32,
}

pub fn write_meta(path: &Path, meta: &IndexMeta) -> Result<()> {
    let json = serde_json::to_string_pretty(meta)?;
    fs::write(path, json)?;
    Ok(())
}

pub fn read_meta(path: &Path) -> Result<IndexMeta> {
    let data = fs::read_to_string(path)?;
    let meta = serde_json::from_str(&data)?;
    Ok(meta)
}
