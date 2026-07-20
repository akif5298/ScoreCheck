#!/usr/bin/env bash
#
# ScoreCheck OCR host — Oracle Cloud Ampere A1 (Ubuntu 22.04/24.04, arm64).
#
# Run this ON THE VM, AFTER the model files are transferred (README Phase 2).
# It installs Ollama bound to localhost, builds the two models, and puts Caddy in
# front as a bearer-token gate so the endpoint is NOT open to the whole internet.
#
#   MODEL_DIR   parent dir holding Modelfile-r5 + scorecheck-ocr-r5_gguf/  (default: ~/scorecheck-model)
#   DOMAIN      optional DNS name (e.g. scorecheck-ocr.duckdns.org) for real HTTPS.
#               Leave blank to serve HTTP on :11434 with the token gate only.
#   OLLAMA_API_KEY  the bearer token the app will send. Generated if blank — copy it.
#
# Usage:
#   chmod +x setup.sh
#   DOMAIN=yourname.duckdns.org ./setup.sh          # with TLS
#   ./setup.sh                                        # HTTP + token only
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-$HOME/scorecheck-model}"
DOMAIN="${DOMAIN:-}"
TOKEN="${OLLAMA_API_KEY:-}"

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 32)"
fi

echo "==> Model dir: $MODEL_DIR"
echo "==> Domain:    ${DOMAIN:-<none, HTTP only>}"

# ── 1. Ollama ────────────────────────────────────────────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  echo "==> Installing Ollama…"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Bind Ollama to localhost only (Caddy is the only public door), keep BOTH models
# resident (reloading a 3B model on CPU per request is what makes uploads feel slow),
# and allow 2 loaded at once so the junk-filter call and the extraction call don't
# evict each other on every upload.
# Ollama listens on loopback at 11435 (NOT 11434): Caddy takes the public :11434, and
# 0.0.0.0:11434 would collide with 127.0.0.1:11434 since 0.0.0.0 covers loopback too.
OLLAMA_INTERNAL="127.0.0.1:11435"
echo "==> Configuring Ollama ($OLLAMA_INTERNAL, keep-alive, 2 loaded models)…"
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<EOF
[Service]
Environment="OLLAMA_HOST=$OLLAMA_INTERNAL"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama

# `ollama` CLI talks to the daemon via OLLAMA_HOST too — point it at the same socket.
export OLLAMA_HOST="$OLLAMA_INTERNAL"

# Wait for the daemon to answer before creating models.
for i in $(seq 1 30); do
  if curl -fsS "http://$OLLAMA_INTERNAL/api/tags" >/dev/null 2>&1; then break; fi
  sleep 1
done

# ── 2. Build the custom model + pull the junk filter ─────────────────────────
# Modelfile-r5's FROM lines are relative (./scorecheck-ocr-r5_gguf/...), so run
# ollama create from the parent that holds both the Modelfile and that dir.
echo "==> Building scorecheck-ocr-r5:latest from the transferred GGUFs…"
cd "$MODEL_DIR"
ollama create scorecheck-ocr-r5:latest -f Modelfile-r5

echo "==> Pulling minicpm-v:latest (junk filter — tag is hardcoded in the app)…"
ollama pull minicpm-v:latest

# Warm both so the first real upload isn't a cold model load.
echo "==> Warming models…"
curl -fsS "http://$OLLAMA_INTERNAL/api/generate" -d '{"model":"scorecheck-ocr-r5:latest","prompt":"","keep_alive":-1}' >/dev/null 2>&1 || true
curl -fsS "http://$OLLAMA_INTERNAL/api/generate" -d '{"model":"minicpm-v:latest","prompt":"","keep_alive":-1}' >/dev/null 2>&1 || true

# ── 3. Caddy as a bearer-token gate ──────────────────────────────────────────
# Plain Ollama has NO auth. Our app sends `Authorization: Bearer <token>`, so Caddy
# validates that header and proxies to localhost — anything without the exact token
# gets 401 and never reaches Ollama.
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy…"
  sudo apt-get update -y
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "==> Writing Caddyfile…"
if [[ -n "$DOMAIN" ]]; then
  # Real HTTPS via Let's Encrypt (needs :80 and :443 open + DNS → this VM's public IP).
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	@authorized header Authorization "Bearer $TOKEN"
	handle @authorized {
		reverse_proxy $OLLAMA_INTERNAL
	}
	respond "Unauthorized" 401
}
EOF
  ENDPOINT="https://$DOMAIN"
  FW_PORTS="80,443"
else
  # No domain: HTTP on the public :11434 with the token gate. Caddy owns 0.0.0.0:11434;
  # Ollama is on loopback :11435, so no collision. The token travels in cleartext here,
  # acceptable for a personal app but weaker than the DOMAIN (HTTPS) path above.
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
:11434 {
	@authorized header Authorization "Bearer $TOKEN"
	handle @authorized {
		reverse_proxy $OLLAMA_INTERNAL
	}
	respond "Unauthorized" 401
}
EOF
  ENDPOINT="http://<THIS_VM_PUBLIC_IP>:11434"
  FW_PORTS="11434"
fi

sudo systemctl enable caddy
sudo systemctl restart caddy

# ── 4. Report ────────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────────
 OCR host is up. Set these on the app (Render) environment:

   OLLAMA_BASE_URL         $ENDPOINT
   OLLAMA_API_KEY          $TOKEN
   OLLAMA_EXTRACTION_MODEL scorecheck-ocr-r5:latest

 Smoke test from your laptop (should return the model list as JSON):
   curl -H "Authorization: Bearer $TOKEN" $ENDPOINT/api/tags

 Open these on the host side if you haven't (ports: $FW_PORTS):
   - Oracle Security List: add an ingress rule, source 0.0.0.0/0, TCP dports $FW_PORTS
   - Instance firewall:
$(for p in ${FW_PORTS//,/ }; do echo "       sudo iptables -I INPUT 6 -p tcp --dport $p -j ACCEPT"; done)
       sudo netfilter-persistent save
────────────────────────────────────────────────────────────────────────
EOF
