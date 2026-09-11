/**
 * PHASE 4.8-B 下書きテンプレートを書き出す（§2・§3・§4）。
 *
 *   npm run character:template
 *
 * `character-template/templates/` に、種類ごとの 256x320 のSVGが出ます。
 * Illustrator / Inkscape / Figma で開いて、**枠の中に描いてください**。
 *
 * テンプレートは手で書きません。**コードから作ります。**
 * 基準線を手で書き写すと、コードを直したときに必ずずれるためです。
 * 基準線を1本動かしたら、このコマンドをもう一度動かせば全部揃います。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  CHARACTER_GUIDES,
  CHARACTER_HEIGHT,
  CHARACTER_VIEW_BOX,
  CHARACTER_WIDTH,
  anchorsFrom,
  headCenterY,
} from '../src/ui/character/coordinates';
import type { CharacterAnchor } from '../src/ui/character/coordinates';
import type { CharacterPartCategory } from '../src/ui/character/types';
import { TEMPLATE_HALF_WIDTH } from '../src/ui/character/svgPart';

const OUT = fileURLToPath(new URL('../character-template/templates', import.meta.url));
const G = CHARACTER_GUIDES;
const A = anchorsFrom(G);

/** 種類ごとに「どの線と点を濃く見せるか」。描くときに迷わないように */
interface TemplateSpec {
  category: CharacterPartCategory;
  label: string;
  /** 濃く見せる基準線 */
  lines: Array<keyof typeof G>;
  /** 濃く見せる基準点 */
  points: Array<keyof typeof A>;
  /** 描くときの注意（テンプレートの中に文字で入れる） */
  note: string;
  /** 頭の枠を出すか（髪・帽子・耳は頭に沿わせるため必要） */
  showHeadFrame: boolean;
  /** 追加で書いておく属性 */
  extraAttrs?: string;
}

const SPECS: TemplateSpec[] = [
  {
    category: 'head',
    label: '頭',
    lines: ['headTop', 'eyebrowLine', 'eyeLine', 'noseLine', 'mouthLine', 'chinLine'],
    points: ['headTop', 'headCenter', 'headBottom', 'leftTemple', 'rightTemple'],
    note: '輪郭だけを描く。髪・耳・首・顔の造作は描かない',
    showHeadFrame: true,
    extraAttrs: ' data-half-width="62" data-face-scale-y="1" data-chin-shift="0"',
  },
  {
    category: 'hairFront',
    label: '前髪',
    lines: ['headTop', 'eyebrowLine'],
    points: ['hairTop', 'leftTemple', 'rightTemple', 'capBase'],
    note: '頭の枠の外を通す。帽子の下から見える分も考えて描く',
    showHeadFrame: true,
  },
  {
    category: 'hairBack',
    label: '後ろ髪',
    lines: ['headTop', 'chinLine', 'shoulderLine'],
    points: ['hairBack', 'leftTemple', 'rightTemple'],
    note: '頭より下の層。毛先は肩の線の手前で止める',
    showHeadFrame: true,
  },
  {
    category: 'cap',
    label: '帽子',
    lines: ['headTop', 'eyebrowLine', 'eyeLine'],
    points: ['headTop', 'capCenter', 'capBase', 'brim', 'leftTemple', 'rightTemple'],
    note: 'つばは目の線より上で止める。頭の枠より少しだけ外',
    showHeadFrame: true,
  },
  {
    category: 'ear',
    label: '耳',
    lines: ['eyeLine', 'noseLine'],
    points: ['leftEar', 'rightEar', 'leftTemple', 'rightTemple'],
    note: '頭より下の層。枠の内側に描くと消えるので、外へふくらませる',
    showHeadFrame: true,
  },
  {
    category: 'eye',
    label: '目',
    lines: ['eyeLine'],
    points: ['leftEye', 'rightEye'],
    note: '左右そろえる。点を中心にすると左右がずれない',
    showHeadFrame: true,
  },
  {
    category: 'eyebrow',
    label: '眉',
    lines: ['eyebrowLine'],
    points: ['leftEyebrow', 'rightEyebrow'],
    note: '左右そろえる',
    showHeadFrame: true,
  },
  {
    category: 'nose',
    label: '鼻',
    lines: ['noseLine'],
    points: ['nose'],
    note: '写実にしない。点・短い線・小さな影で足りる',
    showHeadFrame: true,
  },
  {
    category: 'mouth',
    label: '口',
    lines: ['mouthLine'],
    points: ['mouth'],
    note: '閉じた口を描く。表情での開き方は描画側が変える',
    showHeadFrame: true,
  },
  {
    category: 'beard',
    label: 'ひげ',
    lines: ['noseLine', 'mouthLine', 'chinLine'],
    points: ['mouth', 'headBottom'],
    note: '頭より後、目より前の層',
    showHeadFrame: true,
  },
  {
    category: 'body',
    label: '体',
    lines: ['neckTop', 'shoulderLine', 'bodyBottom'],
    points: ['shoulder', 'torso', 'handLeft', 'handRight'],
    note: '肩から下だけ。首と頭は描かない',
    showHeadFrame: false,
  },
  {
    category: 'neck',
    label: '首',
    lines: ['chinLine', 'neckTop', 'shoulderLine'],
    points: ['headBottom', 'neck', 'shoulder'],
    note: 'あごから肩まで。頭より必ず細く',
    showHeadFrame: false,
  },
  {
    category: 'uniform',
    label: 'ユニフォームの飾り',
    lines: ['shoulderLine', 'bodyBottom'],
    points: ['torso'],
    note: '前立て・ベルトなど。体とは別の層',
    showHeadFrame: false,
  },
  {
    category: 'accessory',
    label: '小物',
    lines: ['eyeLine', 'chinLine'],
    points: ['headCenter', 'leftEar', 'rightEar'],
    note: 'めがねなど。いちばん上の層',
    showHeadFrame: true,
  },
];

