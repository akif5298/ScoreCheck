# Hosting the OCR model on Oracle Cloud (Ampere A1, Always Free)

The app's extraction pipeline calls an **Ollama-compatible endpoint** (`OLLAMA_BASE_URL`)
for two models:

| Model | Tag | Source | Size |
|---|---|---|---|
| Extraction (fine-tuned Qwen2.5-VL-3B) | `scorecheck-ocr-r5:latest` | **transfer** the GGUFs from this repo | 3.1 GB |
| Junk filter (MiniCPM-V) | `minicpm-v:latest` | public `ollama pull` on the VM | 5.5 GB |

The junk-filter tag is **hardcoded** in the app (`src/constants/index.ts`), so the host
must serve exactly `minicpm-v:latest`.

GGUF is architecture-independent — the model built on x86 Windows runs unchanged on ARM64.

> **Why a reverse proxy?** Plain Ollama has no authentication. The app sends
> `Authorization: Bearer $OLLAMA_API_KEY`, but Ollama ignores it. `setup.sh` puts **Caddy**
> in front to validate that header, and binds Ollama to `127.0.0.1` so the only public door
> is the token-checked proxy. Do **not** expose Ollama's port directly.

---

## Phase 1 — Provision the VM (Oracle console; ~30 min, capacity permitting)

1. Sign up / sign in at <https://cloud.oracle.com>. The free tier needs a card for identity
   (not charged for Always Free resources).
2. **Compute → Instances → Create instance.**
   - **Image:** Canonical Ubuntu 24.04 (or 22.04).
   - **Shape:** *Ampere* → **VM.Standard.A1.Flex**, **4 OCPU / 24 GB** (the whole Always
     Free A1 allowance in one box).
   - **SSH keys:** upload your public key (`~/.ssh/id_ed25519.pub`; generate with
     `ssh-keygen -t ed25519` if you don't have one).
   - Leave networking default (creates a VCN with a public subnet).
3. **Capacity is the hard part.** A1 free capacity is frequently exhausted → *"Out of host
   capacity."* Workarounds, in order:
   - Retry every few minutes (capacity frees constantly).
   - Try a different **Availability Domain** in the create dialog.
   - If your home region is full, capacity varies by region — but your Always Free tier is
     pinned to your **home region**, chosen at signup, so pick a large region when signing up.
4. Once it boots, note the **public IP**, then confirm SSH:
   ```bash
   ssh ubuntu@<PUBLIC_IP>
   ```
5. **Open the port** (two firewalls — this trips everyone up):
   - **Oracle Security List:** VCN → your subnet's security list → add an **Ingress rule**:
     source `0.0.0.0/0`, TCP, dest port **`11434`** (or **`80,443`** if you'll use a domain).
   - **Instance firewall** (Oracle Ubuntu images ship with restrictive iptables):
     ```bash
     sudo iptables -I INPUT 6 -p tcp --dport 11434 -j ACCEPT
     sudo netfilter-persistent save
     ```

**→ Come back when `ssh ubuntu@<PUBLIC_IP>` works. That unblocks Phase 2.**

---

## Phase 2 — Transfer the custom model (from your laptop)

The GGUFs are gitignored (3.1 GB), so they don't travel with the repo. Copy the Modelfile
**and** the GGUF dir together (the Modelfile's `FROM` paths are relative):

```bash
# from the repo root on your machine
scp -r Modelfile-r5 scorecheck-ocr-r5_gguf ubuntu@<PUBLIC_IP>:~/scorecheck-model/
```

(3.1 GB over home upload can take a while. If it stalls, `rsync -avP` resumes.)

---

## Phase 3 — Install + build (on the VM)

```bash
scp deploy/oracle/setup.sh ubuntu@<PUBLIC_IP>:~/     # or paste it in
ssh ubuntu@<PUBLIC_IP>
chmod +x setup.sh

# with your own domain for HTTPS (recommended; e.g. a free DuckDNS subdomain):
DOMAIN=yourname.duckdns.org ./setup.sh

# or HTTP + token only:
./setup.sh
```

The script prints the exact `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, and `OLLAMA_EXTRACTION_MODEL`
to set on the app. **Copy the generated token** — it isn't stored anywhere else.

---

## Phase 4 — Wire the app

Set on the API's environment (Render, per `DEV_HANDOFF.md` §9):

```
OLLAMA_BASE_URL         = https://yourname.duckdns.org      (or http://<IP>:11434)
OLLAMA_API_KEY          = <token from setup.sh>
OLLAMA_EXTRACTION_MODEL = scorecheck-ocr-r5:latest
```

Smoke test from anywhere:

```bash
curl -H "Authorization: Bearer <token>" <OLLAMA_BASE_URL>/api/tags
# → JSON listing scorecheck-ocr-r5:latest and minicpm-v:latest
```

The app pre-flights this exact endpoint (`assertExtractionHostReachable`), so if the curl
works, uploads stop returning 503.

---

## Phase 5 — First real end-to-end run

Upload a 2K26 box-score screenshot through the app and watch it go
upload → junk filter → extract → review → save. This is the first time the whole pipeline
runs against a live host — expect ~8–25 s per image on A1's CPU.

---

## Notes

- **Keep-alive:** `setup.sh` sets `OLLAMA_KEEP_ALIVE=-1` + `OLLAMA_MAX_LOADED_MODELS=2` so both
  models stay resident (~9 GB of the 24 GB) and no upload pays a cold-load penalty.
- **Idle reclamation:** Oracle may reclaim *idle* Always-Free VMs. Real upload traffic counts as
  use; a tiny cron pinging `/api/tags` is a safety net if the box is very quiet.
- **Halving the footprint:** the junk filter (`minicpm-v`, 5.5 GB) is optional — making
  `classifyScreenshot` skippable removes one model and one call per upload if you want it leaner.
