//! Book merging - collects and orders markdown files, generates TOC, calls Pandoc.
//!
//! This module provides functionality to:
//! - Collect chapter files in order (Prologue → Act I → Act II → ... → Epilogue)
//! - Generate a table of contents with GitHub-style anchors
//! - Merge files into a single Markdown, DOCX, or EPUB output
//! - Handle language-specific folder structures (EN/NL)

use anyhow::{anyhow, Context, Result};
use chrono::Local;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

use crate::format;

// ============================================================================
// Cached Regex Patterns
// ============================================================================

/// Matches Act/Deel folder names: "Act I - Awakening", "Deel II - Resonantie"
static ACT_FOLDER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(Act|Deel)\s+(I{1,3}|IV|V)(?:\s*[-–—]\s*(.+))?$")
        .expect("ACT_FOLDER_RE is valid")
});

/// Matches chapter filenames: "Chapter8.md", "chapter 12.md"
static CHAPTER_NUM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)chapter\s*(\d+)")
        .expect("CHAPTER_NUM_RE is valid")
});

/// Matches H1 headings in markdown (single # followed by space)
static H1_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\s*#\s+(.+?)\s*$")
        .expect("H1_RE is valid")
});

/// Matches non-slug characters (removes punctuation except hyphens)
static SLUG_CLEAN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[^\p{L}\p{N}\s\-]")
        .expect("SLUG_CLEAN_RE is valid")
});

/// Matches multiple blank lines for collapsing
static BLANK_LINES_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\n{2,}")
        .expect("BLANK_LINES_RE is valid")
});

/// Matches first H1 for demotion to H2
static FIRST_H1_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^(\s*)#\s+")
        .expect("FIRST_H1_RE is valid")
});

/// Matches heading line for image insertion
static HEADING_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^#[^\n]*\n")
        .expect("HEADING_LINE_RE is valid")
});

/// Matches book title row in translation notes
static BOOK_TITLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*Name of the book\s*\|\s*$")
        .expect("BOOK_TITLE_RE is valid")
});

// ============================================================================
// Output Types
// ============================================================================

/// Supported output types for merged books.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutputType {
    Markdown,
    Docx,
    Epub,
    Pdf,
}

impl OutputType {
    /// Parse output type from string (e.g., "md", "docx", "epub", "pdf").
    #[must_use]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "md" | "markdown" => Some(Self::Markdown),
            "docx" | "word" => Some(Self::Docx),
            "epub" => Some(Self::Epub),
            "pdf" => Some(Self::Pdf),
            _ => None,
        }
    }

    /// Get file extension for this output type.
    #[must_use]
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Docx => "docx",
            Self::Epub => "epub",
            Self::Pdf => "pdf",
        }
    }
}

// ============================================================================
// Languages
// ============================================================================

/// Supported languages for the book.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Language {
    EN,
    NL,
}

impl Language {
    /// Parse language from string (case-insensitive).
    #[must_use]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "EN" => Some(Self::EN),
            "NL" => Some(Self::NL),
            _ => None,
        }
    }

    /// Get folder name for this language ("EN" or "NL").
    #[must_use]
    pub fn folder_name(&self) -> &'static str {
        match self {
            Self::EN => "EN",
            Self::NL => "NL",
        }
    }

    /// Get the word for "Chapter" in this language.
    #[must_use]
    pub fn chapter_word(&self) -> &'static str {
        match self {
            Self::EN => "Chapter",
            Self::NL => "Hoofdstuk",
        }
    }

    /// Get the act prefix for this language ("Act" or "Deel").
    #[must_use]
    pub fn act_prefix(&self) -> &'static str {
        match self {
            Self::EN => "Act",
            Self::NL => "Deel",
        }
    }
}

// ============================================================================
// Merge-get and Virtual Merge Types
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeGetScope {
    Book,
    Act,
    Chapter,
}

