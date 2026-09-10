/**
 * PHASE 4.7-A キャラクターそのものの作り方（§1〜§14・§17・§18）。
 *
 * PHASE 4.7 の catalog.ts は「部品」の目録だった。
 * こちらは **1人ぶんの全身キャラクター** をどう頼むかを持つ。
 *
 * 狙いは、日本の家庭用野球ゲームに出てきそうな
 * 親しみやすいデフォルメ選手。2〜3頭身で、頭が大きく、胴が小さい。
 * 実在の作品・キャラクター・球団の意匠は一切使わない（§0）。
 *
 * ここは**文字列を組み立てるだけ**。通信もファイルも知らないので、
 * テストからそのまま読める。ゲーム実行時には1行も動かない。
 */
import { MATTE_BACKGROUND_HEX } from './pipeline';

/**
 * キャラクターの版。文言を変えたら必ず上げる。
 *
 * v1: PHASE 4.7-A。部品ではなく全身のキャラクターとして頼む形にした。
 *     絵柄を「フラットなアバター」から
 *     「日本のデフォルメ野球ゲーム風」へ変えた。
 * v2: PHASE 4.7-B。**帽子を本体に描かせない**ことを絶対条件にした。
 *     10枚中2枚だけ帽子が無い、という品質のブレが出たため。
 *     帽子は別素材として作り、ゲーム側で重ねる。
 *     あわせて余白を割合で指定し、透明背景の念押しを強めた。
 *     絵柄そのものは 4.7-A のまま変えていない（§1）。
 */
export const CHARACTER_PROMPT_VERSION = 2;

/**
 * 余白の目安（§5）。キャンバスに対する割合。
 *
 * 「切るな」と言うだけでは、生成器はぎりぎりまで描いてくる。
 * 4.7-A では上3px・下5pxしか空いていないものが出た。
 * 割合で言い切るほうが効く。
 */
export const MARGIN_TOP_RATIO = 0.10;
export const MARGIN_BOTTOM_RATIO = 0.10;
export const MARGIN_SIDE_RATIO = 0.08;

/* ================================================================
 * 1. 共通の絵柄（§13 MASTER PROMPT）
 * ============================================================== */

/**
 * すべてのキャラクターに共通する絵柄。
 *
 * 「AIが作ったイラストを貼ったゲーム」ではなく
 * 「最初からこの絵柄で作られたゲーム」に見せたいので、
 * ここは1文字も揺らさずに毎回そのまま添える。
 */
export const CHARACTER_STYLE = [
  'high quality original Japanese baseball video game character',
  'stylized super-deformed professional baseball player',
  'approximately 2.5 heads tall',
  'large expressive head, compact athletic body',
  'short arms and legs, slightly oversized hands and shoes',
  'clear readable silhouette',
  'simple clean facial features, distinctive face shape, distinctive hairstyle',
  'subtle three-dimensional volume, clean smooth contours, soft controlled shading',
  'game-ready character illustration',
  'high readability at small UI sizes',
  'original character design',
].join(', ');

/**
 * 照明（§7）。
 *
 * スタジオ撮影のような強い光を当てると、鼻とあごに濃い影ができて
 * 小さく表示したときに顔が潰れる。均一で柔らかい光にする。
 */
export const CHARACTER_LIGHTING = [
  'neutral even lighting',
  'soft gentle shading, no harsh shadows on the face',
  'no strong rim light, no backlight, no lens flare',
].join(', ');

/**
 * 置き方（§11）。ここがぶれると一覧に並べたときに揃わない。
 *
 * 「頭を切るな」だけでは足りなかった。
 * STYLE TEST の10枚のうち1枚は頭が画面の上端に接し、
 * ほかにも余白が3px・5pxしかないものが出た。
 * 「切るな」ではなく「**余白を空けろ**」と頼むほうが効く。
 */
