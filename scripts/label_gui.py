#!/usr/bin/env python3
"""
ScoreCheck Label GUI — web-based interface for labeling and editing box score screenshots.

Usage:
  npm run label                                   # auto-scan mode (warmup + background OCR)
  npm run edit                                     # edit-only mode, no OCR at all
  python scripts/label_gui.py [--port PORT] [--no-browser] [--no-scan]

Features:
  - Browse all screenshots in eval/screenshots/
  - Dot states: grey = unscanned, blue = scanning now, orange = auto-saved by
    OCR but not yet reviewed, green = reviewed and confirmed
  - `npm run label` warms up Ollama, then background-scans every unscanned
    screenshot and immediately saves the result to training_data.json as a
    tentative (unreviewed) entry — no more losing pre-scan results on restart
  - `npm run edit` skips warmup/pre-scan entirely and hides the Auto-fill
    button — strictly for reviewing/correcting existing entries
  - Click a screenshot to load it with existing data (or an empty form)
  - Save writes to training_data.json with reviewed=true (turns the dot
    green); also updates ground_truth.json if the entry is already present there
  - Ctrl+S / Cmd+S keyboard shortcut to save
"""

import argparse
import json
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT            = Path(__file__).parent.parent
SCREENSHOTS_DIR = ROOT / 'eval' / 'screenshots'
TRAINING_DATA   = ROOT / 'eval' / 'training_data.json'
GROUND_TRUTH    = ROOT / 'eval' / 'ground_truth.json'

SUPPORTED_EXTS  = {'.jpg', '.jpeg', '.png'}

ocr_cache: dict   = {}
scanning_set: set = set()
cache_lock = threading.Lock()


# ── JSON helpers ───────────────────────────────────────────────────────────────

def read_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return fallback

def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


# ── Data helpers ───────────────────────────────────────────────────────────────

def entry_state(filename: str, training_by_file: dict, scanning: set) -> str:
    """unscanned (grey) -> scanning (blue, in progress) -> pending (orange, auto-saved
    by OCR but not human-reviewed) -> confirmed (green, human-reviewed via Save)."""
    if filename in scanning:
        return 'scanning'
    entry = training_by_file.get(filename)
    if entry is None:
        return 'unscanned'
    # Entries saved before this field existed were all created by hand — treat as reviewed.
    return 'confirmed' if entry.get('reviewed', True) else 'pending'

def get_screenshots():
    if not SCREENSHOTS_DIR.exists():
        return []
    files = sorted(
        f.name for f in SCREENSHOTS_DIR.iterdir()
        if f.suffix.lower() in SUPPORTED_EXTS
    )
    td = read_json(TRAINING_DATA, [])
    training_by_file = {e['screenshotFile']: e for e in td}
    with cache_lock:
        scanning = set(scanning_set)
    return [{'name': f, 'state': entry_state(f, training_by_file, scanning)} for f in files]

def get_entry(filename: str):
    td = read_json(TRAINING_DATA, [])
    entry = next((e for e in td if e['screenshotFile'] == filename), None)
    gt = read_json(GROUND_TRUTH, [])
    in_gt = any(e['screenshotFile'] == filename for e in gt)
    return {'entry': entry, 'inGroundTruth': in_gt}

def save_entry(entry: dict, reviewed: bool = True):
    filename = entry['screenshotFile']
    entry = {**entry, 'reviewed': reviewed}

    td = read_json(TRAINING_DATA, [])
    idx = next((i for i, e in enumerate(td) if e['screenshotFile'] == filename), -1)
    if idx == -1:
        td.append(entry)
    else:
        td[idx] = entry
    write_json(TRAINING_DATA, td)

    gt = read_json(GROUND_TRUTH, [])
    gtidx = next((i for i, e in enumerate(gt) if e['screenshotFile'] == filename), -1)
    in_gt = gtidx != -1
    if in_gt:
        gt[gtidx] = entry
        write_json(GROUND_TRUTH, gt)

    return {'saved': True, 'inGroundTruth': in_gt, 'total': len(td)}

