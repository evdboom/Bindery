use crate::config::Config;
use anyhow::{Result, anyhow};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use walkdir::WalkDir;

const DEFAULT_SYNC_PATHS: &[&str] = &[
    "Story/EN",
    "Story/NL",
    "Story/AGENTS.md",
    "Story/Details_*.md",
    "Notes",
    "AGENTS.md",
    "Details_*.md",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncInput {
    pub direction: Option<String>,
    pub paths: Option<Vec<String>>,
    pub delete: Option<bool>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub changed_files_count: usize,
    pub elapsed_ms: u128,
    pub manifest_path: String,
    pub synced_paths: Vec<String>,
    pub warnings: Vec<String>,
    pub rsync_failures: Vec<RsyncFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RsyncFailure {
    pub path: String,
    pub status: i32,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkManifest {
    pub source_root: String,
    pub work_root: String,
    pub synced_at: chrono::DateTime<Utc>,
    pub paths: Vec<String>,
    pub changed_files: Vec<String>,
    pub file_count: usize,
}

#[derive(Debug, Clone, Copy)]
enum SyncDirection {
    FromSource,
    ToSource,
}

impl SyncDirection {
    fn parse(value: &str) -> Result<Self> {
        match value.to_lowercase().as_str() {
            "from_source" => Ok(SyncDirection::FromSource),
            "to_source" => Ok(SyncDirection::ToSource),
            _ => Err(anyhow!("direction must be from_source or to_source")),
        }
    }
}

#[derive(Debug, Clone)]
struct SyncItem {
    rel_path: String,
    src: PathBuf,
    dst: PathBuf,
    is_dir: bool,
}

pub fn default_sync_paths() -> Vec<String> {
    DEFAULT_SYNC_PATHS.iter().map(|v| v.to_string()).collect()
}

pub fn sync_for_indexing(config: &Config, paths: Option<Vec<String>>) -> Result<SyncResult> {
    let paths = paths.unwrap_or_else(default_sync_paths);
    sync_internal(config, SyncDirection::FromSource, paths, config.sync_delete_default, false, false)
}

pub fn sync_workspace(config: &Config, input: SyncInput) -> Result<SyncResult> {
    let direction = input.direction.unwrap_or_else(|| "from_source".to_string());
    let delete = input.delete.unwrap_or(config.sync_delete_default);
    let dry_run = input.dry_run.unwrap_or(false);
    let paths = input.paths.unwrap_or_else(default_sync_paths);

    sync_internal(
        config,
        SyncDirection::parse(&direction)?,
        paths,
        delete,
        dry_run,
        true,
    )
}

fn sync_internal(
    config: &Config,
    direction: SyncDirection,
    paths: Vec<String>,
    delete: bool,
    dry_run: bool,
    deprecated_warning: bool,
) -> Result<SyncResult> {
    let start = Instant::now();
    let mut changed_files = Vec::new();
    let mut warnings = Vec::new();
    let mut rsync_failures = Vec::new();

    if deprecated_warning {
        warnings.push("sync_workspace is deprecated; use index_build (it syncs automatically)".to_string());
    }

    let resolved_paths = resolve_paths(config, direction, &paths, &mut warnings)?;
    let items = build_sync_items(config, direction, &resolved_paths, &mut warnings)?;

    if rsync_available() {
        for item in &items {
            if let Err(err) = sync_with_rsync(item, delete, dry_run, &mut changed_files, &mut warnings, &mut rsync_failures) {
                warnings.push(format!("rsync failed for {}: {err}", item.rel_path));
            }
        }
    } else {
        warnings.push("rsync not available; using fallback sync".to_string());
        let fallback_changes = sync_with_fallback(&items, delete, dry_run, &mut warnings)?;
        changed_files.extend(fallback_changes);
    }

    let file_count = count_files(&config.work_root, &resolved_paths);

    let manifest = WorkManifest {
        source_root: config.source_root.to_string_lossy().to_string(),
        work_root: config.work_root.to_string_lossy().to_string(),
        synced_at: Utc::now(),
        paths: resolved_paths.clone(),
        changed_files: changed_files.clone(),
        file_count,
    };

    let manifest_path = config.manifest_path();
    if let Some(parent) = manifest_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)?;

    Ok(SyncResult {
        changed_files_count: changed_files.len(),
        elapsed_ms: start.elapsed().as_millis(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        synced_paths: resolved_paths,
        warnings,
        rsync_failures,
    })
}

fn validate_rel_path(value: &str) -> Result<()> {
    if value.contains("..") || value.starts_with('/') || value.starts_with('\\') {
        return Err(anyhow!("Invalid relative path: {value}"));
    }
    Ok(())
}

fn parse_rsync_path(line: &str) -> Option<String> {
    if line.starts_with('>') || line.starts_with('<') || line.starts_with('*') || line.starts_with('c') {
        line.split_whitespace().last().map(|s| s.to_string())
    } else {
        None
    }
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("...[truncated]");
    }
    truncated
}

fn resolve_sync_paths(config: &Config, direction: SyncDirection, rel: &str) -> Result<(PathBuf, PathBuf)> {
    if rel == "mcp-rust" || rel.starts_with("mcp-rust/") {
        let mirror_root = config.mcp_mirror_root.clone()
            .ok_or_else(|| anyhow!("BINDERY_MCP_MIRROR_ROOT is required to sync mcp-rust"))?;
        let subpath = Path::new(rel).strip_prefix("mcp-rust").unwrap_or(Path::new(""));
        let subpath = if subpath.as_os_str().is_empty() { Path::new("") } else { subpath };
        return if matches!(direction, SyncDirection::ToSource) {
            Ok((mirror_root.join(subpath), config.source_root.join("mcp-rust").join(subpath)))
        } else {
            Ok((config.source_root.join("mcp-rust").join(subpath), mirror_root.join(subpath)))
        };
    }

    if matches!(direction, SyncDirection::ToSource) {
        Ok((config.work_root.join(rel), config.source_root.join(rel)))
    } else {
        Ok((config.source_root.join(rel), config.work_root.join(rel)))
    }
}

fn count_files(work_root: &Path, rel_paths: &[String]) -> usize {
    let mut count = 0usize;
    for rel in rel_paths {
        let path = work_root.join(rel);
        if path.is_file() {
            count += 1;
            continue;
        }
        for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                count += 1;
            }
        }
    }
    count
}