export const CHARACTER_FRAMING = [
  'FULL CHARACTER VISIBLE, single character centered in frame',
  'HEAD FULLY INSIDE CANVAS, FEET FULLY INSIDE CANVAS',
  'GENEROUS EMPTY MARGIN ABOVE THE HEAD — the top eighth of the image is completely empty',
  'GENEROUS EMPTY MARGIN BELOW THE FEET — the bottom eighth of the image is completely empty',
  'empty space on the left and the right as well, the outer eighth of the image is empty on each side',
  'the character occupies only the middle three quarters of the frame, seen from a little way back',
  'NO BODY PART TOUCHING THE IMAGE EDGE, NO CROPPING, NO CUT OFF HEAD, NO CUT OFF FEET',
  'the character is drawn small enough to sit comfortably inside the frame, not filling it edge to edge',
  'front facing or subtle three-quarter view, eye level',
  'no extreme low angle, no extreme high angle, no fisheye, no wide angle distortion',
].join(', ');

/**
 * 帽子を描かせない指定（§2・§5）。**このPHASEの絶対条件**。
 *
 * 本体に帽子を描かせると、帽子あり・なし・形違い・食い込み・ずれ、
 * といったブレが必ず出る。4.7-A では10枚中2枚に帽子が無かった。
 * 帽子は別素材にして、ゲーム側で重ねる。
 */
export const NO_HEADWEAR = [
  'NO HAT, NO CAP, NO HELMET, NO HEADWEAR of any kind',
  'BARE HEAD — the top of the head is uncovered',
  'HAIR FULLY VISIBLE, the whole hairline and the crown of the head can be seen',
].join(', ');

/**
 * 背景（§12）。透明を出せないモデルには単色の下地を描かせて後で抜く。
 *
 * 透明を出せると言っているモデルでも、10枚中2枚は薄い灰色の下地で返ってきた。
 * 灰色とオフホワイトのユニフォームは分けにくいので、
 * 透明を頼むときも「灰色や白の下地を描くな」と念を押す。
 */
export function characterBackground(transparent: boolean): string {
  return transparent
    ? 'isolated character on a FULLY TRANSPARENT background, no environment, ' +
        'the background must be genuinely empty — do not paint a grey, white, off-white or coloured backdrop, ' +
        'no floor, no cast shadow under the feet'
    : `isolated character on a completely flat solid ${MATTE_BACKGROUND_HEX} chroma green background, ` +
        'one uniform colour with no gradient, no texture, no pattern and no shading on the background itself, ' +
        'no environment';
}

/* ================================================================
 * 2. 必ず外すもの（§14 NEGATIVE PROMPT）
 * ============================================================== */

/**
 * 仕様§14がそのまま挙げているもの。
 * 並びも文言も仕様に合わせてある（見比べられるように）。
 */
export const CHARACTER_NEGATIVE_BASE = [
  // 写実に寄せない
  'photorealistic',
  'realistic human',
  'photo',
  'cinematic',
  'hyper realistic',
  'detailed skin pores',
  'realistic anatomy',
  'adult fashion model',
  // 別ジャンルの絵柄に寄せない
  'beautiful anime character',
  'bishoujo',
  'handsome anime hero',
  'fantasy character',
  'fantasy armor',
  // 体型の逸脱
  'exaggerated muscles',
  'extreme anatomy',
  'long limbs',
  'thin limbs',
  'realistic proportions',
  // 背景と人数
  'complex background',
  'stadium',
  'baseball field',
  'crowd',
  'multiple characters',
  'group',
  // 文字と権利
  'text',
  'letters',
  'numbers',
  'logo',
  'watermark',
  'signature',
  'brand',
  'existing character',
  'copyrighted character',
  'recognizable franchise style',
  'specific game style',
  'specific anime style',
  'weapon',
  // 撮り方
  'dramatic lighting',
  'lens flare',
  'depth of field',
  'motion blur',
  'fisheye',
  'wide angle',
  // かぶり物（§2 の絶対条件。本体には描かせない）
  'hat',
  'cap',
  'baseball cap',
  'helmet',
  'headwear',
  'visor',
  'headband',
  // 破綻
  'cropped head',
  'cropped feet',
  'body cut off',
  'touching canvas edge',
  'extra arms',
  'extra legs',
  'extra fingers',
  'missing fingers',
  'deformed hands',
  'duplicate limbs',
  'duplicate face',
  'asymmetrical eyes',
  'broken anatomy',
  // 背景（透明にならない事故が実際に起きた）
  'gray background',
  'white background',
  'colored background',
  'floor shadow',
  'cast shadow',
];

