/**
 * すでにある style-test の画像を、あとから検査しなおす（PHASE 4.7-A §15・§23）。
 *
 *   npm run assets:audit:style
 *
 * 生成はしません。assets/style-test/ に入っている PNG を読むだけです。
 * 検査の中身を直したあと、作り直さずに測りなおすために使います。
 *
 * これは**開発時にだけ動きます**。ゲーム実行時には1行も動きません。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, isPng } from './png.ts';
import { NEEDS_EYE, checkCharacter } from './character-quality.ts';

const DIR = join(process.cwd(), 'assets/style-test');

if (!existsSync(DIR)) {
  console.log(`${DIR} がありません。先に npm run assets:style-test を実行してください。`);
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((name) => name.toLowerCase().endsWith('.png'))
  .sort();

if (files.length === 0) {
  console.log('検査するものがありません。');
  process.exit(0);
}

console.log(`=== style-test の検査（${files.length}枚）===\n`);

const known = [];
const reports = [];
let bytes = 0;

for (const name of files) {
  const path = join(DIR, name);
  const raw = new Uint8Array(readFileSync(path));
  bytes += statSync(path).size;
  if (!isPng(raw)) {
    console.log(`  ❌ ${name}: PNG ではありません`);
    continue;
  }
  let image;
  try {
    image = decodePng(raw);
  } catch (error) {
    console.log(`  ❌ ${name}: 読めません（${error.message}）`);
    continue;
  }

  const report = checkCharacter({ id: name.replace(/\.png$/i, ''), image, known: [...known] });
  known.push(report.hash);
  reports.push(report);

  const fails = report.checks.filter((check) => check.level === 'FAIL');
  const warns = report.checks.filter((check) => check.level === 'WARN');
  const heads = report.metrics ? `${report.metrics.headsTall.toFixed(1)}頭身` : '頭身不明';
  const headShare = report.metrics
    ? ` / 頭の幅 ${((report.metrics.headWidth / image.width) * 100).toFixed(0)}%`
    : '';
  console.log(
    `  ${report.accepted ? '✅' : '❌'} ${report.id}: ${heads}${headShare} / ${(raw.length / 1024).toFixed(0)}KB`,
  );
  for (const check of fails) console.log(`       ✗ ${check.label}: ${check.detail}`);
  for (const check of warns) console.log(`       ! ${check.label}: ${check.detail}`);
}

const accepted = reports.filter((report) => report.accepted);
const heads = reports.map((report) => report.metrics?.headsTall ?? 0).filter((value) => value > 0);

console.log('\n── 報告（§23）──');
console.log(`  検査した枚数    ${reports.length}`);
console.log(`  採用枚数        ${accepted.length}`);
console.log(`  Reject枚数      ${reports.length - accepted.length}`);
console.log(`  素材容量        ${(bytes / 1024 / 1024).toFixed(1)}MB`);

const transparentOk = reports.filter((report) =>
  report.checks.some((check) => check.id === 'background-removable' && check.level === 'PASS'),
).length;
console.log(
  `  背景の処理可否  ${reports.length === 0 ? '-' : ((transparentOk / reports.length) * 100).toFixed(0)}%`,
);

const duplicates = reports.filter((report) =>
  report.checks.some((check) => check.id === 'duplicate' && check.level === 'FAIL'),
).length;
console.log(`  絵の重複        ${duplicates}件`);

if (heads.length > 0) {
  const avg = heads.reduce((a, b) => a + b, 0) / heads.length;
  console.log(
    `  頭身            平均 ${avg.toFixed(1)} / ${Math.min(...heads).toFixed(1)}〜${Math.max(...heads).toFixed(1)}`,
  );
}

console.log('\n── 目で見ないと分からないこと ──');
for (const item of NEEDS_EYE) console.log(`  ・${item}`);
