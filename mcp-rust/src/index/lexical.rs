use crate::{Chunk, Candidate};
use anyhow::{Result, anyhow};
use std::path::Path;
use tantivy::{Index, schema::{TEXT, STORED, STRING, SchemaBuilder, TantivyDocument, Value}};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;

pub const LEXICAL_DIR: &str = "lexical";

pub fn build_lexical(index_dir: &Path, chunks: &[Chunk]) -> Result<()> {
    let target_dir = index_dir.join(LEXICAL_DIR);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)?;
    }
    std::fs::create_dir_all(&target_dir)?;

    let mut schema_builder = SchemaBuilder::default();
    let path_field = schema_builder.add_text_field("path", STRING | STORED);
    let chunk_id_field = schema_builder.add_text_field("chunk_id", STRING | STORED);
    let start_line_field = schema_builder.add_u64_field("start_line", STORED);
    let end_line_field = schema_builder.add_u64_field("end_line", STORED);
    let content_field = schema_builder.add_text_field("content", TEXT);
    let schema = schema_builder.build();

    let index = Index::create_in_dir(&target_dir, schema.clone())?;
    let mut writer = index.writer(50_000_000)?;

    for chunk in chunks {
        let mut doc = TantivyDocument::default();
        doc.add_text(path_field, &chunk.path);
        doc.add_text(chunk_id_field, &chunk.id);
        doc.add_u64(start_line_field, chunk.start_line as u64);
        doc.add_u64(end_line_field, chunk.end_line as u64);
        doc.add_text(content_field, &chunk.text);
        writer.add_document(doc)?;
    }

    writer.commit()?;
    Ok(())
}

pub fn search_lexical(index_dir: &Path, query: &str, top_k: usize) -> Result<Vec<Candidate>> {
    let target_dir = index_dir.join(LEXICAL_DIR);
    if !target_dir.exists() {
        return Err(anyhow!("Lexical index missing"));
    }
    let index = Index::open_in_dir(&target_dir)?;
    let schema = index.schema();
    let path_field = schema.get_field("path").map_err(|e| anyhow!("Missing path field: {e}"))?;
    let chunk_id_field = schema.get_field("chunk_id").map_err(|e| anyhow!("Missing chunk_id field: {e}"))?;
    let start_line_field = schema.get_field("start_line").map_err(|e| anyhow!("Missing start_line field: {e}"))?;
    let end_line_field = schema.get_field("end_line").map_err(|e| anyhow!("Missing end_line field: {e}"))?;
    let content_field = schema.get_field("content").map_err(|e| anyhow!("Missing content field: {e}"))?;

    let reader = index.reader()?;
    let searcher = reader.searcher();
    let query_parser = QueryParser::for_index(&index, vec![content_field]);
    let query = query_parser.parse_query(query)?;
    let top_docs = searcher.search(&query, &TopDocs::with_limit(top_k))?;

    let mut results = Vec::new();
    for (score, doc_address) in top_docs {
        let retrieved: TantivyDocument = searcher.doc(doc_address)?;
        let path = retrieved.get_first(path_field).and_then(|v| v.as_str()).unwrap_or("?").to_string();
        let chunk_id = retrieved.get_first(chunk_id_field).and_then(|v| v.as_str()).unwrap_or("?").to_string();
        let start_line = retrieved.get_first(start_line_field).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let end_line = retrieved.get_first(end_line_field).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        results.push(Candidate {
            id: chunk_id,
            path,
            start_line,
            end_line,
            score: score as f32,
            source: "lex".to_string(),
        });
    }

    Ok(results)
}