/**
 * 背景まわりの否定は、下地を描かせるときだけ言い方を変える。
 *
 * 単色の下地を頼んでおきながら 'background' を丸ごと否定すると、
 * 下地まで消えて中途半端な絵になり、かえって抜きにくくなる。
 */
export function characterNegative(transparent: boolean): string {
  const background = transparent
    ? 'background, backdrop, scenery, floor, ground, cast shadow, drop shadow, vignette, frame, border'
    : 'scenery, landscape, room, floor, furniture, gradient background, textured background, ' +
      'patterned background, checkerboard, transparency checker, cast shadow, drop shadow, vignette, frame, border';
  return [background, ...CHARACTER_NEGATIVE_BASE].join(', ');
}

/* ================================================================
 * 3. 体型（§1・§4）
 * ============================================================== */

export interface BodyType {
  id: string;
  /** 守備位置や年齢の目安。プロンプトには出さず、組み合わせを作るときの手がかりにする */
  note: string;
  prompt: string;
}

/**
 * 体型10種（§4）。
 *
 * 単なる幼児体型にはしない。デフォルメしても
 * 「野球選手としての体格」が分かることを狙う。
 * 肩幅と胴の厚みは体型ごとに変える。
 */
export const BODY_TYPES: BodyType[] = [
  {
    id: 'compact',
    note: '内野手',
    prompt: 'compact tidy build, narrow shoulders, small torso, quick and nimble looking',
  },
  {
    id: 'slim',
    note: '若手',
    prompt: 'slim light build, narrow shoulders, thin torso, youthful and light on his feet',
  },
  {
    id: 'athletic',
    note: '外野手',
    prompt: 'athletic balanced build, moderately wide shoulders, firm torso, well proportioned',
  },
  {
    id: 'broad_shouldered',
    note: '投手',
    prompt: 'broad shouldered build, wide upper body tapering to a stable lower body, strong looking',
  },
  {
    id: 'stocky',
    note: '捕手',
    prompt: 'stocky solid build, thick chest, short thick neck, low centre of gravity',
  },
  {
    id: 'heavy',
    note: '大型',
    prompt: 'heavy powerful build, round thick torso, wide waist, big and immovable looking',
  },
  {
    id: 'tall_deformed',
    note: '長身',
    prompt: 'tall for a deformed character, longer torso and legs but still large headed, lanky',
  },
  {
    id: 'short_powerful',
    note: '短躯強打',
    prompt: 'short and powerful build, very short legs, thick chest and thick arms, compact strength',
  },
  {
    id: 'lean',
    note: '走力型',
    prompt: 'lean wiry build, flat torso, slender limbs, fast and springy looking',
  },
  {
    id: 'veteran_heavy',
    note: 'ベテラン',
    prompt:
      'veteran build with age in the body, thick around the waist and shoulders, slightly rounded posture',
  },
];

/* ================================================================
 * 4. 髪型（§5）
 * ============================================================== */

export interface HairStyle {
  id: string;
  prompt: string;
}

/**
 * 髪型15種（§5）。
 *
 * 一本一本は描かせない。**シルエットで見分けられること**を狙う。
 * 漫画的に尖らせすぎず、野球選手として自然な髪型を中心にする。
 */
export const HAIR_STYLES: HairStyle[] = [
  { id: 'short', prompt: 'short neat hair, simple rounded silhouette' },
  { id: 'crew', prompt: 'crew cut, very short and even all over' },
  { id: 'spiky', prompt: 'short hair with a lightly spiked top, still a compact silhouette' },
  { id: 'side_part', prompt: 'short hair with a clear side part' },
  { id: 'slicked_back', prompt: 'hair swept straight back off the forehead' },
  { id: 'messy', prompt: 'short hair falling in slightly messy uneven clumps' },
  { id: 'flat', prompt: 'flat hair lying close to the skull, low silhouette' },
  { id: 'curly', prompt: 'short tightly curled hair, rounded bumpy silhouette' },
  { id: 'wavy', prompt: 'short wavy hair with soft rolling shapes' },
  { id: 'longer_top', prompt: 'short at the sides with noticeably longer hair on top' },
  { id: 'buzz', prompt: 'buzz cut, hair almost shaved down to the scalp' },
  { id: 'undercut', prompt: 'shaved sides with a solid block of hair on top' },
  { id: 'natural', prompt: 'plain natural hair, no styling, ordinary and unremarkable' },
  { id: 'thick', prompt: 'thick heavy hair with a large solid silhouette' },
  { id: 'thin', prompt: 'thin hair with a receding hairline, scalp showing at the temples' },
];

