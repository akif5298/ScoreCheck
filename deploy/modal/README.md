# Hosting the OCR model on Modal (serverless GPU, scale-to-zero)

The app calls an Ollama-compatible endpoint for two models. Modal runs Ollama in a container
that **wakes on request and scales to zero when idle** — so it's effectively free at personal
volume (Modal gives $30/mo of compute credit) and runs on a real GPU, faster than any free CPU VM.

`scorecheck_ocr.py` defines the whole thing: the container image, a persistent Volume for the
built models, a one-time build step, and a serving container fronted by a bearer-token proxy.

**What only you can do** (needs your Modal account): create the account + token, upload the
3.1 GB GGUFs, run the build, deploy. Everything else is written.

---

## Phase 1 — Account + CLI (~5 min)

```bash
pip install modal
modal token new          # opens a browser to create/authorize your account
```

Create the bearer token the app will send (save the value — you'll set it on the API too):

```bash
TOKEN=$(openssl rand -hex 32); echo "$TOKEN"
modal secret create scorecheck-ocr-token OLLAMA_API_KEY="$TOKEN"
```

---

## Phase 2 — Upload the custom model to a Volume (one time)

The GGUFs are gitignored (3.1 GB), so they live only on your machine. Upload the Modelfile
**and** the GGUF dir together (the Modelfile's `FROM` paths are relative). From the repo root:

```bash
modal volume create scorecheck-gguf     # no-op if it already exists
modal volume put scorecheck-gguf Modelfile-r5 /Modelfile-r5
modal volume put scorecheck-gguf scorecheck-ocr-r5_gguf /scorecheck-ocr-r5_gguf
```

`minicpm-v` is **not** uploaded — the build pulls it from Ollama's registry.

---

## Phase 3 — Build the models into the serving Volume (one time, ~5–10 min)

```bash
cd deploy/modal
modal run scorecheck_ocr.py::build_models
```

This registers `scorecheck-ocr-r5:latest` from your GGUFs and pulls `minicpm-v:latest`, storing
both in the persistent `scorecheck-ollama` Volume so serving containers start with them ready.
Re-run it only when you retrain the model.

---

## Phase 4 — Deploy the endpoint

```bash
modal deploy scorecheck_ocr.py
```

Modal prints a URL like `https://<you>--scorecheck-ocr-server-web.modal.run`. That's your
`OLLAMA_BASE_URL`. Smoke-test it (first call cold-starts — give it up to ~2 min):

```bash
curl -H "Authorization: Bearer $TOKEN" https://<you>--scorecheck-ocr-server-web.modal.run/api/tags
# → JSON listing scorecheck-ocr-r5:latest and minicpm-v:latest
```

---

## Phase 5 — Wire the app (Render env)

```
OLLAMA_BASE_URL                = https://<you>--scorecheck-ocr-server-web.modal.run
OLLAMA_API_KEY                 = <the token from Phase 1>
OLLAMA_EXTRACTION_MODEL        = scorecheck-ocr-r5:latest
EXTRACTION_PREFLIGHT_TIMEOUT_MS = 120000
```

That last one is the important part: the app's default 3 s liveness check can't survive a
scale-to-zero cold start. `120000` lets the first upload's pre-flight **wait** through the wake
instead of failing into a 503. (Regular local Ollama can leave it unset.)

Then upload a box-score screenshot and watch the full pipeline run end-to-end for the first time.

---

## How cold starts behave

- **Idle → first upload:** the request waits ~30–90 s while Modal boots the container and loads
  both models, then succeeds. Subsequent uploads within `scaledown_window` (5 min) are hot.
- **Cost:** you pay only while a container is alive. At personal volume this stays inside the
  $30/mo credit. If usage grows, the levers are `scaledown_window` (longer = fewer cold starts,
  more cost) and `min_containers=1` (always warm, always billing — don't, unless volume is high).
- **Leaner option:** dropping the `minicpm-v` junk filter (make `classifyScreenshot` optional)
  removes ~5.5 GB and one model load, cutting cold-start time and VRAM.

## Notes

- GGUF is architecture-independent — the model built on your Windows machine runs unchanged here.
- The proxy only forwards `stream: false` requests (all the app makes). If you ever add streaming,
  the proxy needs `StreamingResponse`.
- `modal app logs scorecheck-ocr` tails the container if extraction misbehaves.
