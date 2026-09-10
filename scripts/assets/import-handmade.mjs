/**
 * 手で描いたパーツを取り込む。
 *
 *   npm run assets:import
 *   npm run assets:import -- --type eyes
 *
 * 読む:   assets/incoming/<dir>/<id>.png
 * 書く:   src/assets/players/<dir>/<id>.png  … ゲームに入る絵
 *         同 <id>@small/@medium/@large.png    … 派生サイズ
 *         同 <id>cNN.png                      … 肌色・髪色の振り分け
 *
 * **いちばん大事な決まり：位置を動かさない。**
 *
 * 生成AIの絵は「どこに描かれるか分からない」ので、
 * assets:normalize が測って置き直していた。
 * 手で描いたパーツはあなたが正確な位置に描いているので、
 * ここでは1画素も動かさず、そのまま取り込む。
 * 動かすと、せっかく合わせた目や口の位置がずれてしまう。
 *
 * やるのは「確かめること」と「増やすこと」だけ。
 *   確かめる: 1024x1280 か / 透明か / はみ出していないか / 基準点に近いか
 *   増やす:   派生サイズ / 肌色8色・髪色10色
 *
 * これは**開発時にだけ動く**。ゲーム実行時には1行も動かない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CATALOG, catalogEntry, isCatalogId } from './catalog.ts';
import { decodePng, encodePng, isPng } from './png.ts';
import {
  HAIR_RAMPS,
  SKIN_RAMPS,
  contentBounds,
  derivatives,
  hasTransparency,
  looksTransparent,
  recolor,
} from './pipeline.ts';
import { ANCHORS, CANVAS_HEIGHT, CANVAS_WIDTH, OUTPUT_SIZES } from './anchors.ts';

const ROOT = process.cwd();
const FROM = join(ROOT, 'assets/incoming');
const TO = join(ROOT, 'src/assets/players');

/** 基準点からこれ以上ずれていたら知らせる（落としはしない） */
const ANCHOR_WARN = 40;

/** 肌の色を振り分ける種類 */
const SKIN_PARTS = new Set(['head_shape', 'body_type']);
/** 髪の色を振り分ける種類 */
const HAIR_PARTS = new Set(['hair_style', 'hair_back']);

const args = process.argv.slice(2);
const typeArg = (() => {
  const i = args.indexOf('--type');
  if (i >= 0) return args[i + 1];
  const inline = args.find((a) => a.startsWith('--type='));
  return inline ? inline.slice(7) : 'all';
})();
const noColors = args.includes('--no-colors');

const wanted =
  typeArg === 'all'
    ? CATALOG.filter((entry) => entry.kind !== 'recolor').map((entry) => entry.id)
    : typeArg.split(',').map((part) => part.trim());

for (const id of wanted) {
  if (!isCatalogId(id)) {
    console.error(`知らない種類です: ${id}`);
    process.exit(2);
  }
}

const deflate = (bytes) => new Uint8Array(deflateSync(Buffer.from(bytes), { level: 9 }));

function save(path, image) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodePng(image, deflate);
  writeFileSync(path, bytes);
  return bytes.length;
}

console.log('=== 手描きパーツの取り込み ===\n');
console.log('  位置は動かしません。描いたとおりに取り込みます。\n');

let done = 0;
let failed = 0;
let variants = 0;
const missing = [];