/* ================================================================
 * 5. 顔（§2）
 * ============================================================== */

export interface EyeShape {
  id: string;
  prompt: string;
}

/**
 * 目8種（§2）。
 *
 * 大きすぎるアニメ目は禁止。瞳の描き込みも増やさない。
 * 小さい画面で表情が読めることを優先する。左右は対称。
 */
export const EYE_SHAPES: EyeShape[] = [
  { id: 'round', prompt: 'round eyes' },
  { id: 'wide', prompt: 'horizontally wide eyes' },
  { id: 'narrow', prompt: 'narrow slim eyes' },
  { id: 'upturned', prompt: 'slightly upturned eyes' },
  { id: 'downturned', prompt: 'slightly downturned gentle eyes' },
  { id: 'angular', prompt: 'lightly angular eyes' },
  { id: 'sleepy', prompt: 'half lidded sleepy eyes' },
  { id: 'strong', prompt: 'firm strong eyes with a steady gaze' },
];

/** 顔の輪郭6種（§2 head shape / jaw shape / cheek shape） */
export const JAW_SHAPES: Array<{ id: string; prompt: string }> = [
  { id: 'round', prompt: 'round face with full soft cheeks' },
  { id: 'square', prompt: 'square face with a firm wide jaw' },
  { id: 'oval', prompt: 'smooth oval face' },
  { id: 'long', prompt: 'long narrow face' },
  { id: 'wide', prompt: 'wide short face with broad cheeks' },
  { id: 'tapered', prompt: 'face tapering to a narrow chin' },
];

/** 眉4種 */
export const EYEBROW_SHAPES: Array<{ id: string; prompt: string }> = [
  { id: 'straight', prompt: 'straight level eyebrows' },
  { id: 'thick', prompt: 'thick heavy eyebrows' },
  { id: 'thin', prompt: 'thin light eyebrows' },
  { id: 'slanted', prompt: 'gently slanted eyebrows' },
];

/** 鼻3種 */
export const NOSE_SHAPES: Array<{ id: string; prompt: string }> = [
  { id: 'small', prompt: 'a small simple nose' },
  { id: 'rounded', prompt: 'a rounded button nose' },
  { id: 'straight', prompt: 'a straight simple nose' },
];

/** 口3種 */
export const MOUTH_SHAPES: Array<{ id: string; prompt: string }> = [
  { id: 'small', prompt: 'a small simple mouth' },
  { id: 'wide', prompt: 'a wide simple mouth' },
  { id: 'firm', prompt: 'a firmly closed mouth' },
];

/* ================================================================
 * 6. 年齢（§1・§16）
 * ============================================================== */

export interface AgeLook {
  id: string;
  prompt: string;
}

/*
 * 文頭は「A single ...」に続くので、冠詞は付けない。
 * 付けると「A single a veteran player」になってしまう。
 */
export const AGE_LOOKS: AgeLook[] = [
  { id: 'young', prompt: 'young player in his very early twenties, smooth youthful face' },
  { id: 'prime', prompt: 'player in his mid twenties, adult but still fresh faced' },
  { id: 'mature', prompt: 'player around thirty, a settled adult face' },
  {
    id: 'veteran',
    prompt: 'veteran player in his late thirties, faint lines at the eyes, a slightly weathered look',
  },
  {
    id: 'older',
    prompt: 'older player at the end of his career, visible age in the face, greying at the temples',
  },
];

/** ひげ。年齢と組み合わせて使う */
export const FACIAL_HAIR: Array<{ id: string; prompt: string }> = [
  { id: 'none', prompt: 'clean shaven' },
  { id: 'stubble', prompt: 'light stubble' },
  { id: 'moustache', prompt: 'a small neat moustache' },
  { id: 'goatee', prompt: 'a short goatee' },
  { id: 'beard', prompt: 'a short trimmed beard' },
];

