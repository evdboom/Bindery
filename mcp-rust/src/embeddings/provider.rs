use anyhow::Result;

pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, input: &str) -> Result<Vec<f32>>;
    
    /// Embed multiple texts in a single batch request.
    /// Default implementation falls back to sequential single embeds.
    fn embed_batch(&self, inputs: &[&str]) -> Result<Vec<Vec<f32>>> {
        inputs.iter().map(|s| self.embed(s)).collect()
    }
    
    fn is_available(&self) -> bool;
    fn model(&self) -> String;
    fn backend(&self) -> String;
}
