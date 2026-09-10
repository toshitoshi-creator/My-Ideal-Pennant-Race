/**
 * PHASE 4.7-A キャラクター1枚の自動検査（§15）。
 *
 * ここで見るのは **機械で確かめられることだけ** です。
 *
 * 仕様§15 は「顔の破綻」「手の破綻」「既存キャラクターを想起させる意匠」も
 * reject 条件に挙げていますが、それは目で見ないと判断できません。
 * 分かったふりをして PASS を出すと、かえって危ないので、
 * この検査は「形の破綻と構図」に絞り、残りは目視にまわします。
 * どれが自動でどれが目視かは NEEDS_EYE に書いてあります。
 *
 * 純粋な計算だけ。ファイルも通信も知りません（テストから読めます）。
 */
import type { RgbaImage } from './png';
import {
  contentBounds,
  estimateBackground,
  looksTransparent,
  luminance,
  type Bounds,
} from './pipeline';

/** 目で見ないと判断できないもの（自動検査では見ていない） */
export const NEEDS_EYE = [
  '顔が破綻していないか',
  '手と足が破綻していないか',
  '野球選手として認識できるか',
  '既存のキャラクターを想起させる意匠が無いか',
  '10枚が同じゲームの絵柄に見えるか（§17の合格基準）',
  '100人を並べて「同じ顔の量産」に見えないか（§18）',
] as const;

export type CheckLevel = 'PASS' | 'WARN' | 'FAIL';

export interface CharacterCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
}

export interface CharacterReport {
  id: string;
  checks: CharacterCheck[];
  /** FAIL が1つでもあれば採用しない */
  accepted: boolean;
  metrics: FigureMetrics | null;
  /** 見た目の指紋。重複を調べるのに使う */
  hash: string;
}

/* ================================================================
 * 1. 姿の測り方
 * ============================================================== */

export interface FigureMetrics {
  bounds: Bounds;
  /** 頭の下端（首のいちばん細いところ） */
  neckY: number;
  /** 頭の高さ */
  headHeight: number;
  /** 何頭身か */
  headsTall: number;
  /** 頭のいちばん広いところ */
  headWidth: number;
  /** 中身の左右の中心 */
  centerX: number;
}

/**
 * 背景の色を決める。
 *
 * すでに透明なら null（抜くものが無い）。
 * 単色の下地が描かれていれば、その色を返す。
 */
function backgroundColor(image: RgbaImage): [number, number, number] | null {
  if (looksTransparent(image)) return null;
  const estimate = estimateBackground(image);
  return [estimate.color[0], estimate.color[1], estimate.color[2]];
}

/** その画素が背景の色に近いか（いちばん差の大きい成分で見る） */
function nearBackground(
  r: number,
  g: number,
  b: number,
  background: [number, number, number],
  tolerance: number,
): boolean {
  return (
    Math.abs(r - background[0]) <= tolerance &&
    Math.abs(g - background[1]) <= tolerance &&
    Math.abs(b - background[2]) <= tolerance
  );
}

/** その行に中身（背景でない画素）が何画素あるか */
function contentRow(
  image: RgbaImage,
  y: number,
  background: [number, number, number] | null,
  tolerance: number,
): { count: number; left: number; right: number; width: number } {
  const { width, data } = image;
  let count = 0;
  let left = width;
  let right = -1;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    if (background && nearBackground(data[i], data[i + 1], data[i + 2], background, tolerance)) {
      continue;
    }
    count += 1;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  return { count, left, right, width: right < 0 ? 0 : right - left + 1 };
}

/**
 * 背景を除いた中身の範囲。
 *
 * contentBounds はアルファだけを見るので、単色の下地が
 * **不透明のまま**残っていると「画面いっぱいに中身がある」と出てしまう。
 * 生成直後の絵はまさにその状態なので、ここは下地の色も除いて測る。
 */