/* ================================================================
 * 7. 表情（§9）
 * ============================================================== */

export interface Expression {
  id: string;
  prompt: string;
}

/**
 * 表情10種（§9）。
 *
 * 顔を大きく歪ませない。眉・目・口の変化だけで感情を出す。
 * 同じ選手なら、表情が変わっても同一人物に見えることが条件。
 */
export const EXPRESSIONS: Expression[] = [
  { id: 'neutral', prompt: 'a calm neutral expression' },
  { id: 'happy', prompt: 'a happy expression, a light smile' },
  { id: 'confident', prompt: 'a confident expression, a small assured smile' },
  { id: 'focused', prompt: 'a focused expression, eyes fixed ahead' },
  { id: 'angry', prompt: 'an annoyed expression, eyebrows drawn together' },
  { id: 'worried', prompt: 'a worried expression, eyebrows raised slightly' },
  { id: 'tired', prompt: 'a tired expression, heavy eyelids' },
  { id: 'sad', prompt: 'a downcast expression, eyes and mouth turned down' },
  { id: 'surprised', prompt: 'a surprised expression, eyes open wider, small open mouth' },
  { id: 'determined', prompt: 'a determined expression, jaw set' },
];

/* ================================================================
 * 8. ポーズ（§10）
 * ============================================================== */

export interface Pose {
  id: string;
  prompt: string;
}

/**
 * ポーズ8種（§10）。
 * 基本の立ち姿では身体を大きくねじらない。正面〜3/4を中心にする。
 */
export const POSES: Pose[] = [
  { id: 'standing', prompt: 'standing straight, arms relaxed at his sides' },
  { id: 'ready', prompt: 'standing in a low ready stance, knees slightly bent' },
  { id: 'batting', prompt: 'holding a plain bat up in a batting stance' },
  { id: 'pitching', prompt: 'in a simple pitching motion, one arm raised, glove held forward' },
  { id: 'throwing', prompt: 'in a simple throwing motion, arm drawn back' },
  { id: 'fielding', prompt: 'crouched low with a glove held down in front of him' },
  { id: 'celebrating', prompt: 'celebrating with one fist raised' },
  { id: 'resting', prompt: 'standing wearily, shoulders lowered, head slightly down' },
];

/* ================================================================
 * 9. 1人ぶんのプロンプトを組み立てる
 * ============================================================== */

/**
 * 1人ぶんの指定。
 * どれも省略できる（省略すれば、その点は生成器に任せる）。
 */
export interface CharacterSpec {
  id: string;
  body?: string;
  hair?: string;
  eyes?: string;
  jaw?: string;
  eyebrow?: string;
  nose?: string;
  mouth?: string;
  age?: string;
  facialHair?: string;
  expression?: string;
  pose?: string;
}

export interface CharacterPrompt {
  id: string;
  prompt: string;
  negativePrompt: string;
  promptVersion: number;
  transparent: boolean;
  /** 何を指定したか。目録と検査の説明に使う */
  spec: CharacterSpec;
}

function look<T extends { id: string; prompt: string }>(
  list: T[],
  id: string | undefined,
): string | undefined {
  if (id === undefined) return undefined;
  const found = list.find((item) => item.id === id);
  if (!found) throw new Error(`知らない指定です: ${id}`);
  return found.prompt;
}

/**
 * 1人ぶんのプロンプトを組み立てる。
 * 同じ指定からは必ず同じ文字列が出る（乱数を使わない）。
 *
 * 並びが大事。モデルによっては文字数の上限があり、後ろが切られる。
 * 「誰を描くか」を先に置き、絵柄の細かい指定を後ろに置く。
 */
