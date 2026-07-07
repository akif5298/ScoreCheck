/**
 * Headless OCR extractor — reads an image and prints extracted JSON to stdout.
 * Used by the label GUI to pre-fill the form without an interactive prompt.
 *
 * Usage: npm run extract -- <path-to-screenshot>
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { extractBoxScore } from '../src/services/ollamaExtractor';
import { OLLAMA_EXTRACTION_MODEL } from '../src/constants';

const imagePath = process.argv[2];
if (!imagePath) {
  process.stderr.write('Usage: npm run extract -- <path-to-screenshot>\n');
  process.exit(1);
}

const resolved = path.resolve(imagePath);
if (!fs.existsSync(resolved)) {
  process.stderr.write(`File not found: ${resolved}\n`);
  process.exit(1);
}

const buffer = fs.readFileSync(resolved);

extractBoxScore(buffer, OLLAMA_EXTRACTION_MODEL)
  .then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  })
  .catch(err => {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  });