fn resolve_paths(
    config: &Config,
    direction: SyncDirection,
    input_paths: &[String],
    warnings: &mut Vec<String>,
) -> Result<Vec<String>> {
    let root = match direction {
        SyncDirection::FromSource => &config.source_root,
        SyncDirection::ToSource => &config.work_root,
    };

    let mut resolved = BTreeSet::new();
    for rel in input_paths {
        validate_rel_path(rel)?;
        expand_path(root, rel, &mut resolved, warnings);
    }

    if resolved.is_empty() {
        return Err(anyhow!(
            "No valid sync paths found. Provided: {:?}",
            input_paths
        ));
    }

    Ok(resolved.into_iter().collect())
}

fn expand_path(root: &Path, rel: &str, resolved: &mut BTreeSet<String>, warnings: &mut Vec<String>) {
    if !rel.contains('*') {
        let abs = root.join(rel);
        if abs.exists() {
            resolved.insert(rel.to_string());
        } else {
            warnings.push(format!("sync path not found: {}", abs.display()));
        }
        return;
    }

    let (parent, pattern) = split_pattern(rel);
    let base = if parent.is_empty() { root.to_path_buf() } else { root.join(&parent) };
    if !base.exists() {
        warnings.push(format!("sync path not found: {}", base.display()));
        return;
    }

    let Ok(entries) = std::fs::read_dir(&base) else {
        warnings.push(format!("failed to read directory: {}", base.display()));
        return;
    };

    let parent_ref = parent.as_str();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else { continue; };
        if !matches_pattern(name, pattern.as_str()) {
            continue;
        }
        let rel_path = if parent_ref.is_empty() {
            name.to_string()
        } else {
            format!("{parent_ref}/{name}")
        };
        resolved.insert(rel_path);
    }
}

