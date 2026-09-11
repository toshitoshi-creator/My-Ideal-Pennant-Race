/**
 * PHASE 4.8-B 手描きSVGをパーツに変える（§1〜§6）。
 *
 * **ここは「絵」を持ちません。** 絵はあなたが描きます。
 * このファイルがやるのは、あなたの描いた SVG を
 * PHASE 4.8-A の規格（座標系・アンカー・レイヤー）に接ぐことだけです。
 *
 * 接ぎ方は2つだけ覚えれば足ります。
 *
 *   1. **色は書かない。** `fill="token:skin"` のように名前で書く。
 *      実際の色は描くときに配られる（肌の色は選手ごとに違うため）。
 *   2. **位置はテンプレートのまま描く。** 基準線の上に描けばよい。
 *      頭の形が変わったときの追従は、ここが計算する。
 *
 * この2つを守れば、どの頭に載せてもズレません。
 * PHASE 4.8-A で「固定値を書いた瞬間にズレる」ことを3回確かめたので、
 * 手描きのパーツからも固定値を書けないようにしてあります。
 */
import type { ReactNode } from 'react';
import type { CharacterAnchors, CharacterGuides } from './coordinates';
import { CHARACTER_GUIDES, anchorsFrom, headCenterY } from './coordinates';
import type { CharacterPalette } from './palette';
import type {
  CharacterPart,
  CharacterPartCategory,
  CharacterRenderContext,
} from './types';

/* ================================================================
 * 1. 色の名前（§3）
 * ============================================================== */

/**
 * SVG に書いてよい色の名前。
 *
 * `fill="#e8b48c"` のように直に書くと、肌の色を選べなくなります。
 * `fill="token:skin"` と書けば、選手ごとの肌の色が入ります。
 */
