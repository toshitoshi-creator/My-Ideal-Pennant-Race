/**
 * PHASE 4.8-A キャラクターの座標系（§3・§4・§5）。
 *
 * **このファイルがすべての土台です。**
 *
 * 画像生成AIでいちばん困ったのは「目だけ少し右」「帽子だけ浮く」でした。
 * 原因ははっきりしていて、パーツごとに座標系がバラバラだったからです。
 *
 * 自作SVGでは、そこを構造で潰します。
 *   ・すべてのパーツが **同じ 256x320 の座標系** で描かれる
 *   ・パーツは好きな数値を書かず、**基準線とアンカー**を参照する
 *   ・重なる順番は各パーツではなく **描画側が一元管理** する
 *
 * ここは純粋な数と型だけ。React も DOM も知りません。
 */

/* ================================================================
 * 1. キャンバス（§3）
 * ============================================================== */

export const CHARACTER_WIDTH = 256;
export const CHARACTER_HEIGHT = 320;

/** SVG の viewBox。すべてのパーツで同じ */
export const CHARACTER_VIEW_BOX = `0 0 ${CHARACTER_WIDTH} ${CHARACTER_HEIGHT}`;

/* ================================================================
 * 2. 基準線（§4）
 * ============================================================== */

/**
 * 顔と体の基準線。
 *
 * これは「絶対にこの値」ではなく、**頭の形ごとに少し動かせる**（§4）。
 * 動かした結果は CharacterGuides として描画時に配られるので、
 * パーツはいつも「配られた基準線」を見る。生の定数は見ない。
 */
export interface CharacterGuides {
  centerX: number;
  headTop: number;
  headBottom: number;
  eyebrowLine: number;
  eyeLine: number;
  noseLine: number;
  mouthLine: number;
  chinLine: number;
  neckTop: number;
  shoulderLine: number;
  bodyBottom: number;
}

/** 既定の基準線（§4 の値） */
export const CHARACTER_GUIDES: CharacterGuides = {
  centerX: 128,
  headTop: 48,
  headBottom: 177,
  eyebrowLine: 96,
  eyeLine: 111,
  noseLine: 139,
  mouthLine: 157,
  chinLine: 177,
  neckTop: 170,
  shoulderLine: 194,
  bodyBottom: 320,
};

/** 頭の中心。基準線から求める（§3 の y≈108） */
export function headCenterY(guides: CharacterGuides): number {
  return Math.round((guides.headTop + guides.headBottom) / 2);
}

/** 体の中心（§3 の y=215） */
export const BODY_CENTER_Y = 215;

/**
 * 頭の形ごとの微調整。
 *
 * 顔を縦長にすればあごも下がるし、横広にすれば目も少し外へ寄る。
 * その調整をパーツ側に書かせると、組み合わせるたびにずれる。
 * ここで **基準線ごと動かして** から配れば、目も鼻も口も勝手についてくる。
 */
export interface GuideAdjustment {
  /** 顔の縦の伸び縮み（1 = そのまま） */
  faceScaleY?: number;
  /** 顔の横の伸び縮み */
  faceScaleX?: number;
  /** あごの位置だけを動かす（px） */
  chinShift?: number;
}

export function adjustGuides(
  base: CharacterGuides,
  adjustment: GuideAdjustment,
): CharacterGuides {
  const scaleY = adjustment.faceScaleY ?? 1;
  const chinShift = adjustment.chinShift ?? 0;
  const centre = headCenterY(base);

  // 頭の中心を軸に、顔まわりの線だけを伸び縮みさせる
  const at = (y: number) => Math.round(centre + (y - centre) * scaleY);

  const headBottom = at(base.headBottom) + chinShift;
  return {
    ...base,
    headTop: at(base.headTop),
    headBottom,
    chinLine: headBottom,
    eyebrowLine: at(base.eyebrowLine),
    eyeLine: at(base.eyeLine),
    noseLine: at(base.noseLine),
    mouthLine: at(base.mouthLine),
    // 首から下は動かさない。動かすと体との接続が壊れる
  };
}

/* ================================================================
 * 3. アンカー（§5）
 * ============================================================== */

export interface CharacterAnchor {
  x: number;
  y: number;
}

/**
 * パーツが参照してよい基準点の一覧。
 *
 * パーツは「自分で好きな座標を書く」のではなく、ここを見る（§5）。
 * 頭の形が変われば基準点も動くので、パーツ側を直さなくても位置が合う。
 */
export interface CharacterAnchors {
  headCenter: CharacterAnchor;
  headTop: CharacterAnchor;
  headBottom: CharacterAnchor;

  leftEye: CharacterAnchor;
  rightEye: CharacterAnchor;
  eyeLine: CharacterAnchor;

  leftEyebrow: CharacterAnchor;
  rightEyebrow: CharacterAnchor;

  nose: CharacterAnchor;
  mouth: CharacterAnchor;

  hairTop: CharacterAnchor;
  hairBack: CharacterAnchor;

  /**
   * こめかみ＝**頭の輪郭のいちばん外側**。
   *
   * 髪・耳・帽子は「頭がどこまで広いか」を知らないと位置が決まらない。
   * 頭が自分の幅をここへ申告し、外側のパーツはこれだけを見る。
   * 固定幅で描くと、細い頭に幅広の髪が乗って横に黒い板が出る。
   */
  leftTemple: CharacterAnchor;
  rightTemple: CharacterAnchor;

