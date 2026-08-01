/**
 * Password acceptance policy: breach checking, plus the small set of weaknesses a breach
 * list can miss.
 *
 * Deliberately NOT composition rules. NIST SP 800-63B advises against mandatory
 * upper/lower/digit/symbol requirements — they push users toward predictable mutations
 * ("Password1!") without meaningfully raising entropy. Length plus a breach-corpus check is
 * the recommended replacement, and that is what this implements.
 *
 * THE PASSWORD NEVER LEAVES THIS PROCESS. The breach check uses Have I Been Pwned's
 * k-anonymity range API: we SHA-1 the password locally, send only the first five hex
 * characters of that hash, and search the returned suffix list ourselves. HIBP learns a
 * 5-character prefix shared by many thousands of passwords and nothing else.
 *
 * FAILS OPEN, LOUDLY. If HIBP is unreachable or slow, the password is accepted and the
 * failure is logged. Failing closed would mean an outage at a third party blocks every
 * signup and password change in the app — trading a large, certain availability loss for a
 * small, probabilistic security gain. This mirrors the existing fail-open choices for the
 * junk filter and the mapping fetch.
 */
import { createHash } from 'node:crypto';
import logger from '@/utils/logger';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
// Kept short: this sits directly in the signup/change-password request path, and the
// fail-open policy means a slow answer is worth less than a fast rejection of the wait.
const HIBP_TIMEOUT_MS = 2500;

export interface PasswordCheckResult {
  ok: boolean;
  /** Present when ok is false — safe to show the user verbatim. */
  reason?: string;
}

/**
 * Catches the weak passwords a breach corpus can miss: a brand-new password can be absent
 * from every breach list and still be trivially guessable.
 */
export function findObviousWeakness(password: string): string | undefined {
  const lowered = password.toLowerCase();

  if (/^(.)\1+$/.test(password)) {
    return 'Password cannot be a single repeated character.';
  }

  // Runs of 6+ sequential characters, forward or back: "abcdef", "123456", "654321".
  for (let i = 0; i + 5 < lowered.length; i++) {
    let ascending = true;
    let descending = true;
    for (let j = 0; j < 5; j++) {
      const delta = lowered.charCodeAt(i + j + 1) - lowered.charCodeAt(i + j);
      if (delta !== 1) ascending = false;
      if (delta !== -1) descending = false;
    }
    if (ascending || descending) {
      return 'Password cannot contain a long run of sequential characters.';
    }
  }

  if (lowered.includes('scorecheck')) {
    return 'Password cannot contain the site name.';
  }

  return undefined;
}

/**
 * Queries HIBP for the password's SHA-1 prefix.
 *
 * Returns the number of times it appears in known breaches, or null when the lookup could
 * not be completed — callers must treat null as "unknown", never as "safe by proof".
 */
export async function breachCount(password: string): Promise<number | null> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'ScoreCheck-password-policy' },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'HIBP range lookup failed — accepting password unchecked');
      return null;
    }

    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch (err) {
    logger.warn({ err }, 'HIBP range lookup unavailable — accepting password unchecked');
    return null;
  }
}

/**
 * The whole policy. Length is enforced by the zod schema at the route boundary; this covers
 * what a schema cannot express.
 */
export async function assessPassword(password: string): Promise<PasswordCheckResult> {
  const weakness = findObviousWeakness(password);
  if (weakness) return { ok: false, reason: weakness };

  const breaches = await breachCount(password);
  if (breaches !== null && breaches > 0) {
    return {
      ok: false,
      reason:
        'This password has appeared in a known data breach. Please choose a different one.',
    };
  }

  return { ok: true };
}
