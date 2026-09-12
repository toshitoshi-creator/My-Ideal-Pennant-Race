/**
 * 制作テンプレートの検査（§21・§22）。
 *
 *   npm run character:template:check
 *
 * 見るのは「テンプレートの決まりを守れているか」だけです。
 * 絵の good / bad は判定しません。そこはあなたが決めることです。
 *
 * 落ちる条件は、あとで必ず困るものだけに絞ってあります。
 * サイズ違い・viewBox違い・背景あり・外部参照・画像の埋め込み。
 * どれも「気づかないまま進むと、12枚を重ねた時点で破綻する」ものです。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  GUIDES,
  GUIDE_RANGES,
  LAYERS,
  fileNameOf,
  type GuideName,
} from './character/templateSpec';
import { checkSvg, hasDrawing } from './character/templateCheck';

const ROOT = fileURLToPath(new URL('../character-template', import.meta.url));

/* ================================================================
 * 実行
 * ============================================================== */

{
  console.log('\n=== 制作テンプレートの検査 ===\n');

  let errors = 0;
  let warns = 0;
  let missing = 0;
  let drawn = 0;

  // 基準線が §4 の範囲に収まっているか
  for (const [name, value] of Object.entries(GUIDES) as Array<[GuideName, number]>) {
    const [lo, hi] = GUIDE_RANGES[name];
    if (value < lo || value > hi) {
      console.log(`  × 基準線 ${name} = ${value} が §4 の範囲（${lo}〜${hi}）から外れています`);
      errors++;
    }
  }

  const files = ['GUIDE.svg', ...LAYERS.map(fileNameOf)];
  for (const file of files) {
    const path = join(ROOT, file);
    if (!existsSync(path)) {
      console.log(`  × ${file}  ファイルがありません`);
      missing++;
      errors++;
      continue;
    }
    const source = readFileSync(path, 'utf8');
    const findings = checkSvg(source, { isGuide: file === 'GUIDE.svg' });
    const isDrawn = hasDrawing(source);
    if (isDrawn && file !== 'GUIDE.svg') drawn++;

    const bad = findings.filter((f) => f.level === 'error').length;
    const mark = bad > 0 ? '×' : findings.length > 0 ? '△' : '○';
    const state = file === 'GUIDE.svg' ? '' : isDrawn ? '（描いてある）' : '（空）';
    console.log(`  ${mark} ${file.padEnd(20)}${state}`);
    for (const f of findings) {
      if (f.level === 'error') errors++;
      else warns++;
      console.log(`      ${f.level === 'error' ? '要修正' : '注意  '}: ${f.message}`);
    }
  }

  // 順番の確認（§5）
  const expected = LAYERS.map((l) => l.order).join(',');
  if (expected !== '1,2,3,4,5,6,7,8,9,10,11,12') {
    console.log('  × レイヤーの順番が 01〜12 になっていません');
    errors++;
  }

  console.log(`\n  ${files.length}枚 / 中身あり ${drawn}・12 / 要修正 ${errors}件 / 注意 ${warns}件`);
  if (missing > 0) console.log('  足りないファイルは npm run character:template で作れます');

  if (errors > 0) {
    console.log('\n=== 要修正があります ===\n');
    process.exit(1);
  }
  console.log('\n=== テンプレートの決まりは守れています ===');
  console.log('  npm run character:preview  で重ねて確認できます\n');
}
