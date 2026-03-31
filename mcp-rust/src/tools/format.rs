use crate::{config::Config, format as format_core};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatInput {
    pub path: Option<String>,
    pub no_recurse: Option<bool>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatOutput {
    pub root: String,
    pub results: Vec<format_core::FormatResult>,
    pub changed: u32,
    pub total: u32,
    pub dry_run: bool,
}

pub fn format_markdown(config: &Config, input: FormatInput) -> Result<FormatOutput> {
    let dry_run = input.dry_run.unwrap_or(false);
    let no_recurse = input.no_recurse.unwrap_or(false);

    let target = resolve_path(config, input.path.as_deref())?;

    let results = if target.is_dir() {
        format_core::format_directory(&target, !no_recurse, dry_run)?
    } else if target.is_file() {
        vec![format_core::format_file(&target, dry_run)?]
    } else {
        return Err(anyhow!("Path does not exist: {}", target.display()));
    };

    let changed = results.iter().filter(|r| r.changed).count() as u32;
    let total = results.len() as u32;

    Ok(FormatOutput {
        root: target.display().to_string(),
        results,
        changed,
        total,
        dry_run,
    })
}

fn resolve_path(config: &Config, path: Option<&str>) -> Result<PathBuf> {
    let base = config.source_root.clone();
    match path {
        Some(p) => {
            let candidate = PathBuf::from(p);
            if candidate.is_absolute() {
                Ok(candidate)
            } else {
                Ok(base.join(candidate))
            }
        }
        None => Ok(base),
    }
}