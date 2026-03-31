use anyhow::{Result, anyhow};
use regex::Regex;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct DiscoverOptions {
    pub language: String,
    pub act: Option<String>,
    pub chapter_range: Option<String>,
}

pub fn discover_chapter_files(work_root: &Path, opts: &DiscoverOptions) -> Result<Vec<PathBuf>> {
    // Normalize language to uppercase (folders are EN/NL, or ALL for both)
    let lang = opts.language.to_uppercase();
    
    // Support "ALL" to index all languages
    let languages: Vec<&str> = if lang == "ALL" {
        vec!["EN", "NL"]
    } else {
        vec![lang.as_str()]
    };

    let mut all_results = Vec::new();
    
    for lang in &languages {
        let story_root = work_root.join("Story").join(lang);
        if !story_root.exists() {
            if languages.len() == 1 {
                return Err(anyhow!("Story root not found: {}", story_root.to_string_lossy()));
            }
            continue; // Skip missing language folders when using ALL
        }

        let act_filter = opts.act.as_ref().map(|v| v.to_uppercase());
        let act_folder = act_filter.as_deref().and_then(|act| match (*lang, act) {
            ("EN", "I") => Some("Act I - Awakening"),
            ("EN", "II") => Some("Act II - Resonance"),
            ("EN", "III") => Some("Act III - Collapse"),
            ("NL", "I") => Some("Deel I - Ontwaken"),
            ("NL", "II") => Some("Deel II - Resonantie"),
            ("NL", "III") => Some("Deel III - Instorting"),
            _ => None,
        });

        let chapter_range = opts.chapter_range.as_ref().and_then(|value| parse_chapter_range(value));
        let chapter_re = Regex::new(r"^Chapter(\d+)\.md$").expect("chapter regex");

        for entry in WalkDir::new(&story_root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(v) => v,
                None => continue,
            };
            let caps = match chapter_re.captures(filename) {
                Some(c) => c,
                None => continue,
            };
            if let Some(folder) = act_folder {
                let path_str = path.to_string_lossy();
                if !path_str.contains(folder) {
                    continue;
                }
            }
            if let Some((min, max)) = chapter_range {
                let num: u32 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
                if num < min || num > max {
                    continue;
                }
            }
            all_results.push(path.to_path_buf());
        }
    }

    all_results.sort();
    Ok(all_results)
}

pub fn discover_index_files(work_root: &Path, opts: &DiscoverOptions) -> Result<Vec<PathBuf>> {
    let mut files = BTreeSet::new();

    for path in discover_chapter_files(work_root, opts)? {
        files.insert(path);
    }

    let story_root = work_root.join("Story");
    if story_root.exists() {
        let agents = story_root.join("AGENTS.md");
        if agents.exists() {
            files.insert(agents);
        }
        if let Ok(entries) = std::fs::read_dir(&story_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|v| v.to_str()) else { continue; };
                if name.starts_with("Details_") && name.ends_with(".md") {
                    files.insert(path);
                }
            }
        }
    }

    let notes_root = work_root.join("Notes");
    if notes_root.exists() {
        for entry in WalkDir::new(&notes_root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            files.insert(entry.path().to_path_buf());
        }
    }

    let root_details = work_root;
    if let Ok(entries) = std::fs::read_dir(root_details) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|v| v.to_str()) else { continue; };
            if name.starts_with("Details_") && name.ends_with(".md") {
                files.insert(path);
            }
        }
    }

    Ok(files.into_iter().collect())
}

fn parse_chapter_range(value: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let start = parts[0].trim().parse::<u32>().ok()?;
    let end = parts[1].trim().parse::<u32>().ok()?;
    Some((start.min(end), start.max(end)))
}

#[cfg(test)]
mod tests {
    use super::parse_chapter_range;

    #[test]
    fn parses_chapter_range() {
        assert_eq!(parse_chapter_range("1-8"), Some((1, 8)));
        assert_eq!(parse_chapter_range("8-1"), Some((1, 8)));
        assert_eq!(parse_chapter_range("bad"), None);
    }
}
