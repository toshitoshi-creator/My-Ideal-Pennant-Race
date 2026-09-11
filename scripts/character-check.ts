/**
 * PHASE 4.8-B 描いたSVGを検査する（§6・§9）。
 *
 *   npm run character:check            すべて
 *   npm run character:check -- --file <path>   1枚だけ（取り込む前の下見）
 *
 * 見るのは「ゲームに入れて壊れないか」だけです。
 * 絵の good / bad は判定しません。そこはあなたが決めることです。
 *
 * 落ちる条件は、実際に PHASE 4.8-A で壊した経験から決めています。
 * 固定の座標・固定の色・外部参照の3つが、壊れかたのほぼ全部でした。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHARACTER_HEIGHT,
  CHARACTER_WIDTH,
  MIN_STROKE,
} from '../src/ui/character/coordinates';
import {
  COLOR_TOKENS,
  TOKEN_PREFIX,
  parseSvgPart,
  usedTokens,
} from '../src/ui/character/svgPart';
import type { ParsedSvgPart } from '../src/ui/character/svgPart';
import { CHARACTER_PART_CATEGORIES } from '../src/ui/character/types';
import { builtInCount } from '../src/ui/character/registry';
import { loadCustomFiles } from './character/loadCustom';

interface Finding {
  level: 'error' | 'warn';
  message: string;
}

const NAME_PATTERN = /^[a-z][a-zA-Z]*_\d{2,3}$/;

/** 描いてよい図形だけ。ほかは描画ソフトの余りものであることが多い */
const ALLOWED_ELEMENTS = new Set([
  'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'clippath',
]);

function elementsIn(markup: string): string[] {
  const found = new Set<string>();
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) found.add(m[1].toLowerCase());
  return [...found];
}

/** 座標がキャンバスから大きく外れていないか */
function outOfBounds(markup: string): number[] {
  const bad: number[] = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  // 余白を少し許す。線の太さの分だけ枠から出ることがあるため
  const margin = 24;
  while ((m = re.exec(markup)) !== null) {
    const value = Number(m[0]);
    if (value < -margin || value > Math.max(CHARACTER_WIDTH, CHARACTER_HEIGHT) + margin) {
      bad.push(value);
    }
  }
  return [...new Set(bad)];
}

/** 固定の色が書かれていないか */
function hardCodedColors(markup: string): string[] {
  const found = new Set<string>();
  const re = /(?:fill|stroke)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const value = m[1].trim();
    if (value === 'none' || value === 'transparent') continue;
    if (value.startsWith(TOKEN_PREFIX)) continue;
    found.add(value);
  }
  return [...found];
}

/** 細すぎる線が無いか。小さく表示したときに消える */
function thinStrokes(markup: string): number[] {
  const bad: number[] = [];
  const re = /stroke-width\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const value = Number(m[1]);
    if (Number.isFinite(value) && value < MIN_STROKE) bad.push(value);
  }
  return [...new Set(bad)];
}

