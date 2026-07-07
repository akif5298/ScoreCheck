import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const REF_W = 3840;
const REF_H = 2160;
const ROW_H = 82;

const TEAM_A_CROP = { x1: 1218, y1: 434,  x2: 3525, y2: 923  };
const TEAM_B_CROP = { x1: 1218, y1: 1058, x2: 3525, y2: 1545 };

function playerRowCrop(
  teamCrop: { x1: number; y1: number; x2: number; y2: number },
  playerIndex: number,
) {
  const y1 = teamCrop.y1 + ROW_H * (playerIndex + 1); // +1 to skip header row
  const y2 = y1 + ROW_H;
  return { x1: teamCrop.x1, y1, x2: teamCrop.x2, y2 };
}

async function cropRegion(buffer: Buffer, region: { x1: number; y1: number; x2: number; y2: number }) {
  const meta   = await sharp(buffer).metadata();
  const imgW   = meta.width  ?? REF_W;
  const imgH   = meta.height ?? REF_H;
  const sx     = imgW / REF_W;
  const sy     = imgH / REF_H;
  const left   = Math.max(0, Math.round(region.x1 * sx));
  const top    = Math.max(0, Math.round(region.y1 * sy));
  const right  = Math.min(Math.round(region.x2 * sx), imgW);
  const bottom = Math.min(Math.round(region.y2 * sy), imgH);
  return sharp(buffer).extract({ left, top, width: right - left, height: bottom - top }).toBuffer();
}

async function main() {
  const imgPath = path.join(__dirname, '../../eval/screenshots/IMG_0312.JPEG');
  const buffer  = fs.readFileSync(imgPath);
  const outDir  = path.join(__dirname, '../../eval');

  // Team half crops
  console.log('Team halves:');
  const teamA = await cropRegion(buffer, TEAM_A_CROP);
  fs.writeFileSync(path.join(outDir, 'debug_team_a.jpg'), teamA);
  console.log('  saved -> eval/debug_team_a.jpg');

  const teamB = await cropRegion(buffer, TEAM_B_CROP);
  fs.writeFileSync(path.join(outDir, 'debug_team_b.jpg'), teamB);
  console.log('  saved -> eval/debug_team_b.jpg');

  // Individual row crops
  console.log('\nPlayer rows:');
  for (let i = 0; i < 5; i++) {
    const crop   = playerRowCrop(TEAM_A_CROP, i);
    const img    = await cropRegion(buffer, crop);
    const fname  = `debug_row_A${i + 1}.jpg`;
    fs.writeFileSync(path.join(outDir, fname), img);
    console.log(`  A${i + 1} y=${crop.y1}-${crop.y2} -> eval/${fname}`);
  }
  for (let i = 0; i < 5; i++) {
    const crop   = playerRowCrop(TEAM_B_CROP, i);
    const img    = await cropRegion(buffer, crop);
    const fname  = `debug_row_B${i + 1}.jpg`;
    fs.writeFileSync(path.join(outDir, fname), img);
    console.log(`  B${i + 1} y=${crop.y1}-${crop.y2} -> eval/${fname}`);
  }
}

main().catch(console.error);
