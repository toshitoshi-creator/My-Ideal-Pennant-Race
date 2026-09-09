/**
 * 透明PNGとしての適格性を見る（PHASE 4.7 追補）。
 *
 * fal-ai/flux/dev のように透明背景を出せないモデルを使うと、
 * 「抜いたつもりで抜けていない」素材が production に紛れ込みやすい。
 * ここは、その1点だけを厳しく見る検査。
 *
 * 純粋な計算だけで、ファイルも通信も知らない（テストから読める）。
 */
import type { RgbaImage } from './png';
import {
  contentBounds,
  cornersTransparent,
  estimateBackground,
  faceMetrics,
  hasTransparency,
  inspectFringe,
  type Bounds,
  type FringeReport,
} from './pipeline';
import { ANCHORS, CANVAS_HEIGHT, CANVAS_WIDTH, FACE_LINES } from './anchors';
import type { CatalogId } from './catalog';

/** 1点あたりのファイルサイズの上限（§10 相当）。これを超えたら production に入れない */
export const MAX_FILE_BYTES = 1_500_000;

/** 中身が占めてよい面積の範囲（極端に小さい／大きいものを弾く） */
export const MIN_CONTENT_RATIO = 0.01;
export const MAX_CONTENT_RATIO = 0.9;

/** 基準点からのずれの許容（画素） */
export const ANCHOR_TOLERANCE = 12;

/**
 * 顔の目印のずれの許容（画素）。
 *
 * 頭の素材（C-2）は、髪や首をふくむので外枠の中心に意味がない。
 * 代わりに「耳の線」と「あご」が仕様どおりの高さに来ているかを見る。
 * 外枠より厳しい検査で、目や口が顔からはみ出す事故を防ぐ。
 */
export const FACE_LINE_TOLERANCE = 16;

/**
 * 縁が内側よりどれだけ明るければ「消し残り」とみなすか。
 *
 * 背景の消し残りは、縁だけが明るくなる。
 * 素材そのものが白い（白髪・白いユニフォーム）場合は、縁も内側も同じ明るさになる。
 */
export const LIFT_WARN = 18;
export const LIFT_FAIL = 38;

export type CheckLevel = 'PASS' | 'WARN' | 'FAIL';

export interface TransparencyCheck {
  /** 検査項目の名前 */
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
}

export interface TransparencyReport {
  id: string;
  category: CatalogId | null;
  checks: TransparencyCheck[];
  /** FAIL が1つも無いか */
  ok: boolean;
  failures: number;
  warnings: number;
  bounds: Bounds;
  fringe: FringeReport;
}

