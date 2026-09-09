/**
 * PHASE 4.7 プロンプトの組み立て（§9・§12・§13）。
 *
 * 1枚ぶんのプロンプトは、いつも同じ4つの積み重ねで作る。
 *
 *   base      … 全素材に共通する絵柄（Style Bible の要約）
 *   category  … その種類が何を描くのか
 *   variant   … その1枚が他とどう違うのか
 *   negative  … 必ず外すもの
 *
 * ここは純粋な文字列の組み立てだけ。通信もファイルも知らない。
 * 文言を変えたら PROMPT_VERSION を上げる。manifest に残るので、
 * 「どの文言で作られた素材か」が後から分かる（§17）。
 */
import { catalogEntry, plannedCount, type CatalogEntry, type CatalogId } from './catalog';
import { MATTE_BACKGROUND_HEX } from './pipeline';

/**
 * プロンプトの版。文言を変えたら必ず上げる。
 *
 * v2: 透明背景を出せないモデル（fal-ai/flux/dev など）向けに、
 *     「transparent background」ではなく「単色の下地」を描かせる形を足した。
 *     文言だけで透明にはならないので、背景は必ず後処理で抜く。
 */
export const PROMPT_VERSION = 2;

/* ================================================================
 * 共通の土台
 * ============================================================== */

/**
 * すべての素材に共通する絵柄。Style Bible（assets/prompts/style-bible.md）の要約。
 *
 * 目指しているのは「上質なスポーツゲームの2Dキャラクターイラスト」であって、
 * アイコンでも、クリップアートでも、写真でもない（§1）。
 */
export const BASE_STYLE = [
  'high quality 2D character illustration for a modern sports management game',
  'clean confident contour lines of even weight',
  'natural soft shading with two to three tonal steps, no harsh gradients',
  'restrained warm palette, muted and print-like, never neon',
  'adult proportions, believable anatomy, mature but not photorealistic',
  'stylised realism: more grounded than anime, more drawn than a photograph',
  'crisp edges that stay readable when scaled down to 48 pixels',
  'consistent series style: every part must look drawn by the same hand on the same day',
].join(', ');

/** 置き方の指定。ここがぶれると重ねたときに合わない（§5・§7） */
const FRAMING_COMMON = [
  'front facing, orthographic, no perspective and no tilt',
  'centred on the canvas',
  'no ground, no cast shadow, no backdrop, no frame',
];

/**
 * 背景の指定。**モデルによって言うことを変える。**
 *
 * 透明背景を出せるモデル（OpenAI）には透明を頼む。
 * 出せないモデル（fal-ai/flux/dev など）に「transparent background」と
 * 書いても透明にはならない。灰色や市松模様が描かれるだけで、かえって抜きにくい。
 * そこで、**抜きやすい単色の下地**を描かせて、後処理で抜く。
 */
export function framing(transparent: boolean): string {
  const background = transparent
    ? 'isolated single part on a fully transparent background'
    : `isolated single part on a completely flat solid ${MATTE_BACKGROUND_HEX} chroma green background, one uniform colour with no gradient, no texture, no pattern and no shading on the background itself`;
  return [FRAMING_COMMON[0], FRAMING_COMMON[1], background, FRAMING_COMMON[2]].join(', ');
}

/** 透明背景を出せるモデル向けの置き方（従来の文言） */
export const FRAMING = framing(true);

/**
 * 必ず外すもの（§9）。
 * 生成のたびに毎回そのまま添える。
 */
const NEGATIVE_BASE = [
  // 文字・権利
  'text, letters, numbers, watermark, signature, logo, emblem, brand mark, team logo, sponsor patch',
  // 画風の逸脱
  'photorealistic, photograph, 3d render, cgi, ray tracing, glossy highlights, oil painting texture, visible brush strokes, paper texture, noise, grain, jpeg artifacts',
  'low quality clipart, childrens book illustration, sticker art, flat icon, emoji',
  // 構図の逸脱
  'multiple people, second person, duplicate face, extra limbs, extra fingers, deformed anatomy',
  'cropped, cut off, out of frame, tilted, side view, three quarter view, looking away',
  'extreme deformation, chibi proportions, oversized head, grotesque features',
  'asymmetric to the point of deformity, mismatched pair, unnatural eyes',
  // 権利・年齢
  'real athlete, celebrity likeness, existing video game character, existing anime character, recognisable franchise design',
  'child, toddler, infant, sexualised, gore, blood, graphic injury',
];

/**
 * 背景まわりの「外すもの」。ここもモデルによって変える。
 *
 * 単色の下地を描かせるときに 'background' を丸ごと否定すると、
 * 下地まで消えて中途半端な絵になる。否定するのは
 * 「模様のある背景」「風景」「影」だけにする。
 */
function negativeBackground(transparent: boolean): string {
  return transparent
    ? 'background, backdrop, scenery, floor, ground, cast shadow, drop shadow, vignette, frame, border'
    : 'scenery, landscape, room, floor, ground, furniture, gradient background, textured background, patterned background, checkerboard, transparency checker, cast shadow, drop shadow, vignette, frame, border, shadow on the background';
}

