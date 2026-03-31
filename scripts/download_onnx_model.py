#!/usr/bin/env python3
"""Download and export a sentence-transformers model to ONNX.

Example:
  python scripts/download_onnx_model.py \
    --model sentence-transformers/all-MiniLM-L6-v2 \
    --out .bindery/models/all-MiniLM-L6-v2
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from huggingface_hub import snapshot_download


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="HuggingFace model id")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--task", default="feature-extraction", help="Optimum task")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading model: {args.model}")
    snapshot_path = snapshot_download(args.model)

    print("Exporting to ONNX (optimum-cli)...")
    cmd = [
        "optimum-cli",
        "export",
        "onnx",
        "--model",
        args.model,
        "--task",
        args.task,
        str(out_dir),
    ]
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print("optimum-cli export failed.")
        return result.returncode

    # Copy tokenizer/config files if present
    for name in [
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "config.json",
    ]:
        src = Path(snapshot_path) / name
        if src.exists():
            shutil.copy2(src, out_dir / name)

    print("Done. Files written to:", out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
