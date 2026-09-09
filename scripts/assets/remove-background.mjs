/**
 * 背景除去（fal-ai/flux/dev の出力を透明PNGにする）。
 *
 *   npm run assets:remove-background
 *   npm run assets:remove-background -- --type hair_style
 *   npm run assets:remove-background -- --force
 *
 * 読む:   assets/original/<dir>/<id>.png   … 生成したままの絵（背景あり）
 * 書く:   assets/cutout/<dir>/<id>.png     … 背景を抜いた絵（透明・未正規化）
 *
 * FLUX には透明背景を出す機能がないので、
 * 「transparent background」というプロンプトには一切頼らない。
 * 単色の下地を描かせておき、ここで機械的に抜く。
 *
 *   背景色を見立てる
 *     → 端からつながる背景を抜く（囲まれた同色は残す）
 *     → 縁に残った背景色を引き算する（白・灰色のハロー除去）
 *     → うっすら残った膜を落とす
 *     → 半端なアルファを整える
 *
 * これは**開発時にだけ動く**。ゲーム実行時には1行も動かない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CATALOG, catalogEntry, isCatalogId } from './catalog.ts';
import { decodePng, encodePng, isPng } from './png.ts';
import { cutout, estimateBackground, inspectFringe, contentBounds } from './pipeline.ts';

const ROOT = process.cwd();
const FROM = join(ROOT, 'assets/original');
const TO = join(ROOT, 'assets/cutout');

/* ---- 引数 ---- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

const wantedType = value('type', 'all');
const force = flag('force');
const inner = Number(value('inner', 26));
const outer = Number(value('outer', 76));

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

console.log('=== 背景除去（単色の下地を抜いて透明PNGにする）===\n');

if (!existsSync(FROM)) {
  console.log('assets/original/ がありません。');
  console.log('先に npm run assets:generate で生成するか、手元の PNG を置いてください。');
  console.log('\n=== 対象0件（何もしていません）===');
  process.exit(0);
}

let done = 0;
let skipped = 0;
let failed = 0;

for (const entry of categories()) {
  const from = join(FROM, entry.dir);
  if (!existsSync(from)) continue;
  const files = readdirSync(from).filter(
    (name) => name.startsWith(`${entry.prefix}_`) && name.toLowerCase().endsWith('.png'),
  );
  if (files.length === 0) continue;

  console.log(`── ${entry.id}（${files.length}枚）──`);
  for (const name of files.sort()) {
    const source = join(from, name);
    const target = join(TO, entry.dir, name);

    if (!force && existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
      console.log(`  ⏭ ${name}: すでに抜いてあります（--force で作り直せます）`);
      skipped += 1;
      continue;
    }

    const bytes = new Uint8Array(readFileSync(source));
    if (!isPng(bytes)) {
      console.log(`  ❌ ${name}: PNG ではありません（output_format=png で生成してください）`);
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

    const before = estimateBackground(image);
    const result = cutout(image, { inner, outer });
    const fringe = inspectFringe(result.image);
    const bounds = contentBounds(result.image);

    if (bounds.empty) {
      console.log(`  ❌ ${name}: 抜いたら何も残りませんでした（背景と人物の色が近すぎます）`);
      failed += 1;
      continue;
    }

    const size = save(target, result.image);
    console.log(
      `  ✅ ${name}: 背景 rgb(${result.background.join(',')}) 一様さ ${(
        before.uniformity * 100
      ).toFixed(0)}% → 中身 ${bounds.width}x${bounds.height} / 白縁 ${(
        fringe.whiteRatio * 100
      ).toFixed(0)}% 灰縁 ${(fringe.greyRatio * 100).toFixed(0)}% / ${(size / 1024).toFixed(0)}KB`,
    );
    if (before.uniformity < 0.5) {
      console.log(
        `     ⚠️ 下地が一様ではありません。プロンプトの背景指定が効いていない可能性があります`,
      );
    }
    done += 1;
  }
  console.log();
}

console.log(`=== 背景除去: ${done}枚 / 見送り ${skipped}枚 / 失敗 ${failed}枚 ===`);
if (done + skipped === 0) {
  console.log('抜く対象がありませんでした。');
} else {
  console.log('次は npm run assets:normalize を実行してください。');
}
process.exit(failed > 0 ? 1 : 0);