/** その生成に添えるネガティブ */
export function negativePrompt(transparent: boolean): string {
  return [negativeBackground(transparent), ...NEGATIVE_BASE].join(', ');
}

/** 透明背景を出せるモデル向けのネガティブ（従来の文言） */
export const NEGATIVE_PROMPT = negativePrompt(true);

/* ================================================================
 * 見本の1枚（MASTER CHARACTER STYLE SHEET）
 * ============================================================== */

/**
 * いちばん最初に作る1枚（§11）。
 *
 * これ以降のすべての素材は、この絵に合わせて作る。
 * 見本画像を渡せるプロバイダーなら参照画像として、
 * 渡せないなら「この文言」を毎回添えることで画風をそろえる。
 */
export function masterStyleSheetPrompt(transparent = true): string {
  return [
    'A MASTER CHARACTER STYLE SHEET for a baseball management game.',
    'One adult male baseball player, 27 years old, shown from the chest up, front facing, neutral expression.',
    'Plain off-white baseball jersey with no logo, no number and no lettering.',
    'This sheet defines the visual language for an entire cast of players:',
    'line weight, shading steps, eye construction, nose construction, mouth construction,',
    'ear placement, jaw rendering, hair rendering and fabric rendering.',
    BASE_STYLE,
    framing(transparent),
    'Render the figure only. No annotations, no callouts, no labels, no colour swatches.',
  ].join(' ');
}

/* ================================================================
 * 1枚ぶんのプロンプト
 * ============================================================== */

/** 種類ごとの「置き場所」の指定。共通キャンバス 1024x1280 の座標（§6・§7） */
const PLACEMENT: Partial<Record<CatalogId, string>> = {
  head_shape:
    'Top of the skull at y=210, chin at y=800, face width spanning x=244 to x=780, centred at x=512.',
  body_type:
    'Neck base at x=512 y=856, shoulders spanning x=236 to x=788, continuing to the bottom edge y=1280.',
  hair_style:
    'Fits a skull whose crown is at y=200 and whose width spans x=232 to x=792, centred at x=512.',
  eyebrow: 'Left brow centred at x=404, right brow at x=620, both at y=428.',
  eyes: 'Left eye centred at x=408, right eye at x=616, both at y=496.',
  nose: 'Centred at x=512, y=600.',
  mouth: 'Centred at x=512, y=712.',
  ears: 'Left ear centred at x=250, right ear at x=774, both at y=512.',
  jaw_cheeks: 'Chin tip at y=800, centred at x=512, covering the lower half of the face only.',
  facial_hair: 'Centred at x=512 y=740, wrapping a mouth at y=712 and a chin at y=800.',
  expression:
    'Brows at y=428 (x=404 and x=620), eyes at y=496 (x=408 and x=616), mouth at x=512 y=712.',
  pose: 'Centred at x=512, fully transparent above y=856, filling down to the bottom edge y=1280.',
  uniform:
    'Neck opening centred at x=512 at y=856, shoulders spanning x=236 to x=788, continuing to the bottom edge y=1280.',
  cap: 'Centred at x=512, brim front edge at y=306, covering a skull crown at y=210.',
  accessory: 'Lens centres at x=408 and x=616, both at y=496.',
  special_state: 'Placed in the lower half of the canvas, occupying less than a quarter of the area.',
};

/**
 * その種類だけに効く「描いてはいけないもの」（§10）。
 * 顔全体をAIに作らせないための、いちばん大事な指定。
 */
const EXCLUSIONS: Partial<Record<CatalogId, string>> = {
  head_shape: 'eyes, eyebrows, nose, mouth, ears, hair, facial hair, glasses, hat, neck, shoulders',
  body_type: 'head, neck, face, jersey, shirt, uniform, hands, forearms, legs',
  hair_style: 'face, skin, forehead, eyes, ears, head shape, neck, hat, cap, headband',
  eyebrow: 'eyes, eyelids, forehead, skin, face, hair, a single eyebrow',
  eyes: 'eyebrows, glasses, nose, face, skin, a single eye, closed eyes, tears, makeup',
  nose: 'face, skin, eyes, mouth, philtrum, side view',
  mouth: 'face, skin, nose, chin, teeth, tongue, beard, mustache',
  ears: 'head, face, hair, earrings, piercings, a single ear',
  jaw_cheeks: 'outline, face, skin fill, mouth, beard, neck, a full head',
  facial_hair: 'face, skin, lips, teeth, nose, head, scalp hair',
  expression: 'face, skin, head, nose, ears, hair, tears, blood',
  pose: 'head, face, chest, shoulders, ground, base, field, dirt, motion lines',
  uniform: 'head, neck, hands, jersey number, name on the back, pinstripes, coloured trim',
  cap: 'head, hair, face, coloured crown, team mark',
  accessory: 'face, eyes, nose, skin, tinted lenses, reflections, head',
  special_state: 'face, body, player, head, hands, text, numbers',
};