impl MergeGetScope {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.to_lowercase().as_str() {
            "book" => Some(Self::Book),
            "act" => Some(Self::Act),
            "chapter" => Some(Self::Chapter),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderStyle {
    Atx,
    Setext,
}

impl HeaderStyle {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.to_lowercase().as_str() {
            "atx" => Some(Self::Atx),
            "setext" => Some(Self::Setext),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MergeGetInput {
    pub root: PathBuf,
    pub language: Language,
    pub scope: MergeGetScope,
    pub act: Option<String>,
    pub chapter: Option<String>,
    pub include_toc: bool,
    pub max_chars: usize,
    pub header_style: HeaderStyle,
    pub normalize_paths: bool,
}

#[derive(Debug, Serialize)]
pub struct MergeGetResult {
    pub markdown: String,
    pub truncated: bool,
    pub total_chars: usize,
    pub returned_chars: usize,
    pub chapters_included: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_included_chapter: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceLine {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone)]
pub struct MergedMarkdown {
    pub virtual_ref: String,
    pub markdown: String,
    pub chapters_included: Vec<String>,
    pub line_map: Vec<Option<SourceLine>>,
}

// ============================================================================
// Internal Data Structures
// ============================================================================

/// Parsed Act folder info (e.g., "Act I - Awakening").
#[derive(Debug, Clone, PartialEq)]
struct ActInfo {
    /// Original folder name for reference
    name: String,
    /// Act number (1..n)
    number: u32,
    /// Act subtitle if present ("Awakening")
    subtitle: Option<String>,
}

/// Types of ordered files
#[derive(Debug, Clone, PartialEq)]
enum FileType {
    Prologue,
    Act(ActInfo),
    Chapter(ActInfo, u32, String),
    Epilogue,
}

/// Ordered file info
#[derive(Debug, Clone)]
struct OrderedFile {
    path: PathBuf,
    file_type: FileType,
}

// ============================================================================
// Utilities
// ============================================================================

/// Convert Roman numerals to integers (I, II, III, IV, V)
fn roman_to_int(roman: &str) -> Option<u32> {
    match roman.to_uppercase().as_str() {
        "I" => Some(1),
        "II" => Some(2),
        "III" => Some(3),
        "IV" => Some(4),
        "V" => Some(5),
        _ => None,
    }
}

/// Parse act folder name into ActInfo
fn parse_act_folder(name: &str) -> Result<ActInfo> {
    let caps = ACT_FOLDER_RE
        .captures(name)
        .ok_or_else(|| anyhow!("Invalid act folder name: {}", name))?;

    let roman = caps.get(2).unwrap().as_str();
    let number = roman_to_int(roman)
        .ok_or_else(|| anyhow!("Invalid Roman numeral: {}", roman))?;
    let subtitle = caps.get(3).map(|m| m.as_str().to_string());

    Ok(ActInfo {
        name: name.to_string(),
        number,
        subtitle,
    })
}

/// Extract chapter number from filename
fn extract_chapter_num(filename: &str) -> Option<u32> {
    CHAPTER_NUM_RE
        .captures(filename)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<u32>().ok())
}

/// Generate GitHub-style slug from heading text
fn generate_slug(text: &str) -> String {
    let lower = text.to_lowercase();
    let cleaned = SLUG_CLEAN_RE.replace_all(&lower, "");
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

/// Convert H1 headings to H2 (for chapter merge)
fn demote_h1_to_h2(text: &str) -> String {
    FIRST_H1_RE.replace(text, "$1## ").to_string()
}

/// Collapse excessive blank lines
fn collapse_blank_lines(text: &str) -> String {
    BLANK_LINES_RE.replace_all(text, "\n\n").to_string()
}

/// Get ordered list of markdown files for a language
fn get_ordered_files(root: &Path, language: Language) -> Result<Vec<OrderedFile>> {
    let mut files = Vec::new();

    // Prologue
    let prologue = root.join("Prologue.md");
    if prologue.exists() {
        files.push(OrderedFile {
            path: prologue,
            file_type: FileType::Prologue,
        });
    }

    // Acts and chapters
    let mut acts: Vec<ActInfo> = Vec::new();
    let mut act_folders: HashMap<u32, PathBuf> = HashMap::new();

    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if let Ok(info) = parse_act_folder(name) {
            act_folders.insert(info.number, path.clone());
            acts.push(info);
        }
    }

    acts.sort_by_key(|a| a.number);

    for act in acts {
        files.push(OrderedFile {
            path: act_folders.get(&act.number).unwrap().clone(),
            file_type: FileType::Act(act.clone()),
        });

        let mut chapters: Vec<(u32, PathBuf)> = Vec::new();
        if let Some(act_path) = act_folders.get(&act.number) {
            for entry in WalkDir::new(act_path).max_depth(1) {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
                    if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                        if let Some(num) = extract_chapter_num(filename) {
                            chapters.push((num, path.to_path_buf()));
                        }
                    }
                }
            }
        }

        chapters.sort_by_key(|(n, _)| *n);

        for (num, path) in chapters {
            files.push(OrderedFile {
                path,
                file_type: FileType::Chapter(act.clone(), num, language.chapter_word().to_string()),
            });
        }
    }

    // Epilogue
    let epilogue = root.join("Epilogue.md");
    if epilogue.exists() {
        files.push(OrderedFile {
            path: epilogue,
            file_type: FileType::Epilogue,
        });
    }

