use crate::config::Config;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetChapterInput {
    pub chapter_number: u32,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetChapterResult {
    pub file: String,
    pub chapter_number: u32,
    pub language: String,
    pub text: String,
}

pub fn get_chapter(config: &Config, input: GetChapterInput) -> Result<GetChapterResult> {
    if input.chapter_number == 0 {
        return Err(anyhow!("chapter_number is required"));
    }

    let language = input.language.trim().to_uppercase();
    if language != "EN" && language != "NL" {
        return Err(anyhow!("language must be EN or NL"));
    }

    let root = config.source_root.join("Story").join(&language);
    let filename = format!("Chapter{}.md", input.chapter_number);
    let mut found: Option<PathBuf> = None;

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Some(name) = entry.file_name().to_str() {
                if name.eq_ignore_ascii_case(&filename) {
                    found = Some(entry.path().to_path_buf());
                    break;
                }
            }
        }
    }

    let path = found.ok_or_else(|| anyhow!("Chapter not found: {} ({})", input.chapter_number, language))?;
    let text = std::fs::read_to_string(&path)?;

    Ok(GetChapterResult {
        file: rel_from_root(&config.source_root, &path),
        chapter_number: input.chapter_number,
        language,
        text,
    })
}

fn rel_from_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_chapter_finds_file() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("Story/EN/Act I - Awakening");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("Chapter1.md");
        std::fs::write(&file, "# Chapter 1\n\nHello").unwrap();

        let config = Config {
            source_root: dir.path().to_path_buf(),
            work_root: dir.path().to_path_buf(),
            index_dir: dir.path().join(".bindery/index"),
            mcp_mirror_root: None,
            embeddings_backend: "none".to_string(),
            ollama_url: "http://127.0.0.1:11434".to_string(),
            ollama_model: "nomic-embed-text".to_string(),
            onnx_url: "http://127.0.0.1:11435".to_string(),
            onnx_model: "bge-m3".to_string(),
            sync_delete_default: false,
            max_response_bytes: 60000,
            snippet_max_chars: 1600,
            default_topk: 6,
            embed_batch_size: 32,
            author: None,
        };

        let result = get_chapter(
            &config,
            GetChapterInput {
                chapter_number: 1,
                language: "EN".to_string(),
            },
        ).unwrap();

        assert!(result.text.contains("Hello"));
        assert!(result.file.contains("Story/EN"));
    }
}
