"""
ScoreCheck OCR host on Modal — serverless, scale-to-zero, GPU.

Runs Ollama inside a Modal container serving the two models the app needs:
  - scorecheck-ocr-r5:latest  (custom, built from the GGUFs you upload to a Volume)
  - minicpm-v:latest          (junk filter — tag hardcoded in the app)

A tiny FastAPI proxy sits in front and enforces `Authorization: Bearer <OLLAMA_API_KEY>`,
because plain Ollama has no auth. Every call the app makes uses `stream: false`, so the
proxy is a simple request → response forward (no streaming to handle).

Cold start: the container scales to zero when idle. The first request after idle WAITS
while Modal boots the container and `@enter` loads both models — which is why the app's
EXTRACTION_PREFLIGHT_TIMEOUT_MS must be raised (~120000) so that wait is absorbed rather
than failing into a 503.

See README.md for the one-time setup and deploy commands.
"""

import json
import subprocess
import time
import urllib.request

import modal

APP_NAME = "scorecheck-ocr"
GPU = "T4"  # 16 GB VRAM — fits the 3B + minicpm-v models comfortably; cheapest that does.
OLLAMA_PORT = 11434

app = modal.App(APP_NAME)

# Persistent Ollama data dir (built models live here, so they aren't rebuilt each cold start).
models_vol = modal.Volume.from_name("scorecheck-ollama", create_if_missing=True)
# Holds the raw GGUFs + Modelfile-r5 you upload once (see README Phase 2).
gguf_vol = modal.Volume.from_name("scorecheck-gguf", create_if_missing=True)

# The bearer token the app sends. Create with:
#   modal secret create scorecheck-ocr-token OLLAMA_API_KEY=$(openssl rand -hex 32)
token_secret = modal.Secret.from_name("scorecheck-ocr-token")

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-runtime-ubuntu22.04", add_python="3.11")
    # zstd: the Ollama install script now ships zstd-compressed archives and aborts
    # without it; the CUDA base image doesn't include it. curl: fetches the installer.
    .apt_install("curl", "zstd")
    .run_commands("curl -fsSL https://ollama.com/install.sh | sh")
    .pip_install("fastapi[standard]==0.115.*", "httpx==0.27.*")
    .env({"OLLAMA_HOST": f"127.0.0.1:{OLLAMA_PORT}", "OLLAMA_MAX_LOADED_MODELS": "2"})
)

OLLAMA_URL = f"http://127.0.0.1:{OLLAMA_PORT}"


def _start_ollama() -> None:
    """Launch `ollama serve` in the background and block until it answers."""
    subprocess.Popen(["ollama", "serve"])
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("ollama did not become ready")


# ── One-time model build ─────────────────────────────────────────────────────
# Run once (and again whenever you retrain): `modal run scorecheck_ocr.py::build_models`
# Reads the uploaded GGUFs, registers the custom model + pulls minicpm-v, commits the
# result to the models Volume so serving containers start with them already built.
@app.function(
    image=image,
    volumes={"/root/.ollama": models_vol, "/gguf": gguf_vol},
    gpu=GPU,
    timeout=1800,
)
def build_models() -> None:
    _start_ollama()
    # Modelfile-r5's FROM lines are relative to ./scorecheck-ocr-r5_gguf/, so build from /gguf.
    subprocess.run(
        ["ollama", "create", "scorecheck-ocr-r5:latest", "-f", "Modelfile-r5"],
        cwd="/gguf",
        check=True,
    )
    subprocess.run(["ollama", "pull", "minicpm-v:latest"], check=True)
    models_vol.commit()
    print("Built scorecheck-ocr-r5:latest and pulled minicpm-v:latest into the Volume.")


# ── Serving container ────────────────────────────────────────────────────────
@app.cls(
    image=image,
    volumes={"/root/.ollama": models_vol},
    gpu=GPU,
    secrets=[token_secret],
    # Stay warm 5 min after the last request so a burst of uploads cold-starts only once,
    # then scale to zero (pay nothing idle). Raise for fewer cold starts, at more GPU cost.
    scaledown_window=300,
    timeout=600,
)
class Server:
    @modal.enter()
    def start(self) -> None:
        import os

        self.token = os.environ["OLLAMA_API_KEY"]
        _start_ollama()
        # Preload both models (empty prompt = load into VRAM, keep_alive:-1 = stay resident),
        # so once /api/tags answers, the first real upload is hot. Best-effort.
        for model in ("scorecheck-ocr-r5:latest", "minicpm-v:latest"):
            try:
                payload = json.dumps({"model": model, "prompt": "", "keep_alive": -1}).encode()
                req = urllib.request.Request(
                    f"{OLLAMA_URL}/api/generate",
                    data=payload,
                    headers={"content-type": "application/json"},
                )
                urllib.request.urlopen(req, timeout=300).read()
            except Exception as e:  # noqa: BLE001 — warming is best-effort
                print(f"warm {model} failed: {e}")

    @modal.asgi_app()
    def web(self):
        import httpx
        from fastapi import FastAPI, Request, Response, HTTPException

        api = FastAPI()
        client = httpx.AsyncClient(base_url=OLLAMA_URL, timeout=300.0)

        @api.api_route("/{path:path}", methods=["GET", "POST"])
        async def proxy(path: str, request: Request):
            if request.headers.get("authorization", "") != f"Bearer {self.token}":
                raise HTTPException(status_code=401, detail="Unauthorized")
            upstream = await client.request(
                request.method,
                f"/{path}",
                content=await request.body(),
                headers={"content-type": "application/json"},
            )
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "application/json"),
            )

        return api
