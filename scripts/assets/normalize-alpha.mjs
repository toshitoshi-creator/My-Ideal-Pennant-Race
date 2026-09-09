/**
 * アルファの正規化と基準キャンバスへの配置。
 *
 *   npm run assets:normalize
 *   npm run assets:normalize -- --type hair_style
 *
 * 読む:   assets/cutout/<dir>/<id>.png       … 背景を抜いた絵（未正規化）
 * 書く:   src/assets/players/<dir>/<id>.png  … ゲームに入る絵（1024x1280）
 *         同 <id>@small/@medium/@large.png   … 派生サイズ
 *         同 <id>cNN.png                     … 髪色・肌色の振り分け
 *
 * やること:
 *   半端なアルファを整える
 *     → 人物の範囲（bounding box）を求める
 *     → 大きさをそろえる
 *     → 種類ごとの基準点へ置く
 *     → 1024x1280 の基準キャンバスへ配置
 *     → 透明PNGとして保存
 *
 * これは**開発時にだけ動く**。ゲーム実行時には1行も動かない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CATALOG, catalogEntry, isCatalogId } from './catalog.ts';
import { decodePng, encodePng, isPng } from './png.ts';
import {
  cleanAlpha,
  contentBounds,
  derivatives,
  fitToCanvas,
  looksTransparent,
  recolor,
  trimHalo,
  HAIR_RAMPS,
  SKIN_RAMPS,
} from './pipeline.ts';
import { ANCHORS, CANVAS_WIDTH, OUTPUT_SIZES } from './anchors.ts';

const ROOT = process.cwd();
const FROM = join(ROOT, 'assets/cutout');
const TO = join(ROOT, 'src/assets/players');

/** 種類ごとに、中身の幅をどこにそろえるか */
const TARGET_WIDTH = {
  head_shape: 536,
  hair_style: 560,
  hair_back: 600,
  eyebrow: 320,
  eyes: 300,
  nose: 120,
  mouth: 190,
  ears: 560,
  jaw_cheeks: 460,
  facial_hair: 330,
  expression: 340,
  body_type: 552,
  neck: 150,
  uniform: 600,
  cap: 520,
  accessory: 360,
  pose: 640,
  special_state: 240,
};

/** 肌の色を振り分ける種類 */
const SKIN_PARTS = new Set(['head_shape', 'ears', 'neck', 'jaw_cheeks', 'body_type']);

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const wantedType = value('type', 'all');
const noColors = flag('no-colors');

function categories() {
  if (wantedType === 'all') return CATALOG.filter((entry) => entry.kind === 'image');
  const out = [];
  for (const part of wantedType.split(',').map((s) => s.trim())) {
    if (!isCatalogId(part)) {
      console.error(`知らない種類です: ${part}`);
      process.exit(2);
    }
    const entry = catalogEntry(part);
    if (entry.kind === 'image') out.push(entry);
  }
  return out;
}

const save = (path, image) => {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodePng(image, (raw) => new Uint8Array(deflateSync(Buffer.from(raw), { level: 9 })));
  writeFileSync(path, bytes);
  return bytes.length;
};

console.log('=== 正規化（基準点合わせ → 1024x1280 → 派生サイズ・色違い）===\n');

if (!existsSync(FROM)) {
  console.log('assets/cutout/ がありません。');
  console.log('先に npm run assets:remove-background を実行してください。');
  console.log('\n=== 対象0件（何もしていません）===');
  process.exit(0);
}

let done = 0;
let failed = 0;
let variants = 0;

for (const entry of categories()) {
  const from = join(FROM, entry.dir);
  if (!existsSync(from)) continue;
  const files = readdirSync(from).filter(
    (name) => name.startsWith(`${entry.prefix}_`) && name.toLowerCase().endsWith('.png'),
  );
  if (files.length === 0) continue;

  console.log(`── ${entry.id}（${files.length}枚）──`);
  for (const name of files.sort()) {
    const id = name.replace(/\.png$/i, '');
    const bytes = new Uint8Array(readFileSync(join(from, name)));
    if (!isPng(bytes)) {
      console.log(`  ❌ ${name}: PNG ではありません`);
      failed += 1;
      continue;
    }

    let image;
    try {
      image = decodePng(bytes);
    } catch (error) {
      console.log(`  ❌ ${name}: 読めません（${error.message}）`);
      failed += 1;
      continue;
    }

    // 背景が抜けていないものは、ここで止める（production に入れない）
    if (!looksTransparent(image)) {
      console.log(`  ❌ ${name}: 背景が抜けていません。先に assets:remove-background を通してください`);
      failed += 1;
      continue;
    }

    // アルファを整えてから配置する
    image = cleanAlpha(trimHalo(image));
    const bounds = contentBounds(image);
    if (bounds.empty) {
      console.log(`  ❌ ${name}: 中身がありません`);
      failed += 1;
      continue;
    }

    const placed = fitToCanvas(image, {
      anchor: ANCHORS[entry.id],
      ...(TARGET_WIDTH[entry.id] === undefined ? {} : { targetWidth: TARGET_WIDTH[entry.id] }),
    });

    const base = join(TO, entry.dir);
    const size = save(join(base, `${id}.png`), placed);
    for (const [label, width] of Object.entries(OUTPUT_SIZES)) {
      if (width >= CANVAS_WIDTH) continue;
      save(join(base, `${id}@${label}.png`), derivatives(placed, [width]).get(width));
    }

    // 髪色・肌色の振り分け（形は1つ、色は後処理で増やす）
    let made = 0;
    if (!noColors) {
      const ramps = entry.id === 'hair_style' || entry.id === 'hair_back'
        ? HAIR_RAMPS
        : SKIN_PARTS.has(entry.id)
          ? SKIN_RAMPS
          : null;
      if (ramps) {
        for (let i = 0; i < ramps.length; i++) {
          const tinted = recolor(placed, ramps[i].dark, ramps[i].light);
          save(join(base, `${id}c${String(i + 1).padStart(2, '0')}.png`), tinted);
          made += 1;
        }
      }
    }
    variants += made;

    const placedBounds = contentBounds(placed);
    console.log(
      `  ✅ ${id}: ${bounds.width}x${bounds.height} → 中心 (${(
        (placedBounds.left + placedBounds.right) / 2
      ).toFixed(0)}, ${((placedBounds.top + placedBounds.bottom) / 2).toFixed(0)}) ` +
        `基準点 (${ANCHORS[entry.id].x}, ${ANCHORS[entry.id].y}) / ${(size / 1024).toFixed(0)}KB` +
        (made > 0 ? ` / 色違い ${made}点` : ''),
    );
    done += 1;
  }
  console.log();
}

console.log(`=== 正規化: ${done}枚（色違い ${variants}点）/ 失敗 ${failed}枚 ===`);
if (done === 0) {
  console.log('正規化する対象がありませんでした。');
} else {
  console.log('次は npm run assets:validate を実行してください。');
}
process.exit(failed > 0 ? 1 : 0);
