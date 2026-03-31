use crate::config::Config;
use crate::index::meta::read_meta;
use crate::index::lexical::LEXICAL_DIR;
use crate::index::vector::VECTOR_DIR;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatusInput {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatusResult {
    pub meta: Option<crate::index::meta::IndexMeta>,
    pub lexical_present: bool,
    pub vector_present: bool,
}

pub fn index_status(config: &Config) -> Result<IndexStatusResult> {
    let meta_path = config.index_dir.join("meta.json");
    let meta = if meta_path.exists() { read_meta(&meta_path).ok() } else { None };
    Ok(IndexStatusResult {
        meta,
        lexical_present: config.index_dir.join(LEXICAL_DIR).exists(),
        vector_present: config.index_dir.join(VECTOR_DIR).exists(),
    })
}
