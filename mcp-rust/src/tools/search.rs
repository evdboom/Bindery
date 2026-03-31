use crate::config::Config;
use anyhow::{Result, anyhow};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchInput {
    pub query: String,
    pub regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub max_results: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub results: Vec<SearchHit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

pub fn search(config: &Config, input: SearchInput) -> Result<SearchResult> {
    let max_results = input.max_results.map(|v| v as usize).unwrap_or(50);
    let regex_mode = input.regex.unwrap_or(false);
    let case_sensitive = input.case_sensitive.unwrap_or(true);

    let (targets, roots) = build_search_targets(&config.source_root);
    if targets.is_empty() {
        return Err(anyhow!("No search roots found. Checked: {}", format_roots(&roots)));
    }

    if let Ok(result) = search_with_rg(&input.query, regex_mode, case_sensitive, &targets, &config.source_root, max_results) {
        return Ok(result);
    }

    search_with_fallback(&input.query, regex_mode, case_sensitive, &targets, &config.source_root, max_results)
}

fn search_with_rg(query: &str, regex_mode: bool, case_sensitive: bool, targets: &[PathBuf], source_root: &Path, max_results: usize) -> Result<SearchResult> {
    let mut cmd = Command::new("rg");
    cmd.arg("--line-number").arg("--no-heading").arg("--color").arg("never");
    if !regex_mode {
        cmd.arg("-F");
    }
    if !case_sensitive {
        cmd.arg("-i");
    }
    cmd.arg(query);
    for target in targets {
        cmd.arg(target);
    }

    let output = cmd.output()?;
    if !output.status.success() {
        if output.status.code() == Some(1) {
            return Ok(SearchResult { results: Vec::new(), truncated: false });
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("rg failed (roots: {}): {stderr}", format_roots(&targets)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();
    for line in stdout.lines() {
        if let Some(mut hit) = parse_rg_line(line) {
            hit.path = rel_from_root(source_root, Path::new(&hit.path));
            results.push(hit);
            if results.len() >= max_results {
                return Ok(SearchResult { results, truncated: true });
            }
        }
    }

    Ok(SearchResult { results, truncated: false })
}

fn parse_rg_line(line: &str) -> Option<SearchHit> {
    let mut parts = line.splitn(3, ':');
    let path = parts.next()?.to_string();
    let line_no = parts.next()?.parse::<u32>().ok()?;
    let text = parts.next()?.to_string();
    Some(SearchHit { path, line: line_no, text })
}

fn search_with_fallback(query: &str, regex_mode: bool, case_sensitive: bool, targets: &[PathBuf], source_root: &Path, max_results: usize) -> Result<SearchResult> {
    let pattern = if regex_mode {
        RegexBuilder::new(query)
            .case_insensitive(!case_sensitive)
            .build()?
    } else {
        RegexBuilder::new(&regex::escape(query))
            .case_insensitive(!case_sensitive)
            .build()?
    };

    let mut results = Vec::new();
    for target in targets {
        if target.is_dir() {
            for entry in WalkDir::new(target).into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() {
                    continue;
                }
                if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                search_file(entry.path(), &pattern, source_root, &mut results, max_results)?;
                if results.len() >= max_results {
                    return Ok(SearchResult { results, truncated: true });
                }
            }
        } else if target.is_file() {
            search_file(target, &pattern, source_root, &mut results, max_results)?;
            if results.len() >= max_results {
                return Ok(SearchResult { results, truncated: true });
            }
        }
    }
    Ok(SearchResult { results, truncated: false })
}

fn search_file(
    path: &Path,
    pattern: &regex::Regex,
    source_root: &Path,
    results: &mut Vec<SearchHit>,
    max_results: usize,
) -> Result<()> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    for (idx, line) in reader.lines().enumerate() {
        let line = line?;
        if pattern.is_match(&line) {
            let rel = rel_from_root(source_root, path);
            results.push(SearchHit { path: rel, line: (idx + 1) as u32, text: line });
            if results.len() >= max_results {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn build_search_targets(source_root: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut targets = Vec::new();
    let mut roots = Vec::new();

    let story = source_root.join("Story");
    roots.push(story.clone());
    if story.exists() {
        targets.push(story);
    }

    let notes = source_root.join("Notes");
    roots.push(notes.clone());
    if notes.exists() {
        targets.push(notes);
    }

    let agents = source_root.join("AGENTS.md");
    roots.push(agents.clone());
    if agents.exists() {
        targets.push(agents);
    }

    if let Ok(entries) = std::fs::read_dir(source_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
                    if name.starts_with("Details_") && name.ends_with(".md") {
                        roots.push(path.clone());
                        targets.push(path);
                    }
                }
            }
        }
    }

    (targets, roots)
}

fn format_roots(roots: &[PathBuf]) -> String {
    roots
        .iter()
        .map(|r| r.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(", ")
}

fn rel_from_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
