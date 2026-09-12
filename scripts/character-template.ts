/**
 * CHARACTER CREATION TEMPLATE を書き出す（§8・§20）。
 *
 *   npm run character:template            まだ無いものだけ作る
 *   npm run character:template -- --force 空のものを作り直す
 *
 * 作るのは **空の枠と目印だけ** です。絵は入っていません（§1・§23）。
 * 中身はあなたが描きます。
 *
 * すでに描かれているファイルは **絶対に上書きしません**。
 * --force を付けても、中身があるものはそのまま残します。
 * 作った絵が消えるのがいちばん困るので、そこは機械的に止めています。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  CENTER_X,
  GUIDES,
  HEIGHT,
  LAYERS,
  VIEW_BOX,
  WIDTH,
  fileNameOf,
  groupIdOf,
  type LayerSpec,
} from './character/templateSpec';

const ROOT = fileURLToPath(new URL('../character-template', import.meta.url));
const FORCE = process.argv.includes('--force');

const GUIDE_COLOR = '#e0245e';
const CENTER_COLOR = '#1d9bf0';
const FAINT = '#b9b5ae';

/* ================================================================
 * GUIDE.svg（§8）
 * ============================================================== */

function guideSvg(): string {
  const lines = (Object.entries(GUIDES) as Array<[string, number]>)
    .map(
      ([name, y]) =>
        `    <line x1="0" y1="${y}" x2="${WIDTH}" y2="${y}" stroke="${GUIDE_COLOR}" stroke-width="0.8" opacity="0.85"/>\n` +
        `    <text x="3" y="${y - 3}" fill="${GUIDE_COLOR}" font-size="7" font-family="sans-serif">${name} ${y}</text>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  GUIDE（制作用の目印）

  **ゲーム本体では使いません**（§8）。
  12枚を描くときに位置を合わせるためだけのものです。

  CENTER_X = ${CENTER_X}
${(Object.entries(GUIDES) as Array<[string, number]>).map(([n, v]) => `  ${n} = ${v}`).join('\n')}
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" width="${WIDTH}" height="${HEIGHT}">
  <g id="guide" data-guide="true">
    <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" fill="none" stroke="${FAINT}" stroke-width="1"/>
${lines}
    <line x1="${CENTER_X}" y1="0" x2="${CENTER_X}" y2="${HEIGHT}" stroke="${CENTER_COLOR}" stroke-width="0.8" opacity="0.85"/>
    <text x="${CENTER_X + 3}" y="10" fill="${CENTER_COLOR}" font-size="7" font-family="sans-serif">CENTER_X ${CENTER_X}</text>
  </g>
</svg>
`;
}

/* ================================================================
 * 12枚の空テンプレート（§5・§6・§7）
 * ============================================================== */

function layerSvg(layer: LayerSpec): string {
  const guideList =
    layer.guides.length > 0
      ? layer.guides.map((g) => `${g} = ${GUIDES[g]}`).join(' / ')
      : '（特に無し）';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ${String(layer.order).padStart(2, '0')} ${layer.label}

  描くもの      ${layer.draws.join(' / ')}
  描かないもの  ${layer.never.join(' / ')}
${layer.note ? `  memo          ${layer.note}\n` : ''}
  目安の範囲    x ${layer.area.x[0]}〜${layer.area.x[1]} / y ${layer.area.y[0]}〜${layer.area.y[1]}
  見る基準線    ${guideList}
  中心          CENTER_X = ${CENTER_X}

  決まりごと
    ・viewBox は "${VIEW_BOX}" のまま変えない
    ・背景を描かない（透明のまま）
    ・下の <g> の **中** に描く
    ・位置は自分で合わせる。あとから自動で寄せたり縮めたりはしません（§13）

  このファイルには絵が入っていません。中身はあなたが描きます。
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" width="${WIDTH}" height="${HEIGHT}">
  <g id="${groupIdOf(layer)}" data-layer="${String(layer.order).padStart(2, '0')}_${layer.slug}">

    <!-- ここに描く -->

  </g>
</svg>
`;
}

/** その g の中に絵があるか（コメントだけなら空とみなす） */
function hasDrawing(source: string): boolean {
  const body = source.replace(/<!--[\s\S]*?-->/g, '');
  const group = /<g\b[^>]*>([\s\S]*)<\/g>/.exec(body);
  if (!group) return false;
  return group[1].trim().length > 0;
}

/* ================================================================
 * 実行
 * ============================================================== */

mkdirSync(ROOT, { recursive: true });
mkdirSync(join(ROOT, 'preview'), { recursive: true });

interface Result {
  file: string;
  action: 'created' | 'kept-drawn' | 'rewritten' | 'kept';
}

const results: Result[] = [];

function put(file: string, content: string): void {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    writeFileSync(path, content, 'utf8');
    results.push({ file, action: 'created' });
    return;
  }
  const current = readFileSync(path, 'utf8');
  if (hasDrawing(current)) {
    // 描かれているものは何があっても残す
    results.push({ file, action: 'kept-drawn' });
    return;
  }
  if (FORCE || current !== content) {
    writeFileSync(path, content, 'utf8');
    results.push({ file, action: 'rewritten' });
    return;
  }
  results.push({ file, action: 'kept' });
}

put('GUIDE.svg', guideSvg());
for (const layer of LAYERS) put(fileNameOf(layer), layerSvg(layer));

const LABEL: Record<Result['action'], string> = {
  created: '新規作成',
  rewritten: '作り直し',
  kept: 'そのまま',
  'kept-drawn': '描いてあるので触っていません',
};

console.log('\n=== CHARACTER CREATION TEMPLATE ===\n');
console.log(`  キャンバス  ${WIDTH} x ${HEIGHT} / viewBox "${VIEW_BOX}"`);
console.log(`  中心        CENTER_X = ${CENTER_X}`);
console.log('  基準線      ' + (Object.entries(GUIDES) as Array<[string, number]>).map(([n, v]) => `${n}=${v}`).join(' '));
console.log('');
for (const r of results) {
  console.log(`  ${r.file.padEnd(20)} ${LABEL[r.action]}`);
}
const drawn = results.filter((r) => r.action === 'kept-drawn').length;
console.log(`\n  ${results.length}枚 / うち描きかけ・描き終わり ${drawn}枚`);
console.log('\n  絵は入っていません。枠と目印だけです。');
console.log('  中身はあなたが描いてください。');
console.log('\n  次: npm run character:preview  で重ねて確認できます\n');
