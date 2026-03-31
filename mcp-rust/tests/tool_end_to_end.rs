use bindery_mcp::config::Config;
use bindery_mcp::embeddings::none::NoneProvider;
use bindery_mcp::tools::{
    get_review_text::{get_review_text, GetReviewTextInput},
    get_text::{get_text, GetTextInput},
    index_build::{index_build, IndexBuildInput},
    retrieve_context::{retrieve_context, RetrieveContextInput},
    search::{search, SearchInput},
};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

fn test_config(source_root: &Path, work_root: &Path, index_dir: &Path) -> Config {
    Config {
        source_root: source_root.to_path_buf(),
        work_root: work_root.to_path_buf(),
        index_dir: index_dir.to_path_buf(),
        mcp_mirror_root: None,
        embeddings_backend: "none".to_string(),
        ollama_url: "http://127.0.0.1:11434".to_string(),
        ollama_model: "nomic-embed-text".to_string(),
        onnx_url: "http://127.0.0.1:11435".to_string(),
        onnx_model: "bge-m3".to_string(),
        sync_delete_default: true,
        max_response_bytes: 60000,
        snippet_max_chars: 1600,
        default_topk: 6,
        embed_batch_size: 32,
        author: None,
    }
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[test]
fn index_build_syncs_and_updates_manifest() {
    let dir = tempdir().unwrap();
    let source_root = dir.path().join("source");
    let work_root = dir.path().join("work");
    let index_dir = dir.path().join("index");

    write_file(
        &source_root.join("Story/EN/Act I - Awakening/Chapter8.md"),
        "End of chapter 8: Ren closes the loop.",
    );
    write_file(
        &source_root.join("Arc/Act_II_Resonance.md"),
        "Transition chapter 9 purpose: shift to resonance.",
    );
    write_file(
        &source_root.join("Arc/Overall.md"),
        "Overall arc notes.",
    );
    write_file(
        &source_root.join("Story/AGENTS.md"),
        "Story agents rules.",
    );
    write_file(
        &source_root.join("Notes/Details_Notes.md"),
        "Flux-touched: a sharp fear beat.",
    );
    write_file(&source_root.join("AGENTS.md"), "Root agents.");

    let config = test_config(&source_root, &work_root, &index_dir);
    let provider = NoneProvider::default();

    let result = index_build(
        &config,
        &provider,
        IndexBuildInput {
            scope: None,
            act: None,
            chapter_range: None,
            force_rebuild: None,
            require_synced: None,
            sync_paths: None,
        },
    )
    .unwrap();

    assert!(result.chunk_count > 0);
    assert!(work_root.join("AGENTS.md").exists());
    assert!(work_root.join("Arc/Act_II_Resonance.md").exists());
    assert!(work_root.join("Notes/Details_Notes.md").exists());

    let manifest_path = config.manifest_path();
    let manifest = std::fs::read_to_string(&manifest_path).unwrap();
    let value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let paths = value.get("paths").unwrap().as_array().unwrap();
    let paths: Vec<String> = paths
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    assert!(paths.contains(&"AGENTS.md".to_string()));
    assert!(paths.contains(&"Arc/Act_II_Resonance.md".to_string()));
}

#[test]
fn retrieve_context_finds_chapter_and_act_details() {
    let dir = tempdir().unwrap();
    let source_root = dir.path().join("source");
    let work_root = dir.path().join("work");
    let index_dir = dir.path().join("index");

    write_file(
        &source_root.join("Story/EN/Act I - Awakening/Chapter8.md"),
        "End of chapter 8: Ren remembers the Ashlight.",
    );
    write_file(
        &source_root.join("Arc/Act_II_Resonance.md"),
        "Transition chapter 9 purpose: bridge resonance beats.",
    );
    write_file(&source_root.join("Notes/Details_Notes.md"), "Flux-touched.");

    let config = test_config(&source_root, &work_root, &index_dir);
    let provider = NoneProvider::default();

    index_build(
        &config,
        &provider,
        IndexBuildInput {
            scope: None,
            act: None,
            chapter_range: None,
            force_rebuild: None,
            require_synced: None,
            sync_paths: None,
        },
    )
    .unwrap();

    let result = retrieve_context(
        &config,
        &provider,
        RetrieveContextInput {
            query: "end of chapter 8".to_string(),
            language: "EN".to_string(),
            top_k: Some(5),
            act: None,
            chapter_range: None,
        },
        Arc::new(Mutex::new(None)),
    )
    .unwrap();

    assert!(result
        .results
        .iter()
        .any(|hit| hit.path.ends_with("Chapter8.md")));

    let result = retrieve_context(
        &config,
        &provider,
        RetrieveContextInput {
            query: "transition chapter 9 purpose".to_string(),
            language: "EN".to_string(),
            top_k: Some(5),
            act: None,
            chapter_range: None,
        },
        Arc::new(Mutex::new(None)),
    )
    .unwrap();

    assert!(result
        .results
        .iter()
        .any(|hit| hit.path.ends_with("Act_II_Resonance.md")));
}

#[test]
fn get_text_resolves_shorthand_and_details() {
    let dir = tempdir().unwrap();
    let source_root = dir.path().join("source");
    let work_root = dir.path().join("work");
    let index_dir = dir.path().join("index");

    write_file(
        &source_root.join("Story/EN/Act II - Resonance/Chapter9.md"),
        "Chapter 9 text.",
    );
    write_file(
        &source_root.join("Arc/Overall.md"),
        "Overall arc summary.",
    );

    let config = test_config(&source_root, &work_root, &index_dir);

    let result = get_text(
        &config,
        GetTextInput {
            language: "EN".to_string(),
            identifier: "chapter9".to_string(),
            start_line: None,
            end_line: None,
        },
    )
    .unwrap();
    assert!(result.lines.iter().any(|line| line.text.contains("Chapter 9 text")));

    let result = get_text(
        &config,
        GetTextInput {
            language: "EN".to_string(),
            identifier: "details_overall".to_string(),
            start_line: None,
            end_line: None,
        },
    )
    .unwrap();
    assert!(result.lines.iter().any(|line| line.text.contains("Overall arc summary")));

    let err = get_text(
        &config,
        GetTextInput {
            language: "EN".to_string(),
            identifier: "missing_key".to_string(),
            start_line: None,
            end_line: None,
        },
    )
    .err()
    .unwrap();
    assert!(err.to_string().contains("Tried"));
}

#[test]
fn search_finds_hits_in_story_and_notes() {
    let dir = tempdir().unwrap();
    let source_root = dir.path().join("source");
    let work_root = dir.path().join("work");
    let index_dir = dir.path().join("index");

    write_file(
        &source_root.join("Story/EN/Act I - Awakening/Chapter1.md"),
        "The Ashlight burns bright.",
    );
    write_file(
        &source_root.join("Notes/Details_Notes.md"),
        "Flux-touched means fear spikes.",
    );
    write_file(&source_root.join("AGENTS.md"), "Agents.");

    let config = test_config(&source_root, &work_root, &index_dir);

    let result = search(
        &config,
        SearchInput {
            query: "Ashlight".to_string(),
            regex: None,
            case_sensitive: None,
            max_results: Some(10),
        },
    )
    .unwrap();
    assert!(result
        .results
        .iter()
        .any(|hit| hit.path.ends_with("Chapter1.md")));

    let result = search(
        &config,
        SearchInput {
            query: "Flux-touched".to_string(),
            regex: None,
            case_sensitive: None,
            max_results: Some(10),
        },
    )
    .unwrap();
    assert!(result
        .results
        .iter()
        .any(|hit| hit.path.ends_with("Details_Notes.md")));
}

#[test]
fn get_review_text_respects_language_filter() {
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("git not available; skipping get_review_text test");
        return;
    }

    let dir = tempdir().unwrap();
    let source_root = dir.path().join("repo");
    let work_root = dir.path().join("work");
    let index_dir = dir.path().join("index");

    std::fs::create_dir_all(&source_root).unwrap();
    run_git(&source_root, &["init"]);
    run_git(&source_root, &["config", "user.email", "test@example.com"]);
    run_git(&source_root, &["config", "user.name", "Tester"]);

    let en_file = source_root.join("Story/EN/Act II - Resonance/Chapter9.md");
    let nl_file = source_root.join("Story/NL/Deel II - Resonantie/Chapter9.md");

    write_file(&en_file, "Old EN text.");
    write_file(&nl_file, "Old NL text.");
    run_git(&source_root, &["add", "."]);
    run_git(&source_root, &["commit", "-m", "init"]);

    write_file(&en_file, "New EN text.");
    write_file(&nl_file, "New NL text.");

    let config = test_config(&source_root, &work_root, &index_dir);

    let en_result = get_review_text(
        &config,
        GetReviewTextInput {
            language: "EN".to_string(),
            context_lines: Some(1),
        },
    )
    .unwrap();
    assert!(en_result
        .files
        .iter()
        .any(|file| file.file.contains("Story/EN/Act II - Resonance/Chapter9.md")));
    assert!(!en_result
        .files
        .iter()
        .any(|file| file.file.contains("Story/NL/Deel II - Resonantie/Chapter9.md")));

    let all_result = get_review_text(
        &config,
        GetReviewTextInput {
            language: "ALL".to_string(),
            context_lines: Some(1),
        },
    )
    .unwrap();
    assert!(all_result
        .files
        .iter()
        .any(|file| file.file.contains("Story/EN/Act II - Resonance/Chapter9.md")));
    assert!(all_result
        .files
        .iter()
        .any(|file| file.file.contains("Story/NL/Deel II - Resonantie/Chapter9.md")));
}

fn run_git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(repo)
        .status()
        .unwrap();
    assert!(status.success(), "git {:?} failed", args);
}
