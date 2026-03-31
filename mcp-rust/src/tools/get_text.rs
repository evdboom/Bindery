use crate::config::Config;
use crate::docstore::read::read_lines_vec;
use anyhow::{Result, anyhow};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetTextInput {
    pub language: String,
    pub identifier: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetTextResult {
    pub path: String,
    pub lines: Vec<LineText>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineText {
    pub line: u32,
    pub text: String,
}

pub fn get_text(config: &Config, input: GetTextInput) -> Result<GetTextResult> {
    let language = input.language.trim().to_uppercase();
    if language != "EN" && language != "NL" {
        return Err(anyhow!("language must be EN or NL"));
    }

    let identifier = input.identifier.trim();
    if identifier.is_empty() {
        return Err(anyhow!("identifier is required"));
    }

    let (path, _attempts) = resolve_identifier(&config.source_root, &language, identifier)?;
    let start_line = input.start_line.unwrap_or(1).max(1);
    let end_line = input.end_line.unwrap_or(u32::MAX);

    let lines = read_lines_vec(&path, start_line, end_line)?
        .into_iter()
        .map(|(line, text)| LineText { line, text })
        .collect();
    Ok(GetTextResult {
        path: rel_from_root(&config.source_root, &path),
        lines,
    })
}

fn resolve_identifier(source_root: &Path, language: &str, identifier: &str) -> Result<(PathBuf, Vec<String>)> {
    let mut attempts: Vec<String> = Vec::new();
    let identifier = identifier.trim();

    if is_relative_path(identifier) {
        attempts.push(identifier.to_string());
        let path = source_root.join(identifier);
        if path.exists() {
            return Ok((path, attempts));
        }
    }

    let normalized = normalize_key(identifier);
    if let Some(path) = resolve_alias(source_root, &normalized, &mut attempts) {
        return Ok((path, attempts));
    }

    if let Some((act, chapter)) = parse_chapter_identifier(identifier) {
        let candidates = chapter_candidate_paths(language, act, chapter);
        for rel in &candidates {
            attempts.push(rel.to_string());
            let path = source_root.join(rel);
            if path.exists() {
                return Ok((path, attempts));
            }
        }

        if act.is_none() {
            if let Some(path) = find_chapter_in_story(source_root, language, chapter) {
                let rel = rel_from_root(source_root, &path);
                attempts.push(rel.clone());
                return Ok((path, attempts));
            }
        }
    }

    Err(anyhow!(
        "Unable to resolve identifier '{identifier}'. Tried: {attempts:?}. Use a relative path (e.g., Story/EN/Act I - Awakening/Chapter8.md) or shorthand like chapter8, act2 chapter9, agents, overall, act1, act2, act3.",
    ))
}

fn is_relative_path(value: &str) -> bool {
    let path = PathBuf::from(value);
    if path.is_absolute() || value.contains(':') {
        return false;
    }
    !value.contains("..")
}

fn normalize_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn resolve_alias(source_root: &Path, normalized: &str, attempts: &mut Vec<String>) -> Option<PathBuf> {
    let mut try_path = |rel: &str| {
        attempts.push(rel.to_string());
        let path = source_root.join(rel);
        if path.exists() {
            Some(path)
        } else {
            None
        }
    };

    match normalized {
        "agents" | "agentsmd" => try_path("AGENTS.md"),
        "storyagents" | "agentsstory" => try_path("Story/AGENTS.md"),
        "detailsoverall" | "detailsoveral" | "detailsstoryarcoverall" | "detailsstoryarcoveral"
        | "overall" | "arcoverall" => {
            try_path("Arc/Overall.md")
        }
        "detailsact1" | "detailsacti" | "detailsactiawakening" | "detailsstoryarcactiawakening"
        | "act1" | "acti" | "arcact1" | "arcacti" => {
            try_path("Arc/Act_I_Awakening.md")
        }
        "detailsact2" | "detailsactii" | "detailsactiiresonance" | "detailsstoryarcactiiresonance"
        | "act2" | "actii" | "arcact2" | "arcactii" => {
            try_path("Arc/Act_II_Resonance.md")
        }
        "detailsact3" | "detailsactiii" | "detailsactiiicollapse" | "detailsstoryarcactiiicollapse"
        | "act3" | "actiii" | "arcact3" | "arcactiii" => {
            try_path("Arc/Act_III_Collapse.md")
        }
        "detailscharacters" => try_path("Notes/Details_Characters.md"),
        "detailsnotes" | "notes" => try_path("Notes/Details_Notes.md"),
        "detailstranslationnotes" => try_path("Notes/Details_Translation_notes.md"),
        "detailsworldandmagic" => try_path("Notes/Details_World_and_Magic.md"),
        _ => None,
    }
}

fn parse_chapter_identifier(value: &str) -> Option<(Option<u32>, u32)> {
    let cleaned = value.trim().to_lowercase().replace(['_', '-'], " ");
    let re = Regex::new(r"^act\s*([0-9]+|i{1,3})\s*chapter\s*([0-9]+)$").ok()?;
    if let Some(caps) = re.captures(cleaned.trim()) {
        let act = parse_act(caps.get(1)?.as_str());
        let chapter = caps.get(2)?.as_str().parse::<u32>().ok()?;
        return Some((act, chapter));
    }

    let re = Regex::new(r"^(?:chapter|ch)\s*([0-9]+)$").ok()?;
    if let Some(caps) = re.captures(cleaned.trim()) {
        let chapter = caps.get(1)?.as_str().parse::<u32>().ok()?;
        return Some((None, chapter));
    }

    let re = Regex::new(r"^act\s*([0-9]+|i{1,3})\s*ch\s*([0-9]+)$").ok()?;
    if let Some(caps) = re.captures(cleaned.trim()) {
        let act = parse_act(caps.get(1)?.as_str());
        let chapter = caps.get(2)?.as_str().parse::<u32>().ok()?;
        return Some((act, chapter));
    }

    None
}

fn parse_act(value: &str) -> Option<u32> {
    let value = value.trim().to_uppercase();
    match value.as_str() {
        "1" | "I" => Some(1),
        "2" | "II" => Some(2),
        "3" | "III" => Some(3),
        _ => None,
    }
}

fn act_folder(language: &str, act: u32) -> Option<&'static str> {
    match (language, act) {
        ("EN", 1) => Some("Act I - Awakening"),
        ("EN", 2) => Some("Act II - Resonance"),
        ("EN", 3) => Some("Act III - Collapse"),
        ("NL", 1) => Some("Deel I - Ontwaken"),
        ("NL", 2) => Some("Deel II - Resonantie"),
        ("NL", 3) => Some("Deel III - Instorting"),
        _ => None,
    }
}

fn chapter_candidate_paths(language: &str, act: Option<u32>, chapter: u32) -> Vec<String> {
    let mut candidates = Vec::new();
    let filename = format!("Chapter{chapter}.md");
    let acts: Vec<u32> = match act {
        Some(v) => vec![v],
        None => vec![1, 2, 3],
    };
    for act_num in acts {
        if let Some(folder) = act_folder(language, act_num) {
            candidates.push(format!("Story/{language}/{folder}/{filename}"));
        }
    }
    candidates
}

fn find_chapter_in_story(source_root: &Path, language: &str, chapter: u32) -> Option<PathBuf> {
    let root = source_root.join("Story").join(language);
    let filename = format!("Chapter{chapter}.md");
    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case(&filename) {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

fn rel_from_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
