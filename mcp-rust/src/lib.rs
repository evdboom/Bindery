pub mod config;
pub mod tools;
pub mod docstore;
pub mod index;
pub mod embeddings;
pub mod retrieve;
pub mod format;
pub mod merge;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMeta {
    pub id: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub score: f32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimingMs {
    pub embed_query: Option<u128>,
    pub lexical: Option<u128>,
    pub vector: Option<u128>,
    pub rerank: Option<u128>,
    pub snippets: Option<u128>,
    pub total: Option<u128>,
}
