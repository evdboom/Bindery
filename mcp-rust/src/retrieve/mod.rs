pub mod hybrid;
pub mod normalize;

use crate::{ChunkMeta, TimingMs};
use crate::config::Config;
use crate::docstore::read::read_lines_string;
use crate::embeddings::provider::EmbeddingProvider;
use crate::index::lexical::search_lexical;
use crate::index::vector::{load_vector_meta, search_vector, VECTOR_DIR};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveInput {
    pub query: String,
    pub language: String,
    pub top_k: usize,
    pub act: Option<String>,
    pub chapter_range: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveResult {
    pub results: Vec<RetrieveHit>,
    pub truncated: bool,
    pub timing_ms: TimingMs,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveHit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub score: f32,
    pub text: String,
    pub source: String,
    pub source_ref: Option<String>,
}

pub fn retrieve_context(config: &Config, provider: &dyn EmbeddingProvider, input: RetrieveInput) -> Result<RetrieveResult> {
    let total_start = Instant::now();
    let mut timing = TimingMs::default();
    let mut warnings = Vec::new();

    // Normalize language to uppercase
    let lang = input.language.to_uppercase();
    let lang_filter: Option<&str> = if lang == "ALL" {
        None
    } else {
        Some(lang.as_str())
    };

    // Increase search count when filtering to ensure enough results
    let search_top = if lang_filter.is_some() { 24 } else { 12 };

    let lex_start = Instant::now();
    let lexical = match search_lexical(&config.index_dir, &input.query, search_top) {
        Ok(v) => v,
        Err(err) => {
            warnings.push(format!("lexical search failed: {err}"));
            Vec::new()
        }
    };
    timing.lexical = Some(lex_start.elapsed().as_millis());

    let mut vector_hits: Vec<(ChunkMeta, f32)> = Vec::new();
    let vector_path = config.index_dir.join(VECTOR_DIR);
    if vector_path.exists() && provider.is_available() {
        let embed_start = Instant::now();
        match provider.embed(&input.query) {
            Ok(query_vec) => {
                timing.embed_query = Some(embed_start.elapsed().as_millis());
                let vec_start = Instant::now();
                match search_vector(&config.index_dir, &query_vec, search_top) {
                    Ok(raw_hits) => {
                        let meta = load_vector_meta(&config.index_dir).unwrap_or_default();
                        for (idx, distance) in raw_hits {
                            if let Some(meta) = meta.get(idx) {
                                let sim = (1.0 - distance).max(-1.0);
                                vector_hits.push((meta.clone(), sim));
                            }
                        }
                    }
                    Err(err) => warnings.push(format!("vector search failed: {err}")),
                }
                timing.vector = Some(vec_start.elapsed().as_millis());
            }
            Err(err) => warnings.push(format!("embed query failed: {err}")),
        }
    } else if !vector_path.exists() {
        warnings.push("vector index missing".to_string());
    } else {
        warnings.push("embeddings backend not available".to_string());
    }

    let rerank_start = Instant::now();
    let mut merged = hybrid::merge_and_rerank(&lexical, &vector_hits, 0.6, 0.4);
    
    // Filter by language if specified
    // Only filter paths that are language-specific (contain /EN/ or /NL/)
    // Keep Notes/, Story/Details_*, and other non-language-specific files
    if let Some(lang) = lang_filter {
        let lang_pattern = format!("/{}/", lang);
        let other_lang_patterns: Vec<String> = ["EN", "NL"]
            .iter()
            .filter(|&&l| l != lang)
            .map(|l| format!("/{}/", l))
            .collect();
        
        merged.retain(|hit| {
            // If path contains the requested language folder, keep it
            if hit.path.contains(&lang_pattern) {
                return true;
            }
            // If path contains another language folder, exclude it
            for pattern in &other_lang_patterns {
                if hit.path.contains(pattern) {
                    return false;
                }
            }
            // Keep language-neutral files (Notes/, Story/Details_*, etc.)
            true
        });
    }
    
    if input.top_k < merged.len() {
        merged.truncate(input.top_k);
    }
    timing.rerank = Some(rerank_start.elapsed().as_millis());

    let snippets_start = Instant::now();
    let mut hits = Vec::new();
    let mut total_bytes: usize = 0;
    let mut truncated = false;
    for cand in merged {
        let path = config.work_root.join(&cand.path);
        let text = read_lines_string(&path, cand.start_line, cand.end_line).unwrap_or_else(|_| "".to_string());
        let text = if text.len() > config.snippet_max_chars {
            text.chars().take(config.snippet_max_chars).collect::<String>()
        } else {
            text
        };
        let bytes = text.as_bytes().len();
        if total_bytes + bytes > config.max_response_bytes {
            truncated = true;
            break;
        }
        total_bytes += bytes;
        let source_ref = Some(format!("{}:{}", config.source_root.join(&cand.path).to_string_lossy(), cand.start_line));
        hits.push(RetrieveHit {
            path: cand.path,
            start_line: cand.start_line,
            end_line: cand.end_line,
            score: cand.score,
            text,
            source: cand.source,
            source_ref,
        });
    }
    timing.snippets = Some(snippets_start.elapsed().as_millis());
    timing.total = Some(total_start.elapsed().as_millis());

    Ok(RetrieveResult {
        results: hits,
        truncated,
        timing_ms: timing,
        warnings,
    })
}
