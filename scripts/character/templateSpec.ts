/**
 * CHARACTER CREATION TEMPLATE の座標系（§3・§4・§5・§6）。
 *
 * **ここが12枚すべての唯一の基準です。**
 *
 * 基準線を手で書き写すと、直したときに必ずどれかがずれます。
 * テンプレートも GUIDE も検査も preview も、全部ここから作ります。
 * 数字を直したいときは、ここだけを直して作り直してください。
 *
 * 注意: これは **制作用の座標系** で、
 * いま動いているゲーム内の基準線（src/ui/character/coordinates.ts）とは
 * 別物です。両者をつなぐのは、絵ができてからの作業になります。
 */

/* ================================================================
 * 1. キャンバス（§3）
 * ============================================================== */

export const WIDTH = 256;
export const HEIGHT = 320;
export const VIEW_BOX = `0 0 ${WIDTH} ${HEIGHT}`;

/* ================================================================
 * 2. 基準座標（§4）
 * ============================================================== */

export const CENTER_X = 128;

/** 基準線。§4 で指定された範囲の中から選んだ値 */
export const GUIDES = {
  HEAD_TOP: 44,
  BROW_LINE: 110,
  EYE_LINE: 125,
  NOSE_LINE: 152,
  MOUTH_LINE: 177,
  CHIN_LINE: 207,
  NECK_LINE: 227,
  SHOULDER_LINE: 262,
} as const;

export type GuideName = keyof typeof GUIDES;

/** §4 で許された範囲。検査で「範囲から外れていないか」を見る */
export const GUIDE_RANGES: Record<GuideName, [number, number]> = {
  HEAD_TOP: [40, 50],
  BROW_LINE: [105, 115],
  EYE_LINE: [120, 130],
  NOSE_LINE: [145, 160],
  MOUTH_LINE: [170, 185],
  CHIN_LINE: [200, 215],
  NECK_LINE: [215, 240],
  SHOULDER_LINE: [235, 290],
};

/* ================================================================
 * 3. 12レイヤー（§5・§6）
 * ============================================================== */

export interface LayerSpec {
  /** 01〜12。この順番は変えない（§5） */
  order: number;
  /** ファイル名（拡張子なし） */
  slug: string;
  /** 人が読む名前 */
  label: string;
  /** 何を描くか（§6） */
  draws: string[];
  /** 何を描いてはいけないか（§6） */
  never: string[];
  /** 描くときの目安の範囲。強制ではない（§13 により自動補正はしない） */
  area: { x: [number, number]; y: [number, number] };
  /** そのレイヤーで特に見てほしい基準線 */
  guides: GuideName[];
  /** 補足 */
  note?: string;
}

/**
 * 12レイヤー。**下から順**に重なる（01が一番下、12が一番上）。
 */