def run_ocr(filename: str):
    with cache_lock:
        if filename in ocr_cache:
            return ocr_cache[filename]

    img_path = SCREENSHOTS_DIR / filename
    if not img_path.exists():
        return {'error': f'File not found: {filename}'}
    try:
        result = subprocess.run(
            ['npm', 'run', 'extract', '--', str(img_path)],
            capture_output=True, text=True, timeout=180, cwd=str(ROOT),
            shell=(sys.platform == 'win32'),
        )
        # npm prints preamble lines; find the last line that is valid JSON
        for line in reversed(result.stdout.strip().splitlines()):
            line = line.strip()
            if line.startswith('{'):
                try:
                    data = json.loads(line)
                    out = {'players': data.get('players', [])}
                    with cache_lock:
                        ocr_cache[filename] = out
                    return out
                except json.JSONDecodeError:
                    continue
        err = (result.stderr.strip() or result.stdout.strip() or 'No JSON found in output')
        return {'error': err[-400:]}
    except subprocess.TimeoutExpired:
        return {'error': 'OCR timed out (> 180 s)'}
    except Exception as e:
        return {'error': str(e)}


def warmup_ollama():
    """Load the extraction model into Ollama's memory before OCR is needed.
    Best-effort — a slow/unreachable Ollama shouldn't stop the GUI from starting.
    """
    print('Warming up Ollama model (this can take up to ~60s on a cold start)…', flush=True)
    try:
        result = subprocess.run(
            ['npm', 'run', 'warmup'],
            capture_output=True, text=True, timeout=200, cwd=str(ROOT),
            shell=(sys.platform == 'win32'),
        )
        for line in result.stdout.strip().splitlines():
            if line.strip().startswith('Warmup attempt finished'):
                print(f'  ✓ {line.strip()}', flush=True)
                return
        print('  ✗ Warmup did not report success — continuing anyway.', flush=True)
    except subprocess.TimeoutExpired:
        print('  ✗ Warmup timed out (> 200s) — continuing anyway.', flush=True)
    except Exception as e:
        print(f'  ✗ Warmup failed to run ({e}) — continuing anyway.', flush=True)


def build_entry_from_players(filename: str, players: list) -> dict:
    """Map raw OCR player dicts into the training_data.json player-slot shape
    (expectedName/team/slot), padding to exactly 10 players. Used to auto-save
    pre-scan results as a tentative (unreviewed) entry."""
    out_players = []
    for i in range(10):
        p = players[i] if i < len(players) else {}
        out_players.append({
            'slot': i + 1,
            'expectedName': p.get('name', ''),
            'team': 'A' if i < 5 else 'B',
            'grade': p.get('grade', ''),
            'points': p.get('points', 0),
            'rebounds': p.get('rebounds', 0),
            'assists': p.get('assists', 0),
            'steals': p.get('steals', 0),
            'blocks': p.get('blocks', 0),
            'turnovers': p.get('turnovers', 0),
            'fouls': p.get('fouls', 0),
            'fgMade': p.get('fgMade', 0),
            'fgAttempted': p.get('fgAttempted', 0),
            'threeMade': p.get('threeMade', 0),
            'threeAttempted': p.get('threeAttempted', 0),
            'ftMade': p.get('ftMade', 0),
            'ftAttempted': p.get('ftAttempted', 0),
        })
    return {'screenshotFile': filename, 'players': out_players}


def _startup_worker():
    """Warm up Ollama, then run the pre-scan — sequenced in one background
    thread so the pre-scan's first OCR call doesn't race the warmup request,
    while the HTTP server itself starts accepting requests immediately."""
    warmup_ollama()
    _prescan_worker()