export function contentBoundsOver(
  image: RgbaImage,
  background: [number, number, number] | null,
  tolerance = 24,
): Bounds {
  if (!background) return contentBounds(image);
  let top = image.height;
  let bottom = -1;
  let left = image.width;
  let right = -1;
  for (let y = 0; y < image.height; y++) {
    const row = contentRow(image, y, background, tolerance);
    if (row.count === 0) continue;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if (row.left < left) left = row.left;
    if (row.right > right) right = row.right;
  }
  if (bottom < 0) {
    return { empty: true, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  }
  return {
    empty: false,
    top,
    bottom,
    left,
    right,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/**
 * 立ち姿から、頭の大きさと頭身を測る。
 *
 * 探すのは首。頭はいったん広がってから細くなり、
 * 首でいちばん細くなって、肩でまた広がる。
 * その「いちばん細いところ」を上から4割の範囲で探す。
 *
 * 見つからなければ null（測れないものを測ったことにしない）。
 */
export function figureMetrics(
  image: RgbaImage,
  options: { tolerance?: number } = {},
): FigureMetrics | null {
  const tolerance = options.tolerance ?? 24;
  const background = backgroundColor(image);
  const bounds = contentBoundsOver(image, background, tolerance);
  if (bounds.empty) return null;

  const rows: Array<{ y: number; width: number; left: number; right: number }> = [];
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    const row = contentRow(image, y, background, tolerance);
    if (row.count >= 4) rows.push({ y, width: row.width, left: row.left, right: row.right });
  }
  if (rows.length < 16) return null;

  const height = rows[rows.length - 1].y - rows[0].y + 1;
  // 首は上から 15%〜55% のあたりにある（2〜3頭身なので頭が大きい）
  const from = rows[0].y + Math.round(height * 0.15);
  const to = rows[0].y + Math.round(height * 0.55);
  const band = rows.filter((row) => row.y >= from && row.y <= to);
  if (band.length === 0) return null;

  let neck = band[0];
  for (const row of band) if (row.width < neck.width) neck = row;

  const headRows = rows.filter((row) => row.y < neck.y);
  if (headRows.length === 0) return null;
  let headWidth = 0;
  let widest = headRows[0];
  for (const row of headRows) {
    if (row.width > headWidth) {
      headWidth = row.width;
      widest = row;
    }
  }

  const headHeight = neck.y - rows[0].y + 1;
  return {
    bounds,
    neckY: neck.y,
    headHeight,
    headsTall: headHeight <= 0 ? 0 : height / headHeight,
    headWidth,
    centerX: (widest.left + widest.right) / 2,
  };
}

/* ================================================================
 * 2. 見た目の指紋（重複を調べる）
 * ============================================================== */

/**
 * 平均ハッシュ（縮めて、明るさの平均より上か下かを1ビットずつ並べる）。
 *
 * 目は 16x16 の 256ビット。8x8（64ビット）では粗すぎて、
 * 「体格の違う別人」まで同じ指紋になってしまった。
 * 細かくすると、本当に同じ絵だけが近い距離に来る。
 */
export function perceptualHash(
  image: RgbaImage,
  size = 16,
  background: [number, number, number] | null = null,
): string {
  const values: number[] = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor((gx * image.width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * image.width) / size));
      const y0 = Math.floor((gy * image.height) / size);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * image.height) / size));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * image.width + x) * 4;
          const r = image.data[i];
          const g = image.data[i + 1];
          const b = image.data[i + 2];
          const isBackground =
            image.data[i + 3] < 128 ||
            (background !== null && nearBackground(r, g, b, background, 24));
          // 背景は0として数える。下地の色に指紋が引きずられないように
          sum += isBackground ? 0 : luminance(r, g, b) * (image.data[i + 3] / 255);
          n += 1;
        }
      }
      values.push(n === 0 ? 0 : sum / n);
    }
  }
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  let bits = '';
  for (const value of values) bits += value >= average ? '1' : '0';
  // 16進にまとめる（読みやすさのため）
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** 指紋どうしの違い（違うビットの数）。0 なら同じ絵 */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff > 0) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/**
 * これ以下しか違わなければ「同じ絵」とみなす。256ビット中の4ビット。
 *
 * かなり厳しく取ってある。平均ハッシュが見分けられるのは
 * 「ほとんど同じ絵」までで、「似た顔の別人」までは見分けられないため。
 * ゆるくすると、体格の違う別人まで重複と言い出す（実際に9ビットで衝突した）。
 * 「同じ顔の量産に見えないか」は目で見るしかない → NEEDS_EYE。
 */
export const DUPLICATE_DISTANCE = 4;

/* ================================================================
 * 3. 検査（§15）
 * ============================================================== */