    Ok(files)
}

/// Format an Act title for TOC
fn format_act_title(act: &ActInfo, language: Language) -> String {
    let act_prefix = language.act_prefix();
    let roman = match act.number {
        1 => "I",
        2 => "II",
        3 => "III",
        4 => "IV",
        5 => "V",
        _ => "I",
    };

    match &act.subtitle {
        Some(sub) => format!("{} {} - {}", act_prefix, roman, sub),
        None => format!("{} {}", act_prefix, roman),
    }
}

/// Build table of contents for merged markdown
fn generate_toc(files: &[OrderedFile], lang: Language) -> Result<String> {
    let mut toc = String::from("# Table of Contents\n\n");
    let mut current_act: Option<u32> = None;

    for file in files {
        let content = if let FileType::Act(_) = &file.file_type {
            String::new()
        } else {
            fs::read_to_string(&file.path)?
        };

        let title = match &file.file_type {
            FileType::Prologue => {
                if lang == Language::NL { "Proloog" } else { "Prologue" }.to_string()
            }
            FileType::Act(act_info) => {
                current_act = Some(act_info.number);
                format_act_title(act_info, lang)
            }
            FileType::Chapter(_, _, _) => {
                if let Some(caps) = H1_RE.captures(&content) {
                    caps.get(1).unwrap().as_str().to_string()
                } else {
                    file.path.file_stem().unwrap().to_string_lossy().to_string()
                }
            }
            FileType::Epilogue => {
                if lang == Language::NL { "Epiloog" } else { "Epilogue" }.to_string()
            }
        };

        let anchor = generate_slug(&title);

        match &file.file_type {
            FileType::Prologue => {
                toc.push_str(&format!("- [{}](#{})\n", title, anchor));
            }
            FileType::Act(act_info) => {
                let act_label = format_act_title(act_info, lang);
                toc.push_str(&format!("- {}\n", act_label));
            }
            FileType::Chapter(_, _, _) => {
                if let Some(act_info) = match &file.file_type {
                    FileType::Chapter(act, _, _) => Some(act),
                    _ => None,
                } {
                    if current_act != Some(act_info.number) {
                        current_act = Some(act_info.number);
                        let act_label = format_act_title(act_info, lang);
                        toc.push_str(&format!("- {}\n", act_label));
                    }
                }

                toc.push_str(&format!("  - [{}](#{})\n", title, anchor));
            }
            FileType::Epilogue => {
                let label = if lang == Language::NL { "Epiloog" } else { "Epilogue" };
                toc.push_str(&format!("- [{}](#{})\n", label, anchor));
            }
        }
    }

    Ok(toc)
}

/// OpenXML page break for Pandoc DOCX output
const PAGE_BREAK: &str = r#"
```{=openxml}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
```
"#;

/// Merge options
pub struct MergeOptions {
    pub root: PathBuf,
    pub language: Language,
    pub output_types: Vec<OutputType>,
    pub include_toc: bool,
    pub include_separators: bool,
    pub include_source_markers: bool,
    /// Author name for EPUB/DOCX metadata
    pub author: Option<String>,
    /// Path to LibreOffice executable for PDF export.
    /// Defaults to "libreoffice" (available on Linux/WSL after apt install libreoffice).
    /// On Windows, set to the full path of soffice.exe.
    pub libreoffice_path: String,
}

/// Merge result
#[derive(Debug)]
pub struct MergeResult {
    pub outputs: Vec<PathBuf>,
    pub files_merged: usize,
}

#[derive(Debug, Clone)]
struct MergePart {
    lines: Vec<String>,
    line_map: Vec<Option<SourceLine>>,
    chapter_label: Option<String>,
}

/// Merge book for a language
pub fn merge_book(options: &MergeOptions) -> Result<MergeResult> {
    let lang_path = options.root.join("Story").join(options.language.folder_name());

    if !lang_path.exists() {
        return Err(anyhow!("Language folder not found: {}", lang_path.display()));
    }

    // Format files first
    tracing::info!("Formatting {} files...", options.language.folder_name());
    format::format_directory(&lang_path, true, false)?;

    // Get ordered files
    let files = get_ordered_files(&lang_path, options.language)?;

    if files.is_empty() {
        return Err(anyhow!("No markdown files found in {}", lang_path.display()));
    }

    // Create output directory
    let output_dir = options.root.join("Merged");
    fs::create_dir_all(&output_dir)?;

    let base_name = format!("Book_{}_Merged", options.language.folder_name());
    let mut outputs = Vec::new();

    // Write outputs
    for output_type in &options.output_types {
        let output_path = output_dir.join(format!("{}.{}", base_name, output_type.extension()));

        match output_type {
            OutputType::Markdown => {
                // Markdown: include TOC, simple concatenation
                let content = build_markdown_content(&files, options)?;
                fs::write(&output_path, &content)?;
            }
            OutputType::Docx | OutputType::Epub => {
                // DOCX/EPUB: no TOC (Pandoc generates), Act headings as H1, chapters as H2
                let content = build_pandoc_content(&files, options, *output_type)?;
                let md_path = output_dir.join(format!("{}_temp.md", base_name));
                fs::write(&md_path, &content)?;

                let title = get_book_title(&options.root, options.language);
                run_pandoc(&md_path, &output_path, output_type.extension(), &options.root, &title, options.language, options.author.as_deref())?;

                fs::remove_file(&md_path)?;
            }
            OutputType::Pdf => {
                // PDF: generate an intermediate DOCX via pandoc, then convert with LibreOffice
                let title = get_book_title(&options.root, options.language);
                let temp_md_path = output_dir.join(format!("{}_pdf_temp.md", base_name));
                let temp_docx_path = output_dir.join(format!("{}_pdf_temp.docx", base_name));

                let content = build_pandoc_content(&files, options, OutputType::Docx)?;
                fs::write(&temp_md_path, &content)?;

                let pandoc_result = run_pandoc(&temp_md_path, &temp_docx_path, "docx", &options.root, &title, options.language, options.author.as_deref());
                let _ = fs::remove_file(&temp_md_path);
                pandoc_result?;

                let lo_result = run_libreoffice_to_pdf(&temp_docx_path, &output_dir, &output_path, &options.libreoffice_path);
                let _ = fs::remove_file(&temp_docx_path);
                lo_result?;
            }
        }

        outputs.push(output_path);
    }

    Ok(MergeResult {
        outputs,
        files_merged: files.len(),
    })
}

/// Merge and return markdown for book/act/chapter with stable boundaries.
pub fn merge_get(input: &MergeGetInput) -> Result<MergeGetResult> {
    let lang_path = input.root.join("Story").join(input.language.folder_name());
    if !lang_path.exists() {
        return Err(anyhow!("Language folder not found: {}", lang_path.display()));
    }

    let files = get_ordered_files(&lang_path, input.language)?;
    if files.is_empty() {
        return Err(anyhow!("No markdown files found in {}", lang_path.display()));
    }

    let act_filter = parse_act_filter(input.act.as_deref())?;
    let chapter_filter = parse_chapter_filter(input.chapter.as_deref())?;
    let filtered = filter_ordered_files(&files, input.scope, act_filter, chapter_filter)?;

    let parts = collect_merge_parts(
        &filtered,
        input.language,
        input.root.as_path(),
        input.include_toc,
        input.header_style,
        input.normalize_paths,
    )?;

    let mut total_chars = 0usize;
    let mut returned_chars = 0usize;
    let mut has_any = false;
    let mut truncated = false;
    let mut output_lines: Vec<String> = Vec::new();
    let mut chapters_included = Vec::new();
    let mut last_included_chapter = None;

    for part in parts {
        let part_len = lines_len(&part.lines, has_any);
        total_chars += part_len;

        if !truncated && returned_chars + part_len <= input.max_chars {
            if let Some(label) = part.chapter_label.clone() {
                chapters_included.push(label.clone());
                last_included_chapter = Some(label);
            }
            if !part.lines.is_empty() {
                output_lines.extend(part.lines);
                returned_chars += part_len;
                has_any = true;
            }
        } else {
            truncated = true;
        }
    }

    let markdown = output_lines.join("\n");

    Ok(MergeGetResult {
        markdown,
        truncated,
        total_chars,
        returned_chars,
        chapters_included,
        last_included_chapter,
        warnings: Vec::new(),
    })
}

/// Build merged markdown and line map for book indexing.
pub fn build_merged_markdown_with_map(input: &MergeGetInput) -> Result<MergedMarkdown> {
    let lang_path = input.root.join("Story").join(input.language.folder_name());
    if !lang_path.exists() {
        return Err(anyhow!("Language folder not found: {}", lang_path.display()));
    }

    let files = get_ordered_files(&lang_path, input.language)?;
    if files.is_empty() {
        return Err(anyhow!("No markdown files found in {}", lang_path.display()));
    }

    let act_filter = parse_act_filter(input.act.as_deref())?;
    let chapter_filter = parse_chapter_filter(input.chapter.as_deref())?;
    let filtered = filter_ordered_files(&files, input.scope, act_filter, chapter_filter)?;

    let parts = collect_merge_parts(
        &filtered,
        input.language,
        input.root.as_path(),
        input.include_toc,
        input.header_style,
        input.normalize_paths,
    )?;

    let mut lines: Vec<String> = Vec::new();
    let mut line_map: Vec<Option<SourceLine>> = Vec::new();
    let mut chapters_included = Vec::new();

    for part in parts {
        if let Some(label) = part.chapter_label {
            chapters_included.push(label);
        }
        lines.extend(part.lines);
        line_map.extend(part.line_map);
    }

    while lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        lines.pop();
        line_map.pop();
    }