def _prescan_worker():
    screenshots = get_screenshots()
    to_scan = [s['name'] for s in screenshots if s['state'] == 'unscanned']
    if not to_scan:
        return
    print(f'Pre-scanning {len(to_scan)} unscanned screenshot(s) in the background…', flush=True)
    for name in to_scan:
        with cache_lock:
            if name in ocr_cache:
                continue
            scanning_set.add(name)
        print(f'  → {name}…', flush=True)
        result = run_ocr(name)
        with cache_lock:
            scanning_set.discard(name)
        if 'error' in result:
            print(f'    ✗ {result["error"][:80]}', flush=True)
        else:
            entry = build_entry_from_players(name, result.get('players', []))
            save_entry(entry, reviewed=False)
            print(f'    ✓ {len(result.get("players", []))} players — saved as pending (unreviewed)', flush=True)
    print('Pre-scan complete.', flush=True)


# ── Embedded HTML/CSS/JS ───────────────────────────────────────────────────────

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ScoreCheck — Label GUI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* ── Design tokens (mirrors styles.css) ─────────────────────────────── */
:root {
  --bg:        #f5f3ee;
  --surface:   #fdfcfb;
  --ink:       #1e1c18;
  --ink-mid:   #716e68;
  --ink-faint: #a09c96;
  --border:    #dedad4;
  --border-strong: #c4c0b8;
  --secondary: #ebe8e2;
  --input-bg:  #ece9e4;
  --radius:    6px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Scrollbars — hidden, scroll still works ─────────────────────────── */
* { scrollbar-width: none; }
::-webkit-scrollbar { display: none; }

body {
  font-family: 'Manrope', ui-sans-serif, system-ui, sans-serif;
  background: var(--bg); color: var(--ink);
  display: flex; height: 100vh; overflow: hidden; font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

/* ── Sidebar ─────────────────────────────────────────────────────────── */
#sidebar {
  width: 195px; min-width: 195px;
  background: var(--secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
#sidebar-header {
  padding: 14px 12px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 500; color: var(--ink-mid);
  text-transform: uppercase; letter-spacing: .16em;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
#screenshot-list { overflow-y: auto; flex: 1; }
.ss-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  border-bottom: 1px solid var(--border); transition: background .1s;
}
.ss-item:hover  { background: var(--bg); }
.ss-item.active { background: var(--ink); }
.ss-item.active .ss-name { color: var(--bg); }
.ss-item.active .dot.unlabeled { background: #716e68; }
.ss-item.active .dot.scanning  { background: #60a5fa; }
.ss-item.active .dot.pending   { background: #f59e0b; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot.labeled   { background: #16a34a; }
.dot.scanning  { background: #2563eb; }
.dot.pending   { background: #d97706; }
.dot.unlabeled { background: var(--border-strong); }
.ss-name {
  font-size: 12px; font-weight: 500; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Content ─────────────────────────────────────────────────────────── */
#content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

/* ── Image strip ─────────────────────────────────────────────────────── */
#img-area {
  display: flex; flex-direction: row; flex-shrink: 0;
  height: 46vh; min-height: 220px;
  background: var(--surface); border-bottom: 1px solid var(--border); overflow: hidden;
}
#img-wrapper {
  flex: 1; display: flex; align-items: center; justify-content: center;
  overflow: hidden; padding: 12px;
  /* subtle grid paper matching app's .grid-paper utility */
  background-image:
    linear-gradient(to right, rgba(30,28,24,.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(30,28,24,.04) 1px, transparent 1px);
  background-size: 56px 56px;
}
#img-placeholder {
  width: 100%; height: 100%; background: var(--secondary);
  border: 1px dashed var(--border-strong); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
  color: var(--ink-faint); font-size: 13px;
  font-family: 'JetBrains Mono', monospace; letter-spacing: .04em;
}
#screenshot-img {
  max-width: 100%; max-height: 100%; object-fit: contain;
  border-radius: var(--radius); border: 1px solid var(--border); display: none;
  box-shadow: 0 1px 4px rgba(30,28,24,.10);
}
#img-controls {
  width: 152px; min-width: 152px; flex-shrink: 0;
  display: flex; flex-direction: column; justify-content: center;
  gap: 12px; padding: 16px 14px;
  border-left: 1px solid var(--border); background: var(--secondary);
}
#ocr-btn {
  padding: 9px 8px; background: var(--ink);
  border: none; border-radius: var(--radius); color: var(--bg);
  font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: opacity .15s; white-space: nowrap;
}
#ocr-btn:hover:not(:disabled) { opacity: .82; }
#ocr-btn:disabled { background: var(--border); color: var(--ink-faint); cursor: not-allowed; }
#ocr-status {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; color: var(--ink-mid); line-height: 1.5; letter-spacing: .02em;
}
#gt-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; padding: 3px 8px; border-radius: 99px;
  background: var(--ink); color: var(--bg); font-weight: 500;
  display: none; text-align: center; letter-spacing: .08em; text-transform: uppercase;
}

/* ── Form area ───────────────────────────────────────────────────────── */
#form-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
#form-header {
  padding: 9px 18px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  background: var(--surface); min-height: 0;
}
#form-title {
  font-family: 'Sora', sans-serif;
  font-size: 13px; font-weight: 600; letter-spacing: -.01em; color: var(--ink);
}
#form-scroll { flex: 1; overflow: auto; padding: 0; }
#empty-state {
  height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--ink-faint); font-size: 14px;
  font-family: 'JetBrains Mono', monospace; letter-spacing: .04em;
}