/**
 * 余白の下限（§5）。キャンバスに対する割合。
 *
 * 4.7-A では「切れていない」ことしか見ていなかったので、
 * 上3px・下5pxのぎりぎりが PASS で通ってしまった。
 * 割合で見れば、そういうものを WARN として拾える。
 */
export const MARGIN_TOP_MIN = 0.06;
export const MARGIN_BOTTOM_MIN = 0.06;
export const MARGIN_SIDE_MIN = 0.04;

/** 頭身の許容。2〜3頭身が狙いなので、少し広めに取る */
export const HEADS_TALL_MIN = 1.8;
export const HEADS_TALL_MAX = 3.6;

/** 顔が読める大きさか。頭の幅がキャンバス幅に占める割合の下限 */
export const HEAD_WIDTH_MIN_RATIO = 0.14;

/** 中央からどれだけずれてよいか（キャンバス幅に対する割合） */
export const CENTER_TOLERANCE_RATIO = 0.12;

export interface CharacterCheckInput {
  id: string;
  image: RgbaImage;
  /** すでに採用した絵の指紋。重複を調べるのに使う */
  known?: string[];
}

export function checkCharacter(input: CharacterCheckInput): CharacterReport {
  const { image } = input;
  const checks: CharacterCheck[] = [];
  const add = (id: string, label: string, level: CheckLevel, detail: string) =>
    checks.push({ id, label, level, detail });

  const background = backgroundColor(image);
  const bounds = contentBoundsOver(image, background);
  const metrics = figureMetrics(image);
  const hash = perceptualHash(image, 16, background);

  /* ---- 1. 中身があるか ---- */
  if (bounds.empty) {
    add('has-content', '中身がある', 'FAIL', '空の画像です');
    return { id: input.id, checks, accepted: false, metrics: null, hash };
  }
  add('has-content', '中身がある', 'PASS', `${bounds.width}x${bounds.height}`);

  /* ---- 2. 頭が切れていないか（§15）。余白は割合で見る（§5） ---- */
  const topMargin = bounds.top;
  const topRatio = topMargin / image.height;
  if (topMargin <= 1) {
    add('head-inside', '頭が切れていない', 'FAIL', '中身が画面の上端に接しています');
  } else if (topRatio < MARGIN_TOP_MIN) {
    add(
      'head-inside',
      '頭が切れていない',
      'WARN',
      `上の余白が ${topMargin}px（${(topRatio * 100).toFixed(1)}%）しかありません`,
    );
  } else {
    add('head-inside', '頭が切れていない', 'PASS', `上の余白 ${(topRatio * 100).toFixed(1)}%`);
  }

  /* ---- 3. 足が切れていないか（§15） ---- */
  const bottomMargin = image.height - 1 - bounds.bottom;
  const bottomRatio = bottomMargin / image.height;
  if (bottomMargin <= 1) {
    add('feet-inside', '足が切れていない', 'FAIL', '中身が画面の下端に接しています');
  } else if (bottomRatio < MARGIN_BOTTOM_MIN) {
    add(
      'feet-inside',
      '足が切れていない',
      'WARN',
      `下の余白が ${bottomMargin}px（${(bottomRatio * 100).toFixed(1)}%）しかありません`,
    );
  } else {
    add('feet-inside', '足が切れていない', 'PASS', `下の余白 ${(bottomRatio * 100).toFixed(1)}%`);
  }

  /* ---- 4. 左右が切れていないか ---- */
  const sideMargin = Math.min(bounds.left, image.width - 1 - bounds.right);
  const sideRatio = sideMargin / image.width;
  if (sideMargin <= 1) {
    add('sides-inside', '身体が左右に切れていない', 'FAIL', '中身が画面の横端に接しています');
  } else if (sideRatio < MARGIN_SIDE_MIN) {
    add(
      'sides-inside',
      '身体が左右に切れていない',
      'WARN',
      `横の余白が ${sideMargin}px（${(sideRatio * 100).toFixed(1)}%）しかありません`,
    );
  } else {
    add('sides-inside', '身体が左右に切れていない', 'PASS', `横の余白 ${(sideRatio * 100).toFixed(1)}%`);
  }

  /* ---- 5. 背景が抜けるか（§6・§15） ---- */
  const bg = classifyBackground(image);
  add('background-removable', '背景が抜ける', bg.level, bg.detail);

  /* ---- 6. 人物が1人か（§15） ---- */
  const share = largestComponentShare(image, background);
  if (share < 0.55) {
    add(
      'single-figure',
      '人物が1人',
      'FAIL',
      `いちばん大きなかたまりが中身の ${(share * 100).toFixed(0)}% しかありません（複数人の可能性）`,
    );
  } else if (share < 0.8) {
    add('single-figure', '人物が1人', 'WARN', `いちばん大きなかたまりが ${(share * 100).toFixed(0)}%`);
  } else {
    add('single-figure', '人物が1人', 'PASS', `いちばん大きなかたまりが ${(share * 100).toFixed(0)}%`);
  }

  /* ---- 7. 頭身（§1） ---- */
  if (!metrics) {
    add('heads-tall', '2〜3頭身になっている', 'WARN', '首が見つからず、頭身を測れませんでした');
  } else if (metrics.headsTall < HEADS_TALL_MIN || metrics.headsTall > HEADS_TALL_MAX) {
    add(
      'heads-tall',
      '2〜3頭身になっている',
      'FAIL',
      `${metrics.headsTall.toFixed(1)}頭身です（狙いは ${HEADS_TALL_MIN}〜${HEADS_TALL_MAX}）`,
    );
  } else {
    add('heads-tall', '2〜3頭身になっている', 'PASS', `${metrics.headsTall.toFixed(1)}頭身`);
  }

  /* ---- 8. 顔が十分大きいか（§15） ---- */
  if (metrics) {
    const ratio = metrics.headWidth / image.width;
    if (ratio < HEAD_WIDTH_MIN_RATIO) {
      add(
        'face-size',
        '顔が十分大きい',
        'FAIL',
        `頭の幅が画面の ${(ratio * 100).toFixed(0)}% しかありません`,
      );
    } else {
      add('face-size', '顔が十分大きい', 'PASS', `頭の幅が画面の ${(ratio * 100).toFixed(0)}%`);
    }
  }

  /* ---- 9. 中央に置かれているか（§11） ---- */
  const centreX = (bounds.left + bounds.right) / 2;
  const offset = Math.abs(centreX - image.width / 2);
  if (offset > image.width * CENTER_TOLERANCE_RATIO) {
    add('centered', '中央に置かれている', 'WARN', `中心が ${offset.toFixed(0)}px ずれています`);
  } else {
    add('centered', '中央に置かれている', 'PASS', `中心のずれ ${offset.toFixed(0)}px`);
  }

  /* ---- 10. 立ち姿になっているか ---- */
  const aspect = bounds.height / Math.max(1, bounds.width);
  if (aspect < 1.0) {
    add('upright', '立ち姿になっている', 'FAIL', `縦横比 ${aspect.toFixed(2)}（横に広すぎます）`);
  } else {
    add('upright', '立ち姿になっている', 'PASS', `縦横比 ${aspect.toFixed(2)}`);
  }

  /* ---- 11. 既存の絵と重なっていないか（§15・§18） ---- */
  const known = input.known ?? [];
  const nearest = known.reduce(
    (best, other) => Math.min(best, hashDistance(hash, other)),
    Number.POSITIVE_INFINITY,
  );
  if (known.length === 0) {
    add('duplicate', '既存の絵と重なっていない', 'PASS', '比べる相手がまだありません');
  } else if (nearest <= DUPLICATE_DISTANCE) {
    add('duplicate', '既存の絵と重なっていない', 'FAIL', `すでにある絵とほぼ同じです（違い ${nearest}）`);
  } else {
    add('duplicate', '既存の絵と重なっていない', 'PASS', `いちばん近い絵との違い ${nearest}`);
  }

  return {
    id: input.id,
    checks,
    accepted: !checks.some((check) => check.level === 'FAIL'),
    metrics,
    hash,
  };
}

