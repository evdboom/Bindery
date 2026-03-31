use crate::{config::Config, merge};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeInput {
    pub language: Option<String>,
    pub output_type: Option<String>,
    pub root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeOutput {
    pub root: String,
    pub results: Vec<MergeRunResult>,
    pub pandoc_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeRunResult {
    pub language: String,
    pub outputs: Vec<String>,
    pub files_merged: usize,
}

pub fn merge_book(config: &Config, input: MergeInput) -> Result<MergeOutput> {
    let root = input.root.map(PathBuf::from).unwrap_or_else(|| config.source_root.clone());
    if !root.exists() {
        return Err(anyhow!("Root path does not exist: {}", root.display()));
    }

    let languages = parse_languages(input.language.as_deref().unwrap_or("EN"))?;
    let output_types = parse_output_types(input.output_type.as_deref().unwrap_or("md"))?;

    let needs_pandoc = output_types.iter().any(|t| matches!(t, merge::OutputType::Docx | merge::OutputType::Epub | merge::OutputType::Pdf));
    let pandoc_version = if needs_pandoc { Some(merge::check_pandoc()?) } else { None };

    let mut results = Vec::new();

    for language in languages {
        let options = merge::MergeOptions {
            root: root.clone(),
            language,
            output_types: output_types.clone(),
            include_toc: true,
            include_separators: true,
            include_source_markers: true,
            author: config.author.clone(),
            libreoffice_path: config.libreoffice_path.clone(),
        };

        let result = merge::merge_book(&options)?;
        let outputs = result.outputs.iter().map(|p| p.display().to_string()).collect();

        results.push(MergeRunResult {
            language: language.folder_name().to_string(),
            outputs,
            files_merged: result.files_merged,
        });
    }

    Ok(MergeOutput {
        root: root.display().to_string(),
        results,
        pandoc_version,
    })
}

fn parse_languages(input: &str) -> Result<Vec<merge::Language>> {
    let values: Vec<&str> = input
        .split(|c| c == ',' || c == ' ' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut languages = Vec::new();
    for value in values {
        if let Some(lang) = merge::Language::from_str(value) {
            languages.push(lang);
        } else {
            return Err(anyhow!("Invalid language: {}", value));
        }
    }

    if languages.is_empty() {
        return Err(anyhow!("No valid languages provided"));
    }

    Ok(languages)
}

fn parse_output_types(input: &str) -> Result<Vec<merge::OutputType>> {
    let values: Vec<&str> = input
        .split(|c| c == ',' || c == ' ' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut output_types = Vec::new();
    for value in values {
        if let Some(output) = merge::OutputType::from_str(value) {
            output_types.push(output);
        } else {
            return Err(anyhow!("Invalid output type: {} (valid: md, docx, epub, pdf)", value));
        }
    }

    if output_types.is_empty() {
        return Err(anyhow!("No valid output types provided"));
    }

    Ok(output_types)
}