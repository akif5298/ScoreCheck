/**
 * Storage-path coverage for SupabaseService.
 *
 * These live in the unit project rather than the integration one because they are the
 * only cases that need Supabase Storage to SUCCEED. The integration harness deliberately
 * points SUPABASE_URL at an unroutable host so a stray network call fails loudly, which
 * covers every failure path but leaves the success returns unreachable.
 *
 * The mock is applied at the package boundary (`@supabase/supabase-js`), not at any
 * internal seam, so the real method bodies — content-type selection, the pass-through
 * rules in getSignedUrl, error wrapping — all execute unchanged.
 */

const upload = jest.fn();
const createSignedUrl = jest.fn();
const remove = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({ upload, createSignedUrl, remove }),
    },
  }),
}));

process.env.SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:int@localhost:55434/scorecheck_test';

import supabaseService from '@/services/supabase';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('uploadImage', () => {
  it('returns the object PATH, not a URL, so the stored value cannot expire', async () => {
    upload.mockResolvedValue({ error: null });

    await expect(
      supabaseService.uploadImage(Buffer.from('bytes'), 'squad-1-boxscore.jpg'),
    ).resolves.toBe('squad-1-boxscore.jpg');
  });

  it.each([
    ['shot.png', 'image/png'],
    ['shot.gif', 'image/gif'],
    ['shot.jpg', 'image/jpeg'],
    ['shot.jpeg', 'image/jpeg'],
    ['SHOT.PNG', 'image/png'],
    ['shot.bmp', 'image/jpeg'],
    ['shot', 'image/jpeg'],
  ])('sends %s with content type %s', async (fileName, expected) => {
    upload.mockResolvedValue({ error: null });

    await supabaseService.uploadImage(Buffer.from('bytes'), fileName);

    expect(upload).toHaveBeenCalledWith(
      fileName,
      expect.any(Buffer),
      expect.objectContaining({ contentType: expected, upsert: true }),
    );
  });

  it('wraps a Supabase-reported error', async () => {
    upload.mockResolvedValue({ error: new Error('bucket missing') });

    await expect(supabaseService.uploadImage(Buffer.from('x'), 'a.jpg')).rejects.toThrow(
      'Failed to upload image to Supabase: bucket missing',
    );
  });

  it('describes a non-Error rejection as an unknown error', async () => {
    upload.mockRejectedValue('just a string');

    await expect(supabaseService.uploadImage(Buffer.from('x'), 'a.jpg')).rejects.toThrow(
      'Failed to upload image to Supabase: Unknown error',
    );
  });
});

describe('getSignedUrl', () => {
  it('returns the signed URL for a stored object path', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });

    await expect(supabaseService.getSignedUrl('path/x.jpg')).resolves.toBe('https://signed/x');
  });

  it('returns null when Supabase reports an error', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: new Error('gone') });

    await expect(supabaseService.getSignedUrl('path/x.jpg')).resolves.toBeNull();
  });

  it('returns null when Supabase returns no data', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: null });

    await expect(supabaseService.getSignedUrl('path/x.jpg')).resolves.toBeNull();
  });

  it('returns null when the call throws outright', async () => {
    createSignedUrl.mockRejectedValue(new Error('network down'));

    await expect(supabaseService.getSignedUrl('path/x.jpg')).resolves.toBeNull();
  });
});

describe('deleteImage', () => {
  it('removes the object and resolves', async () => {
    remove.mockResolvedValue({ error: null });

    await expect(supabaseService.deleteImage('path/x.jpg')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(['path/x.jpg']);
  });

  it('wraps a Supabase-reported error', async () => {
    remove.mockResolvedValue({ error: new Error('denied') });

    await expect(supabaseService.deleteImage('path/x.jpg')).rejects.toThrow(
      'Failed to delete image from Supabase: denied',
    );
  });

  it('describes a non-Error rejection as an unknown error', async () => {
    remove.mockRejectedValue(42);

    await expect(supabaseService.deleteImage('path/x.jpg')).rejects.toThrow(
      'Failed to delete image from Supabase: Unknown error',
    );
  });
});
