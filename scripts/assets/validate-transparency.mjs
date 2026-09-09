/**
 * 透明PNGとしての検査（PHASE 4.7 追補）。
 *
 *   npm run assets:validate
 *   npm run assets:validate -- --stage cutout    … 背景除去の直後を見る
 *   npm run assets:validate -- --json
 *
 * 見るのは src/assets/players/（ゲームに入るもの）。
 * FAIL が1件でもあれば終了コード1。**透明PNG以外は production に採用しない。**
 *
 * 検査する項目:
 *   PNGである / 壊れたPNGではない / alpha channelが存在する / 四隅が透明 /
 *   背景色が残っていない / 白い縁取りがない / 灰色の縁取りがない /
 *   半透明の背景ハローがない / 人物がキャンバス外にはみ出していない /
 *   bounding boxが極端に小さくない / 大きくない / 基準点が仕様どおり /
 *   1024×1280 / ファイルサイズ上限以内
 *
 * これは**開発時にだけ動く**。ゲーム実行時には1行も動かない。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, catalogEntry, isCatalogId } from './catalog.ts';
import { decodePng, isPng } from './png.ts';
import { checkTransparency, MAX_FILE_BYTES } from './transparency.ts';

const ROOT = process.cwd();
const STAGES = {
  production: { dir: join(ROOT, 'src/assets/players'), normalized: true, label: 'ゲームに入る素材' },
  cutout: { dir: join(ROOT, 'assets/cutout'), normalized: false, label: '背景除去の直後' },
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

const stageName = value('stage', 'production');
const stage = STAGES[stageName];
if (!stage) {
  console.error(`知らない段階です: ${stageName}（production か cutout）`);
  process.exit(2);
}
const wantedType = value('type', 'all');
const asJson = flag('json');

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

const reports = [];

for (const entry of categories()) {
  const dir = join(stage.dir, entry.dir);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(
    (name) =>
      name.toLowerCase().endsWith('.png') &&
      name.startsWith(`${entry.prefix}_`) &&
      // 派生サイズは元と同じ素材なので、代表の1枚だけを見る
      !name.includes('@'),
  );
  for (const name of files.sort()) {
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    let image = null;
    let decodeError;
    if (isPng(bytes)) {
      try {
        image = decodePng(bytes);
      } catch (error) {
        decodeError = error.message;
      }
    }
    reports.push(
      checkTransparency({
        id: name.replace(/\.png$/i, ''),
        image,
        bytes,
        category: entry.id,
        normalized: stage.normalized,
        ...(decodeError === undefined ? {} : { decodeError }),
      }),
    );
  }
}

if (asJson) {
  const out = join(ROOT, 'assets/state');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'transparency.json'),
    JSON.stringify({ stage: stageName, reports }, null, 2),
  );
  console.log(`assets/state/transparency.json に書き出しました（${reports.length}件）`);
}

console.log(`=== 透明PNGの検査（${stage.label}）===\n`);

if (reports.length === 0) {
  console.log('  検査できる素材がまだありません。');
  console.log('  ゲームは PHASE 4.5 の SVG で選手を描きます（正常）。');
  console.log(`\n  ファイルサイズの上限: ${(MAX_FILE_BYTES / 1024).toFixed(0)} KB`);
  console.log('\n=== PASS（素材0点。ゲームは動きます）===');
  process.exit(0);
}

let failures = 0;
let warnings = 0;

for (const report of reports) {
  if (report.ok && report.warnings === 0) continue;
  const mark = report.ok ? '⚠️ ' : '❌';
  console.log(`${mark} ${report.id}`);
  for (const check of report.checks) {
    if (check.level === 'PASS') continue;
    console.log(`     ${check.level} ${check.label}: ${check.detail}`);
  }
  failures += report.failures;
  warnings += report.warnings;
}

const passed = reports.filter((report) => report.ok).length;
console.log();
console.log(`  検査した素材: ${reports.length}点`);
console.log(`  透明PNGとして合格: ${passed}点 / 不合格: ${reports.length - passed}点`);
console.log(`  FAIL ${failures}件 / WARN ${warnings}件`);

/* ---- 項目ごとの内訳 ---- */
const byCheck = new Map();
for (const report of reports) {
  for (const check of report.checks) {
    const row = byCheck.get(check.id) ?? { label: check.label, pass: 0, warn: 0, fail: 0 };
    if (check.level === 'PASS') row.pass += 1;
    else if (check.level === 'WARN') row.warn += 1;
    else row.fail += 1;
    byCheck.set(check.id, row);
  }
}
console.log('\n  項目ごとの内訳:');
for (const [, row] of byCheck) {
  const mark = row.fail > 0 ? '❌' : row.warn > 0 ? '⚠️ ' : '✅';
  console.log(`    ${mark} ${row.label.padEnd(30)} PASS ${row.pass} / WARN ${row.warn} / FAIL ${row.fail}`);
}

console.log();
if (failures > 0) {
  console.log('=== FAIL（透明PNGでない素材があります。production には採用できません）===');
  process.exit(1);
}
console.log(warnings > 0 ? '=== PASS（警告あり）===' : '=== PASS ===');
