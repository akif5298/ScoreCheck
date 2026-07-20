import sharp from 'sharp';

// dhash: compare each pixel to its right neighbour across 16×15 = 240 pairs → 60-char hex
export async function computePerceptualHash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer)
    .resize(16, 16, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits: string[] = [];
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 15; col++) {
      const idx = row * 16 + col;
      bits.push((data[idx] ?? 0) < (data[idx + 1] ?? 0) ? '1' : '0');
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 8) {
    hex += parseInt(bits.slice(i, i + 8).join(''), 2).toString(16).padStart(2, '0');
  }
  return hex;
}

// Two screenshots within this many differing bits are treated as the same game.
// Shared by the upload-time check and the save-time re-check so the two can never
// disagree — a save-time threshold stricter than the upload-time one would reject
// games the user was already told were fine, and a looser one would let the race
// through. Validated against the 38 backfilled screenshots: no two distinct games
// fall within this distance of each other.
export const DUPLICATE_HAMMING_THRESHOLD = 10;

export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    throw new Error(`Hash length mismatch: ${hashA.length} vs ${hashB.length}`);
  }
  let distance = 0;
  for (let i = 0; i < hashA.length; i += 2) {
    const byteA = parseInt(hashA.slice(i, i + 2), 16);
    const byteB = parseInt(hashB.slice(i, i + 2), 16);
    let xor = byteA ^ byteB;
    while (xor) {
      distance += xor & 1;
      xor >>>= 1;
    }
  }
  return distance;
}