export function buildCharacterPrompt(
  spec: CharacterSpec,
  options: { transparent?: boolean; maxLength?: number } = {},
): CharacterPrompt {
  const transparent = options.transparent ?? true;

  const who = [
    look(AGE_LOOKS, spec.age) ?? 'adult baseball player',
    look(BODY_TYPES, spec.body),
    look(HAIR_STYLES, spec.hair),
  ].filter(Boolean);

  const face = [
    look(JAW_SHAPES, spec.jaw),
    look(EYE_SHAPES, spec.eyes),
    look(EYEBROW_SHAPES, spec.eyebrow),
    look(NOSE_SHAPES, spec.nose),
    look(MOUTH_SHAPES, spec.mouth),
    look(FACIAL_HAIR, spec.facialHair),
  ].filter(Boolean);

  const essential = [
    `A single male baseball player: ${who.join(', ')}.`,
    face.length > 0 ? `Face: ${face.join(', ')}.` : '',
    `Expression: ${look(EXPRESSIONS, spec.expression) ?? 'a calm neutral expression'}.`,
    `Pose: ${look(POSES, spec.pose) ?? 'standing straight, arms relaxed at his sides'}.`,
    'Wearing a plain baseball uniform with no logo, no number and no lettering.',
    // 帽子は別素材。ここで描かせてはいけない（§2）
    NO_HEADWEAR + '.',
    CHARACTER_FRAMING + '.',
    characterBackground(transparent) + '.',
    transparent
      ? ''
      : 'The background must be one single flat colour so that it can be removed cleanly afterwards.',
  ].filter(Boolean);

  const decoration = [
    CHARACTER_STYLE + '.',
    CHARACTER_LIGHTING + '.',
    'No text, no logo, no other characters.',
  ];

  let prompt = [...essential, ...decoration].join(' ');
  const limit = options.maxLength;
  if (limit && prompt.length > limit) {
    // まず飾りを削る。それでも長ければ末尾を落とす（大事な指定は先頭にある）
    prompt = essential.join(' ');
    if (prompt.length > limit) prompt = prompt.slice(0, limit).trimEnd();
  }

  return {
    id: spec.id,
    prompt,
    negativePrompt: characterNegative(transparent),
    promptVersion: CHARACTER_PROMPT_VERSION,
    transparent,
    spec,
  };
}

/* ================================================================
 * 10. STYLE TEST（§17）
 * ============================================================== */

/**
 * まず作る10人（§17）。
 *
 * **同じ絵柄に見えるかどうか**だけを見るための10人なので、
 * 顔の作り分けはあえて足さず、体型と年齢だけを振る。
 * 10枚のうち3枚以上が別ゲームの絵柄に見えたら、
 * MASTER PROMPT を直してやり直す。
 */
export const STYLE_TEST: CharacterSpec[] = [
  { id: 'style_01_compact', body: 'compact', hair: 'short', age: 'prime' },
  { id: 'style_02_slim', body: 'slim', hair: 'crew', age: 'young' },
  { id: 'style_03_athletic', body: 'athletic', hair: 'side_part', age: 'prime' },
  { id: 'style_04_broad', body: 'broad_shouldered', hair: 'spiky', age: 'prime' },
  { id: 'style_05_stocky', body: 'stocky', hair: 'buzz', age: 'mature' },
  { id: 'style_06_veteran', body: 'veteran_heavy', hair: 'thin', age: 'veteran', facialHair: 'stubble' },
  { id: 'style_07_young', body: 'lean', hair: 'messy', age: 'young' },
  { id: 'style_08_mature', body: 'tall_deformed', hair: 'slicked_back', age: 'mature' },
  { id: 'style_09_older', body: 'heavy', hair: 'flat', age: 'older', facialHair: 'moustache' },
  { id: 'style_10_catcher', body: 'short_powerful', hair: 'curly', age: 'prime' },
];

/* ================================================================
 * 11. 多様性テスト（§18）
 * ============================================================== */

/**
 * 100人ぶんの組み合わせを作る（§18）。
 *
 * 乱数は使わない。**番号から決める**ので、何度呼んでも同じ100人が出る。
 * 素数の刻み幅で回すことで、体型・髪型・顔が同じ組み合わせで
 * 揃ってしまうのを避ける。
 */
export function diversityPlan(count = 100): CharacterSpec[] {
  const out: CharacterSpec[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `div_${String(i + 1).padStart(3, '0')}`,
      body: BODY_TYPES[i % BODY_TYPES.length].id,
      hair: HAIR_STYLES[(i * 7) % HAIR_STYLES.length].id,
      eyes: EYE_SHAPES[(i * 3) % EYE_SHAPES.length].id,
      jaw: JAW_SHAPES[(i * 5) % JAW_SHAPES.length].id,
      eyebrow: EYEBROW_SHAPES[(i * 3) % EYEBROW_SHAPES.length].id,
      nose: NOSE_SHAPES[(i * 2) % NOSE_SHAPES.length].id,
      mouth: MOUTH_SHAPES[(i * 5) % MOUTH_SHAPES.length].id,
      age: AGE_LOOKS[(i * 11) % AGE_LOOKS.length].id,
      facialHair: FACIAL_HAIR[(i * 13) % FACIAL_HAIR.length].id,
      expression: 'neutral',
      pose: 'standing',
    });
  }
  return out;
}

