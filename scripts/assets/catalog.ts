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

/**
 * image   … 画像生成AIに1枚ずつ作らせる
 * recolor … AIには作らせず、後処理で色を振り分けて増やす
 * merged  … 別の素材の中に描き込まれる。**AIには単独で作らせない**
 *
 * merged にした理由（C-2）。
 *
 * 髪・耳・首は、頭という土台があって初めて形が決まる。
 * 「髪だけ描いて」と頼むと、生成器は親切に顔の輪郭まで描いてしまい、
 * 重ねたときに頬の上へ二重の線が出た（3回試して3回とも同じだった）。
 * そこで、頭・髪・耳・首は1枚にまとめて描かせる。
 *
 * ただし、まとめたままだと髪色を変えられない。
 * 肌8色 × 髪10色 を1枚ずつ焼くと1つの頭につき80枚になってしまう。
 * そこで **描かせるのはまとめて、持つのは層ごと** にする。
 * 後処理（normalize）で髪の画素だけを抜き出して別の層にすれば、
 * 8 + 10 = 18枚で済み、髪型は頭に必ず合ったままになる。
 * 抜き出しは scripts/assets/pipeline.ts の extractHairLayer。
 */
export type CatalogKind = 'image' | 'recolor' | 'merged';

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
  /** merged のとき、どの素材に描き込まれるか */
  mergedInto?: CatalogId;
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
    target: 24,
    max: 60,
    required: true,
    zIndex: 7,
    /*
     * PHASE 4.7 の途中で設計を変えた。
     *
     * 「髪だけ」「耳だけ」を描かせようとしたが、生成器は頭の輪郭を
     * 一緒に描いてしまい、重ねると線が二重になった（3通り試して全部失敗）。
     * 逆に「顔の造作が無い頭」は一発で綺麗に出る。
     *
     * そこで、頭・髪・耳・首を1枚にまとめて土台にし、
     * その上に目・眉・鼻・口だけを重ねる形にした。
     * 生成器の得意なことに合わせたほうが、破綻が少ない。
     */
    subject:
      'the head of a super-deformed baseball game character: skull, hair, ears and a short neck, all in one shape. The head is large and rounded. The face area is completely blank — no eyes, no eyebrows, no nose, no mouth',
    variants: [
      'oval face, short neat hair swept to one side',
      'round face, short cropped hair',
      'square jawed face, flat top crew cut',
      'long narrow face, hair with a centre part',
      'heart shaped face, soft fringe over the forehead',
      'diamond face, short spiky hair',
      'broad face, buzz cut, almost shaved',
      'soft rounded square face, messy short hair',
      'angular face, hair slicked straight back',
      'tapered face, tight fade with a fuller top',
      'wide face, bowl cut with a straight fringe',
      'oval face, curly short hair',
      'round face, wavy medium hair covering the ear tops',
      'square face, receding hairline, thin at the temples',
      'long face, completely bald, no hair at all',
      'heart shaped face, long hair tied back at the nape',
      'diamond face, textured crop with a blunt fringe',
      'broad face, high and tight military cut',
      'compact face, thick nape hair, low hairline',
      'gaunt face, thinning hair on the crown',
      'heavy face, short hair parted seven to three',
      'narrow face, afro textured rounded volume',
      'wide flat face, side part with a hard line',
      'slightly asymmetric oval face, short shaggy hair',
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
    kind: 'merged',
    mergedInto: 'head_shape',

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
    target: 15,
    max: 15,
    required: true,
    zIndex: 11,
    /*
     * 目は2つの軸で決まる（見本の表と同じ組み方）。
     *   縦: 丸目 ── 標準 ── 切れ長
     *   横: ツリ目（鋭い）── アーモンド ── タレ目（穏やか）
     * 3 × 5 で15通り。これで「鋭い人」「穏やかな人」が描き分けられる。
     *
     * 大事なのは**怖くしない**こと。線を太くしすぎず、
     * 白目を大きく出さず、虹彩は落ち着いた茶か灰にする。
     */
    subject:
      'a pair of eyes only, left and right, calm and gentle, looking straight ahead. Thin soft eyelid lines, warm dark grey-brown iris, one small highlight. No eyebrows',
    variants: [
      'round and open, outer corners lifted sharply upward — alert',
      'round and open, outer corners lifted slightly',
      'round and open, level almond shape — neutral',
      'round and open, outer corners dropped slightly — friendly',
      'round and open, outer corners dropped clearly — very gentle',
      'medium height, outer corners lifted sharply upward — sharp',
      'medium height, outer corners lifted slightly',
      'medium height, level almond shape — neutral',
      'medium height, outer corners dropped slightly — mild',
      'medium height, outer corners dropped clearly — soft',
      'narrow and long, outer corners lifted sharply upward — keen',
      'narrow and long, outer corners lifted slightly',
      'narrow and long, level almond shape — composed',
      'narrow and long, outer corners dropped slightly — calm',
      'narrow and long, outer corners dropped clearly — sleepy and mild',
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
    kind: 'merged',
    mergedInto: 'head_shape',

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
    kind: 'merged',
    mergedInto: 'head_shape',

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
    min: 10,
    target: 10,
    max: 15,
    required: false,
    zIndex: 19,
    subject:
      'an expression overlay only — a pair of eyebrows, a pair of eyes and a mouth, with no face, no skin and no nose',
    /*
     * PHASE 4.7-A §9 の10種類。
     * 顔そのものは変えず、眉・目・口の変化だけで感情を出す。
     * 表情が変わっても同じ選手だと分かることが条件（§16）。
     */
    variants: [
      'neutral: level brows, calm open eyes, relaxed closed mouth',
      'happy: raised brows, crescent smiling eyes, open smile',
      'confident: slightly raised brows, steady eyes, small assured smile',
      'focused: level brows drawn in, narrowed eyes, firmly closed mouth',
      'angry: low drawn brows, hard eyes, tight set mouth',
      'worried: inner brows raised, uneasy eyes, small flat mouth',
      'tired: slack brows, heavy half closed eyes, slightly open weary mouth',
      'sad: inner brows raised, downcast eyes, downturned mouth',
      'surprised: high raised brows, wide open eyes, small open mouth',
      'determined: level brows, firm eyes, jaw set and mouth closed hard',
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
    min: 10,
    target: 10,
    max: 20,
    required: false,
    zIndex: 16,
    /*
     * PHASE 4.7-B §2・§3。
     *
     * 帽子は本体に描かせず、必ず別素材にする。
     * 本体に描かせると、あり・なし・形違い・食い込みのブレが必ず出るため。
     * 中身は scripts/assets/character.ts の CAP_TYPES と同じ10種類。
     * 派手なものは作らない。同じ架空リーグの標準的な野球帽に見えること。
     * ヘルメットとマスクは別枠（cap_101 / cap_102 を予約）。
     */
    subject: 'a baseball cap only, floating on its own with no head underneath, plain, no logo and no lettering',
    variants: [
      'six panel cap, gently curved brim, medium height crown',
      'flat straight brim, tall boxy crown',
      'strongly curved brim, low rounded crown sitting close to the head',
      'short stubby brim, compact crown',
      'long wide brim, broad crown',
      'clearly visible panel seams, small button at the top of the crown',
      'smooth seamless crown, no visible stitching',
      'slightly squared front panel standing up straight',
      'well worn cap, softly creased crown, bent brim',
      'deep crown, brim angled slightly downward',
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
    kind: 'merged',
    mergedInto: 'head_shape',

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
    kind: 'merged',
    mergedInto: 'head_shape',

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
