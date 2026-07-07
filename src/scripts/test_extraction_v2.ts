import fs from 'fs';
import path from 'path';
import { extractBoxScore } from '../services/ollamaExtractorV2';

const GT_FILE  = path.join(__dirname, '../../eval/ground_truth.json');
const IMG_DIR  = path.join(__dirname, '../../eval/screenshots');

const modelArg  = process.argv.find(a => a.startsWith('--model='))?.split('=')[1];
const imgArg    = process.argv.find(a => a.startsWith('--img='))?.split('=')[1];
const SINGLE_IMG = imgArg ? path.basename(imgArg) : null;

type GT = Record<string, unknown>;

function pad(s: string | number, n: number)  { return String(s).padEnd(n); }
function rpad(s: string | number, n: number) { return String(s).padStart(n); }
function diff(got: number, exp: number)      { return got === exp ? '  ' : '!'; }

const cols = ['pts','reb','ast','stl','blk','to','pf','fgM','fgA','3M','3A','ftM','ftA'] as const;
const keys: Record<typeof cols[number], string> = {
  pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks',
  to: 'turnovers', pf: 'fouls', fgM: 'fgMade', fgA: 'fgAttempted',
  '3M': 'threeMade', '3A': 'threeAttempted', ftM: 'ftMade', ftA: 'ftAttempted',
};

async function runOne(screenshotFile: string, gtPlayers: GT[]): Promise<{ players: number; correct: number; total: number; latencyMs: number }> {
  const imgPath = path.join(IMG_DIR, screenshotFile);
  if (!fs.existsSync(imgPath)) {
    console.log(`  SKIP — not found: ${screenshotFile}\n`);
    return { players: 0, correct: 0, total: 0, latencyMs: 0 };
  }

  const buffer = fs.readFileSync(imgPath);
  const result = modelArg ? await extractBoxScore(buffer, modelArg) : await extractBoxScore(buffer);
  const players = result.players;

  const header = `${'#'.padEnd(2)} ${'NAME'.padEnd(22)} ` + cols.map(c => rpad(c, 4)).join(' ');
  const sep    = '-'.repeat(header.length);

  console.log(`\n${'='.repeat(90)}`);
  console.log(`IMAGE: ${screenshotFile}  |  Model: ${modelArg ?? 'default'} (V2)`);
  console.log('='.repeat(90));
  console.log('GROUND TRUTH');
  console.log(sep);
  console.log(header);
  console.log(sep);
  for (const g of gtPlayers) {
    const vals = cols.map(c => rpad(String(g[keys[c]] ?? '?'), 4)).join(' ');
    console.log(`${rpad(String(g['slot']), 2)} ${pad(String(g['expectedName']), 22)} ${vals}`);
  }

  console.log('\nEXTRACTED');
  console.log(sep);
  console.log(header);
  console.log(sep);

  let correct = 0, total = 0, nameCorrect = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const g = gtPlayers[i] as GT | undefined;
    const vals = cols.map(c => {
      const got = (p as unknown as Record<string, unknown>)[keys[c]] as number;
      const exp = g ? (g[keys[c]] as number) : got;
      if (g) { if (got === exp) correct++; total++; }
      return rpad(got, 3) + diff(got, exp);
    }).join(' ');
    if (g) {
      const gtName  = String(g['expectedName'] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const extName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (gtName === extName || extName.includes(gtName) || gtName.includes(extName)) nameCorrect++;
    }
    console.log(`${rpad(i + 1, 2)} ${pad(p.name, 22)} ${vals}`);
  }

  const pct = total > 0 ? Math.round(correct / total * 100) : 0;
  console.log(`\n  ${players.length}/10 players  |  names: ${nameCorrect}/${players.length}  |  stat accuracy: ${correct}/${total} (${pct}%)  |  ${(result.latencyMs / 1000).toFixed(1)}s`);

  return { players: players.length, correct, total, latencyMs: result.latencyMs };
}

async function main() {
  const allEntries = JSON.parse(fs.readFileSync(GT_FILE, 'utf8')) as { screenshotFile: string; players: GT[] }[];
  const entries = SINGLE_IMG
    ? allEntries.filter(e => e.screenshotFile === SINGLE_IMG)
    : allEntries;

  if (entries.length === 0) {
    console.error(`No ground truth entry found for: ${SINGLE_IMG}`);
    process.exit(1);
  }

  let totalCorrect = 0, totalStats = 0, totalLatency = 0;
  for (const entry of entries) {
    try {
      const r = await runOne(entry.screenshotFile, entry.players);
      totalCorrect += r.correct;
      totalStats   += r.total;
      totalLatency += r.latencyMs;
    } catch (err) {
      console.log(`\n  ERROR on ${entry.screenshotFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (entries.length > 1) {
    const pct = totalStats > 0 ? Math.round(totalCorrect / totalStats * 100) : 0;
    console.log(`\n${'='.repeat(90)}`);
    console.log(`OVERALL (${entries.length} images)  |  stat accuracy: ${totalCorrect}/${totalStats} (${pct}%)  |  avg latency: ${(totalLatency / entries.length / 1000).toFixed(1)}s`);
  }
}

main().catch(console.error);