/** 組み合わせの偏りを数える（§18・§23 の報告に使う） */
export interface DiversityCount {
  key: keyof CharacterSpec;
  counts: Array<{ id: string; n: number }>;
  /** いちばん多いものが全体に占める割合 */
  topShare: number;
}

export function countDiversity(specs: CharacterSpec[], key: keyof CharacterSpec): DiversityCount {
  const map = new Map<string, number>();
  for (const spec of specs) {
    const value = spec[key];
    if (typeof value !== 'string') continue;
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  const counts = [...map.entries()]
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const total = counts.reduce((sum, item) => sum + item.n, 0);
  return { key, counts, topShare: total === 0 ? 0 : counts[0].n / total };
}

/* ================================================================
 * 12. 帽子（PHASE 4.7-B §2・§3・§4・§20）
 * ============================================================== */

/**
 * 帽子は **本体とは別に作る**。
 *
 * 本体に描かせると、あり・なし・形違い・食い込み・ずれが必ず出る。
 * 別素材にすれば、10種類を作って全選手で使い回せるので、
 * 品質が安定して、生成回数も 100回ではなく 10回で済む（§14）。
 */
export interface CapType {
  id: string;
  /** 何が他と違うのか（人間向け。プロンプトにも入る） */
  prompt: string;
}

/**
 * 帽子10種類（§3）。
 *
 * 形・つば・高さ・クラウン・縫い目・正面の見え方で差を付ける。
 * 派手なものは作らない。**同じ架空リーグの標準的な野球帽**に見えること。
 * 実在球団のロゴも文字も入れない。色はゲーム側で付ける（§10）。
 */
export const CAP_TYPES: CapType[] = [
  { id: 'cap_01', prompt: 'a standard six panel baseball cap with a gently curved brim and a medium height crown' },
  { id: 'cap_02', prompt: 'a baseball cap with a perfectly flat straight brim and a tall boxy crown' },
  { id: 'cap_03', prompt: 'a baseball cap with a strongly curved brim that wraps around, and a low rounded crown sitting close to the head' },
  { id: 'cap_04', prompt: 'a baseball cap with a very short stubby brim, barely longer than the crown, and a small compact crown' },
  { id: 'cap_05', prompt: 'a baseball cap with an unusually long wide brim and a broad crown' },
  {
    /*
     * 「very tall dome standing well above the head」と書いたら、
     * 縦横比1.62の筒のような帽子（コック帽のような形）が出た。
     * 「ふつうより少し深い」くらいに抑える。
     */
    id: 'cap_06',
    prompt:
      'a baseball cap with a deeper than usual crown, tall from the brim to the top but still clearly a baseball cap, paired with a short brim',
  },
  {
    id: 'cap_07',
    prompt:
      'a baseball cap with a very flat low profile crown hugging the head, paired with a long brim',
  },
  { id: 'cap_08', prompt: 'a baseball cap with a squared off front panel standing straight up, giving a boxy front silhouette' },
  {
    id: 'cap_09',
    prompt:
      'a baseball cap whose brim angles sharply downward, pointing down toward the ground at the tip',
  },
  {
    id: 'cap_10',
    prompt:
      'a baseball cap whose brim curls upward at the outer edge, turning up away from the face',
  },
  {
    id: 'cap_11',
    prompt:
      'a baseball cap with a wide flaring crown noticeably wider than the head, and a small neat brim',
  },
  {
    id: 'cap_12',
    prompt:
      'a baseball cap with a narrow tapered crown that narrows toward the top, and a long straight brim',
  },
];

/** 帽子の置き方（§4）。正面〜わずかな3/4に統一する */
export const CAP_FRAMING = [
  'the cap alone, floating in empty space as if photographed on its own',
  'front view or only a very slight three-quarter turn, eye level',
  'centered in the frame with generous empty margin on every side',
  'the cap does not touch any edge of the image',
  'no head, no face, no hair, no person underneath',
].join(', ');

/** 帽子の絵柄。本体と同じ絵柄でないと、重ねたときに浮く（§1） */
export const CAP_STYLE = [
  'drawn in exactly the same style as the player characters',
  'high quality original Japanese baseball video game asset',
  'clean bold linework, subtle three-dimensional volume, soft controlled shading',
  'simple and readable at small UI sizes',
  'plain off-white and neutral grey only — no team colour, no logo, no lettering, no emblem',
].join(', ');

/** 帽子の照明。本体と同じ考え方だが「顔」の話は要らない */
export const CAP_LIGHTING = [
  'neutral even lighting',
  'soft gentle shading, no harsh shadows',
  'no strong rim light, no backlight, no lens flare',
].join(', ');

/** 帽子の背景（§4）。白も灰色も禁止 */
export function capBackground(transparent: boolean): string {
  return transparent
    ? 'on a FULLY TRANSPARENT background, nothing behind the cap, ' +
        'do not paint a white, grey, off-white or coloured backdrop, no floor, no cast shadow'
    : `on a completely flat solid ${MATTE_BACKGROUND_HEX} chroma green background, ` +
        'one uniform colour with no gradient, no texture and no shading on the background itself, no cast shadow';
}

/** 帽子の「必ず外すもの」（§20 帽子） */
export const CAP_NEGATIVE_BASE = [
  'photorealistic',
  'real person',
  'celebrity',
  'existing baseball team',
  'existing sports logo',
  'copyrighted character',
  'text',
  'letters',
  'numbers',
  'watermark',
  'brand logo',
  'team logo',
  'emblem',
  'stadium',
  'person',
  'head',
  'face',
  'hair',
  'helmet',
  'cropped cap',
  'broken brim',
  'deformed brim',
  'two caps',
  'gray background',
  'white background',
  'colored background',
  'shadow',
];

export function capNegative(transparent: boolean): string {
  const background = transparent
    ? 'background, backdrop, scenery, floor, ground, cast shadow, drop shadow, vignette, frame, border'
    : 'scenery, landscape, room, floor, furniture, gradient background, textured background, ' +
      'patterned background, checkerboard, cast shadow, drop shadow, vignette, frame, border';
  return [background, ...CAP_NEGATIVE_BASE].join(', ');
}

export interface CapPrompt {
  id: string;
  prompt: string;
  negativePrompt: string;
  promptVersion: number;
  transparent: boolean;
}

/**
 * 帽子1つぶんのプロンプトを組み立てる。
 * 同じ指定からは必ず同じ文字列が出る（乱数を使わない）。
 */
export function buildCapPrompt(
  capId: string,
  options: { transparent?: boolean; maxLength?: number } = {},
): CapPrompt {
  const transparent = options.transparent ?? true;
  const type = CAP_TYPES.find((cap) => cap.id === capId);
  if (!type) throw new Error(`知らない帽子です: ${capId}`);

  const essential = [
    `${type.prompt}, and nothing else.`,
    CAP_FRAMING + '.',
    capBackground(transparent) + '.',
    'No logo, no lettering, no numbers, no team mark of any kind.',
    transparent
      ? ''
      : 'The background must be one single flat colour so that it can be removed cleanly afterwards.',
  ].filter(Boolean);

  const decoration = [CAP_STYLE + '.', CAP_LIGHTING + '.'];

  let prompt = [...essential, ...decoration].join(' ');
  const limit = options.maxLength;
  if (limit && prompt.length > limit) {
    prompt = essential.join(' ');
    if (prompt.length > limit) prompt = prompt.slice(0, limit).trimEnd();
  }

  return {
    id: type.id,
    prompt,
    negativePrompt: capNegative(transparent),
    promptVersion: CHARACTER_PROMPT_VERSION,
    transparent,
  };
}

/** 帽子10種類ぶんの計画（§11 の STYLE TEST で使う） */
export function capPlan(count = CAP_TYPES.length): string[] {
  return CAP_TYPES.slice(0, count).map((cap) => cap.id);
}
