/**
 * PHASE 4.7 素材カタログ。
 *
 * 「どの種類を、何種類、どういう狙いで作るのか」の正本。
 * ここは純粋なデータと計算だけで、ファイルも通信も知らない（テストから読める）。
 *
 * 大事な区別：
 *   image   … 画像生成AIに1枚ずつ作らせるもの
 *   recolor … AIには作らせず、後処理で色を差し替えて増やすもの
 *
 * 髪色と肌色を recolor にしているのは、AIに「同じ形で色だけ違う髪」を
 * 作らせても形がぶれるからで、費用も10倍かかる。
 * 形を1回作って、後処理で色を振り分けるほうが、確実で安い（§5・§13）。
 */

/** 生成カタログ上の種類（仕様 §4 の18種類） */
export const CATALOG_IDS = [
  'head_shape',
  'body_type',
  'hair_style',
  'hair_color',
  'skin_tone',
  'eyebrow',
  'eyes',
  'nose',
  'mouth',
  'ears',
  'jaw_cheeks',
  'facial_hair',
  'expression',
  'pose',
  'uniform',
  'cap',
  'accessory',
  'special_state',
  // ここから下は仕様 §4 の18種類には無いが、PHASE 4.6 の重ね順が必要とする部品。
  // 無いと首が抜け、長髪が頭の後ろに回れない。
  'neck',
  'hair_back',
] as const;
export type CatalogId = (typeof CATALOG_IDS)[number];

export type CatalogKind = 'image' | 'recolor';

export interface CatalogEntry {
  id: CatalogId;
  /** ゲーム側（src/domain/visualProfile.ts）の種類名。recolor は色を塗る相手 */
  runtime: string;
  kind: CatalogKind;
  /** 素材IDの接頭辞 */
  prefix: string;
  /** 置き場所（src/assets/players/ からの相対） */
  dir: string;
  /** 最低これだけは要る */
  min: number;
  /** 標準の目標枚数 */
  target: number;
  /** これ以上は作らない */
  max: number;
  /** 顔として最低限そろっていないといけないか */
  required: boolean;
  /** 重ねる順（小さいほど下）。§8 */
  zIndex: number;
  /** 何を描くのか（人間向け・プロンプトにも入る） */
  subject: string;
  /**
   * 1枚ずつ変える指定。**構造そのものが違うもの**を並べる（§13）。
   * 色だけ違うものは並べない。
   */
  variants: string[];
}

/* ================================================================
 * 18種類の定義
 * ============================================================== */

/** 仕様 §4 が挙げている18種類。報告のときはこの数で数える */
export const SPEC_CATALOG_IDS: CatalogId[] = [
  'head_shape',
  'body_type',
  'hair_style',
  'hair_color',
  'skin_tone',
  'eyebrow',
  'eyes',
  'nose',
  'mouth',
  'ears',
  'jaw_cheeks',
  'facial_hair',
  'expression',
  'pose',
  'uniform',
  'cap',
  'accessory',
  'special_state',
];

/** 重ね順の都合で足した部品（仕様の18種類には含まれない） */
export const STRUCTURAL_CATALOG_IDS: CatalogId[] = ['neck', 'hair_back'];