export const LAYERS: LayerSpec[] = [
  {
    order: 1,
    slug: 'body',
    label: '体・ユニフォーム',
    draws: ['肩', '胴体', 'ユニフォーム', '襟', 'ボタンなどの衣服'],
    never: ['首', '顔', '耳', '髪', '帽子', '目', '眉', '鼻', '口'],
    area: { x: [16, 240], y: [236, 320] },
    guides: ['SHOULDER_LINE'],
  },
  {
    order: 2,
    slug: 'neck',
    label: '首',
    draws: ['首だけ'],
    never: ['あご', '肩', '襟'],
    area: { x: [98, 158], y: [198, 268] },
    guides: ['CHIN_LINE', 'NECK_LINE', 'SHOULDER_LINE'],
    note: '顔とユニフォームのあいだが自然につながる形にする',
  },
  {
    order: 3,
    slug: 'ears',
    label: '耳',
    draws: ['左耳', '右耳'],
    never: ['顔の輪郭', '髪'],
    area: { x: [48, 208], y: [112, 170] },
    guides: ['EYE_LINE', 'NOSE_LINE'],
    note: '肌色。顔の輪郭との接続位置を基準にする',
  },
  {
    order: 4,
    slug: 'head',
    label: '顔の輪郭',
    draws: ['顔の輪郭', 'あご', '頬', 'こめかみ'],
    never: ['目', '眉', '鼻', '口', '耳', '髪', '帽子', '首'],
    area: { x: [58, 198], y: [44, 207] },
    guides: ['HEAD_TOP', 'BROW_LINE', 'EYE_LINE', 'NOSE_LINE', 'MOUTH_LINE', 'CHIN_LINE'],
    note: '**最重要**。頭の左右幅・耳位置・髪位置・帽子位置は、すべてここを基準に決める',
  },
  {
    order: 5,
    slug: 'hair_back',
    label: '後ろ髪',
    draws: ['後ろ髪', '耳の後ろに見える髪', '首付近に見える髪'],
    never: ['顔の前に出る髪（それは10_hair_front）'],
    area: { x: [50, 206], y: [36, 230] },
    guides: ['HEAD_TOP', 'CHIN_LINE', 'NECK_LINE'],
  },
  {
    order: 6,
    slug: 'eyes',
    label: '目',
    draws: ['左目', '右目'],
    never: ['眉', 'まつげ以外の顔の造作'],
    area: { x: [84, 172], y: [110, 145] },
    guides: ['EYE_LINE'],
    note: '左右対称を基本にする。将来の個性として左右差も置けるようにしておく',
  },
  {
    order: 7,
    slug: 'eyebrows',
    label: '眉',
    draws: ['左眉', '右眉'],
    never: ['目'],
    area: { x: [80, 176], y: [96, 122] },
    guides: ['BROW_LINE', 'EYE_LINE'],
    note: '目との位置関係を保つ',
  },
  {
    order: 8,
    slug: 'nose',
    label: '鼻',
    draws: ['鼻'],
    never: ['口', '鼻より下の影'],
    area: { x: [110, 146], y: [138, 168] },
    guides: ['NOSE_LINE'],
    note: '小さくシンプルに',
  },
  {
    order: 9,
    slug: 'mouth',
    label: '口',
    draws: ['口'],
    never: ['鼻', 'あご'],
    area: { x: [96, 160], y: [164, 194] },
    guides: ['MOUTH_LINE'],
    note: '通常表情を基準にする。笑顔・真顔・怒り・驚き・悲しみへ差し替えられるようにする',
  },
  {
    order: 10,
    slug: 'hair_front',
    label: '前髪',
    draws: ['前髪', '生え際', '額にかかる髪'],
    never: ['後ろ髪（それは05_hair_back）', '帽子'],
    area: { x: [50, 206], y: [36, 160] },
    guides: ['HEAD_TOP', 'BROW_LINE'],
    note: '**個性付けの要**。ここだけを差し替えられる形にする',
  },
  {
    order: 11,
    slug: 'cap',
    label: '帽子',
    draws: ['帽子本体', 'つば'],
    never: ['顔', '髪', '耳'],
    area: { x: [40, 216], y: [10, 130] },
    guides: ['HEAD_TOP', 'BROW_LINE'],
    note: '帽子を変えても顔の座標が動かないようにする',
  },
  {
    order: 12,
    slug: 'details',
    label: '細部',
    draws: ['ほくろ', '傷', '髭の細部', 'その他の小さな個性'],
    never: ['基本構造を壊す大きな要素'],
    area: { x: [0, 256], y: [0, 320] },
    guides: [],
  },
];

/** 01_body のようなファイル名 */
export function fileNameOf(layer: LayerSpec): string {
  return `${String(layer.order).padStart(2, '0')}_${layer.slug}.svg`;
}

/** そのレイヤーの中身を入れる g の id */
export function groupIdOf(layer: LayerSpec): string {
  return `layer-${String(layer.order).padStart(2, '0')}-${layer.slug}`;
}