/** 色を素材に焼き込ませないための指定。移籍で色が変えられなくなるのを防ぐ（§13 uniform） */
const NEUTRAL_COLOR: Partial<Record<CatalogId, string>> = {
  hair_style: 'Render the hair in a neutral dark base colour; colour variants are produced later.',
  head_shape: 'Render the skin in a neutral mid tone; skin tone variants are produced later.',
  ears: 'Render the skin in a neutral mid tone, matching the head parts.',
  jaw_cheeks: 'Neutral shading only, no skin fill colour of its own.',
  uniform:
    'Off-white fabric only. Do not use any team colour: club colours are applied by the game, not baked into the asset.',
  cap: 'Off-white and ink only. Do not use any team colour.',
};

export interface PromptParts {
  id: string;
  category: CatalogId;
  variantIndex: number;
  base: string;
  categoryPrompt: string;
  variantPrompt: string;
  negativePrompt: string;
  /** 実際にプロバイダーへ渡す1本の文字列 */
  prompt: string;
  promptVersion: number;
  /** 透明背景を頼んだか。false なら後処理での背景抜きが必須 */
  transparent: boolean;
}

/**
 * 1枚ぶんのプロンプトを組み立てる。
 * 同じ引数からは必ず同じ文字列が出る（乱数を使わない）。
 */
export function buildPrompt(
  category: CatalogId,
  variantIndex: number,
  options: { transparent?: boolean; maxLength?: number } = {},
): PromptParts {
  const transparent = options.transparent ?? true;
  const entry = catalogEntry(category);
  if (variantIndex < 0 || variantIndex >= entry.variants.length) {
    throw new Error(`${category} に ${variantIndex} 番目の指定はありません`);
  }

  const id = `${entry.prefix}_${String(variantIndex + 1).padStart(3, '0')}`;
  const categoryPrompt = [
    `Draw ${entry.subject}.`,
    PLACEMENT[category] ?? '',
    NEUTRAL_COLOR[category] ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const variantPrompt = `This particular variant: ${entry.variants[variantIndex]}.`;
  const exclusion = EXCLUSIONS[category];
  const negativeBase = negativePrompt(transparent);
  const negative = exclusion ? `${negativeBase}, ${exclusion}` : negativeBase;

  /*
   * 並べる順番が大事。
   *
   * モデルによっては文字数の上限があり（Recraft は1000字）、後ろが切られる。
   * 「何を描くか」と「何を描くな」を先に置き、絵柄の細かい指定を後ろに置く。
   * こうしておけば、切られても大事な指定だけは残る。
   */
  const essential = [
    categoryPrompt,
    variantPrompt,
    exclusion ? `Do not draw: ${exclusion}.` : '',
    framing(transparent) + '.',
    transparent
      ? ''
      : 'The background must be one single flat colour so that it can be removed cleanly afterwards.',
  ].filter(Boolean);

  const decoration = [BASE_STYLE + '.', 'Canvas 1024 by 1280 pixels.'];

  let prompt = [...essential, ...decoration].join(' ');
  const limit = options.maxLength;
  if (limit && prompt.length > limit) {
    // まず飾りを削る。それでも長ければ末尾を落とす（大事な指定は先頭にある）
    prompt = essential.join(' ');
    if (prompt.length > limit) prompt = prompt.slice(0, limit).trimEnd();
  }

  return {
    id,
    category,
    variantIndex,
    base: BASE_STYLE,
    categoryPrompt,
    variantPrompt,
    negativePrompt: negative,
    prompt,
    promptVersion: PROMPT_VERSION,
    transparent,
  };
}

/** その種類ぶん、まとめて組み立てる */
export function buildPromptsFor(
  category: CatalogId,
  count?: number,
  options: { transparent?: boolean; maxLength?: number } = {},
): PromptParts[] {
  const entry = catalogEntry(category);
  const n = plannedCount(entry, count);
  const out: PromptParts[] = [];
  for (let i = 0; i < n; i++) out.push(buildPrompt(category, i, options));
  return out;
}

/** 1枚ぶんの生成計画（何を何枚作るか） */
export interface PlanItem {
  category: CatalogId;
  runtime: string;
  kind: CatalogEntry['kind'];
  count: number;
  ids: string[];
}

/**
 * 生成の計画を立てる。**ここでは1枚も作らない**。
 * dry-run はこの計画をそのまま表示する（§29・§52）。
 */
export function planGeneration(
  categories: CatalogId[],
  count?: number,
): PlanItem[] {
  return categories.map((category) => {
    const entry = catalogEntry(category);
    // 色違いはAIに作らせない。後処理で増やす
    const n = entry.kind === 'recolor' ? entry.target : plannedCount(entry, count);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(`${entry.prefix}_${String(i + 1).padStart(3, '0')}`);
    }
    return { category, runtime: entry.runtime, kind: entry.kind, count: n, ids };
  });
}

/** 計画のうち、実際にAPIを叩く枚数（費用の見積もりに使う） */
export function billableCount(plan: PlanItem[]): number {
  return plan.reduce((sum, item) => sum + (item.kind === 'image' ? item.count : 0), 0);
}
