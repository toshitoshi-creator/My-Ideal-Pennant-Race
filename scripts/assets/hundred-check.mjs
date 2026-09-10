/**
 * 100人テストの検査と一覧づくり（PHASE 4.7-B §13）。
 *
 *   npm run assets:hundred
 *
 * やること:
 *   1. assets/style-test/players/ の100枚を1枚ずつ検査する
 *   2. 頭の幅を基準に共通キャンバスへそろえ、球団の帽子を重ねる
 *   3. 100人を並べた一覧（HTML）を書き出す
 *
 * 「ファイルがあるか」ではなく **実際に重ねて表示できるか** を見る。
 * 生成はしません。ゲーム実行時にも1行も動きません。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, isPng, createImage } from './png.ts';
import { compose, cutout, resize, contentBounds } from './pipeline.ts';
import {
  NEEDS_EYE,
  checkCharacter,
  fitFigureToCanvas,
  hashDistance,
  perceptualHash,
  placeCap,
} from './character-quality.ts';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './anchors.ts';

const ROOT = join(process.cwd(), 'assets/style-test');
const PLAYERS = join(ROOT, 'players');
const CAPS = join(ROOT, 'caps');
const OUT = join(ROOT, 'composed');

/** 頭をそろえる先。ここに合わせておけば帽子は必ず合う（§7） */
const HEAD = { headTopY: 150, headWidth: 380, centerX: CANVAS_WIDTH / 2 };

/** 100人テストの合格基準（§13） */
const DUPLICATE_LIMIT = 4;

if (!existsSync(PLAYERS)) {
  console.log(`${PLAYERS} がありません。先に npm run assets:style-test を実行してください。`);
  process.exit(0);
}

const bodyFiles = readdirSync(PLAYERS)
  .filter((name) => name.toLowerCase().endsWith('.png'))
  .sort();
const capFiles = existsSync(CAPS)
  ? readdirSync(CAPS)
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort()
  : [];

if (bodyFiles.length === 0) {
  console.log('検査するものがありません。');
  process.exit(0);
}

console.log(`=== 100人テスト（本体 ${bodyFiles.length}枚 / 帽子 ${capFiles.length}種類）===\n`);

const deflate = (bytes) => new Uint8Array(deflateSync(Buffer.from(bytes), { level: 9 }));
const load = (path) => decodePng(new Uint8Array(readFileSync(path)));
const caps = capFiles.map((name) => cutout(load(join(CAPS, name))).image);

function save(path, image) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodePng(image, deflate);
  writeFileSync(path, bytes);
  return bytes.length;
}

const rows = [];
const hashes = [];
let bytesIn = 0;
let bytesOut = 0;
let accepted = 0;
let capFailures = 0;
let transparentOk = 0;
let headCut = 0;
let feetCut = 0;

for (let i = 0; i < bodyFiles.length; i++) {
  const name = bodyFiles[i];
  const path = join(PLAYERS, name);
  const raw = new Uint8Array(readFileSync(path));
  bytesIn += statSync(path).size;
  const id = name.replace(/\.png$/i, '');

  if (!isPng(raw)) {
    console.log(`  ❌ ${id}: PNG ではありません`);
    rows.push({ id, ok: false, note: 'PNGではない' });
    continue;
  }

  let image;
  try {
    image = decodePng(raw);
  } catch (error) {
    console.log(`  ❌ ${id}: 読めません（${error.message}）`);
    rows.push({ id, ok: false, note: '読めない' });
    continue;
  }

  /* ---- 1枚ごとの検査（§13） ---- */
  const report = checkCharacter({ id, image, known: [...hashes] });
  const fails = report.checks.filter((check) => check.level === 'FAIL');
  if (report.checks.some((c) => c.id === 'background-removable' && c.level === 'PASS')) {
    transparentOk += 1;
  }
  if (report.checks.some((c) => c.id === 'head-inside' && c.level === 'FAIL')) headCut += 1;
  if (report.checks.some((c) => c.id === 'feet-inside' && c.level === 'FAIL')) feetCut += 1;

  /* ---- 背景を抜いて、頭でそろえて、帽子を重ねる ---- */
  const cut = cutout(image).image;
  const fitted = fitFigureToCanvas(cut, HEAD);
  let composed = null;
  let capOk = false;
  if (fitted.metrics) {
    const cap = caps.length > 0 ? caps[i % caps.length] : null;
    composed = cap ? placeCap(fitted.image, cap, HEAD) : fitted.image;
    // 帽子を乗せても、頭がキャンバスからはみ出していないか
    const bounds = contentBounds(composed);
    capOk = !bounds.empty && bounds.top >= 0 && bounds.bottom <= CANVAS_HEIGHT - 1;
    if (!capOk) capFailures += 1;
  } else {
    capFailures += 1;
  }

  const ok = fails.length === 0 && capOk;
  if (ok) accepted += 1;
  hashes.push(report.hash);

  if (composed) {
    bytesOut += save(join(OUT, `${id}.png`), composed);
  }

  const heads = report.metrics ? `${report.metrics.headsTall.toFixed(1)}頭身` : '頭身不明';
  const marks = [];
  if (fitted.shrunk) marks.push('縮めた');
  if (!capOk) marks.push('帽子が合わない');
  console.log(
    `  ${ok ? '✅' : '❌'} ${id}: ${heads} / 倍率 ${fitted.scale.toFixed(2)}` +
      (marks.length > 0 ? ` / ${marks.join(' / ')}` : ''),
  );
  for (const check of fails) console.log(`       ✗ ${check.label}: ${check.detail}`);

  rows.push({ id, ok, heads, note: fails.map((c) => c.label).join(', ') });
}

