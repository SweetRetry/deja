#!/usr/bin/env python3
"""Proof that the sidecar serves usable EmbeddingGemma 2 embeddings.

Starts embed_server.py as a subprocess, waits for its `ready` line, then:

  * GET /health
  * one /embed request that holds both a vault image and text, to prove the
    vision tower loads and lands in the same space as the text tower
  * timed single-item requests for warm ms per text item and per image item
  * two text-only similarity orderings that must hold

Prints every number it measures, kills the server, exits non-zero on failure.
"""

from __future__ import annotations

import argparse
import json
import math
import queue
import resource
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().with_name("embed_server.py")
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGE = REPO_ROOT / "public/vault/摄影/风景/海边-dusk.jpg"
SAME_TOPIC_MIN_MARGIN = 0.1

# (same-topic pair, unrelated pair); the first cosine must clearly win.
TEXT_ORDERINGS = [
    (("黄昏的海边", "日落时的海岸"), ("黄昏的海边", "蓝色渐变按钮")),
    (("深色登录页", "暗色主题的登录界面"), ("深色登录页", "黄色沙滩")),
]


def ordered_texts() -> list[str]:
    """Every text the orderings reference, de-duplicated, in a stable order."""
    texts: list[str] = []
    for same_pair, unrelated_pair in TEXT_ORDERINGS:
        for text in (*same_pair, *unrelated_pair):
            if text not in texts:
                texts.append(text)
    return texts


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def post_embed(port: int, items: list[dict], dim: int) -> dict:
    body = json.dumps({"items": items, "dim": dim}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/embed", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"/embed {error.code}: {error.read().decode(errors='replace')}") from error


def get_health(port: int) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=30) as response:
        return json.load(response)


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def norm(vector: list[float]) -> float:
    return math.sqrt(sum(x * x for x in vector))


class ServerProcess:
    def __init__(self, port: int, dim: int) -> None:
        self._stdout: queue.Queue[str] = queue.Queue()
        self.stderr_lines: list[str] = []
        self.started = time.monotonic()
        self.process = subprocess.Popen(
            [
                sys.executable,
                str(SERVER),
                "--port",
                str(port),
                "--dim",
                str(dim),
                "--offline",
                "--idle-timeout",
                "0",
                # The app's own lifecycle: it holds stdin open, so the model dies
                # with it. Passing these flags is what exercises the stdin
                # watcher whose shutdown used to abort the process.
                "--exit-with-stdin",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self) -> None:
        for line in self.process.stdout:
            self._stdout.put(line.rstrip("\n"))

    def _read_stderr(self) -> None:
        for line in self.process.stderr:
            self.stderr_lines.append(line.rstrip("\n"))

    def wait_ready(self, timeout: float = 300.0) -> float:
        """Return seconds from spawn to the server's `ready` line."""
        deadline = time.monotonic() + timeout
        while True:
            try:
                line = self._stdout.get(timeout=1.0)
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError(f"server exited ({self.process.returncode}): {self.stderr_tail()}")
                if time.monotonic() > deadline:
                    raise RuntimeError(f"server not ready after {timeout:g}s: {self.stderr_tail()}")
                continue
            if line == "ready":
                return time.monotonic() - self.started

    def stderr_tail(self, lines: int = 10) -> str:
        return "\n".join(self.stderr_lines[-lines:]) or "(no stderr)"

    def stop(self) -> None:
        if self.process.poll() is None:
            # Close the pipe the way the app does on quit, then fall back to a
            # signal only if the sidecar ignores it.
            self.process.stdin.close()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=10)
        self.peak_rss_mb = peak_child_rss_mb()


def peak_child_rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return peak / 1e6 if sys.platform == "darwin" else peak / 1024