for (const id of wanted) {
  const entry = catalogEntry(id);
  const from = join(FROM, entry.dir);
  if (!existsSync(from)) {
    missing.push(entry);
    continue;
  }

  const files = readdirSync(from)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .filter((name) => name.startsWith(`${entry.prefix}_`))
    .sort();
  if (files.length === 0) {
    missing.push(entry);
    continue;
  }

  console.log(`── ${entry.id}（${files.length}枚）──`);
  const anchor = ANCHORS[entry.id];

  for (const name of files) {
    const assetId = name.replace(/\.png$/i, '');
    const raw = new Uint8Array(readFileSync(join(from, name)));

    if (!isPng(raw)) {
      console.log(`  ❌ ${name}: PNG ではありません`);
      failed += 1;
      continue;
    }

    let image;
    try {
      image = decodePng(raw);
    } catch (error) {
      console.log(`  ❌ ${name}: 読めません（${error.message}）`);
      failed += 1;
      continue;
    }

    /* ---- 確かめる ---- */
    const problems = [];
    const notes = [];

    if (image.width !== CANVAS_WIDTH || image.height !== CANVAS_HEIGHT) {
      problems.push(`${image.width}x${image.height} です（${CANVAS_WIDTH}x${CANVAS_HEIGHT} で描いてください）`);
    }
    if (!hasTransparency(image)) {
      problems.push('透明な部分がありません（背景を透明にしてください）');
    } else if (!looksTransparent(image)) {
      problems.push('四隅が透明ではありません（背景が塗られています）');
    }

    const bounds = contentBounds(image);
    if (bounds.empty) {
      problems.push('中身がありません');
    } else {
      if (bounds.top <= 0 || bounds.left <= 0) notes.push('中身が画面の端に接しています');
      if (bounds.bottom >= image.height - 1 || bounds.right >= image.width - 1) {
        notes.push('中身が画面の端に接しています');
      }
      if (anchor) {
        const cx = (bounds.left + bounds.right) / 2;
        const cy = (bounds.top + bounds.bottom) / 2;
        const off = Math.max(Math.abs(cx - anchor.x), Math.abs(cy - anchor.y));
        if (off > ANCHOR_WARN) {
          notes.push(
            `中心が (${cx.toFixed(0)}, ${cy.toFixed(0)}) で、基準点 (${anchor.x}, ${anchor.y}) から ${off.toFixed(0)}px ずれています`,
          );
        }
      }
    }

    if (problems.length > 0) {
      console.log(`  ❌ ${assetId}: ${problems.join(' / ')}`);
      failed += 1;
      continue;
    }

    /* ---- そのまま取り込む（1画素も動かさない） ---- */
    const base = join(TO, entry.dir);
    const size = save(join(base, `${assetId}.png`), image);
    for (const [label, width] of Object.entries(OUTPUT_SIZES)) {
      if (width >= CANVAS_WIDTH) continue;
      save(join(base, `${assetId}@${label}.png`), derivatives(image, [width]).get(width));
    }

    /* ---- 色を増やす ---- */
    let made = 0;
    if (!noColors) {
      const ramps = HAIR_PARTS.has(entry.id) ? HAIR_RAMPS : SKIN_PARTS.has(entry.id) ? SKIN_RAMPS : null;
      if (ramps) {
        for (let i = 0; i < ramps.length; i++) {
          const tinted = recolor(image, ramps[i].dark, ramps[i].light);
          save(join(base, `${assetId}c${String(i + 1).padStart(2, '0')}.png`), tinted);
          made += 1;
        }
      }
    }
    variants += made;
    done += 1;

    console.log(
      `  ✅ ${assetId}: ${bounds.width}x${bounds.height} / ${(size / 1024).toFixed(0)}KB` +
        (made > 0 ? ` / 色違い ${made}点` : '') +
        (notes.length > 0 ? `\n       ! ${notes.join(' / ')}` : ''),
    );
  }
  console.log();
}

console.log(`=== 取り込み: ${done}枚（色違い ${variants}点）/ 失敗 ${failed}枚 ===`);

if (missing.length > 0) {
  console.log('\n── まだ描かれていない種類 ──');
  for (const entry of missing) {
    console.log(
      `  ${entry.id.padEnd(14)} ${join('assets/incoming', entry.dir).padEnd(26)} ` +
        `${entry.prefix}_001.png 〜 / 最低${entry.min}枚 ${entry.required ? '（必須）' : '（任意）'}`,
    );
  }
}

console.log('\n次はこの順で進めてください：');
console.log('  1. npm run assets:manifest   目録を作り直す');
console.log('  2. npm run assets:validate   仕様に合っているか調べる');
console.log('  3. npm run assets:gallery    並べて目で確かめる');
console.log('\n素材が足りないうちは、ゲームは PHASE 4.5 の SVG で描かれます（正常）。');
