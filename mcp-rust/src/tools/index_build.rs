use crate::config::Config;
use crate::docstore::chunk::chunk_file;
use crate::docstore::discover::{discover_index_files, DiscoverOptions};
use crate::embeddings::provider::EmbeddingProvider;
use crate::index::lexical::build_lexical;
use crate::index::meta::{ChunkingMeta, IndexMeta, write_meta};
use crate::index::vector::build_vector;
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexBuildInput {
    pub scope: Option<String>,
    pub act: Option<String>,
    pub chapter_range: Option<String>,
    pub force_rebuild: Option<bool>,
    pub require_synced: Option<bool>,
    pub sync_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexBuildResult {
    pub chunk_count: usize,
    pub lexical_built: bool,
    pub vector_built: bool,
    pub embeddings_dim: Option<usize>,
    pub elapsed_ms: u128,
    pub warnings: Vec<String>,
}

pub fn index_build(config: &Config, provider: &dyn EmbeddingProvider, input: IndexBuildInput) -> Result<IndexBuildResult> {
    let start = Instant::now();
    let mut warnings = Vec::new();
    if input.require_synced == Some(false) {
        warnings.push("require_synced=false is ignored; index_build always syncs before indexing".to_string());
    }
    let sync_result = crate::tools::sync_workspace::sync_for_indexing(config, input.sync_paths)?;
    warnings.extend(sync_result.warnings);

    let opts = DiscoverOptions {
        language: "ALL".to_string(),
        act: input.act.clone(),
        chapter_range: input.chapter_range.clone(),
    };
    let files = discover_index_files(&config.work_root, &opts)?;
    let mut chunks = Vec::new();
    for file in files {
        let mut file_chunks = chunk_file(&config.work_root, &file)?;
        chunks.append(&mut file_chunks);
    }

    build_lexical(&config.index_dir, &chunks)?;

    let mut embeddings_dim = None;
    let vector_built = if provider.is_available() {
        match build_vector(&config.index_dir, &chunks, provider, config.embed_batch_size)? {
            Some(dim) => {
                embeddings_dim = Some(dim);
                true
            }
            None => false,
        }
    } else {
        warnings.push("embeddings backend not reachable; vector index skipped".to_string());
        false
    };

    let meta = IndexMeta {
        schema_version: 1,
        built_at: Utc::now(),
        work_root: config.work_root.to_string_lossy().to_string(),
        index_dir: config.index_dir.to_string_lossy().to_string(),
        language: "ALL".to_string(),
        scope: input.scope.unwrap_or_else(|| "full".to_string()),
        act: input.act,
        chapter_range: input.chapter_range,
        embeddings_backend: provider.backend(),
        embeddings_model: provider.model(),
        embeddings_dim,
        chunking: ChunkingMeta { strategy: "markdown-paragraph".to_string(), min_lines: 1, max_lines: 9999 },
        chunk_count: chunks.len(),
        config_hash: config.config_hash(),
    };
    let meta_path = config.index_dir.join("meta.json");
    fs::create_dir_all(&config.index_dir)?;
    write_meta(&meta_path, &meta)?;

    Ok(IndexBuildResult {
        chunk_count: meta.chunk_count,
        lexical_built: true,
        vector_built,
        embeddings_dim,
        elapsed_ms: start.elapsed().as_millis(),
        warnings,
    })
}
