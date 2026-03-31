use crate::config::Config;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};

const NOTES_FILE: &str = "Notes/Details_Notes.md";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetNotesInput {
    pub category: String,
    pub name: String,
    pub match_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetNotesResult {
    pub file: String,
    pub category: String,
    pub name: String,
    pub text: String,
}

pub fn get_notes(config: &Config, input: GetNotesInput) -> Result<GetNotesResult> {
    if input.category.trim().is_empty() || input.name.trim().is_empty() {
        return Err(anyhow!("category and name are required"));
    }

    let path = config.source_root.join(NOTES_FILE);
    let content = std::fs::read_to_string(&path)?;
    let lines: Vec<&str> = content.lines().collect();

    let category = input.category.trim();
    let name = input.name.trim();
    let match_index = input.match_index.unwrap_or(1).max(1) as usize;

    let category_range = find_heading_range(&lines, 2, category)
        .ok_or_else(|| anyhow!("category not found"))?;

    let name_indices = find_heading_indices_in_range(&lines, 3, name, category_range.0, category_range.1);
    if name_indices.len() < match_index {
        return Err(anyhow!("name not found"));
    }

    let start = name_indices[match_index - 1] + 1;
    let end = find_next_heading(&lines, 3, start, category_range.1).unwrap_or(category_range.1);
    let text = lines[start..end].join("\n").trim().to_string();

    Ok(GetNotesResult {
        file: NOTES_FILE.to_string(),
        category: category.to_string(),
        name: name.to_string(),
        text,
    })
}

fn find_heading_range(lines: &[&str], level: usize, heading: &str) -> Option<(usize, usize)> {
    let prefix = "#".repeat(level) + " ";
    let mut start = None;
    for (idx, line) in lines.iter().enumerate() {
        if line.trim_start().starts_with(&prefix) {
            let title = line.trim_start().trim_start_matches(&prefix).trim();
            if start.is_some() {
                return start.map(|s| (s, idx));
            }
            if title.eq_ignore_ascii_case(heading) {
                start = Some(idx + 1);
            }
        }
    }
    start.map(|s| (s, lines.len()))
}

fn find_heading_indices_in_range(lines: &[&str], level: usize, heading: &str, start: usize, end: usize) -> Vec<usize> {
    let prefix = "#".repeat(level) + " ";
    let mut indices = Vec::new();
    for (idx, line) in lines.iter().enumerate().take(end).skip(start) {
        if line.trim_start().starts_with(&prefix) {
            let title = line.trim_start().trim_start_matches(&prefix).trim();
            if title.eq_ignore_ascii_case(heading) {
                indices.push(idx);
            }
        }
    }
    indices
}

fn find_next_heading(lines: &[&str], level: usize, start: usize, end: usize) -> Option<usize> {
    let prefix = "#".repeat(level) + " ";
    for (idx, line) in lines.iter().enumerate().take(end).skip(start) {
        if line.trim_start().starts_with(&prefix) {
            return Some(idx);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_notes_returns_text() {
        let dir = tempdir().unwrap();
        let notes_path = dir.path().join(NOTES_FILE);
        std::fs::create_dir_all(notes_path.parent().unwrap()).unwrap();
        std::fs::write(
            &notes_path,
            "## Characters\n\n### Ren\nA short note.\n",
        ).unwrap();

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

        let result = get_notes(
            &config,
            GetNotesInput {
                category: "Characters".to_string(),
                name: "Ren".to_string(),
                match_index: None,
            },
        ).unwrap();

        assert!(result.text.contains("A short note."));
    }
}
