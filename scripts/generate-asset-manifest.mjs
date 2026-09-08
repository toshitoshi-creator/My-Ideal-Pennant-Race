/**
 * PHASE 4.6 選手ビジュアル素材の manifest を作る。
 *
 *   npm run assets:manifest
 *
 * src/assets/players/ 以下の画像を走査して、
 * 種類ごとの一覧（id / path / サイズ / アンカー / タグ）を manifest.json に書き出す。
 *
 * 素材が1枚も無くても正常終了する。そのときゲームは PHASE 4.5 の SVG で選手を描く。
 * ここは開発時に走らせるスクリプトで、ゲーム実行時には動かない。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';

const CONFIG = JSON.parse(readFileSync('config/visual-assets.json', 'utf8'));
const ROOT = 'src/assets/players';
const OUT = join(ROOT, 'manifest.json');
const IMAGE_EXT = new Set(['.webp', '.png']);

/** PNG / WebP のヘッダから幅と高さを読む（外部ライブラリを使わない） */
function imageSize(buffer, ext) {
  if (ext === '.png' && buffer.length > 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (ext === '.webp' && buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (format === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (format === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
  }
  return null;
}

/** ファイル名から「素材ID」と「サイズ違い」を取り出す（例: head_001@small.webp） */
function parseName(file) {
  const ext = extname(file);
  const stem = basename(file, ext);
  const at = stem.indexOf('@');
  return {
    id: at >= 0 ? stem.slice(0, at) : stem,
    variant: at >= 0 ? stem.slice(at + 1) : null,
    ext,
  };
}

const parts = {};
let total = 0;
const problems = [];

for (const category of CONFIG.categories) {
  const dir = join(ROOT, category.dir);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
  const byId = new Map();

  for (const file of files) {
    const { id, variant, ext } = parseName(file);
    // 種類ごとの接頭辞に合うものだけ拾う（同じフォルダに複数の種類が入るため）
    if (!id.startsWith(`${category.prefix}_`)) continue;
    const full = join(dir, file);
    const buffer = readFileSync(full);
    const size = imageSize(buffer, ext.toLowerCase());
    if (!size) problems.push(`${full}: 画像の大きさを読めません（壊れている可能性）`);

    const entry = byId.get(id) ?? {
      id,
      path: null,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      bytes: 0,
      sha1: '',
      variants: {},
      anchor: CONFIG.anchors[category.id] ?? null,
      compatibleTypes: [],
      tags: [],
    };
    const rel = `${category.dir}/${file}`;
    if (variant) {
      entry.variants[variant] = rel;
    } else {
      entry.path = rel;
      entry.width = size?.width ?? 0;
      entry.height = size?.height ?? 0;
      entry.bytes = statSync(full).size;
      entry.sha1 = createHash('sha1').update(buffer).digest('hex');
    }
    byId.set(id, entry);
  }

  const list = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (list.length > 0) {
    parts[category.id] = list;
    total += list.length;
  }
}

const manifest = {
  version: CONFIG.version,
  generatedFrom: 'scripts/generate-asset-manifest.mjs',
  canvas: CONFIG.canvas,
  note:
    total === 0
      ? '素材が1枚も無い状態。この場合ゲームは PHASE 4.5 の SVG で選手を描きます。'
      : `${total}点の素材を登録しました。`,
  parts,
};

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${OUT} を書き出しました（${total}点 / ${Object.keys(parts).length}種類）`);
for (const p of problems) console.warn(`  警告: ${p}`);
if (total === 0) {
  console.log('  素材はまだありません。ゲームは PHASE 4.5 の SVG で選手を描きます。');
}
