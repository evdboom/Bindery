use std::collections::HashMap;

pub fn min_max_normalize(values: &[(String, f32)]) -> HashMap<String, f32> {
    let mut map = HashMap::new();
    if values.is_empty() {
        return map;
    }
    let mut min = f32::MAX;
    let mut max = f32::MIN;
    for (_, v) in values {
        if *v < min { min = *v; }
        if *v > max { max = *v; }
    }
    let denom = if (max - min).abs() < f32::EPSILON { 1.0 } else { max - min };
    for (k, v) in values {
        let norm = if denom == 1.0 && (max - min).abs() < f32::EPSILON { 1.0 } else { (*v - min) / denom };
        map.insert(k.clone(), norm);
    }
    map
}
