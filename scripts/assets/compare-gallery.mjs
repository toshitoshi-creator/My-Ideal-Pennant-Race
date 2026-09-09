/**
 * 3段階の見比べ（元画像 → 背景除去後 → 1024x1280 正規化後）。
 *
 *   npm run assets:compare
 *   npm run assets:compare -- --out compare.html
 *
 * まず3枚だけ作って、この1枚で品質を確かめてから量産する（§いきなり大量生成しない）。
 *
 * 見るところ:
 *   ・背景が本当に抜けているか（市松の下地が透けて見えるか）
 *   ・白い縁・灰色の縁が残っていないか
 *   ・髪の毛の細いところが溶けていないか
 *   ・正規化で基準点に乗っているか
 *
 * これは開発時の資料で、ゲームには入らない。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from './catalog.ts';
import { decodePng, isPng } from './png.ts';
import { contentBounds, estimateBackground, inspectFringe } from './pipeline.ts';
import { checkTransparency } from './transparency.ts';
import { ANCHORS, CANVAS_HEIGHT, CANVAS_WIDTH } from './anchors.ts';

const ROOT = process.cwd();
const DIRS = {
  original: join(ROOT, 'assets/original'),
  cutout: join(ROOT, 'assets/cutout'),
  production: join(ROOT, 'src/assets/players'),
};

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const OUT = value('out', 'assets-compare.html');
const LIMIT = Number(value('limit', 12));

const esc = (text) =>
  String(text).replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );

const dataUri = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

/* ---- どの素材があるかを集める ---- */
const rows = [];
for (const entry of CATALOG) {
  if (entry.kind !== 'image') continue;
  const originalDir = join(DIRS.original, entry.dir);
  if (!existsSync(originalDir)) continue;
  const files = readdirSync(originalDir).filter(
    (name) => name.startsWith(`${entry.prefix}_`) && name.toLowerCase().endsWith('.png'),
  );
  for (const name of files.sort()) {
    if (rows.length >= LIMIT) break;
    rows.push({ entry, name, id: name.replace(/\.png$/i, '') });
  }
}

if (rows.length === 0) {
  console.log('見比べる素材がありません。');
  console.log('先に npm run assets:generate -- --count 3 で3枚だけ作ってください。');
  process.exit(0);
}

/* ---- 1行ぶんを作る ---- */
function cell(label, path, note) {
  if (!path || !existsSync(path)) {
    return `<td class="miss"><div class="label">${esc(label)}</div><div class="none">まだありません</div></td>`;
  }
  return `<td>
    <div class="label">${esc(label)}</div>
    <div class="frame"><img src="${dataUri(path)}" alt=""></div>
    <div class="note">${note ?? ''}</div>
  </td>`;
}