/* ── Player table ────────────────────────────────────────────────────── */
#player-table { border-collapse: collapse; width: 100%; display: none; table-layout: fixed; }
#player-table th {
  background: var(--secondary); color: var(--ink-mid);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 500; letter-spacing: .12em;
  text-transform: uppercase; padding: 7px 4px;
  border-bottom: 1px solid var(--border-strong);
  white-space: nowrap; text-align: center;
  position: sticky; top: 0; z-index: 1;
}
#player-table th.left { text-align: left; padding-left: 8px; }
#player-table td { padding: 1px 2px; border-bottom: 1px solid var(--border); vertical-align: middle; }
/* Shooting splits (FGM/FGA, 3PM/3PA, FTM/FTA): gap before each made/attempt
   pair, no gap within it — mirrors the tight "8-15" grouping in box score screenshots. */
#player-table th.shoot-first, #player-table td.shoot-first { padding-left: 10px; }
#player-table th.shoot-second, #player-table td.shoot-second { padding-left: 2px; }
tr.row-a td { background: var(--surface); }
tr.row-b td { background: var(--bg); }
tr:last-child td { border-bottom: none; }

#player-table input[type="text"],
#player-table input[type="number"],
#player-table select {
  width: 100%; background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--ink); font-size: 12px; font-family: inherit;
  padding: 5px 5px; text-align: center;
  transition: border-color .1s, background .1s;
}
#player-table input[type="text"] {
  text-align: left; padding-left: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#player-table input:focus, #player-table select:focus {
  outline: none; border-color: var(--ink); background: var(--input-bg);
}
#player-table input[type="number"]::-webkit-inner-spin-button,
#player-table input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
#player-table input[type="number"] { -moz-appearance: textfield; font-variant-numeric: tabular-nums; }

.slot-num {
  font-family: 'JetBrains Mono', monospace;
  color: var(--ink-faint); font-size: 11px; text-align: center; padding: 0 4px;
}
.team-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; font-weight: 500; padding: 2px 5px;
  border-radius: 3px; display: inline-block; letter-spacing: .06em;
}
.team-a-badge { background: var(--ink); color: var(--bg); }
.team-b-badge { background: var(--secondary); color: var(--ink); border: 1px solid var(--border-strong); }
.grade-sel {
  font-family: 'JetBrains Mono', monospace !important;
  font-weight: 500 !important; color: var(--ink) !important;
}

