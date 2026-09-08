/**
 * PHASE 4.6 画像素材の最適化（§26）。
 *
 *   npm run assets:optimize
 *
 * やること：
 *   - 使えない大きさ・形式の検出
 *   - サイズ違い（@small / @medium / @large）が足りているかの点検
 *   - 中身が同じ画像の検出（重複排除の候補）
 *   - 容量の内訳の表示
 *
 * 実際の縮小・WebP変換は外部ツール（squoosh / cwebp / ImageMagick など）で行う。
 * ここはリポジトリに余計な依存を増やさないため、指示を出すところまでを受け持つ。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';

const CONFIG = JSON.parse(readFileSync('config/visual-assets.json', 'utf8'));
const ROOT = 'src/assets/players';
const SIZES = Object.keys(CONFIG.sizes);

const files = [];
for (const category of CONFIG.categories) {
  const dir = join(ROOT, category.dir);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.png' && ext !== '.webp') continue;
    const stem = basename(file, ext);
    if (!stem.split('@')[0].startsWith(`${category.prefix}_`)) continue;
    files.push({ category: category.id, dir: category.dir, file, ext, stem, full: join(dir, file) });
  }
}

if (files.length === 0) {
  console.log('画像素材はまだありません。最適化するものはありません。');
  process.exit(0);
}

let bytes = 0;
const byCategory = new Map();
const hashes = new Map();
const duplicates = [];
const pngMasters = [];
const missingVariants = [];

for (const f of files) {
  const size = statSync(f.full).size;
  bytes += size;
  byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + size);

  const sha1 = createHash('sha1').update(readFileSync(f.full)).digest('hex');
  if (hashes.has(sha1)) duplicates.push([hashes.get(sha1), f.full]);
  else hashes.set(sha1, f.full);

  if (f.ext === '.png') pngMasters.push(f.full);
}

// サイズ違いの点検（原寸だけがあって small が無い、など）
const baseIds = new Set(files.filter((f) => !f.stem.includes('@')).map((f) => `${f.dir}/${f.stem}`));
for (const id of baseIds) {
  for (const size of SIZES) {
    if (size === 'hero') continue; // hero は原寸を使う
    const has = files.some((f) => `${f.dir}/${f.stem}` === `${id}@${size}`);
    if (!has) missingVariants.push(`${id}@${size}`);
  }
}

const kb = (n) => `${Math.round(n / 1024)}KB`;

console.log(`=== 選手ビジュアル素材の最適化（${files.length}点 / 合計 ${kb(bytes)}）===\n`);
console.log('種類ごとの容量:');
for (const [category, size] of [...byCategory].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${category.padEnd(12)} ${kb(size)}`);
}

if (duplicates.length) {
  console.log('\n中身が同じ画像（どちらかを消して manifest で共有してください。§28）:');
  for (const [a, b] of duplicates) console.log(`  ${a}\n  ${b}\n`);
}

if (pngMasters.length) {
  console.log(`\nPNG のままの素材が ${pngMasters.length}点あります。ゲーム同梱は WebP を推奨します（§25）:`);
  for (const p of pngMasters.slice(0, 10)) {
    console.log(`  cwebp -q 88 -alpha_q 100 "${p}" -o "${p.replace(/\.png$/, '.webp')}"`);
  }
  if (pngMasters.length > 10) console.log(`  ...ほか ${pngMasters.length - 10}点`);
}

if (missingVariants.length) {
  console.log(`\nサイズ違いが足りない素材が ${missingVariants.length}件あります（一覧の表示が重くなります。§49）:`);
  for (const v of missingVariants.slice(0, 10)) {
    const [, size] = v.split('@');
    console.log(`  ${v}.webp （幅 ${CONFIG.sizes[size]}px）`);
  }
  if (missingVariants.length > 10) console.log(`  ...ほか ${missingVariants.length - 10}件`);
}

console.log('\n最適化を実行したら npm run assets:manifest と npm run assets:validate を続けて実行してください。');