    let markdown = lines.join("\n");
    let virtual_ref = virtual_ref_for_scope(input.language, input.scope, act_filter);

    Ok(MergedMarkdown {
        virtual_ref,
        markdown,
        chapters_included,
        line_map,
    })
}

fn collect_merge_parts(
    files: &[OrderedFile],
    language: Language,
    _repo_root: &Path,
    include_toc: bool,
    header_style: HeaderStyle,
    normalize_paths: bool,
) -> Result<Vec<MergePart>> {
    let mut parts = Vec::new();

    if include_toc {
        let toc = generate_toc(files, language)?;
        let mut lines = Vec::new();
        for line in toc.lines() {
            lines.push(line.to_string());
        }
        lines.push("---".to_string());
        lines.push(String::new());

        let line_map = vec![None; lines.len()];
        parts.push(MergePart {
            lines,
            line_map,
            chapter_label: None,
        });
    }

    let mut current_act: Option<u32> = None;

    for file in files {
        let file_content = match &file.file_type {
            FileType::Prologue | FileType::Chapter(_, _, _) | FileType::Epilogue => {
                Some(fs::read_to_string(&file.path)?)
            }
            FileType::Act(_) => None,
        };
        let content = file_content.as_deref().unwrap_or("");
        let chapter_label = build_chapter_label(file, language, content);
        let mut lines: Vec<String> = Vec::new();
        let mut line_map: Vec<Option<SourceLine>> = Vec::new();

        match &file.file_type {
            FileType::Prologue => {
                let file_content = file_content.as_deref().unwrap_or("");
                let label = if language == Language::NL { "Proloog" } else { "Prologue" };
                lines.push(format!("# {}", label));
                line_map.push(None);
                lines.push(String::new());
                line_map.push(None);
                append_content_lines(&mut lines, &mut line_map, &file.path, file_content, normalize_paths)?;
            }
            FileType::Act(act_info) => {
                current_act = Some(act_info.number);
                let title = format_act_title(act_info, language);
                let heading = match header_style {
                    HeaderStyle::Atx => format!("# {}", title),
                    HeaderStyle::Setext => format!("{}\n{}", title, "=".repeat(title.len())),
                };
                lines.push(heading);
                line_map.push(None);
                lines.push(String::new());
                line_map.push(None);
            }
            FileType::Chapter(act_info, _, _) => {
                let file_content = file_content.as_deref().unwrap_or("");
                if current_act != Some(act_info.number) {
                    current_act = Some(act_info.number);
                    let act_label = format_act_title(act_info, language);
                    let heading = match header_style {
                        HeaderStyle::Atx => format!("# {}", act_label),
                        HeaderStyle::Setext => format!("{}\n{}", act_label, "=".repeat(act_label.len())),
                    };
                    lines.push(heading);
                    line_map.push(None);
                    lines.push(String::new());
                    line_map.push(None);
                }

                let content = demote_h1_to_h2(file_content);
                append_content_lines(&mut lines, &mut line_map, &file.path, &content, normalize_paths)?;
            }
            FileType::Epilogue => {
                let file_content = file_content.as_deref().unwrap_or("");
                let label = if language == Language::NL { "Epiloog" } else { "Epilogue" };
                lines.push(format!("# {}", label));
                line_map.push(None);
                lines.push(String::new());
                line_map.push(None);
                append_content_lines(&mut lines, &mut line_map, &file.path, file_content, normalize_paths)?;
            }
        }

        parts.push(MergePart {
            lines,
            line_map,
            chapter_label,
        });
    }

    Ok(parts)
}

