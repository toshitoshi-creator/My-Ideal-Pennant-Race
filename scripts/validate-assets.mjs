/**
 * PHASE 4.6 選手ビジュアル素材の検査（§27・§28）。
 *
 *   npm run assets:validate
 *
 * 調べること：
 *   - ファイルが存在するか / 拡張子が正しいか
 *   - 画像として壊れていないか（ヘッダを読む）
 *   - 共通キャンバスの大きさに合っているか
 *   - 透過を持っているか
 *   - 命名規則に合っているか
 *   - manifest と実ファイルが食い違っていないか
 *   - 中身がまったく同じ画像が別名で置かれていないか
 *   - 必要な種類の点数が足りているか
 *
 * 素材が1枚も無い状態は「異常」ではない（ゲームは SVG で動く）。
 * 中途半端に足りていない状態だけを警告する。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';

const CONFIG = JSON.parse(readFileSync('config/visual-assets.json', 'utf8'));
const ROOT = 'src/assets/players';
const MANIFEST_PATH = join(ROOT, 'manifest.json');
const NAME_RE = new RegExp(CONFIG.naming.pattern);
const ALLOWED_EXT = new Set(['.webp', '.png']);

const errors = [];
const warnings = [];
const notes = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ---------------- 画像ヘッダ ---------------- */

function readPng(buffer) {
  if (buffer.length < 26) return null;
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  const colorType = buffer.readUInt8(25);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    // 4 = グレースケール+α, 6 = RGB+α
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

function readWebp(buffer) {
  if (buffer.length < 32) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const format = buffer.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      hasAlpha: (buffer.readUInt8(20) & 0x10) !== 0,
    };
  }
  if (format === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      hasAlpha: ((bits >> 28) & 1) === 1,
    };
  }
  if (format === 'VP8 ') {
    // ロスあり単体は透過を持てない
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  return null;
}

function readImage(buffer, ext) {
  return ext === '.png' ? readPng(buffer) : readWebp(buffer);
}

/* ---------------- 走査 ---------------- */

const seenHash = new Map();
const foundByCategory = new Map();
let total = 0;

for (const category of CONFIG.categories) {
  const dir = join(ROOT, category.dir);
  if (!existsSync(dir)) {
    warn(`${dir} がありません（${category.id} の素材を置く場所）`);
    continue;
  }
  const files = readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'README.md');
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const stem = basename(file, ext);
    const id = stem.split('@')[0];
    if (!id.startsWith(`${category.prefix}_`)) continue;

    total += 1;
    const full = join(dir, file);

    if (!ALLOWED_EXT.has(ext)) {
      fail(`${full}: 拡張子が ${ext} です。使えるのは .webp / .png だけです`);
      continue;
    }
    if (!NAME_RE.test(file)) {
      fail(`${full}: 命名規則に合いません（例: ${category.prefix}_001.webp）`);
    }

    const buffer = readFileSync(full);
    if (buffer.length === 0) {
      fail(`${full}: 中身が空です`);
      continue;
    }
    const image = readImage(buffer, ext);
    if (!image) {
      fail(`${full}: 画像として読めません（壊れているか、対応していない形式です）`);
      continue;
    }
    if (!image.hasAlpha) {
      fail(`${full}: 透過がありません。背景を必ず透明にしてください（§8）`);
    }
    // サイズ違い（@small など）は縮小されているので、原寸だけ確認する
    if (!stem.includes('@')) {
      if (image.width !== CONFIG.canvas.width || image.height !== CONFIG.canvas.height) {
        fail(
          `${full}: 大きさが ${image.width}x${image.height} です。` +
            `共通キャンバス ${CONFIG.canvas.width}x${CONFIG.canvas.height} に合わせてください（§9）`,
        );
      }
    }

    const sha1 = createHash('sha1').update(buffer).digest('hex');
    const previous = seenHash.get(sha1);
    if (previous) {
      fail(`${full}: ${previous} と中身がまったく同じです（別名の複製。§28）`);
    } else {
      seenHash.set(sha1, full);
    }

    const list = foundByCategory.get(category.id) ?? new Set();
    list.add(id);
    foundByCategory.set(category.id, list);

    const bytes = statSync(full).size;
    if (bytes > 400 * 1024) {
      warn(`${full}: ${Math.round(bytes / 1024)}KB あります。npm run assets:optimize を検討してください`);
    }
  }
}

/* ---------------- 点数 ---------------- */

if (total === 0) {
  notes.push('画像素材はまだ1枚もありません。ゲームは PHASE 4.5 の SVG で選手を描きます（正常）。');
} else {
  for (const category of CONFIG.categories) {
    const found = foundByCategory.get(category.id)?.size ?? 0;
    if (category.required && found === 0) {
      warn(`${category.id}: 必須の種類ですが0点です。この状態では画像モードにならず SVG で描かれます`);
    } else if (found > 0 && found < category.min) {
      warn(`${category.id}: ${found}点しかありません（仕様は最低${category.min}点）`);
    } else if (found > category.max) {
      warn(`${category.id}: ${found}点あります（仕様は最大${category.max}点）`);
    }
  }
}

/* ---------------- manifest の整合 ---------------- */

if (!existsSync(MANIFEST_PATH)) {
  fail(`${MANIFEST_PATH} がありません。npm run assets:manifest を実行してください`);
} else {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.canvas?.width !== CONFIG.canvas.width || manifest.canvas?.height !== CONFIG.canvas.height) {
    fail('manifest のキャンバスが config/visual-assets.json と食い違っています');
  }
  for (const [categoryId, entries] of Object.entries(manifest.parts ?? {})) {
    for (const entry of entries) {
      if (!entry.path) {
        fail(`manifest: ${categoryId}/${entry.id} に path がありません`);
        continue;
      }
      if (!existsSync(join(ROOT, entry.path))) {
        fail(`manifest: ${entry.path} が実際には存在しません（manifest を作り直してください）`);
      }
    }
    const onDisk = foundByCategory.get(categoryId)?.size ?? 0;
    if (entries.length !== onDisk) {
      fail(
        `manifest: ${categoryId} は ${entries.length}点と書かれていますが、実際は ${onDisk}点です` +
          '（npm run assets:manifest を実行してください）',
      );
    }
  }
  for (const [categoryId, ids] of foundByCategory) {
    const listed = (manifest.parts ?? {})[categoryId]?.length ?? 0;
    if (listed === 0 && ids.size > 0) {
      fail(`manifest: ${categoryId} の素材が${ids.size}点あるのに登録されていません`);
    }
  }
}

/* ---------------- 結果 ---------------- */

console.log(`=== 選手ビジュアル素材の検査（${total}点）===`);
for (const n of notes) console.log(`  ${n}`);
for (const w of warnings) console.log(`  警告: ${w}`);
for (const e of errors) console.log(`  エラー: ${e}`);
if (errors.length > 0) {
  console.log(`\n=== FAIL（エラー ${errors.length}件 / 警告 ${warnings.length}件）===`);
  process.exitCode = 1;
} else {
  console.log(`\n=== PASS（警告 ${warnings.length}件）===`);
}