/* ── Controls panel buttons ──────────────────────────────────────────── */
#save-btn {
  width: 100%; padding: 8px; background: var(--ink); border: none;
  border-radius: var(--radius); color: var(--bg);
  font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: opacity .15s;
}
#save-btn:hover:not(:disabled) { opacity: .82; }
#save-btn:disabled { background: var(--border); color: var(--ink-faint); cursor: not-allowed; }
#clear-btn {
  width: 100%; padding: 8px; background: transparent;
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  color: var(--ink-mid); font-family: 'Manrope', sans-serif; font-size: 12px; cursor: pointer;
  transition: background .1s;
}
#clear-btn:hover { background: var(--bg); }
#ctrl-divider { height: 1px; background: var(--border); margin: 2px 0; }
#status-msg {
  margin-left: auto; font-size: 11px; color: var(--ink-mid);
  font-family: 'JetBrains Mono', monospace; letter-spacing: .02em;
}
.ok  { color: #16a34a !important; font-weight: 600; }
.err { color: #b91c1c !important; font-weight: 600; }

/* ── Drag-to-resize handle ───────────────────────────────────────────── */
#resize-handle {
  height: 4px; background: var(--border); cursor: ns-resize; flex-shrink: 0;
  transition: background .15s;
}
#resize-handle:hover, #resize-handle:active { background: var(--ink); }
</style>
</head>
<body>

<div id="sidebar">
  <div id="sidebar-header">Screenshots</div>
  <div id="screenshot-list"><div style="padding:12px;color:#a09c96;font-size:12px;font-family:'JetBrains Mono',monospace">Loading…</div></div>
</div>

<div id="content">

  <div id="img-area">
    <div id="img-wrapper">
      <div id="img-placeholder">Select a screenshot</div>
      <img id="screenshot-img" alt="">
    </div>
    <div id="img-controls">
      <button id="save-btn" disabled>Save</button>
      <button id="clear-btn">Clear</button>
      <div id="ctrl-divider"></div>
      <span id="gt-badge">ground truth</span>
      <button id="ocr-btn" disabled>Auto-fill</button>
      <div id="ocr-status"></div>
    </div>
  </div>

  <div id="resize-handle"></div>

  <div id="form-area">
    <div id="form-header">
      <span id="form-title">No screenshot selected</span>
      <span id="status-msg"></span>
    </div>
    <div id="form-scroll">
      <div id="empty-state">← Select a screenshot from the sidebar</div>
      <table id="player-table">
        <thead>
          <tr>
            <th style="width:24px">#</th>
            <th style="width:32px"></th>
            <th class="left" style="width:88px">Name</th>
            <th style="width:54px">Grade</th>
            <th style="width:44px">PTS</th>
            <th style="width:44px">REB</th>
            <th style="width:44px">AST</th>
            <th style="width:44px">STL</th>
            <th style="width:44px">BLK</th>
            <th style="width:44px">FOULS</th>
            <th style="width:44px">TO</th>
            <th class="shoot-first"  style="width:44px">FGM</th>
            <th class="shoot-second" style="width:44px">FGA</th>
            <th class="shoot-first"  style="width:44px">3PM</th>
            <th class="shoot-second" style="width:44px">3PA</th>
            <th class="shoot-first"  style="width:44px">FTM</th>
            <th class="shoot-second" style="width:44px">FTA</th>
          </tr>
        </thead>
        <tbody id="player-tbody"></tbody>
      </table>
    </div>
  </div>

</div>

<script>
const GRADES = ['', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
let currentFile = null;
let cachePoller = null;

async function loadSidebar() {
  const res  = await fetch('/api/screenshots');
  const list = await res.json();
  const el   = document.getElementById('screenshot-list');
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div style="padding:12px;color:#334155;font-size:12px">No screenshots found in<br>eval/screenshots/</div>';
    return;
  }
  const STATE_TO_DOT = { unscanned: 'unlabeled', scanning: 'scanning', pending: 'pending', confirmed: 'labeled' };
  list.forEach(({ name, state }) => {
    const item = document.createElement('div');
    item.className = 'ss-item' + (name === currentFile ? ' active' : '');
    item.dataset.name = name;
    const dotClass = STATE_TO_DOT[state] || 'unlabeled';
    item.innerHTML =
      `<div class="dot ${dotClass}"></div>` +
      `<span class="ss-name">${esc(name)}</span>`;
    item.addEventListener('click', () => selectScreenshot(name));
    el.appendChild(item);
  });
  if (list.some(s => s.state === 'scanning')) {
    setTimeout(loadSidebar, 2000);
  }
}

async function selectScreenshot(filename) {
  clearInterval(cachePoller); cachePoller = null;
  currentFile = filename;
  document.querySelectorAll('.ss-item').forEach(el =>
    el.classList.toggle('active', el.dataset.name === filename)
  );
  document.getElementById('form-title').textContent = filename;
  if (!EDIT_MODE) document.getElementById('ocr-btn').disabled = false;
  document.getElementById('save-btn').disabled = false;
  document.getElementById('ocr-status').textContent = '';
  setStatus('');

  const placeholder = document.getElementById('img-placeholder');
  const img = document.getElementById('screenshot-img');
  img.style.display = 'none';
  placeholder.style.display = 'flex';
  placeholder.textContent = 'Loading…';
  img.onload  = () => { placeholder.style.display = 'none'; img.style.display = 'block'; };
  img.onerror = () => { placeholder.textContent = 'Image not found'; };
  img.src = '/screenshots/' + encodeURIComponent(filename) + '?t=' + Date.now();

  const res  = await fetch('/api/entry/' + encodeURIComponent(filename));
  const data = await res.json();
  document.getElementById('gt-badge').style.display = data.inGroundTruth ? 'inline' : 'none';
  renderForm(data.entry ? data.entry.players : emptyPlayers());

  if (!EDIT_MODE) checkCacheStatus(filename);
}

async function checkCacheStatus(filename) {
  clearInterval(cachePoller);
  cachePoller = null;
  const ocrStatus = document.getElementById('ocr-status');
  const res  = await fetch('/api/cache-status');
  const data = await res.json();
  if (data.cached.includes(filename)) {
    ocrStatus.textContent = 'Pre-scan ready — Auto-fill is instant';
    return;
  }
  ocrStatus.textContent = 'Pre-scanning in background…';
  cachePoller = setInterval(async () => {
    if (currentFile !== filename) { clearInterval(cachePoller); cachePoller = null; return; }
    const r = await fetch('/api/cache-status');
    const d = await r.json();
    if (d.cached.includes(filename)) {
      clearInterval(cachePoller); cachePoller = null;
      document.getElementById('ocr-status').textContent = 'Pre-scan ready — Auto-fill is instant';
    }
  }, 3000);
}

function emptyPlayers() {
  return Array.from({ length: 10 }, (_, i) => ({
    slot: i + 1, expectedName: '', team: i < 5 ? 'A' : 'B', grade: '',
    points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
    turnovers: 0, fouls: 0, fgMade: 0, fgAttempted: 0,
    threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0,
  }));
}

function gradeOpts(sel) {
  return GRADES.map(g =>
    `<option value="${g}"${g === sel ? ' selected' : ''}>${g || '—'}</option>`
  ).join('');
}

function numCell(val, id, cls) {
  return `<td${cls ? ` class="${cls}"` : ''}><input type="number" id="${id}" value="${+val || 0}" min="0" step="1"></td>`;
}

function renderForm(players) {
  const rows = [...players];
  while (rows.length < 10) {
    const i = rows.length;
    rows.push({
      slot: i+1, expectedName: '', team: i < 5 ? 'A' : 'B', grade: '',
      points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
      turnovers: 0, fouls: 0, fgMade: 0, fgAttempted: 0,
      threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0,
    });
  }
  const tbody = document.getElementById('player-tbody');
  tbody.innerHTML = '';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('player-table').style.display = 'table';

  rows.forEach((p, i) => {
    const team = p.team || (i < 5 ? 'A' : 'B');
    const tr = document.createElement('tr');
    tr.className = team === 'A' ? 'row-a' : 'row-b';
    tr.innerHTML =
      `<td class="slot-num">${p.slot ?? i + 1}</td>` +
      `<td style="text-align:center"><span class="team-badge ${team === 'A' ? 'team-a-badge' : 'team-b-badge'}">${team}</span></td>` +
      `<td><input type="text"   id="name_${i}"  value="${esc(p.expectedName ?? p.name ?? '')}"></td>` +
      `<td><select id="grade_${i}" class="grade-sel">${gradeOpts(p.grade || '')}</select></td>` +
      numCell(p.points,         `pts_${i}`) +
      numCell(p.rebounds,       `reb_${i}`) +
      numCell(p.assists,        `ast_${i}`) +
      numCell(p.steals,         `stl_${i}`) +
      numCell(p.blocks,         `blk_${i}`) +
      numCell(p.fouls,          `pf_${i}`)  +
      numCell(p.turnovers,      `to_${i}`)  +
      numCell(p.fgMade,         `fgm_${i}`, 'shoot-first')  +
      numCell(p.fgAttempted,    `fga_${i}`, 'shoot-second') +
      numCell(p.threeMade,      `t3m_${i}`, 'shoot-first')  +
      numCell(p.threeAttempted, `t3a_${i}`, 'shoot-second') +
      numCell(p.ftMade,         `ftm_${i}`, 'shoot-first')  +
      numCell(p.ftAttempted,    `fta_${i}`, 'shoot-second');
    tbody.appendChild(tr);
  });
}

function collectForm() {
  const players = [];
  for (let i = 0; i < 10; i++) {
    players.push({
      slot:           i + 1,
      expectedName:   (document.getElementById(`name_${i}`)?.value ?? '').trim(),
      team:           i < 5 ? 'A' : 'B',
      grade:          document.getElementById(`grade_${i}`)?.value ?? '',
      points:         numVal(`pts_${i}`),
      rebounds:       numVal(`reb_${i}`),
      assists:        numVal(`ast_${i}`),
      steals:         numVal(`stl_${i}`),
      blocks:         numVal(`blk_${i}`),
      fouls:          numVal(`pf_${i}`),
      turnovers:      numVal(`to_${i}`),
      fgMade:         numVal(`fgm_${i}`),
      fgAttempted:    numVal(`fga_${i}`),
      threeMade:      numVal(`t3m_${i}`),
      threeAttempted: numVal(`t3a_${i}`),
      ftMade:         numVal(`ftm_${i}`),
      ftAttempted:    numVal(`fta_${i}`),
    });
  }
  return { screenshotFile: currentFile, players };
}

function numVal(id) {
  const v = parseInt(document.getElementById(id)?.value ?? '0', 10);
  return isNaN(v) || v < 0 ? 0 : v;
}

async function saveEntry() {
  if (!currentFile) return;
  setStatus('Saving…');
  const res  = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectForm()),
  });
  const data = await res.json();
  if (data.error) {
    setStatus('Error: ' + data.error, 'err');
  } else {
    const gt = data.inGroundTruth ? ' + ground_truth.json' : '';
    setStatus(`Saved to training_data.json${gt}  (${data.total} total)`, 'ok');
    loadSidebar();
  }
}

