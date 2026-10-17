#!/usr/bin/env python3
"""Measure text→image search quality on a hand-labelled folder.

  .venv/bin/python eval/eval_search.py --labels eval/labels.json,eval/labels-pinterest-eval-150.json

Embeds every image once per image variant (cached in eval/.cache), embeds each
query once per query variant, and prints AP, P@10 and nDCG@10 per config.
Images listed as `ignore` for a query are removed before scoring.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from embed_server import Embedder  # noqa: E402

def unit(v: np.ndarray, dim: int) -> np.ndarray:
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    v = v[..., :dim]
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def thumb(path: Path, side: int):
    from PIL import Image

    image = Image.open(path).convert("RGB")
    image.thumbnail((side, side))
    return image


def embed_images(embedder: Embedder, files: list[Path], variant: str) -> np.ndarray:
    cache = HERE / ".cache" / f"img-{files[0].parent.name}-{variant}.npy"
    if cache.exists():
        return np.load(cache)
    side, budget = variant.split("-")
    from PIL import Image

    rows = []
    for path in files:
        image = Image.open(path).convert("RGB") if side == "full" else thumb(path, int(side))
        rows.append(embedder._embed_pil_image(image, int(budget)).float().cpu().numpy())
    out = np.stack(rows)
    cache.parent.mkdir(exist_ok=True)
    np.save(cache, out)
    return out


def metrics(scores: np.ndarray, ids: list[str], relevant: set[str], ignore: set[str]) -> dict:
    order = [ids[i] for i in np.argsort(-scores) if ids[i] not in ignore]
    hits, ap = 0, 0.0
    for rank, item in enumerate(order, 1):
        if item in relevant:
            hits += 1
            ap += hits / rank
    ap /= max(len(relevant), 1)
    p10 = sum(item in relevant for item in order[:10]) / 10
    dcg = sum(1 / math.log2(r + 2) for r, item in enumerate(order[:10]) if item in relevant)
    ideal = sum(1 / math.log2(r + 2) for r in range(min(10, len(relevant))))
    return {"ap": ap, "p10": p10, "ndcg10": dcg / ideal, "top": order[:10]}


def evaluate(embedder: Embedder, labels: dict, args: argparse.Namespace) -> None:
    folder = Path(labels["folder"])
    files = sorted(p for p in folder.glob("*.jpg") if not p.name.startswith("_"))
    ids = [p.name.split("-")[0] for p in files]
    queries = labels["queries"]
    text_vecs = {}
    for variant, template in (("tpl", args.template), ("raw", "{q}")):
        text_vecs[variant] = np.stack(
            [embedder._embed_text(template.format(q=q["query"])).float().cpu().numpy() for q in queries]
        )

    configs = {}
    for variant in args.images.split(","):
        images = embed_images(embedder, files, variant)
        for dim in map(int, args.dims.split(",")):
            for qv in ("tpl", "raw"):
                configs[f"image {variant} q={qv} @{dim}"] = (text_vecs[qv], images, dim)

    print(f"\n{folder.name}: {len(files)} images, {len(queries)} queries")
    print(f"{'config':32} {'mAP':>6} {'P@10':>6} {'nDCG':>6}   " + "  ".join(q["query"] for q in queries))
    for name, (qs, docs, dim) in configs.items():
        scores = unit(qs, dim) @ unit(docs, dim).T
        rows = [metrics(scores[i], ids, set(q["relevant"]), set(q["ignore"])) for i, q in enumerate(queries)]
        mean = {k: sum(r[k] for r in rows) / len(rows) for k in ("ap", "p10", "ndcg10")}
        per = "  ".join(f"{r['ap']:.2f}" for r in rows)
        print(f"{name:32} {mean['ap']:6.3f} {mean['p10']:6.3f} {mean['ndcg10']:6.3f}   {per}")
        if name == args.show:
            for q, r, s in zip(queries, rows, scores):
                print(f"    {q['query']}: {' '.join(r['top'])}  max={s.max():.3f} min={s.min():.3f}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", default=str(HERE / "labels.json"), help="comma-separated label files")
    # Defaults are what the app ships: 512px thumbnail, 280 vision tokens,
    # 512 dims, query wrapped as "<q>的照片" (src-tauri/src/search.rs).
    parser.add_argument("--images", default="512-280")
    parser.add_argument("--dims", default="512")
    parser.add_argument("--template", default="{q}的照片")
    parser.add_argument("--show", default="", help="config name whose per-query top 10 is printed")
    args = parser.parse_args()

    embedder = Embedder()
    for path in args.labels.split(","):
        evaluate(embedder, json.loads(Path(path).read_text()), args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
