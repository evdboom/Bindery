use crate::config::Config;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetReviewTextInput {
    #[serde(default = "default_review_language", alias = "mode")]
    pub language: String,
    #[serde(default)]
    pub context_lines: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetReviewTextResult {
    pub files: Vec<ReviewFileResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewFileResult {
    pub file: String,
    pub changes: Vec<ReviewLine>,
    pub hunks: Vec<ReviewHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewLine {
    pub line: usize,
    pub before: Option<String>,
    pub after: Option<String>,
    pub change_type: ChangeType,
    pub before_line: Option<usize>,
    pub after_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewHunk {
    pub before_range: LineRange,
    pub after_range: LineRange,
    pub context_before: Vec<ReviewContextLine>,
    pub changes: Vec<ReviewHunkChange>,
    pub context_after: Vec<ReviewContextLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewContextLine {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewHunkChange {
    pub change_type: ChangeType,
    pub before: Option<String>,
    pub after: Option<String>,
    pub before_line: Option<usize>,
    pub after_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeType {
    Insert,
    Delete,
    Replace,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LineRange {
    pub start: usize,
    pub count: usize,
}

pub fn get_review_text(config: &Config, input: GetReviewTextInput) -> Result<GetReviewTextResult> {
    let mode = input.language.trim().to_lowercase();
    let context_lines = input.context_lines.unwrap_or(3).max(1) as usize;
    let path_filters = match mode.as_str() {
        "en" | "story" => vec!["Story/EN".to_string(), "Story/Details_*.md".to_string(), "Story/AGENTS.md".to_string()],
        "nl" | "translation" => vec!["Story/NL".to_string()],
        "all" => vec![
            "Story/EN".to_string(),
            "Story/NL".to_string(),
            "Story/Details_*.md".to_string(),
            "Story/AGENTS.md".to_string(),
        ],
        _ => return Err(anyhow!("language must be EN, NL, or ALL")),
    };

    let output = Command::new("git")
        .args(git_diff_args(&path_filters))
        .current_dir(&config.source_root)
        .output()
        .map_err(|e| anyhow!("git diff failed: {e}"))?;

    let diff = String::from_utf8_lossy(&output.stdout).to_string();
    let files = parse_diff(&diff, &config.source_root, context_lines)?;
    Ok(GetReviewTextResult { files })
}

fn git_diff_args(path_filters: &[String]) -> Vec<String> {
    let mut args = vec![
        "diff".to_string(),
        "--unified=0".to_string(),
        "--ignore-cr-at-eol".to_string(),
        "--".to_string(),
    ];
    for filter in path_filters {
        args.push(filter.clone());
    }
    args
}

fn parse_diff(diff: &str, repo_root: &Path, context_lines: usize) -> Result<Vec<ReviewFileResult>> {
    let mut results = Vec::new();
    let mut current_file: Option<String> = None;
    let mut hunks: Vec<ReviewHunk> = Vec::new();
    let mut changes: Vec<ReviewLine> = Vec::new();

    let mut before_line = 0usize;
    let mut after_line = 0usize;
    let mut current_hunk: Option<(LineRange, LineRange, Vec<ReviewHunkChange>)> = None;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            flush_file(&mut results, current_file.take(), &mut hunks, &mut changes);
            continue;
        }
        if line.starts_with("+++ b/") {
            current_file = Some(line.trim_start_matches("+++ b/").to_string());
            continue;
        }
        if line.starts_with("@@ ") {
            if let Some((before_range, after_range, hunk_changes)) = current_hunk.take() {
                let (context_before, context_after) = build_context(repo_root, current_file.as_deref(), &after_range, context_lines);
                hunks.push(ReviewHunk {
                    before_range,
                    after_range,
                    context_before,
                    changes: hunk_changes,
                    context_after,
                });
            }
            if let Some((before_range, after_range)) = parse_hunk_header(line) {
                before_line = before_range.start;
                after_line = after_range.start;
                current_hunk = Some((before_range, after_range, Vec::new()));
            }
            continue;
        }

        if let Some((_, _, hunk_changes)) = current_hunk.as_mut() {
            if line.starts_with('+') && !line.starts_with("+++") {
                let text = line.trim_start_matches('+').to_string();
                hunk_changes.push(ReviewHunkChange {
                    change_type: ChangeType::Insert,
                    before: None,
                    after: Some(text.clone()),
                    before_line: None,
                    after_line: Some(after_line),
                });
                changes.push(ReviewLine {
                    line: after_line,
                    before: None,
                    after: Some(text),
                    change_type: ChangeType::Insert,
                    before_line: None,
                    after_line: Some(after_line),
                });
                after_line += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                let text = line.trim_start_matches('-').to_string();
                hunk_changes.push(ReviewHunkChange {
                    change_type: ChangeType::Delete,
                    before: Some(text.clone()),
                    after: None,
                    before_line: Some(before_line),
                    after_line: None,
                });
                changes.push(ReviewLine {
                    line: before_line,
                    before: Some(text),
                    after: None,
                    change_type: ChangeType::Delete,
                    before_line: Some(before_line),
                    after_line: None,
                });
                before_line += 1;
            } else if line.starts_with(' ') {
                before_line += 1;
                after_line += 1;
            }
        }
    }

    if let Some((before_range, after_range, hunk_changes)) = current_hunk.take() {
        let (context_before, context_after) = build_context(repo_root, current_file.as_deref(), &after_range, context_lines);
        hunks.push(ReviewHunk {
            before_range,
            after_range,
            context_before,
            changes: hunk_changes,
            context_after,
        });
    }

    flush_file(&mut results, current_file.take(), &mut hunks, &mut changes);

    Ok(results)
}

fn parse_hunk_header(line: &str) -> Option<(LineRange, LineRange)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let before = parts[1].trim_start_matches('-');
    let after = parts[2].trim_start_matches('+');
    Some((parse_range(before), parse_range(after)))
}

fn parse_range(value: &str) -> LineRange {
    let mut split = value.split(',');
    let start = split.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let count = split.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    LineRange { start, count }
}

fn build_context(
    repo_root: &Path,
    file: Option<&str>,
    after_range: &LineRange,
    context_lines: usize,
) -> (Vec<ReviewContextLine>, Vec<ReviewContextLine>) {
    let Some(file) = file else { return (Vec::new(), Vec::new()); };
    let path = repo_root.join(file);
    let Ok(content) = std::fs::read_to_string(&path) else { return (Vec::new(), Vec::new()); };
    let lines: Vec<&str> = content.lines().collect();

    let start_line = if after_range.start == 0 { 1 } else { after_range.start };
    let end_line = if after_range.count == 0 {
        start_line
    } else {
        start_line + after_range.count.saturating_sub(1)
    };

    let before_start = start_line.saturating_sub(context_lines);
    let before_end = start_line.saturating_sub(1);
    let after_start = end_line + 1;
    let after_end = end_line + context_lines;

    let context_before = collect_lines(&lines, before_start, before_end);
    let context_after = collect_lines(&lines, after_start, after_end);

    (context_before, context_after)
}

fn collect_lines(lines: &[&str], start: usize, end: usize) -> Vec<ReviewContextLine> {
    if start == 0 || start > end {
        return Vec::new();
    }
    let mut result = Vec::new();
    for line_no in start..=end {
        if let Some(text) = lines.get(line_no - 1) {
            result.push(ReviewContextLine {
                line: line_no,
                text: text.to_string(),
            });
        }
    }
    result
}

fn flush_file(
    results: &mut Vec<ReviewFileResult>,
    file: Option<String>,
    hunks: &mut Vec<ReviewHunk>,
    changes: &mut Vec<ReviewLine>,
) {
    if let Some(file) = file {
        results.push(ReviewFileResult {
            file,
            changes: std::mem::take(changes),
            hunks: std::mem::take(hunks),
        });
    }
}

fn default_review_language() -> String {
    "ALL".to_string()
}

#[cfg(test)]
mod tests {
    use super::{git_diff_args, parse_hunk_header};

    #[test]
    fn parses_hunk_header() {
        let line = "@@ -10,2 +12,3 @@";
        let (before, after) = parse_hunk_header(line).expect("range");
        assert_eq!(before.start, 10);
        assert_eq!(before.count, 2);
        assert_eq!(after.start, 12);
        assert_eq!(after.count, 3);
    }

    #[test]
    fn includes_ignore_cr_at_eol_flag() {
        let args = git_diff_args(&vec!["Story/EN".to_string()]);
        assert!(args.contains(&"--ignore-cr-at-eol".to_string()));
    }
}