/* ================================================================
 * 重複（§13）
 * ============================================================== */

let closest = Number.POSITIVE_INFINITY;
let closestPair = '';
let duplicates = 0;
for (let i = 0; i < hashes.length; i++) {
  for (let j = i + 1; j < hashes.length; j++) {
    const d = hashDistance(hashes[i], hashes[j]);
    if (d <= DUPLICATE_LIMIT) duplicates += 1;
    if (d < closest) {
      closest = d;
      closestPair = `${rows[i]?.id} と ${rows[j]?.id}`;
    }
  }
}

/* ================================================================
 * 一覧（§13）
 * ============================================================== */

const COLS = 10;
const CELL = 128;
const sheetRows = Math.ceil(rows.length / COLS);
const sheet = createImage(CELL * COLS, Math.round(CELL * 1.25) * sheetRows);
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 245;
  sheet.data[i + 1] = 245;
  sheet.data[i + 2] = 245;
  sheet.data[i + 3] = 255;
}
let placed = 0;
for (const row of rows) {
  const file = join(OUT, `${row.id}.png`);
  if (!existsSync(file)) {
    placed += 1;
    continue;
  }
  const small = resize(load(file), CELL, Math.round(CELL * 1.25));
  compose(
    sheet,
    small,
    (placed % COLS) * CELL,
    Math.floor(placed / COLS) * Math.round(CELL * 1.25),
  );
  placed += 1;
}
const sheetPath = join(ROOT, 'hundred.png');
save(sheetPath, sheet);

/* ================================================================
 * 報告（§27）
 * ============================================================== */

console.log('\n── 100人テストの報告（§27）──');
console.log(`  生成枚数        ${bodyFiles.length}`);
console.log(`  採用枚数        ${accepted}`);
console.log(`  Reject枚数      ${bodyFiles.length - accepted}`);
console.log(`  総容量（原本）  ${(bytesIn / 1024 / 1024).toFixed(1)}MB`);
console.log(`  平均容量（原本）${(bytesIn / bodyFiles.length / 1024).toFixed(0)}KB`);
console.log(`  総容量（合成）  ${(bytesOut / 1024 / 1024).toFixed(1)}MB`);
console.log(
  `  透明背景率      ${((transparentOk / bodyFiles.length) * 100).toFixed(0)}%`,
);
console.log(`  頭切れ          ${headCut}`);
console.log(`  足切れ          ${feetCut}`);
console.log(`  帽子配置失敗    ${capFailures}`);
console.log(`  重複            ${duplicates}件（いちばん近い組: ${closestPair} / 違い ${closest}）`);
console.log(`\n  一覧: ${sheetPath}`);
console.log(`  合成後: ${OUT}`);

console.log('\n── 目で見ないと分からないこと ──');
for (const item of NEEDS_EYE) console.log(`  ・${item}`);

process.exit(accepted === bodyFiles.length && capFailures === 0 ? 0 : 1);