async function runOCR() {
  if (!currentFile) return;
  clearInterval(cachePoller); cachePoller = null;
  const btn = document.getElementById('ocr-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  document.getElementById('ocr-status').textContent = 'May take 10–30 s…';
  setStatus('');

  const res  = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: currentFile }),
  });
  const data = await res.json();
  btn.disabled = false;
  btn.textContent = 'Auto-fill';

  if (data.error) {
    document.getElementById('ocr-status').textContent = '✗ ' + data.error.slice(0, 120);
    return;
  }
  document.getElementById('ocr-status').textContent = `✓ Got ${data.players.length} players`;
  renderForm(data.players);
}

function setStatus(msg, cls = '') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = cls;
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('save-btn').addEventListener('click', saveEntry);
document.getElementById('ocr-btn').addEventListener('click', runOCR);
document.getElementById('clear-btn').addEventListener('click', () => {
  if (currentFile) { renderForm(emptyPlayers()); setStatus(''); }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!document.getElementById('save-btn').disabled) saveEntry();
  }
});

// ── Drag-to-resize the image strip ───────────────────────────────────────────
(function () {
  const handle   = document.getElementById('resize-handle');
  const imgArea  = document.getElementById('img-area');
  let dragging = false, startY = 0, startH = 0;
  handle.addEventListener('mousedown', e => {
    dragging = true; startY = e.clientY; startH = imgArea.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const h = Math.max(120, Math.min(window.innerHeight - 200, startH + e.clientY - startY));
    imgArea.style.height = h + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

const __initialFile = __INITIAL_FILE__;
const EDIT_MODE = __EDIT_MODE__;
if (EDIT_MODE) {
  const ocrBtn = document.getElementById('ocr-btn');
  ocrBtn.style.display = 'none';
  document.getElementById('ocr-status').textContent = '';
}
loadSidebar().then(() => {
  if (__initialFile) selectScreenshot(__initialFile);
});
</script>
</body>
</html>"""


# ── HTTP handler ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence access log

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path).path

        if p in ('/', '/index.html'):
            initial_file = getattr(self.server, 'initial_file', None)
            js_val = f'"{initial_file}"' if initial_file else 'null'
            edit_mode = 'true' if getattr(self.server, 'edit_mode', False) else 'false'
            html = HTML.replace('__INITIAL_FILE__', js_val).replace('__EDIT_MODE__', edit_mode)
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif p == '/api/screenshots':
            self.send_json(get_screenshots())

        elif p == '/api/cache-status':
            with cache_lock:
                self.send_json({'cached': list(ocr_cache.keys())})

        elif p.startswith('/api/entry/'):
            filename = unquote(p[len('/api/entry/'):])
            self.send_json(get_entry(filename))

        elif p.startswith('/screenshots/'):
            filename = unquote(p[len('/screenshots/'):]).split('?')[0]
            img_path = SCREENSHOTS_DIR / filename
            if not img_path.exists():
                self.send_response(404); self.end_headers(); return
            ext  = img_path.suffix.lower()
            mime = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png'
            raw  = img_path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length).decode('utf-8'))
        p      = urlparse(self.path).path

        if p == '/api/save':
            self.send_json(save_entry(body))
        elif p == '/api/extract':
            self.send_json(run_ocr(body.get('filename', '')))
        else:
            self.send_response(404); self.end_headers()


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='ScoreCheck Label GUI')
    ap.add_argument('file',         nargs='?', default=None,
                    help='Screenshot to pre-select (path or filename)')
    ap.add_argument('--port',       type=int, default=7437)
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('--no-scan',    action='store_true',
                    help='Edit-only mode: no warmup, no background OCR pre-scan, no Auto-fill button')
    args = ap.parse_args()

    # Resolve the initial file to just a basename
    initial_file = None
    if args.file:
        initial_file = Path(args.file).name
        td = read_json(TRAINING_DATA, [])
        if not any(e['screenshotFile'] == initial_file for e in td):
            print(f'Note: {initial_file} has no existing entry — opening with empty form.')

    server = HTTPServer(('localhost', args.port), Handler)
    server.initial_file = initial_file  # passed through to handler via self.server
    server.edit_mode = args.no_scan
    url = f'http://localhost:{args.port}'
    if initial_file:
        print(f'ScoreCheck Label GUI  →  {url}  (opening {initial_file})')
    else:
        print(f'ScoreCheck Label GUI  →  {url}')
    print('Press Ctrl+C to stop.\n')

    if args.no_scan:
        print('Edit mode: OCR disabled (no warmup, no background pre-scan).\n', flush=True)
    else:
        threading.Thread(target=_startup_worker, daemon=True).start()

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