export const COLOR_TOKENS = [
  'skin',
  'skinShadow',
  'skinLight',
  'hair',
  'hairShadow',
  'eye',
  'eyeWhite',
  'eyeHighlight',
  'brow',
  'mouth',
  'mouthInner',
  'outline',
  'uniform',
  'uniformSecondary',
  'uniformShadow',
  'cap',
  'capSecondary',
  'capShadow',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const TOKEN_PREFIX = 'token:';

/** 色の名前として使ってよい文字列か */
export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

/* ================================================================
 * 2. 位置の合わせ方（§4）
 * ============================================================== */

/**
 * その種類がどの基準線を目印にするか。
 *
 * 手描きのパーツは「テンプレートの基準線の上」に描かれています。
 * 実際に描くときは頭の形で基準線が動くので、その差だけずらします。
 * ずらす量を人が計算する必要はありません。
 */
const REFERENCE_LINE: Record<CharacterPartCategory, keyof CharacterGuides> = {
  head: 'headTop',
  hairFront: 'headTop',
  hairBack: 'headTop',
  cap: 'headTop',
  ear: 'eyeLine',
  eye: 'eyeLine',
  eyebrow: 'eyebrowLine',
  nose: 'noseLine',
  mouth: 'mouthLine',
  beard: 'chinLine',
  neck: 'neckTop',
  body: 'shoulderLine',
  uniform: 'shoulderLine',
  pose: 'shoulderLine',
  expression: 'eyeLine',
  accessory: 'eyeLine',
};

/**
 * 頭の横幅についていく種類。
 *
 * 髪・耳・帽子は、頭が細ければ細く、広ければ広くなければいけません。
 * PHASE 4.8-A でここを固定値にして3回とも壊したので、
 * 手描きのパーツでも自動で追従させます。
 */
const FOLLOWS_HEAD_WIDTH: ReadonlySet<CharacterPartCategory> = new Set([
  'hairFront',
  'hairBack',
  'cap',
  'ear',
]);

/** テンプレートを描いたときの基準。ここからの差でずらす */
export const TEMPLATE_GUIDES = CHARACTER_GUIDES;
export const TEMPLATE_ANCHORS = anchorsFrom(CHARACTER_GUIDES);
/** テンプレートの頭の半幅。追従の基準になる */
export const TEMPLATE_HALF_WIDTH =
  TEMPLATE_ANCHORS.rightTemple.x - CHARACTER_GUIDES.centerX;

/**
 * 手描きの絵を、いまの頭に合わせて置き直す変換を作る。
 *
 * やることは2つだけです。
 *   ・目印の線の差だけ縦にずらす
 *   ・頭の幅に合わせて横に伸び縮みさせる（髪・耳・帽子のみ）
 *
 * 回転はしません。増やすと「なぜか傾く」が起きるためです。
 */
export function partTransform(
  category: CharacterPartCategory,
  guides: CharacterGuides,
  anchors: CharacterAnchors,
): string | null {
  const line = REFERENCE_LINE[category];
  const dy = guides[line] - TEMPLATE_GUIDES[line];

  const parts: string[] = [];
  if (dy !== 0) parts.push(`translate(0 ${round(dy)})`);

  if (FOLLOWS_HEAD_WIDTH.has(category)) {
    const half = anchors.rightTemple.x - guides.centerX;
    const scale = half / TEMPLATE_HALF_WIDTH;
    if (Math.abs(scale - 1) > 0.001) {
      const cx = guides.centerX;
      // 中心線を軸に横だけ伸ばす。顔の中心がずれないように戻す
      parts.push(`translate(${round(cx)} 0) scale(${round(scale)} 1) translate(${round(-cx)} 0)`);
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/* ================================================================
 * 3. 中身の取り出しと安全確認（§6）
 * ============================================================== */

/** 手描きSVGから読み取ったもの */
export interface ParsedSvgPart {
  id: string;
  category: CharacterPartCategory;
  label: string;
  /** 描く中身（<g data-part> の中だけ） */
  body: string;
  /** 頭だけが持つ。自分の輪郭の半幅 */
  halfWidth?: number;
  /** 頭だけが持つ。顔の縦の伸び縮み */
  faceScaleY?: number;
  /** 頭だけが持つ。あごの位置だけを動かす */
  chinShift?: number;
}

/**
 * 絶対に入っていてはいけないもの。
 *
 * 手描きのSVGは人が作るので、描画ソフトが余計なものを入れることがあります。
 * 外へ取りに行くもの（画像・フォント・スクリプト）は、
 * 「実行時に外部へ出ない」という約束を破るので、必ず弾きます。
 */
export const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<script/i, reason: 'script が入っています' },
  { pattern: /<image/i, reason: '外部画像（image）が入っています' },
  { pattern: /<foreignObject/i, reason: 'foreignObject が入っています' },
  { pattern: /<use\b/i, reason: 'use は参照先がずれるので使えません' },
  { pattern: /\bhref\s*=/i, reason: '外部参照（href）が入っています' },
  { pattern: /\bon[a-z]+\s*=/i, reason: 'イベント属性（onclick など）が入っています' },
  { pattern: /https?:/i, reason: '外部URLが入っています' },
  { pattern: /url\s*\(/i, reason: 'url(...) は外部を指す可能性があるので使えません' },
  { pattern: /@import/i, reason: '@import が入っています' },
  { pattern: /<style/i, reason: 'style タグは他のパーツに影響するので使えません' },
];

/**
 * SVG の名前空間の宣言だけを外す。
 *
 * `xmlns="http://www.w3.org/2000/svg"` は外へ取りに行く指定ではなく、
 * 「これはSVGです」という名札です。どの描画ソフトも必ず書きます。
 * これを外部URLとして弾くと、まともなファイルが1枚も通りません。
 * w3.org の名札だけを外し、それ以外のURLはこれまで通り弾きます。
 */
function stripNamespaces(markup: string): string {
  return markup.replace(/\sxmlns(:[A-Za-z][\w.-]*)?\s*=\s*"https?:\/\/www\.w3\.org\/[^"]*"/g, ' ');
}

/** 中身に危ないものが無いか見る。あれば理由を返す */
export function unsafeReason(markup: string): string | null {
  const target = stripNamespaces(markup);
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(target)) return reason;
  }
  return null;
}

const ROOT_GROUP = /<g\b([^>]*\bdata-part\s*=[^>]*)>([\s\S]*)<\/g>/;

/**
 * コメントを外す。
 *
 * テンプレートには書き方の説明がコメントで入っていて、
 * その中にも `<g data-part ...>` という**文字**が出てきます。
 * 外さずに探すと、説明のほうを絵だと思い込みます（実際にそうなりました）。
 * 描くときに使うソフトもコメントを残すので、ここで必ず外します。
 */
function stripComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

/** 属性を1つ読む */
function attr(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source);
  return match ? match[1] : null;
}

