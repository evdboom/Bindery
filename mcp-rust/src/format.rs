//! Typography formatting for markdown files.
//!
//! This module converts straight quotes to curly quotes, `...` to ellipsis,
//! and `--` to em-dash while preserving content inside HTML comments.
//!
//! # Design Notes
//! - Regexes are compiled once using `once_cell::sync::Lazy` for performance
//! - HTML comments are protected during conversion to preserve their content
//! - The `---` sequence (markdown horizontal rule) is preserved

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

// =============================================================================
// Cached Regex Patterns
// =============================================================================
// Using Lazy<Regex> avoids recompiling patterns on every function call.
// This significantly improves performance when processing many files.

/// Matches HTML comments: `<!-- ... -->`
/// Used to protect comment contents from typography conversion.
static COMMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"<!--[\s\S]*?-->").expect("Invalid COMMENT_RE pattern")
});

/// Matches opening double quote context: after whitespace, line start, or brackets
static OPEN_DOUBLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(^|[\s\(\[\{—–\-])\""#).expect("Invalid OPEN_DOUBLE_RE pattern")
});

/// Matches opening single quote context: after whitespace, line start, or brackets
static OPEN_SINGLE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(^|[\s\(\[\{—–\-])'").expect("Invalid OPEN_SINGLE_RE pattern")
});

/// Matches a closing double quote after an em-dash at end-of-word or line
static CLOSE_DOUBLE_AFTER_EM_DASH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"—"([\s\)\]\}\.,;:!?]|$)"#).expect("Invalid CLOSE_DOUBLE_AFTER_EM_DASH_RE pattern")
});

// =============================================================================
// Typographic Characters
// =============================================================================
// Using string slices directly instead of char + .to_string() avoids allocations

const OPEN_DOUBLE: &str = "\u{201C}";   // "
const CLOSE_DOUBLE: &str = "\u{201D}";  // "
const OPEN_SINGLE: &str = "\u{2018}";   // '
const CLOSE_SINGLE: &str = "\u{2019}";  // ' (also used for apostrophes)
const ELLIPSIS: &str = "\u{2026}";      // …
const EM_DASH: &str = "\u{2014}";       // —

// =============================================================================
// Public API
// =============================================================================

/// Update typographic characters in text.
///
/// Performs the following conversions:
/// - `...` → `…` (ellipsis)
/// - `--` → `—` (em-dash, but not `---` which is markdown HR)
/// - `"text"` → `“text”` (curly double quotes)
/// - `'text'` → `‘text’` (curly single quotes)
/// - `don't` → `don’t` (apostrophes)
///
/// # Arguments
/// * `text` - The input text to convert
///
/// # Returns
/// A new string with typographic characters applied.
#[must_use]
pub fn update_typography(text: &str) -> String {
    let mut result = text.to_string();

    // Step 1: Convert ... to ellipsis (must happen before quote processing)
    result = result.replace("...", ELLIPSIS);

    // Step 2: Protect HTML comments from em-dash conversion
    // We replace comments with placeholders, convert dashes, then restore
    let mut protected_comments: Vec<String> = Vec::new();
    result = COMMENT_RE.replace_all(&result, |caps: &regex::Captures| {
        let placeholder = format!("\x00COMMENT{}\x00", protected_comments.len());
        protected_comments.push(caps[0].to_string());
        placeholder
    }).to_string();

    // Step 3: Convert -- to em-dash (but preserve --- for markdown HR)
    // Strategy: temporarily protect ---, then convert --, then restore ---
    let protected_triple = "\x00TRIPLE\x00";
    result = result.replace("---", protected_triple);
    result = result.replace("--", EM_DASH);
    result = result.replace(protected_triple, "---");

    // Step 4: Restore HTML comments
    for (i, comment) in protected_comments.iter().enumerate() {
        result = result.replace(&format!("\x00COMMENT{}\x00", i), comment);
    }

    // Step 4b: Fix closing quotes after em-dash introduced from --
    result = CLOSE_DOUBLE_AFTER_EM_DASH_RE
        .replace_all(&result, |caps: &regex::Captures| {
            format!("{}{}{}", EM_DASH, CLOSE_DOUBLE, &caps[1])
        })
        .to_string();

    // Step 5: Convert double quotes
    // Opening: after whitespace, start of line, or opening brackets
    result = OPEN_DOUBLE_RE.replace_all(&result, |caps: &regex::Captures| {
        format!("{}{}", &caps[1], OPEN_DOUBLE)
    }).to_string();
    // Closing: all remaining straight double quotes
    result = result.replace('"', CLOSE_DOUBLE);

    // Step 6: Convert single quotes
    // Opening: after whitespace, start of line, or opening brackets
    result = OPEN_SINGLE_RE.replace_all(&result, |caps: &regex::Captures| {
        format!("{}{}", &caps[1], OPEN_SINGLE)
    }).to_string();
    // Closing/apostrophe: all remaining straight single quotes
    result = result.replace('\'', CLOSE_SINGLE);

    result
}

