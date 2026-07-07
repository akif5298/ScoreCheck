/**
 * Junk filter via Ollama.
 *
 * Classifies whether a screenshot is a valid NBA 2K box score before passing
 * it to the expensive GCV extraction pipeline.
 *
 * Fail-open policy: if Ollama is unreachable or times out, the function
 * returns isValidBoxScore=true so a legitimate upload is never blocked.
 */

import { OLLAMA_BASE_URL, OLLAMA_JUNK_FILTER_MODEL } from '@/constants';

const MODEL = OLLAMA_JUNK_FILTER_MODEL;
const TIMEOUT_MS = 15_000;

const PROMPT =
  'Does this image show an NBA 2K basketball game box score? ' +
  'Answer with exactly one word: yes or no.';

export interface JunkFilterResult {
  isValidBoxScore: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  latencyMs: number;
}

export async function classifyScreenshot(imageBuffer: Buffer): Promise<JunkFilterResult> {
  const start = Date.now();

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: PROMPT,
        images: [imageBuffer.toString('base64')],
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      isValidBoxScore: true,
      confidence: 'low',
      reason: isTimeout ? 'filter_timeout' : 'filter_unavailable',
      latencyMs: Date.now() - start,
    };
  }

  if (!response.ok) {
    return {
      isValidBoxScore: true,
      confidence: 'low',
      reason: `filter_http_${response.status}`,
      latencyMs: Date.now() - start,
    };
  }

  let body: { response?: string };
  try {
    body = (await response.json()) as { response?: string };
  } catch {
    return {
      isValidBoxScore: true,
      confidence: 'low',
      reason: 'filter_parse_error',
      latencyMs: Date.now() - start,
    };
  }

  const raw = (body.response ?? '').trim().toLowerCase();
  const latencyMs = Date.now() - start;

  if (raw.startsWith('yes')) {
    return { isValidBoxScore: true, confidence: 'high', reason: 'model_yes', latencyMs };
  }
  if (raw.startsWith('no')) {
    return { isValidBoxScore: false, confidence: 'high', reason: 'model_no', latencyMs };
  }

  // Ambiguous response — fail open.
  return { isValidBoxScore: true, confidence: 'medium', reason: `model_ambiguous:${raw.slice(0, 40)}`, latencyMs };
}
