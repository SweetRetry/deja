#!/usr/bin/env python3
"""Local HTTP embedding sidecar for google/embeddinggemma-2.

Loads the model once, then serves:

  GET  /health -> {"ok": true, "model": ..., "dim": 768}
  POST /embed  {"items": [{"id": "a", "text": "..."} | {"id": "b", "image": "/abs/x.png"}], "dim": 256}
               -> {"model": ..., "dim": 256, "ms": 123, "vectors": [{"id": "a", "vector": [...]}]}

Everything is processed serially on one device, so a batch never runs in
parallel with another request. Text and image vectors share one 768-d space;
`dim` truncates them Matryoshka-style (normalize -> slice -> re-normalize).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = "google/embeddinggemma-2"
NATIVE_DIM = 768
MAX_BATCH = 8
DEFAULT_PORT = 5187
DEFAULT_DIM = 256
DEFAULT_IDLE_TIMEOUT = 180.0


class Embedder:
    """One model in memory, one inference at a time (guarded by `_lock`)."""

    def __init__(self, model_id: str = MODEL_ID) -> None:
        # huggingface_hub reads HF_HUB_OFFLINE when it is imported, so the
        # transformers import has to happen after --offline sets the env var.
        import torch
        from transformers import AutoConfig, AutoModel, AutoProcessor

        self._torch = torch
        self._lock = threading.Lock()
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        # The model card forbids float16 (activations overflow it); bfloat16 on
        # Metal, float32 on CPU.
        self.dtype = torch.bfloat16 if self.device == "mps" else torch.float32

        config = AutoConfig.from_pretrained(model_id)
        # The audio encoder is 300M unused parameters; dropping it keeps peak
        # memory well under the 4 GB budget.
        config.audio_config = None
        self._model = (
            AutoModel.from_pretrained(model_id, config=config, dtype=self.dtype).to(self.device).eval()
        )
        self._processor = AutoProcessor.from_pretrained(model_id)
        self._tokenizer = self._processor.tokenizer

    def _pool(self, last_hidden, attention_mask):
        mask = attention_mask.unsqueeze(-1).float()
        return (last_hidden.float() * mask).sum(1) / mask.sum(1).clamp(min=1e-9)

    def _embed_text(self, text: str):
        encoded = self._tokenizer(text, return_tensors="pt").to(self.device)
        with self._torch.inference_mode():
            output = self._model(**encoded)
        return self._pool(output.last_hidden_state, encoded["attention_mask"])[0]

    def _embed_pil_image(self, image, budget: int = 280):
        inputs = self._processor(
            text=["<|image|>"],
            images=[image],
            images_kwargs={"max_soft_tokens": budget},
            return_tensors="pt",
        ).to(self.device)
        with self._torch.inference_mode():
            output = self._model(**inputs)
        return self._pool(output.last_hidden_state, inputs["attention_mask"])[0]

    def _embed_image(self, path: str):
        from PIL import Image

        with Image.open(path) as image:
            return self._embed_pil_image(image.convert("RGB"))

    def _truncate(self, vector, dim: int):
        normed = vector / vector.norm().clamp(min=1e-12)
        truncated = normed[:dim]
        return truncated / truncated.norm().clamp(min=1e-12)

    def embed(self, items: list[dict], dim: int) -> list[dict]:
        vectors = []
        with self._lock:
            for item in items:
                if "text" in item:
                    vector = self._embed_text(item["text"])
                else:
                    vector = self._embed_image(item["image"])
                vectors.append({"id": item["id"], "vector": [float(x) for x in self._truncate(vector, dim).cpu()]})
        return vectors

    def warmup(self) -> None:
        from PIL import Image

        self._embed_text("warmup")
        self._embed_pil_image(Image.new("RGB", (64, 64), (0, 0, 0)))


class State:
    def __init__(self, embedder: Embedder, default_dim: int) -> None:
        self.embedder = embedder
        self.default_dim = default_dim
        self.last_request = time.monotonic()


def parse_embed_request(body: object, default_dim: int) -> tuple[list[dict], int]:
    """Validate a /embed body; raise ValueError with a client-facing message."""
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items must be a non-empty array")
    if len(items) > MAX_BATCH:
        raise ValueError(f"items must hold at most {MAX_BATCH} entries, got {len(items)}")
    dim = body.get("dim", default_dim)
    if not isinstance(dim, int) or isinstance(dim, bool) or not 1 <= dim <= NATIVE_DIM:
        raise ValueError(f"dim must be an integer in 1..{NATIVE_DIM}, got {dim!r}")
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] must be an object")
        if not isinstance(item.get("id"), str):
            raise ValueError(f"items[{index}].id must be a string")
        has_text, has_image = "text" in item, "image" in item
        if has_text == has_image:
            raise ValueError(f'items[{index}] must have exactly one of "text" or "image"')
        value = item["text"] if has_text else item["image"]
        if not isinstance(value, str) or not value:
            raise ValueError(f'items[{index}].{"text" if has_text else "image"} must be a non-empty string')
    return items, dim


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "embed-sidecar"
    state: State

    def _send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(404, {"error": f"unknown path {self.path}"})
            return
        # A status probe is not work: counting it kept a polled model alive forever.
        self._send_json(200, {"ok": True, "model": MODEL_ID, "dim": NATIVE_DIM})

    def do_POST(self) -> None:
        if self.path != "/embed":
            self._send_json(404, {"error": f"unknown path {self.path}"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw or b"{}")
            items, dim = parse_embed_request(body, self.state.default_dim)
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return

        started = time.monotonic()
        try:
            vectors = self.state.embedder.embed(items, dim)
        except FileNotFoundError as error:
            self._send_json(400, {"error": f"image not found: {error.filename}"})
            return
        except Exception as error:  # noqa: BLE001 - surface the failure to the client
            self._send_json(500, {"error": f"{type(error).__name__}: {error}"})
            return

        self.state.last_request = time.monotonic()
        self._send_json(
            200,
            {
                "model": MODEL_ID,
                "dim": dim,
                "ms": round((self.state.last_request - started) * 1000),
                "vectors": vectors,
            },
        )

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))


def make_handler(state: State) -> type[Handler]:
    bound = type("BoundHandler", (Handler,), {"state": state})
    return bound


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="google/embeddinggemma-2 embedding sidecar")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--dim", type=int, default=DEFAULT_DIM, help="default Matryoshka output dim")
    parser.add_argument(
        "--idle-timeout",
        type=float,
        default=DEFAULT_IDLE_TIMEOUT,
        help="exit 0 after this many seconds without requests; 0 disables the timeout",
    )
    parser.add_argument("--offline", action="store_true", help="set HF_HUB_OFFLINE=1 and use cached weights")
    parser.add_argument(
        "--exit-with-stdin",
        action="store_true",
        help="exit when stdin closes; the app holds it open so the model dies with the app",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.dim <= NATIVE_DIM:
        parser.error(f"--dim must be in 1..{NATIVE_DIM}")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"

    embedder = Embedder()
    embedder.warmup()
    state = State(embedder, args.dim)

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state))
    except OSError as error:
        print(f"cannot bind 127.0.0.1:{args.port}: {error}", file=sys.stderr)
        return 1
    server.daemon_threads = True

    stop = threading.Event()

    def request_stop(_signum, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    if args.exit_with_stdin:

        def watch_parent() -> None:
            sys.stdin.buffer.read()
            print("parent closed stdin, exiting", file=sys.stderr, flush=True)
            stop.set()

        threading.Thread(target=watch_parent, name="parent", daemon=True).start()

    serving = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    serving.start()
    print("ready", flush=True)

    while not stop.wait(1.0):
        if args.idle_timeout > 0 and time.monotonic() - state.last_request > args.idle_timeout:
            print(f"idle for {args.idle_timeout:g}s, exiting", file=sys.stderr, flush=True)
            break

    server.shutdown()
    serving.join(timeout=5)
    server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