  leftEar: CharacterAnchor;
  rightEar: CharacterAnchor;

  neck: CharacterAnchor;

  shoulder: CharacterAnchor;
  torso: CharacterAnchor;

  capCenter: CharacterAnchor;
  capBase: CharacterAnchor;
  brim: CharacterAnchor;

  bodyCenter: CharacterAnchor;
  handLeft: CharacterAnchor;
  handRight: CharacterAnchor;
}

/** 顔の横幅の半分。目や耳の左右への開き方を決める */
export const FACE_HALF_WIDTH = 62;
/** 目が中心からどれだけ離れるか */
export const EYE_OFFSET = 30;
/**
 * 耳が中心からどれだけ離れるか（**頭が幅を申告しなかったときの控え**）。
 *
 * 通常は頭が anchorsFor で自分の輪郭の位置を渡してくる。
 * 耳は頭より下の層なので、輪郭の内側に置くと塗り潰されて見えなくなる。
 * だから耳は必ず「頭の縁から外へ」描く（parts/face.tsx）。
 */
export const EAR_OFFSET = 66;

/**
 * 基準線から基準点をすべて計算する。
 *
 * **アンカーは手で書かない。** 基準線から必ずここで導く。
 * こうしておけば、頭の形を変えても目・鼻・口・帽子がまとめて追従する。
 */
export function anchorsFrom(guides: CharacterGuides): CharacterAnchors {
  const cx = guides.centerX;
  const headCy = headCenterY(guides);
  return {
    headCenter: { x: cx, y: headCy },
    headTop: { x: cx, y: guides.headTop },
    headBottom: { x: cx, y: guides.headBottom },

    leftEye: { x: cx - EYE_OFFSET, y: guides.eyeLine },
    rightEye: { x: cx + EYE_OFFSET, y: guides.eyeLine },
    eyeLine: { x: cx, y: guides.eyeLine },

    leftEyebrow: { x: cx - EYE_OFFSET, y: guides.eyebrowLine },
    rightEyebrow: { x: cx + EYE_OFFSET, y: guides.eyebrowLine },

    nose: { x: cx, y: guides.noseLine },
    mouth: { x: cx, y: guides.mouthLine },

    hairTop: { x: cx, y: guides.headTop },
    hairBack: { x: cx, y: headCy },

    // 既定値。実際には頭が anchorsFor で自分の幅を申告して上書きする
    leftTemple: { x: cx - FACE_HALF_WIDTH, y: headCy },
    rightTemple: { x: cx + FACE_HALF_WIDTH, y: headCy },

    leftEar: { x: cx - EAR_OFFSET, y: guides.eyeLine + 8 },
    rightEar: { x: cx + EAR_OFFSET, y: guides.eyeLine + 8 },

    neck: { x: cx, y: guides.neckTop },

    shoulder: { x: cx, y: guides.shoulderLine },
    torso: { x: cx, y: BODY_CENTER_Y },

    /*
     * 帽子は頭の天辺と眉の線から求める。頭が変われば帽子も動く（§19）。
     *
     * capBase は「ヘッドバンドの下端」。眉のすぐ上に置く。
     * 天辺からの固定距離にしていたとき、帽子が頭のてっぺんに
     * 乗っているだけのニット帽のように見えた。
     */
    capBase: { x: cx, y: guides.eyebrowLine - 8 },
    capCenter: { x: cx, y: Math.round((guides.headTop + guides.eyebrowLine - 8) / 2) },
    brim: { x: cx, y: guides.eyebrowLine - 8 },

    bodyCenter: { x: cx, y: BODY_CENTER_Y },
    handLeft: { x: cx - 58, y: 268 },
    handRight: { x: cx + 58, y: 268 },
  };
}

/* ================================================================
 * 4. 線の太さ（§10）
 * ============================================================== */

/**
 * 線の太さ。
 *
 * 390x844 の画面で小さく表示しても顔が潰れないよう、細い線を禁じる。
 * SVG は縮小されるので vector-effect="non-scaling-stroke" と併用する。
 */
export const STROKE = {
  /** いちばん外の輪郭 */
  outer: 3,
  /** 内側の主要な線 */
  secondary: 2.4,
  /** 細部 */
  detail: 1.8,
} as const;

/** 極端に細い線を禁じる下限。これを下回る指定はここで止める */
export const MIN_STROKE = 1.5;

export function safeStroke(width: number): number {
  return Math.max(MIN_STROKE, width);
}

/* ================================================================
 * 5. 重なる順番（§6）
 * ============================================================== */

/**
 * レイヤーの並び。小さいほど下（先に描かれる）。
 *
 * **パーツ側に z-index を持たせない。** ここだけが順番を知っている（§6）。
 * パーツが自分の順番を主張しはじめると、追加のたびに順番が壊れる。
 */
export const CHARACTER_LAYERS = [
  'backHair',
  'backEar',
  'neck',
  'body',
  'uniform',
  'frontEar',
  'head',
  'beard',
  'eyes',
  'eyebrows',
  'nose',
  'mouth',
  'frontHair',
  'cap',
  'accessory',
  'expression',
] as const;

export type CharacterLayer = (typeof CHARACTER_LAYERS)[number];

/** その層が何番目に描かれるか */
export function layerOrder(layer: CharacterLayer): number {
  return CHARACTER_LAYERS.indexOf(layer);
}