function measure(path, category, normalized) {
  if (!path || !existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  if (!isPng(bytes)) return { error: 'PNG ではありません' };
  let image;
  try {
    image = decodePng(bytes);
  } catch (error) {
    return { error: error.message };
  }
  const bounds = contentBounds(image);
  const fringe = inspectFringe(image);
  const estimate = estimateBackground(image);
  const report = checkTransparency({ id: '', image, bytes, category, normalized });
  return { image, bounds, fringe, estimate, report, bytes };
}

const body = rows
  .map(({ entry, name, id }) => {
    const originalPath = join(DIRS.original, entry.dir, name);
    const cutoutPath = join(DIRS.cutout, entry.dir, name);
    const productionPath = join(DIRS.production, entry.dir, name);

    const a = measure(originalPath, entry.id, false);
    const b = measure(cutoutPath, entry.id, false);
    const c = measure(productionPath, entry.id, true);

    const noteA = a?.image
      ? `${a.image.width}x${a.image.height}<br>下地 rgb(${a.estimate.color.join(',')}) 一様さ ${(
          a.estimate.uniformity * 100
        ).toFixed(0)}%`
      : '';
    const noteB = b?.image
      ? `${b.image.width}x${b.image.height}<br>中身 ${b.bounds.width}x${b.bounds.height}<br>白縁 ${(
          b.fringe.whiteRatio * 100
        ).toFixed(0)}% 灰縁 ${(b.fringe.greyRatio * 100).toFixed(0)}%`
      : '';
    const noteC = c?.image
      ? `${c.image.width}x${c.image.height}<br>中心 (${(
          (c.bounds.left + c.bounds.right) / 2
        ).toFixed(0)}, ${((c.bounds.top + c.bounds.bottom) / 2).toFixed(0)})<br>基準点 (${
          ANCHORS[entry.id].x
        }, ${ANCHORS[entry.id].y})`
      : '';

    const verdict = c?.report
      ? c.report.ok
        ? `<span class="ok">透明PNGとして合格${c.report.warnings > 0 ? `（警告 ${c.report.warnings}件）` : ''}</span>`
        : `<span class="ng">不合格: ${esc(
            c.report.checks.filter((check) => check.level === 'FAIL').map((check) => check.label).join(' / '),
          )}</span>`
      : '<span class="dim">まだ正規化されていません</span>';

    return `<tr class="head"><th colspan="3">${esc(id)}　<span class="dim">${esc(entry.id)}</span>　${verdict}</th></tr>
      <tr>
        ${cell('1. 生成したまま（背景あり）', originalPath, noteA)}
        ${cell('2. 背景除去後', cutoutPath, noteB)}
        ${cell('3. 1024×1280 正規化後', productionPath, noteC)}
      </tr>`;
  })
  .join('');

const css = existsSync('src/styles.css') ? readFileSync('src/styles.css', 'utf8') : '';

writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>背景除去の見比べ（${rows.length}件）</title>
<style>${css}
 body{background:var(--paper,#f5f3ee);color:var(--ink,#1b1a17);font-family:system-ui;padding:20px;margin:0}
 h1{font-size:19px;margin:0 0 4px}
 .lead{color:var(--text-dim,#6b6862);font-size:12px;margin:0 0 16px;max-width:760px;line-height:1.7}
 table{border-collapse:collapse;width:100%}
 td{vertical-align:top;padding:8px;width:33.33%}
 tr.head th{text-align:left;font-size:13px;padding:18px 8px 4px;border-top:1px solid var(--paper-edge,#ddd8cc)}
 .label{font-size:11px;color:var(--text-dim,#6b6862);margin-bottom:6px}
 .note{font-size:11px;color:var(--text-dim,#6b6862);margin-top:6px;line-height:1.6}
 .none{font-size:12px;color:var(--text-dim,#6b6862);padding:30px 0}
 /* 市松の下地。ここが透けて見えれば、背景は本当に抜けている */
 .frame{background-image:linear-gradient(45deg,#d9d4c8 25%,transparent 25%),linear-gradient(-45deg,#d9d4c8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d9d4c8 75%),linear-gradient(-45deg,transparent 75%,#d9d4c8 75%);
   background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;
   border:1px solid var(--paper-edge,#ddd8cc);display:inline-block;line-height:0}
 .frame img{max-width:230px;max-height:290px;display:block}
 .ok{color:#2f6b46;font-weight:700;font-size:12px}
 .ng{color:#a4442c;font-weight:700;font-size:12px}
 .dim{color:var(--text-dim,#6b6862);font-weight:400}
</style>
<h1>背景除去の見比べ（${rows.length}件）</h1>
<p class="lead">
 fal-ai/flux/dev は透明背景を出せません。単色の下地を描かせて、ここで抜いています。<br>
 <strong>2列目と3列目で、市松模様の下地が透けて見えていれば背景は抜けています。</strong>
 白や灰色の縁が残っていないか、髪の細いところが溶けていないか、
 3列目で基準点に乗っているかを見てください。<br>
 キャンバスは ${CANVAS_WIDTH}×${CANVAS_HEIGHT}。ここで品質を確かめてから量産してください。
</p>
<table>${body}</table>`,
);

console.log(`${OUT} を書き出しました（${rows.length}件）`);
for (const { entry, name } of rows.slice(0, 3)) {
  console.log(`  ${entry.id}: ${name}`);
}
console.log('\nブラウザで開いて、市松の下地が透けて見えることを確かめてください。');