fn append_content_lines(
    lines: &mut Vec<String>,
    line_map: &mut Vec<Option<SourceLine>>,
    path: &Path,
    content: &str,
    normalize_paths: bool,
) -> Result<()> {
    let mut line_num = 1u32;
    let mut content_lines = content.lines();

    while let Some(line) = content_lines.next() {
        lines.push(line.to_string());
        let file = if normalize_paths {
            path.to_string_lossy().replace('\\', "/")
        } else {
            path.to_string_lossy().to_string()
        };
        line_map.push(Some(SourceLine { file, line: line_num }));
        line_num += 1;
    }

    lines.push(String::new());
    line_map.push(None);

    Ok(())
}

fn build_chapter_label(file: &OrderedFile, language: Language, content: &str) -> Option<String> {
    match &file.file_type {
        FileType::Chapter(_, num, _) => {
            if let Some(caps) = H1_RE.captures(content) {
                let title = caps.get(1).unwrap().as_str();
                Some(title.to_string())
            } else {
                Some(format!("{} {}", language.chapter_word(), num))
            }
        }
        FileType::Prologue => Some(if language == Language::NL { "Proloog" } else { "Prologue" }.to_string()),
        FileType::Epilogue => Some(if language == Language::NL { "Epiloog" } else { "Epilogue" }.to_string()),
        _ => None,
    }
}

fn lines_len(lines: &[String], has_any: bool) -> usize {
    if lines.is_empty() {
        return 0;
    }

    let mut total = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if i > 0 || has_any {
            total += 1;
        }
        total += line.len();
    }
    total
}

