import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const REF_W = 3840;
const REF_H = 2160;

const HEADER_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  516 };
const TEAM_A_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  923 };
const TEAM_B_CROP = { x1: 1218, y1: 1058, x2: 3525, y2: 1545 };

async function crop(buffer: Buffer, r: typeof HEADER_CROP): Promise<Buffer> {
  const meta  = await sharp(buffer).metadata();
  const sx    = (meta.width  ?? REF_W) / REF_W;
  const sy    = (meta.height ?? REF_H) / REF_H;
  return sharp(buffer)
    .extract({
      left:   Math.round(r.x1 * sx),
      top:    Math.round(r.y1 * sy),
      width:  Math.round((r.x2 - r.x1) * sx),
      height: Math.round((r.y2 - r.y1) * sy),
    })
    .toBuffer();
}

async function compositeWithHeader(headerBuf: Buffer, bodyBuf: Buffer): Promise<Buffer> {
  const [hm, bm] = await Promise.all([sharp(headerBuf).metadata(), sharp(bodyBuf).metadata()]);
  const w  = hm.width  ?? 0;
  const hH = hm.height ?? 0;
  const bH = bm.height ?? 0;
  return sharp({ create: { width: w, height: hH + bH, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .composite([{ input: headerBuf, top: 0, left: 0 }, { input: bodyBuf, top: hH, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function main() {
  const imgArg = process.argv.find(a => a.startsWith('--img='))?.split('=')[1] ?? 'IMG_0312.JPEG';
  const imgPath = path.join(__dirname, '../../eval/screenshots', path.basename(imgArg));
  if (!fs.existsSync(imgPath)) { console.error(`Not found: ${imgPath}`); process.exit(1); }

  const buf       = fs.readFileSync(imgPath);
  const headerBuf = await crop(buf, HEADER_CROP);
  const teamABuf  = await crop(buf, TEAM_A_CROP);
  const teamBBuf  = await crop(buf, TEAM_B_CROP);
  const teamBComp = await compositeWithHeader(headerBuf, teamBBuf);

  const outDir = path.join(__dirname, '../../eval/crops');
  fs.mkdirSync(outDir, { recursive: true });

  const base = path.basename(imgArg, path.extname(imgArg));
  fs.writeFileSync(path.join(outDir, `${base}_header.jpg`),         headerBuf);
  fs.writeFileSync(path.join(outDir, `${base}_teamA.jpg`),          teamABuf);
  fs.writeFileSync(path.join(outDir, `${base}_teamB_raw.jpg`),      teamBBuf);
  fs.writeFileSync(path.join(outDir, `${base}_teamB_composite.jpg`), teamBComp);

  console.log(`Saved to eval/crops/:`);
  console.log(`  ${base}_header.jpg         (${headerBuf.length} bytes)`);
  console.log(`  ${base}_teamA.jpg          (${teamABuf.length} bytes)`);
  console.log(`  ${base}_teamB_raw.jpg      (${teamBBuf.length} bytes)`);
  console.log(`  ${base}_teamB_composite.jpg (${teamBComp.length} bytes)`);
}

main().catch(console.error);