export const CATALOG: CatalogEntry[] = [
  {
    id: 'head_shape',
    runtime: 'head',
    kind: 'image',
    prefix: 'head',
    dir: 'base',
    min: 10,
    target: 12,
    max: 15,
    required: true,
    zIndex: 7,
    subject:
      'a bare human head — the skin surface from forehead to chin, with no facial features at all',
    variants: [
      'oval face, balanced proportions',
      'round face, soft full cheeks',
      'square face, wide heavy jaw',
      'long narrow face, high forehead',
      'heart shaped face, wide brow and narrow chin',
      'diamond face, prominent cheekbones and narrow forehead',
      'broad face with strong zygomatic arches',
      'soft rounded square, gentle angles',
      'angular face, sharp planes and flat cheeks',
      'tapered face, narrow toward the chin',
      'wide flat face, low forehead',
      'slightly asymmetric oval, one cheek fuller',
      'gaunt face, hollow cheeks',
      'heavy face, full lower half',
      'compact face, short vertical proportions',
    ],
  },
  {
    id: 'body_type',
    runtime: 'body',
    kind: 'image',
    prefix: 'body',
    dir: 'body',
    min: 8,
    target: 10,
    max: 12,
    required: true,
    zIndex: 3,
    subject:
      'the bare shoulders and upper torso of an adult athlete, headless and neckless, cut flat at the neck base',
    variants: [
      'slim build, narrow shoulders',
      'lean athletic build, defined but light',
      'average build, unremarkable proportions',
      'broad shouldered, V-shaped back',
      'muscular build, thick deltoids and chest',
      'heavy set, wide and solid',
      'stocky build, short and dense',
      'tall and narrow, long clavicles',
      'thick chested, barrel torso',
      'wiry build, sinewy and light',
      'powerful build, very wide trapezius',
      'soft build, rounded shoulders',
    ],
  },
  {
    id: 'hair_style',
    runtime: 'hair',
    kind: 'image',
    prefix: 'hair',
    dir: 'hair',
    min: 10,
    target: 16,
    max: 20,
    required: true,
    zIndex: 15,
    subject:
      'a hair piece only, floating with no head underneath, transparent where the scalp and forehead would be',
    variants: [
      'buzz cut, very short and even',
      'crew cut, short with a flat top',
      'short side part, combed to one side',
      'center part, falling either side of the brow',
      'swept back, no part',
      'spiky short, upward texture',
      'messy short, uneven and casual',
      'tight fade, short sides and fuller top',
      'slicked back, smooth and close',
      'shaggy medium, covering the ears',
      'textured crop, blunt fringe',
      'high and tight, military short',
      'curly short, tight coils',
      'wavy medium, loose waves',
      'long tied back, hair pulled behind',
      'receding hairline, thin at the temples',
      'thinning crown, sparse on top',
      'bald with side hair only',
      'shaved head, stubble only',
      'afro textured, rounded volume',
    ],
  },
  {
    id: 'hair_color',
    runtime: 'hair',
    kind: 'recolor',
    prefix: 'hair',
    dir: 'hair',
    min: 10,
    target: 10,
    max: 10,
    required: true,
    zIndex: 15,
    subject: 'hair colour variants produced by recolouring the generated hair pieces',
    variants: [
      'black',
      'dark brown',
      'brown',
      'light brown',
      'auburn',
      'dark blond',
      'grey streaked',
      'mostly grey',
      'white',
      'silver',
    ],
  },
  {
    id: 'skin_tone',
    runtime: 'head',
    kind: 'recolor',
    prefix: 'head',
    dir: 'base',
    min: 8,
    target: 8,
    max: 8,
    required: true,
    zIndex: 7,
    subject: 'skin tone variants produced by recolouring the generated skin parts',
    variants: [
      'very light',
      'light',
      'light medium',
      'medium',
      'medium tan',
      'tan',
      'deep',
      'very deep',
    ],
  },
  {
    id: 'eyebrow',
    runtime: 'eyebrows',
    kind: 'image',
    prefix: 'brow',
    dir: 'eyebrows',
    min: 10,
    target: 12,
    max: 15,
    required: true,
    zIndex: 10,
    subject: 'a pair of eyebrows only, left and right, nothing else',
    variants: [
      'straight and thick',
      'straight and thin',
      'softly arched',
      'sharply angled',
      'downturned at the outer end',
      'upturned at the outer end',
      'short and bushy',
      'long and tapered',
      'slightly asymmetric, one higher',
      'furrowed inward, close to the eyes',
      'raised and high on the brow',
      'flat and low, close to the eyes',
      'rounded, no visible peak',
      'sparse and light',
      'heavy and dense',
    ],
  },
  {
    id: 'eyes',
    runtime: 'eyes',
    kind: 'image',
    prefix: 'eye',
    dir: 'eyes',
    min: 10,
    target: 14,
    max: 16,
    required: true,
    zIndex: 11,
    subject:
      'a pair of eyes only, left and right, calm neutral gaze looking straight ahead, no eyebrows',
    variants: [
      'almond shaped',
      'round and open',
      'narrow and long',
      'hooded, heavy upper lid',
      'downturned outer corners',
      'upturned outer corners',
      'wide set, far apart',
      'close set, near the nose',
      'deep set, shadowed sockets',
      'single eyelid, smooth lid',
      'double eyelid, defined crease',
      'sleepy, half lowered lids',
      'large and expressive',
      'small and sharp',
      'slightly uneven, one narrower',
      'piercing, high contrast iris',
    ],
  },
  {
    id: 'nose',
    runtime: 'nose',
    kind: 'image',
    prefix: 'nose',
    dir: 'nose',
    min: 10,
    target: 12,
    max: 15,
    required: true,
    zIndex: 12,
    subject: 'a single nose only, floating with no face around it',
    variants: [
      'straight and narrow',
      'straight and wide',
      'slightly upturned tip',
      'downturned tip',
      'aquiline, curved bridge',
      'button, small and round',
      'broad and flat',
      'high bridged, prominent',
      'low bridged, shallow',
      'rounded bulbous tip',
      'pointed sharp tip',
      'wide nostrils',
      'narrow nostrils',
      'slightly crooked, once broken',
      'long and thin',
    ],
  },
  {
    id: 'mouth',
    runtime: 'mouth',
    kind: 'image',
    prefix: 'mouth',
    dir: 'mouth',
    min: 10,
    target: 12,
    max: 15,
    required: true,
    zIndex: 13,
    subject: 'a single closed mouth only, relaxed and neutral, no teeth',
    variants: [
      'thin lips, level line',
      'full lips, soft volume',
      'wide mouth',
      'narrow mouth',
      'slight natural upturn at the corners',
      'slight natural downturn at the corners',
      'flat straight line',
      'softly parted lips',
      'pronounced cupid bow',
      'flat upper lip, fuller lower',
      'asymmetric, one corner higher',
      'small and compact',
      'firm and pressed',
      'heavy lower lip',
      'thin and long',
    ],
  },
  {
    id: 'ears',
    runtime: 'ears',
    kind: 'image',
    prefix: 'ear',
    dir: 'face',
    min: 6,
    target: 8,
    max: 10,
    required: true,
    zIndex: 6,
    subject: 'a pair of ears only, seen from the front, floating with no head between them',
    variants: [
      'small and close to the head',
      'large and protruding',
      'long lobed',
      'attached lobe, no dangle',
      'pointed upper rim',
      'round and soft',
      'flat against the head',
      'slightly uneven, one lower',
      'thick cauliflower rim',
      'narrow and tall',
    ],
  },
  {
    id: 'jaw_cheeks',
    runtime: 'jaw',
    kind: 'image',
    prefix: 'jaw',
    dir: 'face',
    min: 6,
    target: 8,
    max: 10,
    required: true,
    zIndex: 9,
    subject:
      'a jaw and cheek shading overlay only — soft shadow that defines the lower face, with no outline and no skin fill',
    variants: [
      'square heavy jaw',
      'narrow tapered jaw',
      'rounded soft jaw',
      'cleft chin',
      'pointed chin',
      'wide flat chin',
      'double chin, soft under-jaw',
      'slack jowls, older weight',
      'hollow cheeks, lean',
      'full cheeks, youthful',
    ],
  },
  {
    id: 'facial_hair',
    runtime: 'beard',
    kind: 'image',
    prefix: 'beard',
    dir: 'beard',
    min: 8,
    target: 10,
    max: 12,
    required: false,
    zIndex: 14,
    subject:
      'facial hair only, floating with no face underneath, transparent where the skin and lips would be',
    variants: [
      'light stubble',
      'heavy stubble',
      'thin mustache',
      'thick mustache',
      'goatee',
      'chin strap',
      'short full beard',
      'medium full beard',
      'mutton chops',
      'soul patch',
      'circle beard',
      'long full beard',
    ],
  },
  {
    id: 'expression',
    runtime: 'expression',
    kind: 'image',
    prefix: 'expression',
    dir: 'expressions',
    min: 9,
    target: 9,
    max: 15,
    required: false,
    zIndex: 19,
    subject:
      'an expression overlay only — a pair of eyebrows, a pair of eyes and a mouth, with no face, no skin and no nose',
    variants: [
      'focused: narrowed determined eyes, level brows, firmly closed mouth',
      'confident: steady bright eyes, slightly raised brows, small confident smile',
      'happy: crescent smiling eyes, raised brows, open joyful smile',
      'angry: hard glaring eyes, low drawn brows, tight set mouth',
      'tired: heavy half closed eyes, slack brows, slightly open weary mouth',
      'disappointed: downcast eyes, inner brows raised, flat downturned mouth',
      'surprised: wide open eyes, high raised brows, small open mouth',
      'injured: tightly shut eyes, deeply furrowed brows, clenched grimacing mouth',
      'celebrating: eyes shut in joy, high brows, wide open shouting mouth',
    ],
  },
  {
    id: 'pose',
    runtime: 'pose',
    kind: 'image',
    prefix: 'pose',
    dir: 'poses',
    min: 8,
    target: 8,
    max: 12,
    required: false,
    zIndex: 2,
    subject:
      'the lower body and arms of a baseball player only, headless and transparent above the neck base',
    variants: [
      'neutral: standing straight, arms relaxed at the sides',
      'ready: athletic ready stance, knees slightly bent',
      'pitch: pitching wind-up, front leg lifted, throwing arm cocked back',
      'bat: batting stance, bat held up over the back shoulder',
      'field: fielding crouch, knees bent, hands low in front',
      'catch: catcher crouch, mitt held forward at chest height',
      'celebrate: both arms raised, weight on the front foot',
      'tired: shoulders dropped, hands on knees',
      'injured: one arm held close, weight shifted off one leg',
      'run: mid-stride running, arms driving',
      'throw: follow-through after a throw',
      'walk: mid-step walking, relaxed',
    ],
  },
  {
    id: 'uniform',
    runtime: 'uniform',
    kind: 'image',
    prefix: 'uniform',
    dir: 'uniforms',
    min: 1,
    target: 6,
    max: 8,
    required: true,
    zIndex: 4,
    subject:
      'a plain baseball jersey only, worn on an invisible body, off-white fabric, no logo, no number, no lettering',
    variants: [
      'button front jersey, plain placket',
      'pullover jersey, no buttons',
      'v-neck jersey',
      'jersey with plain undershirt sleeves',
      'practice shirt, looser cut',
      'warm-up jacket, zipped',
      'sleeveless vest over an undershirt',
      'windbreaker, light shell',
    ],
  },
  {
    id: 'cap',
    runtime: 'cap',
    kind: 'image',
    prefix: 'cap',
    dir: 'equipment',
    min: 3,
    target: 3,
    max: 8,
    required: false,
    zIndex: 16,
    subject: 'headwear only, worn on an invisible head, plain, no logo and no lettering',
    variants: [
      'baseball cap, plain crown and brim',
      'batting helmet, plain shell with one ear flap',
      'catcher mask and helmet, transparent behind the cage bars',
      'winter cap, knitted',
      'cap worn backwards',
      'sun visor, open crown',
      'helmet with two ear flaps',
      'cap with a flat brim',
    ],
  },
  {
    id: 'accessory',
    runtime: 'glasses',
    kind: 'image',
    prefix: 'glasses',
    dir: 'equipment',
    min: 6,
    target: 8,
    max: 10,
    required: false,
    zIndex: 17,
    subject:
      'a pair of eyeglasses only, floating with no face behind them, fully transparent lenses, frame only',
    variants: [
      'thin metal round frames',
      'thin metal rectangular frames',
      'thick dark rectangular frames',
      'half rim frames',
      'rimless frames',
      'sports goggles with a strap',
      'square frames',
      'oval frames',
      'aviator shaped frames',
      'thin wire frames',
    ],
  },
  {
    id: 'neck',
    runtime: 'neck',
    kind: 'image',
    prefix: 'neck',
    dir: 'body',
    min: 6,
    target: 6,
    max: 8,
    required: true,
    zIndex: 5,
    subject:
      'a neck only — a short column of skin between a chin and a collar, floating with no head and no body',
    variants: [
      'slender neck',
      'average neck',
      'thick neck',
      'very thick muscular neck',
      'long neck',
      'short neck',
      'neck with a visible adam apple',
      'neck with visible tendon lines',
    ],
  },
  {
    id: 'hair_back',
    runtime: 'hairBack',
    kind: 'image',
    prefix: 'hairback',
    dir: 'hair',
    min: 0,
    target: 6,
    max: 20,
    required: false,
    zIndex: 8,
    subject:
      'the back-of-head hair mass only, seen from the front — the volume that shows behind and beside the head, transparent in the centre',
    variants: [
      'low ponytail',
      'short bob volume',
      'shoulder length straight',
      'shoulder length wavy',
      'bun',
      'thick nape hair',
      'long straight',
      'braided',
    ],
  },
  {
    id: 'special_state',
    runtime: 'special',
    kind: 'image',
    prefix: 'special',
    dir: 'special',
    min: 4,
    target: 6,
    max: 10,
    required: false,
    zIndex: 20,
    subject:
      'a small state marker overlay only, placed over a player portrait, with no face and no body underneath',
    variants: [
      'injury: a plain bandage strip across the upper arm',
      'fatigue: sweat drops at the temple',
      'slump: a faint downward hatch over the lower half',
      'hot: a faint upward hatch over the upper half',
      'rookie: a plain ribbon across the lower left corner',
      'veteran: a plain thin band across the lower left corner',
      'award: a plain laurel arc at the lower edge',
      'captain: a plain armband on the upper left arm',
      'debut: a plain corner fold at the upper right',
      'milestone: a plain thin double rule at the lower edge',
    ],
  },
];

/* ================================================================
 * 引き当て
 * ============================================================== */

const BY_ID = new Map<CatalogId, CatalogEntry>(CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: CatalogId): CatalogEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`知らない種類です: ${id}`);
  return entry;
}

export function isCatalogId(value: string): value is CatalogId {
  return BY_ID.has(value as CatalogId);
}

/** AIに作らせるものだけ */
export function imageCategories(): CatalogEntry[] {
  return CATALOG.filter((entry) => entry.kind === 'image');
}

/** 後処理で色を振り分けるものだけ */
export function recolorCategories(): CatalogEntry[] {
  return CATALOG.filter((entry) => entry.kind === 'recolor');
}

/** 素材IDを作る（001 から始まる3桁） */
export function catalogAssetId(entry: CatalogEntry, index: number): string {
  return `${entry.prefix}_${String(index + 1).padStart(3, '0')}`;
}

/**
 * 何枚作るかを決める。
 * 指定が無ければ target、あってもカタログの max は超えない（費用の暴走を防ぐ。§53）。
 */
export function plannedCount(entry: CatalogEntry, requested?: number): number {
  const wanted = requested ?? entry.target;
  return Math.max(0, Math.min(wanted, entry.max, entry.variants.length));
}