export interface TransparencyInput {
  /** 素材ID */
  id: string;
  /** 復号した画素。復号できなかったときは null */
  image: RgbaImage | null;
  /** ファイルのバイト列（先頭だけで足りる） */
  bytes: Uint8Array;
  /** 種類。分かっていれば基準点も見る */
  category: CatalogId | null;
  /** 復号に失敗した理由 */
  decodeError?: string;
  /** 1024x1280 に正規化済みのものとして見るか */
  normalized?: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** PNG のヘッダから色の種類を読む（4 と 6 だけがアルファを持つ） */
function colorTypeOf(bytes: Uint8Array): number | null {
  if (!isPngBytes(bytes) || bytes.length < 26) return null;
  return bytes[25];
}

/**
 * 透明PNGとして取り込んでよいかを見る。
 *
 * ここで FAIL が1つでも出たものは production に入れない（§10）。
 */
export function checkTransparency(input: TransparencyInput): TransparencyReport {
  const checks: TransparencyCheck[] = [];
  const add = (id: string, label: string, level: CheckLevel, detail: string) => {
    checks.push({ id, label, level, detail });
  };

  /* ---- 1. PNG であること ---- */
  if (!isPngBytes(input.bytes)) {
    add('is-png', 'PNGである', 'FAIL', 'PNG の署名がありません');
  } else {
    add('is-png', 'PNGである', 'PASS', 'PNG の署名を確認');
  }

  /* ---- 2. 壊れていないこと ---- */
  if (!input.image) {
    add(
      'decodable',
      '壊れたPNGではない',
      'FAIL',
      input.decodeError ?? '画素を読み出せませんでした',
    );
    return finish(input, checks, emptyBounds(), emptyFringe());
  }
  add('decodable', '壊れたPNGではない', 'PASS', '画素を最後まで読めました');

  const image = input.image;
  const bounds = contentBounds(image);
  const fringe = inspectFringe(image);

  /* ---- 3. アルファチャンネルがあること ---- */
  const colorType = colorTypeOf(input.bytes);
  if (colorType !== null && colorType !== 4 && colorType !== 6) {
    add(
      'alpha-channel',
      'alpha channelが存在する',
      'FAIL',
      `色の種類が ${colorType} です（4 か 6 でないとアルファを持てません）`,
    );
  } else if (!hasTransparency(image)) {
    add(
      'alpha-channel',
      'alpha channelが存在する',
      'FAIL',
      'すべての画素が不透明です（背景が抜けていません）',
    );
  } else {
    add('alpha-channel', 'alpha channelが存在する', 'PASS', `色の種類 ${colorType ?? '不明'}`);
  }

  /* ---- 4. 四隅が透明であること ---- */
  if (!cornersTransparent(image)) {
    add('corners', '四隅が透明', 'FAIL', '四隅のどれかが不透明です');
  } else {
    add('corners', '四隅が透明', 'PASS', '四隅はすべて完全に透明');
  }

  /* ---- 5. 背景色が残っていないこと ---- */
  const opaqueRatio = opaqueShare(image);
  const estimate = estimateBackground(image);
  if (opaqueRatio > MAX_CONTENT_RATIO) {
    add(
      'background-left',
      '背景色が残っていない',
      'FAIL',
      `画面の ${Math.round(opaqueRatio * 100)}% が不透明です（背景が抜けていません）`,
    );
  } else if (estimate.uniformity > 0.6 && opaqueRatio > 0.5) {
    add(
      'background-left',
      '背景色が残っていない',
      'WARN',
      `縁に一様な色が残っている可能性があります（一様さ ${Math.round(estimate.uniformity * 100)}%）`,
    );
  } else {
    add(
      'background-left',
      '背景色が残っていない',
      'PASS',
      `不透明な面積は ${Math.round(opaqueRatio * 100)}%`,
    );
  }

  /*
   * 6・7. 白い縁取り／灰色の縁取り
   *
   * 縁の色だけを見てはいけない。白髪の素材も白いユニフォームも縁は白いので、
   * それだけで弾くと、正しい素材まで落としてしまう。
   *
   * 背景の消し残りは「**縁だけ**が内側より明るい」。
   * 白髪は「縁も内側も白い」。この差（lift）で見分ける。
   */
  const lift = fringe.lift;
  const liftText = `縁の明るさ ${fringe.edgeLuminance.toFixed(0)} / 内側 ${fringe.coreLuminance.toFixed(0)}（差 ${lift >= 0 ? '+' : ''}${lift.toFixed(0)}）`;

  if (fringe.whiteRatio > 0.25 && lift > LIFT_FAIL) {
    add(
      'white-fringe',
      '白い縁取りがない',
      'FAIL',
      `輪郭の ${Math.round(fringe.whiteRatio * 100)}% が白く、内側より明るいです。${liftText}`,
    );
  } else if (fringe.whiteRatio > 0.12 && lift > LIFT_WARN) {
    add(
      'white-fringe',
      '白い縁取りがない',
      'WARN',
      `輪郭の ${Math.round(fringe.whiteRatio * 100)}% が白く、やや明るいです。${liftText}`,
    );
  } else if (fringe.whiteRatio > 0.25) {
    add(
      'white-fringe',
      '白い縁取りがない',
      'PASS',
      `輪郭は白いが、内側も同じ明るさ（白い素材そのもの）。${liftText}`,
    );
  } else {
    add('white-fringe', '白い縁取りがない', 'PASS', `白っぽい輪郭 ${Math.round(fringe.whiteRatio * 100)}%`);
  }

  if (fringe.greyRatio > 0.3 && lift > LIFT_FAIL) {
    add(
      'grey-fringe',
      '灰色の縁取りがない',
      'FAIL',
      `輪郭の ${Math.round(fringe.greyRatio * 100)}% が灰色で、内側より明るいです。${liftText}`,
    );
  } else if (fringe.greyRatio > 0.18 && lift > LIFT_WARN) {
    add(
      'grey-fringe',
      '灰色の縁取りがない',
      'WARN',
      `輪郭の ${Math.round(fringe.greyRatio * 100)}% が灰色で、やや明るいです。${liftText}`,
    );
  } else if (fringe.greyRatio > 0.3) {
    add(
      'grey-fringe',
      '灰色の縁取りがない',
      'PASS',
      `輪郭は灰色だが、内側も同じ明るさ（白髪などの素材そのもの）。${liftText}`,
    );
  } else {
    add('grey-fringe', '灰色の縁取りがない', 'PASS', `灰色の輪郭 ${Math.round(fringe.greyRatio * 100)}%`);
  }

  /* ---- 8. 半透明のハローが無いこと ---- */
  const softShare = softAlphaShare(image);
  if (softShare > 0.3) {
    add(
      'halo',
      '半透明の背景ハローがない',
      'FAIL',
      `不透明でない画素が ${Math.round(softShare * 100)}% もあります`,
    );
  } else if (softShare > 0.15) {
    add('halo', '半透明の背景ハローがない', 'WARN', `半透明の画素が ${Math.round(softShare * 100)}%`);
  } else {
    add('halo', '半透明の背景ハローがない', 'PASS', `半透明の画素は ${Math.round(softShare * 100)}%`);
  }

  /* ---- 9. 中身が空でないこと ---- */
  if (bounds.empty) {
    add('not-empty', '中身がある', 'FAIL', '不透明な画素が1つもありません');
    return finish(input, checks, bounds, fringe);
  }
  add('not-empty', '中身がある', 'PASS', `${bounds.width}x${bounds.height}`);

  /* ---- 10. キャンバスからはみ出していないこと ---- */
  const touching: string[] = [];
  if (bounds.left <= 0) touching.push('左');
  if (bounds.top <= 0) touching.push('上');
  if (bounds.right >= image.width - 1) touching.push('右');
  if (bounds.bottom >= image.height - 1) touching.push('下');
  if (touching.length > 0) {
    add(
      'inside-canvas',
      '人物がキャンバス外にはみ出していない',
      'FAIL',
      `中身が端（${touching.join('・')}）に接しています`,
    );
  } else {
    add('inside-canvas', '人物がキャンバス外にはみ出していない', 'PASS', '端に接していません');
  }

  /* ---- 11. bounding box が小さすぎないこと ---- */
  const areaRatio = (bounds.width * bounds.height) / (image.width * image.height);
  if (areaRatio < MIN_CONTENT_RATIO) {
    add(
      'bbox-min',
      'bounding boxが極端に小さくない',
      'FAIL',
      `中身が画面の ${(areaRatio * 100).toFixed(2)}% しかありません`,
    );
  } else {
    add('bbox-min', 'bounding boxが極端に小さくない', 'PASS', `画面の ${(areaRatio * 100).toFixed(1)}%`);
  }

  /* ---- 12. bounding box が大きすぎないこと ---- */
  if (areaRatio > MAX_CONTENT_RATIO) {
    add(
      'bbox-max',
      'bounding boxが極端に大きくない',
      'FAIL',
      `中身が画面の ${(areaRatio * 100).toFixed(1)}% を占めています`,
    );
  } else {
    add('bbox-max', 'bounding boxが極端に大きくない', 'PASS', `画面の ${(areaRatio * 100).toFixed(1)}%`);
  }

  /* ---- 13. 1024x1280 であること ---- */
  const normalized = input.normalized ?? true;
  if (normalized && (image.width !== CANVAS_WIDTH || image.height !== CANVAS_HEIGHT)) {
    add(
      'canvas-size',
      '1024×1280',
      'FAIL',
      `${image.width}x${image.height} です（${CANVAS_WIDTH}x${CANVAS_HEIGHT} が必要）`,
    );
  } else if (!normalized) {
    add('canvas-size', '1024×1280', 'PASS', `正規化前（${image.width}x${image.height}）なので見送り`);
  } else {
    add('canvas-size', '1024×1280', 'PASS', `${image.width}x${image.height}`);
  }

  /* ---- 14. 基準点が仕様どおりであること ---- */
  if (normalized && input.category === 'head_shape') {
    /*
     * 頭は外枠ではなく顔で見る（C-2）。
     * 髪型で外枠は変わるが、耳の線とあごは変わってはいけない。
     */
    const metrics = faceMetrics(image);
    if (!metrics) {
      add('anchor', '基準点が仕様どおり', 'FAIL', '顔の目印（耳の線・あご）が見つかりません');
    } else {
      const dEar = Math.abs(metrics.earLineY - FACE_LINES.earLine);
      const dChin = Math.abs(metrics.chinY - FACE_LINES.chinLine);
      const detail =
        `耳の線 y=${metrics.earLineY}（仕様 ${FACE_LINES.earLine}）` +
        ` / あご y=${metrics.chinY}（仕様 ${FACE_LINES.chinLine}）`;
      if (dEar > FACE_LINE_TOLERANCE || dChin > FACE_LINE_TOLERANCE) {
        add('anchor', '基準点が仕様どおり', 'FAIL', `${detail} … ずれすぎです`);
      } else {
        add('anchor', '基準点が仕様どおり', 'PASS', detail);
      }
    }
  } else if (normalized && input.category) {
    const anchor = ANCHORS[input.category];
    const centreX = (bounds.left + bounds.right) / 2;
    const centreY = (bounds.top + bounds.bottom) / 2;
    const dx = Math.abs(centreX - anchor.x);
    const dy = Math.abs(centreY - anchor.y);
    if (dx > ANCHOR_TOLERANCE || dy > ANCHOR_TOLERANCE) {
      add(
        'anchor',
        '基準点が仕様どおり',
        'FAIL',
        `中心が (${centreX.toFixed(0)}, ${centreY.toFixed(0)}) で、基準点 (${anchor.x}, ${anchor.y}) から ${Math.max(dx, dy).toFixed(0)}px ずれています`,
      );
    } else {
      add('anchor', '基準点が仕様どおり', 'PASS', `基準点からのずれ ${Math.max(dx, dy).toFixed(0)}px`);
    }
  } else {
    add('anchor', '基準点が仕様どおり', 'PASS', '正規化前なので見送り');
  }

  /* ---- 15. ファイルサイズ ---- */
  if (input.bytes.length > MAX_FILE_BYTES) {
    add(
      'file-size',
      'ファイルサイズ上限以内',
      'FAIL',
      `${(input.bytes.length / 1024).toFixed(0)} KB（上限 ${(MAX_FILE_BYTES / 1024).toFixed(0)} KB）`,
    );
  } else {
    add('file-size', 'ファイルサイズ上限以内', 'PASS', `${(input.bytes.length / 1024).toFixed(0)} KB`);
  }

  return finish(input, checks, bounds, fringe);
}

function finish(
  input: TransparencyInput,
  checks: TransparencyCheck[],
  bounds: Bounds,
  fringe: FringeReport,
): TransparencyReport {
  const failures = checks.filter((check) => check.level === 'FAIL').length;
  const warnings = checks.filter((check) => check.level === 'WARN').length;
  return {
    id: input.id,
    category: input.category,
    checks,
    ok: failures === 0,
    failures,
    warnings,
    bounds,
    fringe,
  };
}

function emptyBounds(): Bounds {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, empty: true };
}

function emptyFringe(): FringeReport {
  return {
    edgePixels: 0,
    whitish: 0,
    greyish: 0,
    soft: 0,
    whiteRatio: 0,
    greyRatio: 0,
    softRatio: 0,
    edgeLuminance: 0,
    coreLuminance: 0,
    lift: 0,
    corePixels: 0,
  };
}

/** 不透明な画素が画面に占める割合 */
export function opaqueShare(image: RgbaImage): number {
  const total = image.width * image.height;
  if (total === 0) return 0;
  let opaque = 0;
  for (let at = 3; at < image.data.length; at += 4) {
    if (image.data[at] > 0) opaque += 1;
  }
  return opaque / total;
}

/** 中途半端なアルファ（1〜254）が、中身に占める割合 */
export function softAlphaShare(image: RgbaImage): number {
  let opaque = 0;
  let soft = 0;
  for (let at = 3; at < image.data.length; at += 4) {
    const alpha = image.data[at];
    if (alpha === 0) continue;
    opaque += 1;
    if (alpha < 255) soft += 1;
  }
  return opaque === 0 ? 0 : soft / opaque;
}
