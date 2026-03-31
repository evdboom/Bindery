use crate::{Chunk, ChunkMeta};
use crate::embeddings::provider::EmbeddingProvider;
use anyhow::{Result, anyhow};
use hnsw_rs::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const VECTOR_DIR: &str = "vector";
const VECTORS_FILE: &str = "vectors.json";
const META_FILE: &str = "vector_meta.json";

#[derive(Debug, Serialize, Deserialize)]
struct VectorStore {
    dim: usize,
    vectors: Vec<Vec<f32>>,
}

pub fn build_vector(index_dir: &Path, chunks: &[Chunk], provider: &dyn EmbeddingProvider, batch_size: usize) -> Result<Option<usize>> {
    if !provider.is_available() {
        return Ok(None);
    }

    let batch_size = batch_size.max(1); // Ensure at least 1
    let mut vectors = Vec::with_capacity(chunks.len());
    let mut dim: Option<usize> = None;
    let mut metas = Vec::with_capacity(chunks.len());

    // Process in batches for better throughput
    let texts: Vec<&str> = chunks.iter().map(|c| c.text.as_str()).collect();
    
    for batch_start in (0..texts.len()).step_by(batch_size) {
        let batch_end = (batch_start + batch_size).min(texts.len());
        let batch = &texts[batch_start..batch_end];
        
        let batch_vecs = provider.embed_batch(batch)?;
        
        for (i, vec) in batch_vecs.into_iter().enumerate() {
            let chunk_idx = batch_start + i;
            if let Some(expected) = dim {
                if vec.len() != expected {
                    return Err(anyhow!("Embedding dim mismatch at {chunk_idx}: expected {expected}, got {}", vec.len()));
                }
            } else {
                dim = Some(vec.len());
            }
            vectors.push(vec);
            metas.push(ChunkMeta {
                id: chunks[chunk_idx].id.clone(),
                path: chunks[chunk_idx].path.clone(),
                start_line: chunks[chunk_idx].start_line,
                end_line: chunks[chunk_idx].end_line,
            });
        }
    }

    let dim = dim.unwrap_or(0);
    let store = VectorStore { dim, vectors };

    let target_dir = index_dir.join(VECTOR_DIR);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)?;
    }
    fs::create_dir_all(&target_dir)?;

    fs::write(target_dir.join(VECTORS_FILE), serde_json::to_vec(&store)?)?;
    fs::write(target_dir.join(META_FILE), serde_json::to_vec(&metas)?)?;

    Ok(Some(dim))
}

pub fn load_vector_meta(index_dir: &Path) -> Result<Vec<ChunkMeta>> {
    let meta_path = index_dir.join(VECTOR_DIR).join(META_FILE);
    let data = fs::read(meta_path)?;
    let meta = serde_json::from_slice(&data)?;
    Ok(meta)
}

pub fn search_vector(index_dir: &Path, query_vec: &[f32], top_k: usize) -> Result<Vec<(usize, f32)>> {
    let store_path = index_dir.join(VECTOR_DIR).join(VECTORS_FILE);
    if !store_path.exists() {
        return Err(anyhow!("Vector store missing"));
    }
    let data = fs::read(store_path)?;
    let store: VectorStore = serde_json::from_slice(&data)?;
    if store.dim != query_vec.len() {
        return Err(anyhow!("Query dim mismatch: expected {}, got {}", store.dim, query_vec.len()));
    }

    let hnsw = build_hnsw(&store.vectors);
    let result = hnsw.search(query_vec, top_k, 100);

    let mut hits = Vec::new();
    for nb in result {
        hits.push((nb.d_id, nb.distance));
    }
    Ok(hits)
}

fn build_hnsw(vectors: &[Vec<f32>]) -> Hnsw<'_, f32, DistCosine> {
    let max_nb_conn = 16;
    let nb_elements = vectors.len().max(1);
    let nb_layers = 16;
    let ef_c = 200;
    let hnsw = Hnsw::<f32, DistCosine>::new(max_nb_conn, nb_elements, nb_layers, ef_c, DistCosine {});
    for (idx, vec) in vectors.iter().enumerate() {
        hnsw.insert((&vec[..], idx));
    }
    hnsw
}
