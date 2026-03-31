use crate::Chunk;
use anyhow::{Result, anyhow};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

pub fn chunk_file(work_root: &Path, path: &Path) -> Result<Vec<Chunk>> {
    let file = File::open(path)?;
    let rel_path = path.strip_prefix(work_root)
        .map_err(|_| anyhow!("Path not under work root: {}", path.to_string_lossy()))?;
    let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");

    let mut chunks = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut start_line: Option<u32> = None;
    let mut line_no: u32 = 0;

    for line in BufReader::new(file).lines() {
        let line = line?;
        line_no += 1;
        if line.trim().is_empty() {
            if let Some(start) = start_line.take() {
                let end = line_no - 1;
                let text = current.join("\n");
                let id = chunk_id(&rel_path_str, start, end, &text);
                chunks.push(Chunk {
                    id,
                    path: rel_path_str.clone(),
                    start_line: start,
                    end_line: end,
                    text,
                });
                current.clear();
            }
            continue;
        }
        if start_line.is_none() {
            start_line = Some(line_no);
        }
        current.push(line);
    }

    if let Some(start) = start_line.take() {
        let end = line_no;
        let text = current.join("\n");
        let id = chunk_id(&rel_path_str, start, end, &text);
        chunks.push(Chunk {
            id,
            path: rel_path_str,
            start_line: start,
            end_line: end,
            text,
        });
    }

    Ok(chunks)
}

fn chunk_id(rel_path: &str, start_line: u32, end_line: u32, text: &str) -> String {
    let content_hash = hash_bytes(text.as_bytes());
    let raw = format!("{rel_path}:{start_line}:{end_line}:{content_hash}");
    hash_bytes(raw.as_bytes())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::chunk_id;

    #[test]
    fn chunk_id_stable() {
        let a = chunk_id("Story/EN/Chapter1.md", 1, 2, "Hello");
        let b = chunk_id("Story/EN/Chapter1.md", 1, 2, "Hello");
        assert_eq!(a, b);
    }
}
