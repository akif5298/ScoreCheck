/**
 * Loads the extraction model into Ollama's memory ahead of time so the first
 * real OCR call doesn't pay the cold-load penalty (which is what was tripping
 * the label GUI's 120s subprocess timeout).
 *
 * Usage: npm run warmup
 */

import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { warmupModel } from '../src/services/ollamaExtractor';
import { OLLAMA_EXTRACTION_MODEL } from '../src/constants';

warmupModel(OLLAMA_EXTRACTION_MODEL).then(() => {
  // warmupModel() is best-effort and never rejects — a "[Ollama] Warmup failed"
  // line above (if any) means it didn't actually load; this just means it finished trying.
  process.stdout.write(`Warmup attempt finished for ${OLLAMA_EXTRACTION_MODEL}\n`);
});