/* ================================================================
 * 4. 補助
 * ============================================================== */

/**
 * いちばん大きなかたまりが、中身全体のどれだけを占めるか。
 *
 * 2人描かれていると、かたまりが2つに割れて割合が下がる。
 * 走査は行ごとの区間で行い、上下の行とつなげる（塗りつぶしより速く、
 * 1024x1280 でも一瞬で終わる）。
 */
export function largestComponentShare(
  image: RgbaImage,
  background: [number, number, number] | null,
  tolerance = 24,
): number {
  const { width, height, data } = image;
  const parent: number[] = [];
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    let node = a;
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const solid = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return false;
    if (background && nearBackground(data[i], data[i + 1], data[i + 2], background, tolerance)) {
      return false;
    }
    return true;
  };

  // 行ごとの連続区間を作る
  interface Run {
    y: number;
    from: number;
    to: number;
    id: number;
    size: number;
  }
  const runs: Run[] = [];
  const byRow: Run[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Run[] = [];
    let x = 0;
    while (x < width) {
      if (!solid(x, y)) {
        x += 1;
        continue;
      }
      const from = x;
      while (x < width && solid(x, y)) x += 1;
      const run: Run = { y, from, to: x - 1, id: runs.length, size: x - from };
      parent[run.id] = run.id;
      runs.push(run);
      row.push(run);
    }
    byRow.push(row);
  }
  if (runs.length === 0) return 0;

  for (let y = 1; y < height; y++) {
    for (const run of byRow[y]) {
      for (const above of byRow[y - 1]) {
        if (above.to < run.from || above.from > run.to) continue;
        union(above.id, run.id);
      }
    }
  }

  const sizes = new Map<number, number>();
  let total = 0;
  for (const run of runs) {
    const root = find(run.id);
    sizes.set(root, (sizes.get(root) ?? 0) + run.size);
    total += run.size;
  }
  let largest = 0;
  for (const size of sizes.values()) if (size > largest) largest = size;
  return total === 0 ? 0 : largest / total;
}