/// Result of formatting a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatResult {
    /// Path to the formatted file
    pub path: String,
    /// Whether the file content was modified
    pub changed: bool,
}

/// Format typography in a single markdown file.
///
/// # Arguments
/// * `path` - Path to the markdown file
/// * `dry_run` - If true, report what would change without writing
///
/// # Errors
/// Returns an error if the file cannot be read or written.
pub fn format_file(path: &Path, dry_run: bool) -> Result<FormatResult> {
    let content = fs::read_to_string(path)?;
    let converted = update_typography(&content);

    let changed = content != converted;

    if changed && !dry_run {
        fs::write(path, &converted)?;
    }

    Ok(FormatResult {
        path: path.display().to_string(),
        changed,
    })
}

/// Format all markdown files in a directory.
///
/// # Arguments
/// * `dir` - Directory path to search for `.md` files
/// * `recurse` - If true, process subdirectories recursively
/// * `dry_run` - If true, report what would change without writing
///
/// # Errors
/// Returns an error if the directory cannot be read.
/// Individual file errors are logged but don't stop processing.
pub fn format_directory(dir: &Path, recurse: bool, dry_run: bool) -> Result<Vec<FormatResult>> {
    let mut results = Vec::new();

    let walker = if recurse {
        WalkDir::new(dir)
    } else {
        WalkDir::new(dir).max_depth(1)
    };

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
            match format_file(path, dry_run) {
                Ok(result) => results.push(result),
                Err(e) => {
                    // Log warning but continue processing other files
                    tracing::warn!("Failed to format {}: {}", path.display(), e);
                }
            }
        }
    }

    Ok(results)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ellipsis() {
        assert_eq!(update_typography("Wait... what?"), "Wait\u{2026} what?");
    }

    #[test]
    fn test_em_dash() {
        assert_eq!(update_typography("Hello--world"), "Hello\u{2014}world");
    }

    #[test]
    fn test_em_dash_preserves_triple() {
        // Triple dash (markdown HR) should NOT be converted
        assert_eq!(update_typography("---"), "---");
    }

    #[test]
    fn test_double_quotes() {
        assert_eq!(update_typography(r#""Hello""#), "\u{201C}Hello\u{201D}");
        assert_eq!(update_typography(r#"She said "hi""#), "She said \u{201C}hi\u{201D}");
    }

    #[test]
    fn test_em_dash_before_closing_quote() {
        assert_eq!(update_typography(r#""But--""#), "\u{201C}But\u{2014}\u{201D}");
        assert_eq!(update_typography("\"But--\","), "\u{201C}But\u{2014}\u{201D},");
    }

    #[test]
    fn test_single_quotes() {
        assert_eq!(update_typography("'Hello'"), "\u{2018}Hello\u{2019}");
    }

    #[test]
    fn test_apostrophe() {
        // Apostrophes in contractions should use closing single quote
        assert_eq!(update_typography("don't"), "don\u{2019}t");
        assert_eq!(update_typography("Ren's"), "Ren\u{2019}s");
    }

    #[test]
    fn test_html_comment_preserved() {
        // Dashes inside HTML comments should NOT be converted
        assert_eq!(
            update_typography("<!-- comment with -- dash -->"),
            "<!-- comment with -- dash -->"
        );
    }

    #[test]
    fn test_multiple_comments() {
        // Multiple comments should all be preserved
        let input = "text <!-- a -- b --> more <!-- c -- d --> end";
        let output = update_typography(input);
        assert_eq!(output, "text <!-- a -- b --> more <!-- c -- d --> end");
    }
}