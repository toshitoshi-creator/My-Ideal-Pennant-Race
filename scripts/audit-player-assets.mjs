/**
 * PHASE 4.6 画像素材の目視確認シート（§29）。
 *
 *   npm run assets:audit [出力先]
 *
 * 機械では判断できない項目（顔の崩れ・目の左右差・手の崩れ・線の品質・
 * 背景の残り・透かし・文字・ロゴ・他人物の混入）を人が確かめるための一覧を出す。
 *
 * AI生成画像を無条件で採用してはいけない。ここで必ず1点ずつ目で見る。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONFIG = JSON.parse(readFileSync('config/visual-assets.json', 'utf8'));
const ROOT = 'src/assets/players';
const MANIFEST = join(ROOT, 'manifest.json');
const OUT = process.argv[2] ?? 'asset-audit.html';

const CHECKS = [
  '顔の崩れが無い',
  '目の左右差が無い',
  '手・指の崩れが無い',
  '装備の崩れが無い',
  '線の太さが他のパーツとそろっている',
  '背景が残っていない',
  '透かし・文字・ロゴが無い',
  '他の人物が写り込んでいない',
  '床の影が入っていない',
  '透明部分が欠けていない',
];

if (!existsSync(MANIFEST)) {
  console.error(`${MANIFEST} がありません。先に npm run assets:manifest を実行してください`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const entries = [];
for (const [categoryId, list] of Object.entries(manifest.parts ?? {})) {
  for (const entry of list) {
    entries.push({ categoryId, ...entry });
  }
}

const rows = entries
  .map((entry) => {
    const src = relative('.', join(ROOT, entry.path ?? ''));
    return `<tr>
      <td class="thumb"><img src="${src}" alt="${entry.id}" loading="lazy"></td>
      <td>
        <strong>${entry.id}</strong><br>
        <span class="dim">${entry.categoryId} / ${entry.width}x${entry.height} / ${Math.round((entry.bytes ?? 0) / 1024)}KB</span>
      </td>
      ${CHECKS.map(() => '<td class="check"><input type="checkbox"></td>').join('')}
    </tr>`;
  })
  .join('\n');

const summary =
  entries.length === 0
    ? '<p class="empty">画像素材はまだありません。<br>' +
      '外部の画像生成AIで <code>assets/prompts/</code> のプロンプトを使って素材を作り、' +
      '<code>src/assets/players/</code> に置いてから <code>npm run assets:manifest</code> を実行してください。</p>'
    : `<p>${entries.length}点。1点ずつ目で見て、問題があれば作り直してください。</p>`;

writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>選手ビジュアル素材の目視確認</title>
<style>
  body{font-family:system-ui;background:#f6f4ef;color:#22252b;padding:20px;font-size:13px}
  h1{font-size:18px;margin:0 0 4px}
  .dim{color:#6b7079;font-size:11px}
  .empty{background:#fff;border:1px solid #ddd;padding:16px;line-height:1.9}
  table{border-collapse:collapse;background:#fff;margin-top:12px}
  th,td{border:1px solid #e2e0da;padding:6px 8px;text-align:left;vertical-align:middle}
  th{font-size:11px;writing-mode:vertical-rl;white-space:nowrap;background:#efece5}
  th:first-child,th:nth-child(2){writing-mode:horizontal-tb}
  .thumb img{width:88px;height:110px;object-fit:contain;background:
    repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 50%/16px 16px}
  .check{text-align:center}
  code{background:#efece5;padding:1px 4px}
</style>
<h1>選手ビジュアル素材の目視確認</h1>
<p class="dim">キャンバス ${CONFIG.canvas.width}x${CONFIG.canvas.height} / 生成AIの出力を無条件で採用しないこと（§29）</p>
${summary}
${entries.length ? `<table>
  <tr><th>画像</th><th>素材</th>${CHECKS.map((c) => `<th>${c}</th>`).join('')}</tr>
  ${rows}
</table>` : ''}
`,
);
console.log(`${OUT} を書き出しました（${entries.length}点）`);
if (entries.length === 0) {
  console.log('  素材がまだ無いため、確認表は空です。');
}
