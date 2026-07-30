/**
 * Derives a stable-ish image number from an uploaded screenshot's filename.
 *
 * Shared by two callers that would otherwise each need their own copy: the upload routes
 * use it to build the Storage object path, and the save pipeline uses it for a player's
 * `gameIdFromFile` and the generated team ids.
 *
 * Best-effort by design. Phone camera rolls reset their counters, so this is NOT unique —
 * the upload path appends a random suffix precisely because two distinct games can yield
 * the same number. The timestamp fallback keeps it defined for a file whose name carries
 * no digits at all.
 */
export function extractImageNumber(filename?: string): string {
  if (!filename) {
    return Date.now().toString();
  }

  const patterns = [
    /IMG_(\d+)\./i,
    /(\d+)-boxscore\./i,
    /(\d+)\./i,
    /(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return Date.now().toString();
}