fn split_pattern(rel: &str) -> (String, String) {
    let mut parts = rel.rsplitn(2, '/');
    let file = parts.next().unwrap_or(rel);
    let parent = parts.next().unwrap_or("");
    (parent.to_string(), file.to_string())
}

fn matches_pattern(name: &str, pattern: &str) -> bool {
    if !pattern.contains('*') {
        return name == pattern;
    }
    let segments: Vec<&str> = pattern.split('*').collect();
    if segments.is_empty() {
        return true;
    }
    let mut pos = 0usize;
    for (idx, seg) in segments.iter().enumerate() {
        if seg.is_empty() {
            continue;
        }
        if idx == 0 {
            if !name.starts_with(seg) {
                return false;
            }
            pos = seg.len();
            continue;
        }
        if let Some(found) = name[pos..].find(seg) {
            pos += found + seg.len();
        } else {
            return false;
        }
    }
    if let Some(last) = segments.last() {
        if !last.is_empty() && !name.ends_with(last) {
            return false;
        }
    }
    true
}

fn build_sync_items(
    config: &Config,
    direction: SyncDirection,
    rel_paths: &[String],
    warnings: &mut Vec<String>,
) -> Result<Vec<SyncItem>> {
    let mut items = Vec::new();
    for rel in rel_paths {
        let (src, dst) = resolve_sync_paths(config, direction, rel)?;
        if !src.exists() {
            warnings.push(format!("sync source missing: {}", src.display()));
            continue;
        }
        let is_dir = src.is_dir();
        items.push(SyncItem {
            rel_path: rel.clone(),
            src,
            dst,
            is_dir,
        });
    }
    Ok(items)
}

fn rsync_available() -> bool {
    Command::new("rsync").arg("--version").output().is_ok()
}