def mean_ms(port: int, item: dict, dim: int, repeats: int) -> float:
    times = [post_embed(port, [item], dim)["ms"] for _ in range(repeats)]
    return sum(times) / len(times)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dim", type=int, default=256)
    parser.add_argument(
        "--image",
        type=Path,
        default=DEFAULT_IMAGE,
        help="image used for the vision-path check (any readable photo)",
    )
    args = parser.parse_args(argv)

    if not args.image.is_file():
        print(f"missing image: {args.image}", file=sys.stderr)
        print("run `node scripts/make-fixtures.mjs` at the repo root, or pass --image <photo>", file=sys.stderr)
        return 2

    port = free_port()
    failures: list[str] = []
    server = ServerProcess(port, args.dim)
    try:
        ready_s = server.wait_ready()
        print(f"startup (spawn -> ready): {ready_s:.1f} s")

        health = get_health(port)
        print(f"health: {json.dumps(health, ensure_ascii=False)}")
        if health.get("ok") is not True or health.get("dim") != 768:
            failures.append("/health did not report ok with the native 768 dim")

        # Vision path plus text in one request: proves one shared space and that
        # the vision tower loads at all.
        texts = ordered_texts()
        text_ids = {text: f"t{index}" for index, text in enumerate(texts)}
        first = post_embed(
            port,
            [{"id": "image", "image": str(args.image)}] + [{"id": text_ids[t], "text": t} for t in texts],
            args.dim,
        )
        vectors = {entry["id"]: entry["vector"] for entry in first["vectors"]}
        image_vector = vectors["image"]
        print(
            f"vision path: dim={len(image_vector)} norm={norm(image_vector):.4f} "
            f"nonzero={any(abs(x) > 1e-8 for x in image_vector)} "
            f"items_in_response={len(vectors)}/{len(texts) + 1} total_ms={first['ms']}"
        )
        if len(image_vector) != args.dim:
            failures.append(f"image vector has {len(image_vector)} dims, expected {args.dim}")
        if not 0.99 < norm(image_vector) < 1.01:
            failures.append(f"image vector is not L2-normalized (norm {norm(image_vector):.4f})")
        if not any(abs(x) > 1e-8 for x in image_vector):
            failures.append("image vector is all zeros")
        if len(vectors) != len(texts) + 1:
            failures.append("response did not carry every image and text item")
        image_cosines = " ".join(
            f"cos(image, {text})={cosine(image_vector, vectors[text_ids[text]]):.4f}" for text in texts
        )
        print(f"  {image_cosines}")
        print("  (vault fixtures are synthetic gradients, so these are printed, not asserted)")

        text_ms = mean_ms(port, {"id": "warm", "text": "warm"}, args.dim, repeats=5)
        image_ms = mean_ms(port, {"id": "img", "image": str(args.image)}, args.dim, repeats=3)
        print(f"warm text: {text_ms:.1f} ms/item   warm image: {image_ms:.1f} ms/item")

        for same_pair, unrelated_pair in TEXT_ORDERINGS:
            same = cosine(vectors[text_ids[same_pair[0]]], vectors[text_ids[same_pair[1]]])
            unrelated = cosine(vectors[text_ids[unrelated_pair[0]]], vectors[text_ids[unrelated_pair[1]]])
            margin = same - unrelated
            verdict = "PASS" if margin > SAME_TOPIC_MIN_MARGIN else "FAIL"
            print(
                f"{verdict} cos({same_pair[0]}, {same_pair[1]})={same:.4f} > "
                f"cos({unrelated_pair[0]}, {unrelated_pair[1]})={unrelated:.4f} "
                f"(margin {margin:+.4f} > {SAME_TOPIC_MIN_MARGIN})"
            )
            if verdict == "FAIL":
                failures.append(f"cos({same_pair[0]}, {same_pair[1]}) is not clearly above {unrelated_pair}")
    finally:
        server.stop()
        print(f"server stopped (peak RSS {server.peak_rss_mb:.0f} MB, exit {server.process.returncode})")
        if server.process.returncode != 0:
            failures.append(f"server exited with {server.process.returncode}, expected 0")
        if any("Fatal Python error" in line for line in server.stderr_lines):
            failures.append("server aborted at interpreter shutdown:")
            failures.extend(f"  {line}" for line in server.stderr_lines[-8:])

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
