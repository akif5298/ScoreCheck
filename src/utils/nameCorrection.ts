/**
 * Snap OCR'd gamertags to a roster of known player names.
 *
 * VLM OCR errors on gamertags are almost always 1–2 character typos
 * ("LyricalJuiceee" for "LyricalJuicee"). When an extracted name is within a
 * small edit distance of exactly one roster name, replace it with the roster
 * spelling. Ambiguous or distant names pass through unchanged.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] as number) + 1,      // insertion
        (prev[j] as number) + 1,          // deletion
        (prev[j - 1] as number) + cost,   // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Returns the roster spelling for `name` when there is an unambiguous
 * near-match, otherwise returns `name` unchanged.
 *
 * Rules:
 *  - exact (case/whitespace-insensitive) roster match → roster spelling
 *  - otherwise the single roster name within maxDistance edits wins; if two
 *    roster names tie at the same distance, no correction (ambiguous)
 *  - short names (< 5 chars) are never fuzzy-corrected — too collision-prone
 */
export function correctName(
  name: string,
  roster: readonly string[],
  maxDistance = 2,
): string {
  const n = norm(name);
  if (!n) return name;

  for (const r of roster) {
    if (norm(r) === n) return r;
  }

  if (n.length < 5) return name;

  let best: string | null = null;
  let bestDist = maxDistance + 1;
  let tie = false;
  for (const r of roster) {
    const d = levenshtein(n, norm(r));
    if (d < bestDist) {
      bestDist = d;
      best = r;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  return best !== null && !tie ? best : name;
}