function checkParsed(parsed: ParsedSvgPart, folder: string | null): Finding[] {
  const out: Finding[] = [];
  const { id, category, body } = parsed;

  if (!NAME_PATTERN.test(id)) {
    out.push({
      level: 'error',
      message: `名前 "${id}" が規格に合いません（例 ${category}_06 / NAMING.md を見てください）`,
    });
  }
  if (!(CHARACTER_PART_CATEGORIES as readonly string[]).includes(category)) {
    out.push({ level: 'error', message: `種類 "${category}" は使えません` });
  }
  if (folder && folder !== category) {
    out.push({ level: 'error', message: `フォルダ（${folder}）と data-category（${category}）が違います` });
  }
  if (body.replace(/<!--[\s\S]*?-->/g, '').trim() === '') {
    out.push({ level: 'error', message: '中身が空です（テンプレートのまま保存されています）' });
  }

  const unknown = elementsIn(body).filter((name) => !ALLOWED_ELEMENTS.has(name));
  if (unknown.length > 0) {
    out.push({ level: 'error', message: `使えない要素が入っています: ${unknown.join(', ')}` });
  }

  const colors = hardCodedColors(body);
  if (colors.length > 0) {
    out.push({
      level: 'error',
      message:
        `色が直に書かれています: ${colors.join(', ')}\n` +
        `        肌の色は選手ごとに違うので、名前で書いてください（例 fill="${TOKEN_PREFIX}skin"）`,
    });
  }

  const tokens = usedTokens(body);
  const badTokens = tokens.filter((t) => !(COLOR_TOKENS as readonly string[]).includes(t));
  if (badTokens.length > 0) {
    out.push({ level: 'error', message: `知らない色の名前です: ${badTokens.join(', ')}` });
  }
  if (tokens.length === 0) {
    out.push({ level: 'warn', message: '色の名前が1つも使われていません（塗りが none だけ？）' });
  }

  const far = outOfBounds(body);
  if (far.length > 0) {
    out.push({
      level: 'warn',
      message: `枠の外の座標があります: ${far.slice(0, 6).join(', ')}${far.length > 6 ? ' …' : ''}`,
    });
  }

  const thin = thinStrokes(body);
  if (thin.length > 0) {
    out.push({
      level: 'warn',
      message: `線が細すぎます（${thin.join(', ')}）。小さく表示すると消えます。${MIN_STROKE} 以上にしてください`,
    });
  }

  if (category === 'head') {
    if (parsed.halfWidth === undefined) {
      out.push({
        level: 'error',
        message: '頭には data-half-width が必要です（この頭の輪郭の半幅。髪・耳・帽子がこれを見ます）',
      });
    } else if (parsed.halfWidth < 30 || parsed.halfWidth > 90) {
      out.push({ level: 'warn', message: `data-half-width=${parsed.halfWidth} は極端です（40〜75 が目安）` });
    }
  } else if (parsed.halfWidth !== undefined) {
    out.push({ level: 'warn', message: 'data-half-width は頭だけが持てます（無視されます）' });
  }

  return out;
}

/* ================================================================
 * 実行
 * ============================================================== */

const fileArgIndex = process.argv.indexOf('--file');
const single = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : null;

interface Row {
  name: string;
  findings: Finding[];
  ok: boolean;
}

const rows: Row[] = [];

if (single) {
  const path = resolve(single);
  if (!existsSync(path)) {
    console.error(`\n  ファイルがありません: ${single}\n`);
    process.exit(1);
  }
  const source = readFileSync(path, 'utf8');
  const parsed = parseSvgPart(source);
  if ('error' in parsed) {
    rows.push({ name: single, findings: [{ level: 'error', message: parsed.error }], ok: false });
  } else {
    const findings = checkParsed(parsed, null);
    rows.push({ name: single, findings, ok: !findings.some((f) => f.level === 'error') });
  }
} else {
  for (const file of loadCustomFiles()) {
    if (file.error) {
      rows.push({ name: file.key, findings: [{ level: 'error', message: file.error }], ok: false });
      continue;
    }
    const findings = checkParsed(file.parsed!, file.folder);
    rows.push({ name: file.key, findings, ok: !findings.some((f) => f.level === 'error') });
  }
}

console.log('\n=== 自作パーツの検査（PHASE 4.8-B）===\n');

if (rows.length === 0) {
  console.log('  src/ui/character/custom/ に SVG がまだありません。\n');
  console.log('  はじめかた:');
  console.log('    1. npm run character:template   下書きを作る');
  console.log('    2. character-template/templates/ の中から1枚開いて描く');
  console.log('    3. src/ui/character/custom/<種類>/ に置く');
  console.log('    4. npm run character:check      もう一度ここへ戻る\n');
  console.log(`  はじめから入っているパーツ: 頭${builtInCount('head')} / 体${builtInCount('body')} / ` +
    `髪${builtInCount('hairFront')} / 目${builtInCount('eye')} / 帽子${builtInCount('cap')}\n`);
  process.exit(0);
}

let errors = 0;
let warns = 0;
for (const row of rows) {
  const mark = row.ok ? (row.findings.length > 0 ? '△' : '○') : '×';
  console.log(`  ${mark} ${row.name}`);
  for (const finding of row.findings) {
    if (finding.level === 'error') errors++;
    else warns++;
    console.log(`      ${finding.level === 'error' ? '要修正' : '注意  '}: ${finding.message}`);
  }
}

console.log(`\n  ${rows.length}枚 / 要修正 ${errors}件 / 注意 ${warns}件`);
if (errors > 0) {
  console.log('\n=== 要修正があります。直してからもう一度 ===\n');
  process.exit(1);
}
console.log('\n=== 取り込めます ===');
console.log('  npm run character:workshop  で実際のキャラクターに載せて見られます\n');