fn sync_with_rsync(
    item: &SyncItem,
    delete: bool,
    dry_run: bool,
    changed_files: &mut Vec<String>,
    warnings: &mut Vec<String>,
    rsync_failures: &mut Vec<RsyncFailure>,
) -> Result<()> {
    // Ensure destination exists
    if let Some(parent) = if item.is_dir { Some(item.dst.clone()) } else { item.dst.parent().map(|p| p.to_path_buf()) } {
        if let Err(e) = std::fs::create_dir_all(&parent) {
            warnings.push(format!("Failed to create directory {}: {e}", parent.display()));
        }
    }

    let mut cmd = Command::new("rsync");
    cmd.arg("-a").arg("--checksum").arg("--itemize-changes");
    if item.is_dir {
        cmd.arg("--prune-empty-dirs");
    }
    if delete && item.is_dir {
        cmd.arg("--delete");
    }
    if dry_run {
        cmd.arg("--dry-run");
    }
    if item.is_dir {
        cmd.arg(item.src.to_string_lossy().to_string() + "/");
        cmd.arg(item.dst.to_string_lossy().to_string() + "/");
    } else {
        cmd.arg(item.src.to_string_lossy().to_string());
        cmd.arg(item.dst.to_string_lossy().to_string());
    }

    let output = cmd.output().map_err(|e| anyhow!("rsync failed: {e}"))?;
    if !output.status.success() {
        let status = output.status.code().unwrap_or(-1);
        let stderr = truncate_text(&String::from_utf8_lossy(&output.stderr), 2000);
        warnings.push(format!("rsync status failed for {}", item.rel_path));
        rsync_failures.push(RsyncFailure {
            path: item.rel_path.clone(),
            status,
            stderr,
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(path) = parse_rsync_path(line) {
            let full_path = if item.is_dir {
                if path.is_empty() {
                    item.rel_path.clone()
                } else {
                    format!("{}/{}", item.rel_path.trim_end_matches('/'), path)
                }
            } else {
                item.rel_path.clone()
            };
            changed_files.push(full_path);
        }
    }
    Ok(())
}

fn sync_with_fallback(
    items: &[SyncItem],
    delete: bool,
    dry_run: bool,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>> {
    let mut changed = Vec::new();
    let mut expected_files: HashSet<String> = HashSet::new();

    for item in items {
        if item.is_dir {
            for entry in WalkDir::new(&item.src).into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() {
                    continue;
                }
                let rel = entry.path().strip_prefix(&item.src).unwrap_or(entry.path());
                let rel = rel.to_string_lossy().replace('\\', "/");
                let full_rel = format!("{}/{}", item.rel_path.trim_end_matches('/'), rel);
                expected_files.insert(full_rel.clone());

                let dst = item.dst.join(rel);
                if file_needs_copy(entry.path(), &dst) {
                    changed.push(full_rel);
                    if !dry_run {
                        if let Some(parent) = dst.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        std::fs::copy(entry.path(), &dst)?;
                    }
                }
            }
        } else {
            expected_files.insert(item.rel_path.clone());
            if file_needs_copy(&item.src, &item.dst) {
                changed.push(item.rel_path.clone());
                if !dry_run {
                    if let Some(parent) = item.dst.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::copy(&item.src, &item.dst)?;
                }
            }
        }
    }

    if delete {
        for item in items {
            let dst_root = &item.dst;
            if !dst_root.exists() {
                continue;
            }
            if item.is_dir {
                for entry in WalkDir::new(dst_root).into_iter().filter_map(|e| e.ok()) {
                    if !entry.file_type().is_file() {
                        continue;
                    }
                    let rel = entry.path().strip_prefix(dst_root).unwrap_or(entry.path());
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    let full_rel = format!("{}/{}", item.rel_path.trim_end_matches('/'), rel);
                    if !expected_files.contains(&full_rel) {
                        changed.push(full_rel.clone());
                        if !dry_run {
                            if let Err(err) = std::fs::remove_file(entry.path()) {
                                warnings.push(format!("failed to delete {}: {err}", entry.path().display()));
                            }
                        }
                    }
                }
            } else if !expected_files.contains(&item.rel_path) {
                changed.push(item.rel_path.clone());
                if !dry_run {
                    if let Err(err) = std::fs::remove_file(dst_root) {
                        warnings.push(format!("failed to delete {}: {err}", dst_root.display()));
                    }
                }
            }
        }
    }

    Ok(changed)
}

fn file_needs_copy(src: &Path, dst: &Path) -> bool {
    let Ok(src_meta) = src.metadata() else { return false; };
    let Ok(dst_meta) = dst.metadata() else { return true; };

    if src_meta.len() != dst_meta.len() {
        return true;
    }
    if let (Ok(src_m), Ok(dst_m)) = (src_meta.modified(), dst_meta.modified()) {
        if src_m > dst_m {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{resolve_sync_paths, truncate_text, SyncDirection};
    use crate::config::Config;
    use std::path::PathBuf;

    fn test_config() -> Config {
        Config {
            source_root: PathBuf::from("/mnt/c/MyRepo"),
            work_root: PathBuf::from("/home/user/bindery_work"),
            index_dir: PathBuf::from("/home/user/.bindery/index"),
            mcp_mirror_root: Some(PathBuf::from("/home/user/src/bindery-mcp")),
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
        }
    }

    #[test]
    fn resolves_mcp_rust_paths_from_source() {
        let config = test_config();
        let (src, dst) = resolve_sync_paths(&config, SyncDirection::FromSource, "mcp-rust/src")
            .expect("resolve");
        assert_eq!(src, PathBuf::from("/mnt/c/MyRepo/mcp-rust/src"));
        assert_eq!(dst, PathBuf::from("/home/user/src/bindery-mcp/src"));
    }

    #[test]
    fn truncates_long_stderr() {
        let input = "a".repeat(10);
        let result = truncate_text(&input, 5);
        assert!(result.starts_with("aaaaa"));
        assert!(result.contains("[truncated]"));
    }
}