/* ================================================================
 * 5. 帽子の検査（PHASE 4.7-B §4・§12）
 * ============================================================== */

/** 帽子の余白の下限。本体より広めに取る（重ねるときに縁が要る） */
export const CAP_MARGIN_MIN = 0.05;

/** 帽子の縦横比の許容。野球帽は横長になる */
export const CAP_ASPECT_MIN = 0.45;
export const CAP_ASPECT_MAX = 1.15;

/** 左右のずれの許容（帽子の幅に対する割合） */
export const CAP_SYMMETRY_TOLERANCE = 0.12;

export interface CapReport {
  id: string;
  checks: CharacterCheck[];
  accepted: boolean;
  hash: string;
  /** つばを含めた幅と高さ */
  width: number;
  height: number;
}

/**
 * 帽子1つを検査する。
 *
 * 本体と見るところが違う。帽子は
 *   ・中身が1つのかたまりであること（つばが千切れていないこと）
 *   ・左右がだいたい対称であること（つばの破綻はここに出る）
 *   ・横長であること（縦長なら帽子の形をしていない）
 *   ・背景が抜けること
 * を見る。顔や頭が写り込んでいないかは目で見るしかない。
 */
export function checkCap(input: { id: string; image: RgbaImage; known?: string[] }): CapReport {
  const { image } = input;
  const checks: CharacterCheck[] = [];
  const add = (id: string, label: string, level: CheckLevel, detail: string) =>
    checks.push({ id, label, level, detail });

  const background = backgroundColor(image);
  const bounds = contentBoundsOver(image, background);
  const hash = perceptualHash(image, 16, background);

  if (bounds.empty) {
    add('has-content', '中身がある', 'FAIL', '空の画像です');
    return { id: input.id, checks, accepted: false, hash, width: 0, height: 0 };
  }
  add('has-content', '中身がある', 'PASS', `${bounds.width}x${bounds.height}`);

  /* ---- 切れていないか（§12 つば破綻） ---- */
  const margins = {
    top: bounds.top / image.height,
    bottom: (image.height - 1 - bounds.bottom) / image.height,
    left: bounds.left / image.width,
    right: (image.width - 1 - bounds.right) / image.width,
  };
  const smallest = Math.min(margins.top, margins.bottom, margins.left, margins.right);
  if (smallest <= 0.002) {
    add('cap-inside', '帽子が切れていない', 'FAIL', '中身が画面の端に接しています');
  } else if (smallest < CAP_MARGIN_MIN) {
    add('cap-inside', '帽子が切れていない', 'WARN', `いちばん狭い余白が ${(smallest * 100).toFixed(1)}%`);
  } else {
    add('cap-inside', '帽子が切れていない', 'PASS', `いちばん狭い余白 ${(smallest * 100).toFixed(1)}%`);
  }

  /* ---- 形が横長か ---- */
  const aspect = bounds.height / Math.max(1, bounds.width);
  if (aspect < CAP_ASPECT_MIN || aspect > CAP_ASPECT_MAX) {
    add('cap-shape', '帽子の形をしている', 'FAIL', `縦横比 ${aspect.toFixed(2)}（帽子としては不自然）`);
  } else {
    add('cap-shape', '帽子の形をしている', 'PASS', `縦横比 ${aspect.toFixed(2)}`);
  }

  /* ---- 左右がそろっているか（つばの破綻はここに出る） ---- */
  const skew = capSymmetry(image, background, bounds);
  if (skew > CAP_SYMMETRY_TOLERANCE * 2) {
    add('cap-symmetry', '左右がそろっている', 'FAIL', `左右のずれ ${(skew * 100).toFixed(0)}%`);
  } else if (skew > CAP_SYMMETRY_TOLERANCE) {
    add('cap-symmetry', '左右がそろっている', 'WARN', `左右のずれ ${(skew * 100).toFixed(0)}%`);
  } else {
    add('cap-symmetry', '左右がそろっている', 'PASS', `左右のずれ ${(skew * 100).toFixed(0)}%`);
  }

  /* ---- 1つのかたまりか（つばが千切れていないか） ---- */
  const share = largestComponentShare(image, background);
  if (share < 0.9) {
    add(
      'cap-single',
      '帽子がひとつながり',
      share < 0.75 ? 'FAIL' : 'WARN',
      `いちばん大きなかたまりが ${(share * 100).toFixed(0)}%`,
    );
  } else {
    add('cap-single', '帽子がひとつながり', 'PASS', `いちばん大きなかたまりが ${(share * 100).toFixed(0)}%`);
  }

  /* ---- 背景（§6） ---- */
  const bg = classifyBackground(image);
  add('cap-background', '背景が抜ける', bg.level, bg.detail);

  /* ---- 重複 ---- */
  const known = input.known ?? [];
  const nearest = known.reduce(
    (best, other) => Math.min(best, hashDistance(hash, other)),
    Number.POSITIVE_INFINITY,
  );
  if (known.length === 0) {
    add('duplicate', '既存の帽子と重なっていない', 'PASS', '比べる相手がまだありません');
  } else if (nearest <= DUPLICATE_DISTANCE) {
    add('duplicate', '既存の帽子と重なっていない', 'FAIL', `すでにある帽子とほぼ同じです（違い ${nearest}）`);
  } else {
    add('duplicate', '既存の帽子と重なっていない', 'PASS', `いちばん近い帽子との違い ${nearest}`);
  }

  return {
    id: input.id,
    checks,
    accepted: !checks.some((check) => check.level === 'FAIL'),
    hash,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * 左右のずれ。
 *
 * 各行の中身の中心が、全体の中心からどれだけ外れているかを平均する。
 * つばが片側だけ伸びたり欠けたりすると、ここが大きくなる。
 */
function capSymmetry(
  image: RgbaImage,
  background: [number, number, number] | null,
  bounds: Bounds,
): number {
  const centre = (bounds.left + bounds.right) / 2;
  let sum = 0;
  let rows = 0;
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    const row = contentRow(image, y, background, 24);
    if (row.count < 4) continue;
    sum += Math.abs((row.left + row.right) / 2 - centre);
    rows += 1;
  }
  if (rows === 0) return 1;
  return sum / rows / Math.max(1, bounds.width);
}

/**
 * 背景の見立て（§6）。
 *
 *   透明          → PASS
 *   単色          → 抜けるので PASS（縁が一様なら）
 *   複雑・景色つき → REJECT
 */
export function classifyBackground(image: RgbaImage): { level: CheckLevel; detail: string } {
  if (looksTransparent(image)) return { level: 'PASS', detail: 'すでに透明です' };
  const estimate = estimateBackground(image);
  const detail =
    `単色 rgb(${estimate.color.join(',')}) / 一様さ ${(estimate.uniformity * 100).toFixed(0)}%` +
    ` / ばらつき ${estimate.spread.toFixed(0)}`;
  if (estimate.uniformity < 0.6) {
    return { level: 'FAIL', detail: `${detail} … 背景が描き込まれています（複雑な背景は不採用）` };
  }
  if (estimate.uniformity < 0.9) return { level: 'WARN', detail };
  return { level: 'PASS', detail };
}
