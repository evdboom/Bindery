use anyhow::Result;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

pub fn read_lines_string(path: &Path, start: u32, end: u32) -> Result<String> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut line_no: u32 = 0;
    for line in reader.lines() {
        let line = line?;
        line_no += 1;
        if line_no < start {
            continue;
        }
        if line_no > end {
            break;
        }
        lines.push(line);
    }
    Ok(lines.join("\n"))
}

pub fn read_lines_vec(path: &Path, start: u32, end: u32) -> Result<Vec<(u32, String)>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut line_no: u32 = 0;
    for line in reader.lines() {
        let line = line?;
        line_no += 1;
        if line_no < start {
            continue;
        }
        if line_no > end {
            break;
        }
        lines.push((line_no, line));
    }
    Ok(lines)
}
