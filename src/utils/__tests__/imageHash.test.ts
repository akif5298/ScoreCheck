import { computePerceptualHash, hammingDistance } from '@/utils/imageHash';
import sharp from 'sharp';

jest.mock('sharp');

const mockedSharp = sharp as jest.MockedFunction<typeof sharp>;

function mockPixels(pixels: Buffer): void {
  mockedSharp.mockImplementation(() =>
    ({
      resize: jest.fn().mockReturnThis(),
      grayscale: jest.fn().mockReturnThis(),
      raw: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue({
        data: pixels,
        info: { width: 16, height: 16, channels: 1, size: pixels.length, format: 'raw' },
      }),
    }) as any,
  );
}

describe('computePerceptualHash', () => {
  it('produces a 60-character lowercase hex string', async () => {
    mockPixels(Buffer.alloc(256, 0));
    const hash = await computePerceptualHash(Buffer.from('fake-image'));
    expect(hash).toHaveLength(60);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('returns all zeros for a uniform-intensity image (no pixel rises)', async () => {
    mockPixels(Buffer.alloc(256, 128));
    const hash = await computePerceptualHash(Buffer.from('fake-image'));
    expect(hash).toBe('0'.repeat(60));
  });

  it('returns a deterministic hash for the same pixel data', async () => {
    const pixels = Buffer.alloc(256, 0);
    mockPixels(pixels);
    const hash1 = await computePerceptualHash(Buffer.from('fake-image'));
    mockPixels(pixels);
    const hash2 = await computePerceptualHash(Buffer.from('fake-image'));
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different pixel data, exactly 1 bit apart', async () => {
    mockPixels(Buffer.alloc(256, 0));
    const hashA = await computePerceptualHash(Buffer.from('fake-image'));

    // pixel(0,0)=0, pixel(0,1)=10 → bit 0 = '1' → first byte = 0x80
    const altPixels = Buffer.alloc(256, 0);
    altPixels[1] = 10;
    mockPixels(altPixels);
    const hashB = await computePerceptualHash(Buffer.from('fake-image'));

    expect(hashA).not.toBe(hashB);
    expect(hammingDistance(hashA, hashB)).toBe(1);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    const h = '0'.repeat(60);
    expect(hammingDistance(h, h)).toBe(0);
  });

  it('returns 240 for completely opposite hashes', () => {
    expect(hammingDistance('f'.repeat(60), '0'.repeat(60))).toBe(240);
  });

  it('counts the exact number of differing bits', () => {
    // first byte: 0x80 vs 0x00 → 1 bit differs
    const hashA = '80' + '0'.repeat(58);
    const hashB = '0'.repeat(60);
    expect(hammingDistance(hashA, hashB)).toBe(1);
  });

  it('throws when hash lengths differ', () => {
    expect(() => hammingDistance('aa', 'aabb')).toThrow(/mismatch/i);
  });

  it('is symmetric', () => {
    const a = 'aabbcc' + '0'.repeat(54);
    const b = '001122' + '0'.repeat(54);
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });
});