const GUIDE_COLOR = '#e0245e';
const POINT_COLOR = '#1d9bf0';
const FAINT = '#c9c6c0';

function guideLines(spec: TemplateSpec): string {
  const rows: string[] = [];
  for (const [name, y] of Object.entries(G)) {
    if (name === 'centerX' || name === 'bodyBottom') continue;
    const strong = (spec.lines as string[]).includes(name);
    rows.push(
      `    <line x1="0" y1="${y}" x2="${CHARACTER_WIDTH}" y2="${y}" ` +
        `stroke="${strong ? GUIDE_COLOR : FAINT}" stroke-width="${strong ? 0.8 : 0.5}" ` +
        `${strong ? '' : 'stroke-dasharray="3 3" '}opacity="${strong ? 0.9 : 0.55}"/>`,
      `    <text x="2" y="${y - 2}" fill="${strong ? GUIDE_COLOR : FAINT}" font-size="6" ` +
        `font-family="sans-serif">${name} ${y}</text>`,
    );
  }
  rows.push(
    `    <line x1="${G.centerX}" y1="0" x2="${G.centerX}" y2="${CHARACTER_HEIGHT}" ` +
      `stroke="${POINT_COLOR}" stroke-width="0.6" opacity="0.6"/>`,
  );
  return rows.join('\n');
}

function guidePoints(spec: TemplateSpec): string {
  const rows: string[] = [];
  for (const name of spec.points) {
    const point = A[name] as CharacterAnchor;
    rows.push(
      `    <circle cx="${point.x}" cy="${point.y}" r="2" fill="${POINT_COLOR}"/>`,
      `    <text x="${point.x + 4}" y="${point.y + 2}" fill="${POINT_COLOR}" font-size="6" ` +
        `font-family="sans-serif">${name}</text>`,
    );
  }
  return rows.join('\n');
}

/** 頭の枠。**輪郭の見本ではありません。** 位置合わせ用の楕円です */
function headFrame(): string {
  const cy = headCenterY(G);
  const ry = (G.headBottom - G.headTop) / 2;
  return (
    `    <ellipse cx="${G.centerX}" cy="${cy}" rx="${TEMPLATE_HALF_WIDTH}" ry="${ry}" ` +
    `fill="none" stroke="${FAINT}" stroke-width="1" stroke-dasharray="4 4" opacity="0.8"/>`
  );
}

function template(spec: TemplateSpec): string {
  const idHint = `${spec.category}_01`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  PHASE 4.8-B 下書きテンプレート : ${spec.label}（${spec.category}）

  ${spec.note}

  描きかた
    1. 下の <g data-part="..."> の **中** に描く
    2. 色は書かない。fill="token:skin" のように名前で書く
       （使える名前は character-template/NAMING.md）
    3. data-part を正しい名前に直す（例 ${spec.category}_06）
    4. guides のグループは消してよい（消さなくても取り込まれない）
    5. src/ui/character/custom/${spec.category}/ に置く
    6. npm run character:check で確かめる

  やってはいけないこと
    ・viewBox を変える
    ・座標を別の位置にずらす（基準線の上に描けば位置は自動で合う）
    ・画像を貼る / script を入れる / 外部URLを参照する
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CHARACTER_VIEW_BOX}" width="${CHARACTER_WIDTH}" height="${CHARACTER_HEIGHT}">

  <!-- ここから下は目印です。取り込むときは読みません -->
  <g id="guides" data-guides="true">
    <rect x="0" y="0" width="${CHARACTER_WIDTH}" height="${CHARACTER_HEIGHT}" fill="#ffffff"/>
${spec.showHeadFrame ? headFrame() : ''}
${guideLines(spec)}
${guidePoints(spec)}
  </g>

  <!-- ここから下があなたの絵です。この中だけが取り込まれます -->
  <g data-part="${idHint}" data-category="${spec.category}" data-label="なまえ"${spec.extraAttrs ?? ''}>

    <!-- ここに描く -->

  </g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
const written: string[] = [];
for (const spec of SPECS) {
  const file = join(OUT, `${spec.category}.svg`);
  writeFileSync(file, template(spec), 'utf8');
  written.push(`${spec.category}.svg`);
}

console.log('\n=== 下書きテンプレート（PHASE 4.8-B）===\n');
console.log(`  ${written.length}種類を書き出しました`);
console.log(`  場所: character-template/templates/`);
for (const name of written) console.log(`    ${name}`);
console.log('\n  絵は入っていません。枠と目印だけです。');
console.log('  この中に、あなたが描いてください。\n');
