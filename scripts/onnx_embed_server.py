import os
from typing import List, Union

from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

from transformers import AutoTokenizer
import onnxruntime as ort
from optimum.onnxruntime import ORTModelForFeatureExtraction
import numpy as np


def select_provider() -> str:
    """Pick the best available ONNX Runtime execution provider."""
    available = ort.get_available_providers()
    # Prefer DirectML (Windows GPU), then CUDA, then CPU
    for pref in ["DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]:
        if pref in available:
            return pref
    return available[0] if available else "CPUExecutionProvider"


MODEL_ID = os.getenv("ONNX_MODEL_ID", "BAAI/bge-m3")
PROVIDER = os.getenv("ONNX_PROVIDER", "") or select_provider()
HOST = os.getenv("ONNX_HOST", "0.0.0.0")
PORT = int(os.getenv("ONNX_PORT", "11435"))
EXPORT = os.getenv("ONNX_EXPORT", "1").lower() in {"1", "true", "yes"}

print(f"ONNX provider: {PROVIDER} (available: {ort.get_available_providers()})")

# Suppress ORT's informational node-assignment warning (shape ops intentionally run on CPU).
ort.set_default_logger_severity(3)

try:
    # fix_mistral_regex corrects a bad regex in this tokenizer's config (bge-m3 inherits
    # it from its Mistral-derived tokenizer). The warning fires before the fix is applied
    # and is a false positive — tokenization is correct with this flag set.
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, fix_mistral_regex=True)
except TypeError:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
try:
    model = ORTModelForFeatureExtraction.from_pretrained(
        MODEL_ID,
        export=EXPORT,
        provider=PROVIDER,
    )
except Exception as exc:  # pragma: no cover - startup failures
    hint = (
        "ONNX export failed. Either install ONNX + torch for export, or "
        "export once with: `optimum-cli export onnx --model BAAI/bge-m3 --task feature-extraction onnx/bge-m3` "
        "then set ONNX_MODEL_ID=onnx/bge-m3 and ONNX_EXPORT=0."
    )
    raise RuntimeError(hint) from exc


class EmbeddingRequest(BaseModel):
    model: str = MODEL_ID
    input: Union[str, List[str]]


def mean_pool(last_hidden_state: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    mask = attention_mask.astype(np.float32)
    masked = last_hidden_state * mask[:, :, None]
    summed = masked.sum(axis=1)
    counts = np.clip(mask.sum(axis=1, keepdims=True), a_min=1.0, a_max=None)
    return summed / counts


def l2_normalize(x: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(x, axis=1, keepdims=True)
    norm = np.clip(norm, a_min=1e-12, a_max=None)
    return x / norm


def extract_last_hidden_state(outputs) -> np.ndarray:
    if hasattr(outputs, "last_hidden_state"):
        return outputs.last_hidden_state
    if hasattr(outputs, "token_embeddings"):
        return outputs.token_embeddings
    if isinstance(outputs, dict):
        if "last_hidden_state" in outputs:
            return outputs["last_hidden_state"]
        if "token_embeddings" in outputs:
            return outputs["token_embeddings"]
        if len(outputs):
            return next(iter(outputs.values()))
    if isinstance(outputs, (list, tuple)) and outputs:
        return outputs[0]
    raise ValueError(f"ONNX outputs missing last_hidden_state/token_embeddings: {outputs}")


app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "provider": PROVIDER}


@app.post("/embeddings")
def embeddings(payload: EmbeddingRequest):
    inputs = payload.input if isinstance(payload.input, list) else [payload.input]
    tokenized = tokenizer(
        inputs,
        padding=True,
        truncation=True,
        return_tensors="np",
    )
    if hasattr(model, "model"):
        session = model.model
        output_names = [o.name for o in session.get_outputs()]
        input_feed = {k: np.asarray(v) for k, v in tokenized.items()}
        run_options = ort.RunOptions()
        outputs = session.run(output_names, input_feed, run_options)
        output_map = dict(zip(output_names, outputs))
        if "sentence_embedding" in output_map:
            pooled = output_map["sentence_embedding"]
            if pooled.ndim == 1:
                pooled = pooled[None, :]
            pooled = l2_normalize(pooled)
            vectors = pooled.astype(np.float32).tolist()
            if isinstance(payload.input, list):
                return {"embeddings": vectors}
            return {"embedding": vectors[0]}
        last_hidden_state = output_map.get("token_embeddings", outputs[0])
    else:
        outputs = model(**tokenized)
        last_hidden_state = extract_last_hidden_state(outputs)
    pooled = mean_pool(last_hidden_state, tokenized["attention_mask"])
    pooled = l2_normalize(pooled)
    vectors = pooled.astype(np.float32).tolist()
    if isinstance(payload.input, list):
        return {"embeddings": vectors}
    return {"embedding": vectors[0]}


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
