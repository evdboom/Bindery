use crate::embeddings::provider::EmbeddingProvider;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json;
use std::time::Duration;

#[derive(Clone)]
pub struct OllamaProvider {
    url: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(url: String, model: String) -> Self {
        Self { url, model }
    }

    fn embed_request(&self, input: &str) -> Result<Vec<f32>> {
        let endpoint = format!("{}/api/embeddings", self.url.trim_end_matches('/'));
        let body = EmbeddingRequest { model: self.model.clone(), prompt: input.to_string() };
        let body_json = serde_json::to_string(&body)?;
        let response: Result<ureq::Response, ureq::Error> = ureq::post(&endpoint)
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(30))
            .send_string(&body_json);

        match response {
            Ok(resp) => {
                if resp.status() >= 400 {
                    return Err(anyhow!("Ollama embeddings failed: {}", resp.status()));
                }
                let text = resp.into_string().map_err(|e| anyhow!("Ollama response read failed: {e}"))?;
                let parsed: EmbeddingResponse = serde_json::from_str(&text)?;
                Ok(parsed.embedding)
            }
            Err(ureq::Error::Status(code, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                Err(anyhow!("Ollama embeddings failed: {} {}", code, text))
            }
            Err(err) => Err(anyhow!("Ollama request failed: {err}")),
        }
    }

    fn ping(&self) -> bool {
        let endpoint = format!("{}/api/tags", self.url.trim_end_matches('/'));
        let response: Result<ureq::Response, ureq::Error> = ureq::get(&endpoint)
            .timeout(Duration::from_secs(10))
            .call();
        match response {
            Ok(resp) => resp.status() >= 200 && resp.status() < 300,
            Err(_) => false,
        }
    }
}

impl EmbeddingProvider for OllamaProvider {
    fn embed(&self, input: &str) -> Result<Vec<f32>> {
        self.embed_request(input)
    }

    fn is_available(&self) -> bool {
        self.ping()
    }

    fn model(&self) -> String {
        self.model.clone()
    }

    fn backend(&self) -> String {
        "ollama".to_string()
    }
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    embedding: Vec<f32>,
}

#[cfg(test)]
mod tests {
    use super::EmbeddingResponse;

    #[test]
    fn parses_embedding_response() {
        let value = serde_json::json!({"embedding": [0.1, 0.2, 0.3]});
        let parsed: EmbeddingResponse = serde_json::from_value(value).expect("parse");
        assert_eq!(parsed.embedding.len(), 3);
    }
}