fn filter_ordered_files(
    files: &[OrderedFile],
    scope: MergeGetScope,
    act_filter: Option<u32>,
    chapter_filter: Option<u32>,
) -> Result<Vec<OrderedFile>> {
    let mut result = Vec::new();

    for file in files {
        match scope {
            MergeGetScope::Book => result.push(file.clone()),
            MergeGetScope::Act => {
                if let Some(act_num) = act_filter {
                    match &file.file_type {
                        FileType::Act(act) if act.number == act_num => result.push(file.clone()),
                        FileType::Chapter(act, _, _) if act.number == act_num => result.push(file.clone()),
                        _ => {}
                    }
                }
            }
            MergeGetScope::Chapter => {
                if let Some(chapter_num) = chapter_filter {
                    if let FileType::Chapter(_, num, _) = &file.file_type {
                        if *num == chapter_num {
                            result.push(file.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

fn parse_act_filter(input: Option<&str>) -> Result<Option<u32>> {
    match input {
        Some(act) => {
            let num = roman_to_int(act)
                .or_else(|| act.parse::<u32>().ok())
                .ok_or_else(|| anyhow!("Invalid act: {}", act))?;
            Ok(Some(num))
        }
        None => Ok(None),
    }
}

fn parse_chapter_filter(input: Option<&str>) -> Result<Option<u32>> {
    match input {
        Some(chapter) => {
            let num = chapter.parse::<u32>()
                .map_err(|_| anyhow!("Invalid chapter: {}", chapter))?;
            Ok(Some(num))
        }
        None => Ok(None),
    }
}

fn virtual_ref_for_scope(language: Language, scope: MergeGetScope, act: Option<u32>) -> String {
    let lang = language.folder_name();
    match scope {
        MergeGetScope::Book => format!("MERGED:{}:BOOK", lang),
        MergeGetScope::Act => {
            let roman = match act.unwrap_or(1) {
                1 => "I",
                2 => "II",
                3 => "III",
                4 => "IV",
                5 => "V",
                _ => "I",
            };
            format!("MERGED:{}:ACT_{}", lang, roman)
        }
        MergeGetScope::Chapter => format!("MERGED:{}:CHAPTER", lang),
    }
}

fn build_markdown_content(files: &[OrderedFile], options: &MergeOptions) -> Result<String> {
    let toc = if options.include_toc {
        generate_toc(files, options.language)?
    } else {
        String::new()
    };

    let mut content = String::new();

    if options.include_toc {
        content.push_str(&toc);
        content.push_str("\n---\n\n");
    }

    let mut current_act: Option<u32> = None;

    for file in files {
        match &file.file_type {
            FileType::Prologue => {
                let file_content = fs::read_to_string(&file.path)?;
                content.push_str(&file_content);
            }
            FileType::Act(act_info) => {
                current_act = Some(act_info.number);
                content.push_str(&format!("# {}\n\n", format_act_title(act_info, options.language)));
            }
            FileType::Chapter(act_info, _, _) => {
                let file_content = fs::read_to_string(&file.path)?;
                if current_act != Some(act_info.number) {
                    current_act = Some(act_info.number);
                    content.push_str(&format!("# {}\n\n", format_act_title(act_info, options.language)));
                }

                content.push_str(&file_content);
            }
            FileType::Epilogue => {
                let file_content = fs::read_to_string(&file.path)?;
                content.push_str(&file_content);
            }
        }

        if options.include_separators {
            content.push_str("\n\n---\n\n");
        } else {
            content.push_str("\n\n");
        }
    }

    Ok(collapse_blank_lines(&content))
}

fn build_pandoc_content(files: &[OrderedFile], options: &MergeOptions, output_type: OutputType) -> Result<String> {
    let mut content = String::new();

    if matches!(output_type, OutputType::Docx) {
        if let Some(cover_md) = cover_markdown(options) {
            content.push_str(&cover_md);
            content.push_str(PAGE_BREAK);
            content.push_str("\n");
        }
    }

    for (i, file) in files.iter().enumerate() {
        match &file.file_type {
            FileType::Prologue => {
                let file_content = fs::read_to_string(&file.path)?;
                let mut content_with_images = file_content;
                if let Some(image_md) = image_markdown_for(file, options) {
                    content_with_images = insert_image_after_heading(&content_with_images, &image_md);
                }
                content.push_str(&content_with_images);
            }
            FileType::Act(act_info) => {
                let title = format_act_title(act_info, options.language);
                content.push_str(&format!("# {}\n\n", title));
            }
            FileType::Chapter(_, _, _) => {
                let file_content = fs::read_to_string(&file.path)?;
                let mut demoted = demote_h1_to_h2(&file_content);
                if let Some(image_md) = image_markdown_for(file, options) {
                    demoted = insert_image_after_heading(&demoted, &image_md);
                }
                content.push_str(&demoted);
            }
            FileType::Epilogue => {
                let file_content = fs::read_to_string(&file.path)?;
                let mut content_with_images = file_content;
                if let Some(image_md) = image_markdown_for(file, options) {
                    content_with_images = insert_image_after_heading(&content_with_images, &image_md);
                }
                content.push_str(&content_with_images);
            }
        }

        if i < files.len() - 1 {
            content.push_str("\n\n");
            if matches!(output_type, OutputType::Docx) && has_next_content_file(files, i) {
                content.push_str(PAGE_BREAK);
            }
        }
    }

    let collapsed = collapse_blank_lines(&content);

    Ok(collapsed)
}

fn has_next_content_file(files: &[OrderedFile], current_index: usize) -> bool {
    for file in files.iter().skip(current_index + 1) {
        match file.file_type {
            FileType::Act(_) => continue,
            _ => return true,
        }
    }
    false
}

fn image_markdown_for(file: &OrderedFile, options: &MergeOptions) -> Option<String> {
    let image_name = match &file.file_type {
        FileType::Prologue => "prologue.jpg".to_string(),
        FileType::Epilogue => "epilogue.jpg".to_string(),
        FileType::Chapter(_, num, _) => format!("chapter{}.jpg", num),
        FileType::Act(_) => return None,
    };

    let image_path = options.root.join("images").join(image_name);
    if !image_path.exists() {
        return None;
    }

    let path_str = image_path.to_string_lossy().replace('\\', "/");
    Some(format!("![]({})\n\n", path_str))
}

fn cover_markdown(options: &MergeOptions) -> Option<String> {
    let cover_path = options
        .root
        .join("Story")
        .join(options.language.folder_name())
        .join("cover.jpg");
    if !cover_path.exists() {
        return None;
    }
    let path_str = cover_path.to_string_lossy().replace('\\', "/");
    Some(format!("![]({})\n\n", path_str))
}

fn insert_image_after_heading(content: &str, image_md: &str) -> String {
    if let Some(m) = HEADING_LINE_RE.find(content) {
        let end = m.end();
        format!("{}{}{}", &content[..end], image_md, &content[end..])
    } else {
        format!("{}{}", image_md, content)
    }
}

fn run_pandoc(input: &Path, output: &Path, output_type: &str, root: &Path, title: &str, language: Language, author: Option<&str>) -> Result<()> {
    let mut cmd = Command::new("pandoc");
    cmd.arg(input)
        .arg("-o")
        .arg(output)
        .arg("--metadata")
        .arg(format!("title={}", title));

    // Add author metadata if provided
    if let Some(author_name) = author {
        cmd.arg("--metadata").arg(format!("author={}", author_name));
    }

    // Add language metadata (ISO 639-1 code)
    let lang_code = match language {
        Language::EN => "en",
        Language::NL => "nl",
    };
    cmd.arg("--metadata").arg(format!("lang={}", lang_code));

    // Add publication date (current date)
    let date = Local::now().format("%Y-%m-%d").to_string();
    cmd.arg("--metadata").arg(format!("date={}", date));

    if output_type == "docx" {
        cmd.arg("--from=markdown+raw_attribute");
        let reference = root.join("reference.docx");
        if reference.exists() {
            cmd.arg("--reference-doc").arg(&reference);
        }
    }

    if output_type == "epub" {
        cmd.arg("--split-level=2");
        // Add cover image if it exists (in Story/EN/ or Story/NL/)
        let cover = root.join("Story").join(language.folder_name()).join("cover.jpg");
        if cover.exists() {
            cmd.arg("--epub-cover-image").arg(&cover);
        }
    }

    let output_result = cmd.output()
        .context("Failed to run pandoc - is it installed?")?;

    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        return Err(anyhow!("Pandoc failed: {}", stderr));
    }

    Ok(())
}

/// Run LibreOffice headless to convert a DOCX file to PDF.
/// LibreOffice writes `<basename>.pdf` into `output_dir`; we then rename it to `final_pdf_path`.
fn run_libreoffice_to_pdf(docx_path: &Path, output_dir: &Path, final_pdf_path: &Path, libreoffice_path: &str) -> Result<()> {
    let output = Command::new(libreoffice_path)
        .args(["--headless", "--convert-to", "pdf"])
        .arg(docx_path)
        .arg("--outdir")
        .arg(output_dir)
        .output()
        .with_context(|| format!(
            "Failed to run LibreOffice ({libreoffice_path}) — is it installed? \
            On WSL/Linux: sudo apt install libreoffice. \
            On Windows: set BINDERY_LIBREOFFICE_PATH to the full path of soffice.exe."
        ))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("LibreOffice PDF conversion failed: {}", stderr));
    }

    // LibreOffice outputs <stem>.pdf in output_dir — rename to the desired final path
    let stem = docx_path.file_stem()
        .ok_or_else(|| anyhow!("Could not determine stem of DOCX path: {}", docx_path.display()))?;
    let lo_output = output_dir.join(format!("{}.pdf", stem.to_string_lossy()));

    fs::rename(&lo_output, final_pdf_path)
        .with_context(|| format!(
            "LibreOffice produced output at {} but could not rename to {}",
            lo_output.display(), final_pdf_path.display()
        ))?;

    Ok(())
}

/// Check if Pandoc is available
pub fn check_pandoc() -> Result<String> {
    let output = Command::new("pandoc")
        .arg("--version")
        .output()
        .context("Failed to run pandoc - is it installed?")?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("unknown");
        Ok(first_line.to_string())
    } else {
        Err(anyhow!("Pandoc is not available"))
    }
}

/// Get book title from translation notes.
///
/// Uses cached `BOOK_TITLE_RE` pattern. Falls back to "Book" if not found.
fn get_book_title(root: &Path, lang: Language) -> String {
    let notes_path = root.join("Notes/Details_Translation_notes.md");

    if !notes_path.exists() {
        return "Book".to_string();
    }

    let content = match fs::read_to_string(&notes_path) {
        Ok(c) => c,
        Err(_) => return "Book".to_string(),
    };

    // Match: | EN Title | NL Title | Name of the book |
    if let Some(caps) = BOOK_TITLE_RE.captures(&content) {
        let title = match lang {
            Language::EN => caps.get(1).map(|m| m.as_str().trim()),
            Language::NL => caps.get(2).map(|m| m.as_str().trim()),
        };

        if let Some(t) = title {
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }

    "Book".to_string()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_roman_to_int_valid() {
        assert_eq!(roman_to_int("I"), Some(1));
        assert_eq!(roman_to_int("II"), Some(2));
        assert_eq!(roman_to_int("III"), Some(3));
        assert_eq!(roman_to_int("IV"), Some(4));
        assert_eq!(roman_to_int("V"), Some(5));
    }

    #[test]
    fn test_roman_to_int_case_insensitive() {
        assert_eq!(roman_to_int("i"), Some(1));
        assert_eq!(roman_to_int("ii"), Some(2));
        assert_eq!(roman_to_int("iii"), Some(3));
        assert_eq!(roman_to_int("iv"), Some(4));
        assert_eq!(roman_to_int("v"), Some(5));
    }

    #[test]
    fn test_roman_to_int_invalid() {
        assert_eq!(roman_to_int("VI"), None);
        assert_eq!(roman_to_int("X"), None);
        assert_eq!(roman_to_int(""), None);
        assert_eq!(roman_to_int("IIII"), None);
    }

    #[test]
    fn test_parse_act_folder_english() {
        let info = parse_act_folder("Act I - Awakening").unwrap();
        assert_eq!(info.number, 1);
        assert_eq!(info.subtitle, Some("Awakening".to_string()));
    }

    #[test]
    fn test_parse_act_folder_dutch() {
        let info = parse_act_folder("Deel II - Resonantie").unwrap();
        assert_eq!(info.number, 2);
        assert_eq!(info.subtitle, Some("Resonantie".to_string()));
    }

    #[test]
    fn test_parse_act_folder_no_subtitle() {
        let info = parse_act_folder("Act III").unwrap();
        assert_eq!(info.number, 3);
        assert_eq!(info.subtitle, None);
    }

    #[test]
    fn test_parse_act_folder_em_dash() {
        let info = parse_act_folder("Act I — Awakening").unwrap();
        assert_eq!(info.number, 1);
        assert_eq!(info.subtitle, Some("Awakening".to_string()));
    }

    #[test]
    fn test_extract_chapter_num() {
        assert_eq!(extract_chapter_num("Chapter1.md"), Some(1));
        assert_eq!(extract_chapter_num("chapter 12.md"), Some(12));
        assert_eq!(extract_chapter_num("Ch1.md"), None);
    }

    #[test]
    fn test_generate_slug() {
        assert_eq!(generate_slug("Hello World"), "hello-world");
        assert_eq!(generate_slug("Hello, World!"), "hello-world");
        assert_eq!(generate_slug("Hello  World"), "hello-world");
    }

    #[test]
    fn test_demote_h1_to_h2() {
        let input = "# Title\n\nText";
        let output = demote_h1_to_h2(input);
        assert!(output.starts_with("## Title"));
    }

    #[test]
    fn test_collapse_blank_lines() {
        let input = "Line1\n\n\nLine2";
        let output = collapse_blank_lines(input);
        assert_eq!(output, "Line1\n\nLine2");
    }

    #[test]
    fn test_get_ordered_files_structure() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");

        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Prologue.md"), "# Prologue").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::write(lang_root.join("Epilogue.md"), "# Epilogue").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        assert_eq!(files.len(), 4);
        assert!(matches!(files[0].file_type, FileType::Prologue));
        assert!(matches!(files[1].file_type, FileType::Act(_)));
        assert!(matches!(files[2].file_type, FileType::Chapter(_, 1, _)));
        assert!(matches!(files[3].file_type, FileType::Epilogue));
    }

    #[test]
    fn test_generate_toc() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Prologue.md"), "# Prologue").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let toc = generate_toc(&files, Language::EN).unwrap();
        assert!(toc.contains("Table of Contents"));
        assert!(toc.contains("- Act I"));
        assert!(toc.contains("Chapter 1"));
    }

    #[test]
    fn test_build_markdown_content() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Prologue.md"), "# Prologue: Ignition").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::write(lang_root.join("Epilogue.md"), "# Epilogue: Winds").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let options = MergeOptions {
            root: PathBuf::from(root),
            language: Language::EN,
            output_types: vec![OutputType::Markdown],
            include_toc: true,
            include_separators: false,
            include_source_markers: false,
            author: None,
            libreoffice_path: "libreoffice".to_string(),
        };
        let content = build_markdown_content(&files, &options).unwrap();
        assert!(content.contains("Table of Contents"));
        assert!(content.contains("Prologue: Ignition"));
        assert!(content.contains("Epilogue: Winds"));
        assert!(!content.contains("# Prologue\n\n# Prologue:"));
        assert!(!content.contains("# Epilogue\n\n# Epilogue:"));
    }

    #[test]
    fn test_merge_get_act_filter() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::create_dir_all(lang_root.join("Act II - Resonance")).unwrap();
        fs::write(lang_root.join("Act II - Resonance").join("Chapter2.md"), "# Chapter 2").unwrap();

        let input = MergeGetInput {
            root: PathBuf::from(root),
            language: Language::EN,
            scope: MergeGetScope::Act,
            act: Some("I".to_string()),
            chapter: None,
            include_toc: false,
            max_chars: 10000,
            header_style: HeaderStyle::Atx,
            normalize_paths: true,
        };

        let result = merge_get(&input).unwrap();
        assert!(result.markdown.contains("Chapter 1"));
        assert!(!result.markdown.contains("Chapter 2"));
    }

    #[test]
    fn test_check_pandoc_failure() {
        let _ = check_pandoc();
    }

    #[test]
    fn test_generate_slug_diacritics() {
        let slug = generate_slug("Café Résumé");
        assert!(slug.contains("café"));
        assert!(slug.contains("résumé"));
    }

    #[test]
    fn test_build_merged_markdown_with_map() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1\nLine 1\nLine 2").unwrap();

        let input = MergeGetInput {
            root: PathBuf::from(root),
            language: Language::EN,
            scope: MergeGetScope::Book,
            act: None,
            chapter: None,
            include_toc: false,
            max_chars: 10000,
            header_style: HeaderStyle::Atx,
            normalize_paths: true,
        };

        let merged = build_merged_markdown_with_map(&input).unwrap();
        assert!(!merged.markdown.is_empty());
        assert_eq!(merged.line_map.len(), merged.markdown.lines().count());
    }

    #[test]
    fn test_build_pandoc_content_docx_page_breaks() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Prologue.md"), "# Prologue").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter2.md"), "# Chapter 2").unwrap();
        fs::write(lang_root.join("Epilogue.md"), "# Epilogue").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let options = MergeOptions {
            root: PathBuf::from(root),
            language: Language::EN,
            output_types: vec![OutputType::Docx],
            include_toc: false,
            include_separators: false,
            include_source_markers: false,
            author: None,
            libreoffice_path: "libreoffice".to_string(),
        };

        let content = build_pandoc_content(&files, &options, OutputType::Docx).unwrap();
        assert!(content.contains("w:type=\"page\""));
    }

    #[test]
    fn test_build_pandoc_content_includes_chapter_images() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        let images_root = root.join("images");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::create_dir_all(&images_root).unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::write(images_root.join("chapter1.jpg"), "fake").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let options = MergeOptions {
            root: PathBuf::from(root),
            language: Language::EN,
            output_types: vec![OutputType::Docx],
            include_toc: false,
            include_separators: false,
            include_source_markers: false,
            author: None,
            libreoffice_path: "libreoffice".to_string(),
        };

        let content = build_pandoc_content(&files, &options, OutputType::Docx).unwrap();
        assert!(content.contains("images/chapter1.jpg"));
    }

    #[test]
    fn test_build_pandoc_content_docx_cover() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();
        fs::write(lang_root.join("cover.jpg"), "fake").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let options = MergeOptions {
            root: PathBuf::from(root),
            language: Language::EN,
            output_types: vec![OutputType::Docx],
            include_toc: false,
            include_separators: false,
            include_source_markers: false,
            author: None,
            libreoffice_path: "libreoffice".to_string(),
        };

        let content = build_pandoc_content(&files, &options, OutputType::Docx).unwrap();
        assert!(content.contains("Story/EN/cover.jpg"));
    }

    #[test]
    fn test_build_pandoc_content_prologue_single_heading() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let lang_root = root.join("Story").join("EN");
        fs::create_dir_all(lang_root.join("Act I - Awakening")).unwrap();
        fs::write(lang_root.join("Prologue.md"), "# Prologue: Ignition\n\nText").unwrap();
        fs::write(lang_root.join("Act I - Awakening").join("Chapter1.md"), "# Chapter 1").unwrap();

        let files = get_ordered_files(&lang_root, Language::EN).unwrap();
        let options = MergeOptions {
            root: PathBuf::from(root),
            language: Language::EN,
            output_types: vec![OutputType::Docx],
            include_toc: false,
            include_separators: false,
            include_source_markers: false,
            author: None,
            libreoffice_path: "libreoffice".to_string(),
        };

        let content = build_pandoc_content(&files, &options, OutputType::Docx).unwrap();
        assert!(content.contains("# Prologue: Ignition"));
        assert!(!content.contains("# Prologue\n\n# Prologue:"));
    }
}