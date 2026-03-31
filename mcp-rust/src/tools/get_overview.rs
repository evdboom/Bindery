use crate::config::Config;
use crate::tools::get_chapter::get_chapter;
use crate::tools::get_chapter::GetChapterInput;
use anyhow::{Result, anyhow};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

const ACT_FILES: &[(u32, &str)] = &[
    (1, "Arc/Act_I_Awakening.md"),
    (2, "Arc/Act_II_Resonance.md"),
    (3, "Arc/Act_III_Collapse.md"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetOverviewInput {
    pub language: Option<String>,
    pub act: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetOverviewResult {
    pub acts: Vec<ActOverview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActOverview {
    pub act_number: u32,
    pub act_title: String,
    pub chapters: Vec<ChapterOverview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterOverview {
    pub chapter_number: u32,
    pub title: String,
    pub pov: Option<String>,
    pub synopsis: Option<String>,
    pub status: ChapterStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterStatus {
    pub en: Option<String>,
    pub nl: Option<String>,
}

pub fn get_overview(config: &Config, input: GetOverviewInput) -> Result<GetOverviewResult> {
    if let Some(act) = input.act {
        if !(1..=3).contains(&act) {
            return Err(anyhow!("act must be 1-3"));
        }
    }

    let language_filter = input.language.as_ref().map(|value| value.trim().to_uppercase());
    if let Some(lang) = &language_filter {
        if lang != "EN" && lang != "NL" {
            return Err(anyhow!("language must be EN or NL"));
        }
    }

    let chapter_header = Regex::new(r"(?i)^###\s*Chapter\s+(\d+)\s*(?:-\s*(.+))?$")?;
    let mut acts = Vec::new();

    for (act_number, rel_path) in ACT_FILES {
        if let Some(filter_act) = input.act {
            if *act_number != filter_act {
                continue;
            }
        }
        let path = config.source_root.join(rel_path);
        if !path.exists() {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let act_title = extract_act_title(&content).unwrap_or_else(|| default_act_title(rel_path));
        let chapters = parse_chapters(&content, &chapter_header, config, language_filter.as_deref());
        acts.push(ActOverview {
            act_number: *act_number,
            act_title,
            chapters,
        });
    }

    Ok(GetOverviewResult { acts })
}

fn extract_act_title(content: &str) -> Option<String> {
    for line in content.lines() {
        if line.trim_start().starts_with("# ") {
            return Some(line.trim_start().trim_start_matches("# ").trim().to_string());
        }
    }
    None
}

fn default_act_title(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Act")
        .to_string()
}

fn parse_chapters(
    content: &str,
    regex: &Regex,
    config: &Config,
    language_filter: Option<&str>,
) -> Vec<ChapterOverview> {
    struct ChapterParse {
        number: u32,
        title: String,
        pov: Option<String>,
        beats: Vec<String>,
    }

    let mut chapters = Vec::new();
    let mut current: Option<ChapterParse> = None;

    for line in content.lines() {
        if let Some(caps) = regex.captures(line) {
            if let Some(ch) = current.take() {
                chapters.push(ch);
            }
            let number = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            let title = caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            current = Some(ChapterParse {
                number,
                title,
                pov: None,
                beats: Vec::new(),
            });
            continue;
        }

        if let Some(chapter) = current.as_mut() {
            let trimmed = line.trim();
            if trimmed.starts_with("**POV**:") {
                let value = trimmed.trim_start_matches("**POV**:").trim();
                if !value.is_empty() {
                    chapter.pov = Some(value.to_string());
                }
            } else if trimmed.starts_with("1. ") {
                let beat = trimmed.trim_start_matches("1. ").trim();
                if !beat.is_empty() {
                    chapter.beats.push(beat.to_string());
                }
            }
        }
    }

    if let Some(ch) = current.take() {
        chapters.push(ch);
    }

    chapters.into_iter().map(|chapter| {
        let status = build_status(config, chapter.number, language_filter);
        ChapterOverview {
            chapter_number: chapter.number,
            title: chapter.title,
            pov: chapter.pov,
            synopsis: build_synopsis(&chapter.beats),
            status,
        }
    }).collect()
}

fn build_synopsis(beats: &[String]) -> Option<String> {
    if beats.is_empty() {
        return None;
    }
    let mut synopsis = String::new();
    for (idx, beat) in beats.iter().take(2).enumerate() {
        if idx > 0 {
            synopsis.push(' ');
        }
        synopsis.push_str(beat);
    }
    Some(synopsis)
}

fn build_status(config: &Config, chapter_number: u32, language_filter: Option<&str>) -> ChapterStatus {
    let mut status = ChapterStatus { en: None, nl: None };
    let langs = match language_filter {
        Some(lang) => vec![lang],
        None => vec!["EN", "NL"],
    };

    for lang in langs {
        let exists = get_chapter(config, GetChapterInput {
            chapter_number,
            language: lang.to_string(),
        }).is_ok();
        let value = if exists { "present" } else { "missing" };
        match lang {
            "EN" => status.en = Some(value.to_string()),
            "NL" => status.nl = Some(value.to_string()),
            _ => {}
        }
    }

    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn overview_parses_act_file() {
        let dir = tempdir().unwrap();
        let act_path = dir.path().join("Arc/Act_I_Awakening.md");
        std::fs::create_dir_all(act_path.parent().unwrap()).unwrap();
        std::fs::write(
            &act_path,
            "# Act I\n\n### Chapter 1 - Start\n**POV**: Ren\n1. Beat one\n",
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

        let result = get_overview(&config, GetOverviewInput { language: None, act: Some(1) }).unwrap();
        assert_eq!(result.acts.len(), 1);
        assert_eq!(result.acts[0].chapters.len(), 1);
    }
}
