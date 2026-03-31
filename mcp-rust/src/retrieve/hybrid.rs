use crate::{Candidate, ChunkMeta};
use std::collections::HashMap;
use crate::retrieve::normalize::min_max_normalize;

pub fn merge_and_rerank(
    lex: &[Candidate],
    vec: &[(ChunkMeta, f32)],
    weight_lex: f32,
    weight_vec: f32,
) -> Vec<Candidate> {
    let mut by_id: HashMap<String, Candidate> = HashMap::new();

    for c in lex {
        by_id.entry(c.id.clone()).or_insert_with(|| c.clone());
    }
    for (meta, _) in vec {
        by_id.entry(meta.id.clone()).or_insert_with(|| Candidate {
            id: meta.id.clone(),
            path: meta.path.clone(),
            start_line: meta.start_line,
            end_line: meta.end_line,
            score: 0.0,
            source: "vec".to_string(),
        });
    }

    let lex_scores: Vec<(String, f32)> = lex.iter().map(|c| (c.id.clone(), c.score)).collect();
    let vec_scores: Vec<(String, f32)> = vec.iter().map(|(m, s)| (m.id.clone(), *s)).collect();

    let lex_norm = min_max_normalize(&lex_scores);
    let vec_norm = min_max_normalize(&vec_scores);

    let mut merged = Vec::new();
    for (id, mut base) in by_id {
        let l = lex_norm.get(&id).copied().unwrap_or(0.0);
        let v = vec_norm.get(&id).copied().unwrap_or(0.0);
        let score = if l > 0.0 && v > 0.0 {
            weight_lex * l + weight_vec * v
        } else if l > 0.0 {
            l
        } else {
            v
        };
        base.score = score;
        base.source = if l > 0.0 && v > 0.0 { "hybrid".to_string() } else if l > 0.0 { "lex".to_string() } else { "vec".to_string() };
        merged.push(base);
    }

    merged.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    merged
}
