use bindery_mcp::retrieve::normalize::min_max_normalize;

#[test]
fn min_max_normalize_scales() {
    let input = vec![
        ("a".to_string(), 1.0),
        ("b".to_string(), 3.0),
    ];
    let out = min_max_normalize(&input);
    assert_eq!(out.get("a").copied().unwrap(), 0.0);
    assert_eq!(out.get("b").copied().unwrap(), 1.0);
}