function numberAttr(source: string, name: string): number | undefined {
  const raw = attr(source, name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 手描きSVGを読む。
 *
 * 読めなければ理由を返します（例外は投げません）。
 * 「読めなかった」は開発中に必ず起きることなので、
 * 落とすのではなく理由を見せるほうが直しやすいためです。
 */
export function parseSvgPart(raw: string): ParsedSvgPart | { error: string } {
  const source = stripComments(raw);
  const viewBox = attr(source, 'viewBox');
  if (viewBox === null) return { error: 'viewBox がありません' };
  if (viewBox.trim().replace(/[\s,]+/g, ' ') !== '0 0 256 320') {
    return { error: `viewBox が "0 0 256 320" ではありません（${viewBox}）` };
  }

  const group = ROOT_GROUP.exec(source);
  if (!group) return { error: '<g data-part="..."> が見つかりません' };

  const head = group[1];
  const body = group[2];

  const id = attr(head, 'data-part');
  if (!id) return { error: 'data-part（パーツ名）がありません' };

  const category = attr(head, 'data-category');
  if (!category) return { error: 'data-category（種類）がありません' };

  const label = attr(head, 'data-label') ?? id;

  const danger = unsafeReason(source);
  if (danger) return { error: danger };

  return {
    id,
    category: category as CharacterPartCategory,
    label,
    body,
    ...pick('halfWidth', numberAttr(head, 'data-half-width')),
    ...pick('faceScaleY', numberAttr(head, 'data-face-scale-y')),
    ...pick('chinShift', numberAttr(head, 'data-chin-shift')),
  };
}

function pick<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/* ================================================================
 * 4. 色を入れる（§3）
 * ============================================================== */

/** 中身に出てくる色の名前を、実際の色に置き換える */
export function applyPalette(body: string, palette: CharacterPalette): string {
  return body.replace(
    new RegExp(`${TOKEN_PREFIX}([A-Za-z]+)`, 'g'),
    (whole, name: string) =>
      isColorToken(name) ? palette[name] : whole,
  );
}

/** 中身に使われている色の名前を全部集める（検査で使う） */
export function usedTokens(body: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(`${TOKEN_PREFIX}([A-Za-z]+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) found.add(match[1]);
  return [...found];
}

/* ================================================================
 * 5. パーツにする（§5）
 * ============================================================== */

/**
 * 読み取った内容を CharacterPart にする。
 *
 * これで、手描きのSVGと `parts/` の TSX が同じものになります。
 * 描画側から見て区別がつかないので、混ぜて使えます。
 */
export function toCharacterPart(parsed: ParsedSvgPart): CharacterPart {
  const { id, category, label, body } = parsed;

  const part: CharacterPart = {
    id,
    category,
    label,
    render: (context: CharacterRenderContext): ReactNode => {
      const transform = partTransform(category, context.guides, context.anchors);
      const markup = applyPalette(body, context.palette);
      return (
        <g
          {...(transform ? { transform } : {})}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      );
    },
  };

  // 頭だけは自分の形を申告する（§5 の一方通行）
  if (category === 'head') {
    if (parsed.faceScaleY !== undefined || parsed.chinShift !== undefined) {
      part.guideAdjustment = {
        ...pick('faceScaleY', parsed.faceScaleY),
        ...pick('chinShift', parsed.chinShift),
      };
    }
    const half = parsed.halfWidth;
    if (half !== undefined) {
      part.anchorsFor = (guides) => ({
        leftTemple: { x: guides.centerX - half, y: headCenterY(guides) },
        rightTemple: { x: guides.centerX + half, y: headCenterY(guides) },
        leftEar: { x: guides.centerX - (half - 2), y: guides.eyeLine + 8 },
        rightEar: { x: guides.centerX + (half - 2), y: guides.eyeLine + 8 },
      });
    }
  }

  return part;
}
