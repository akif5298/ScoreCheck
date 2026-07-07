import fs from 'fs';
const buf = fs.readFileSync('eval/screenshots/IMG_0312.JPEG');
const start = Date.now();
const res = await fetch('http://localhost:11434/api/generate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'qwen2.5vl:7b', prompt: 'Does this image show an NBA 2K basketball game box score? Answer with exactly one word: yes or no.', images: [buf.toString('base64')], stream: false })
});
const body = await res.json();
const raw = (body.response ?? '').trim();
const latencyMs = Date.now() - start;
console.log('Model:', 'qwen2.5vl:7b');
console.log('Raw response:', JSON.stringify(raw));
const lower = raw.toLowerCase();
const parsed = lower.startsWith('yes') ? '{ isValidBoxScore: true, confidence: "high", reason: "model_yes" }' : lower.startsWith('no') ? '{ isValidBoxScore: false, confidence: "high", reason: "model_no" }' : `{ isValidBoxScore: true, confidence: "medium", reason: "model_ambiguous" }`;
console.log('Parsed result:', parsed);
console.log('Latency:', latencyMs + 'ms');
