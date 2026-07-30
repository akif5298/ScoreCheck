/**
 * Supabase Storage operations — the screenshot bucket.
 *
 * First link in the composition chain that builds SupabaseService:
 *   client → StorageService → UsersService → AggregatesService → GamesService → SupabaseService
 *
 * The chain is `extends` purely to compose one object with one `this`, NOT a taxonomy —
 * storage is not a "kind of" anything, and users do not inherit from it conceptually.
 * It is built this way so that a method calling another method still dispatches through
 * `this`, exactly as it did when all of them lived in a single class. That matters:
 * tests spy on the service instance, and a spy has to keep intercepting internal calls
 * (updateGame → this.getGameById, for one). Direct cross-module imports would silently
 * bypass those spies.
 *
 * Order is dictated by who calls whom, so each link only ever reaches *down* the chain.
 */
import { supabaseServiceRole } from './client';
import logger from '@/utils/logger';

const SCREENSHOT_BUCKET = 'screenshots';
// Signed-URL lifetime when serving a screenshot for viewing. Minted fresh on
// every read, so short is fine — this is not what's persisted in the DB.
const SIGNED_URL_TTL_SECONDS = 3600;

export class StorageService {
  // File Storage Methods
  //
  // Screenshots live in Supabase Storage. We persist the object PATH (e.g.
  // "<userId>-1-boxscore.jpg") in games.screenshotUrl — never a signed URL,
  // which would expire — and mint a fresh signed URL at read time via
  // getSignedUrl().
  async uploadImage(file: Buffer, fileName: string, bucket: string = SCREENSHOT_BUCKET): Promise<string> {
    try {
      // Detect MIME type from file extension
      const fileExtension = fileName.split('.').pop()?.toLowerCase();
      let contentType = 'image/jpeg'; // default

      if (fileExtension === 'png') {
        contentType = 'image/png';
      } else if (fileExtension === 'gif') {
        contentType = 'image/gif';
      } else if (fileExtension === 'jpg' || fileExtension === 'jpeg') {
        contentType = 'image/jpeg';
      }

      // Service-role client bypasses RLS
      const { error } = await supabaseServiceRole.storage
        .from(bucket)
        .upload(fileName, file, {
          contentType,
          upsert: true,
        });

      if (error) {
        logger.error({ err: error }, 'Supabase storage upload failed');
        throw error;
      }

      // Return the object path; the caller persists this, not a signed URL.
      return fileName;
    } catch (error) {
      logger.error({ err: error }, 'Supabase storage upload failed');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upload image to Supabase: ${errorMessage}`);
    }
  }

  // Mints a short-lived signed URL for a stored object path. Returns null when
  // the path is empty or Supabase can't sign it (e.g. object was deleted).
  async getSignedUrl(
    objectPath: string,
    bucket: string = SCREENSHOT_BUCKET,
    expiresIn: number = SIGNED_URL_TTL_SECONDS,
  ): Promise<string | null> {
    if (!objectPath) return null;
    // Legacy rows may still hold a full URL or a base64 data URI; pass those
    // through unchanged rather than trying to sign them.
    if (objectPath.startsWith('http') || objectPath.startsWith('data:')) {
      return objectPath;
    }
    try {
      const { data, error } = await supabaseServiceRole.storage
        .from(bucket)
        .createSignedUrl(objectPath, expiresIn);
      if (error || !data) {
        logger.error({ err: error, objectPath }, 'Failed to generate signed URL');
        return null;
      }
      return data.signedUrl;
    } catch (error) {
      logger.error({ err: error, objectPath }, 'Failed to generate signed URL');
      return null;
    }
  }

  async deleteImage(fileName: string, bucket: string = 'screenshots'): Promise<void> {
    try {
      // Try Supabase storage with service role (bypasses RLS)
      const { error } = await supabaseServiceRole.storage
        .from(bucket)
        .remove([fileName]);

      if (error) {
        logger.error({ err: error }, 'Supabase storage delete failed');
        throw error;
      }
    } catch (error) {
      logger.error({ err: error }, 'Supabase storage delete failed');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete image from Supabase: ${errorMessage}`);
    }
  }
}
