/**
 * PHASE 4.7 素材の品質検査（§15・§40）。
 *
 * 機械で見られるものだけを見る。
 * 「絵として良いか」「文字が入っていないか」は人が見るしかないので、
 * 機械の点数は 100 点満点のうち上限を設け、人の確認欄を必ず残す。
 *
 * 判定：
 *   80点以上          → APPROVED（採用してよい）
 *   60〜79点          → REVIEW（人が見て決める）
 *   59点以下          → REJECT（作り直す）
 *
 * 点数がいくら高くても、人の確認が済むまで approved にはしない。
 */
import { contentBounds, looksTransparent, luminance, type Bounds } from './pipeline';
import type { RgbaImage } from './png';
import { CANVAS_HEIGHT, CANVAS_WIDTH, EXPECTED_REGION } from './anchors';
import { catalogEntry, type CatalogId } from './catalog';

export type Verdict = 'PASS' | 'WARN' | 'REJECT';
export type Grade = 'APPROVED' | 'REVIEW' | 'REJECT';

export interface QualityIssue {
  code: string;
  verdict: Verdict;
  message: string;
  /** 引く点数 */
  penalty: number;
}

export interface QualityReport {
  id: string;
  category: CatalogId;
  score: number;
  grade: Grade;
  issues: QualityIssue[];
  /** 目で見ないと決められない項目（§15） */
  humanChecks: string[];
  bounds: Bounds;
}

/** 左右で対になっている種類。左右のつり合いを見る */
const PAIRED: CatalogId[] = ['eyes', 'eyebrow', 'ears', 'accessory'];

/** 検査する。画像を1枚も変更しない */
export function inspect(image: RgbaImage, id: string, category: CatalogId): QualityReport {
  const entry = catalogEntry(category);
  const issues: QualityIssue[] = [];
  const bounds = contentBounds(image);

  /* ---- 大きさ ---- */
  if (image.width !== CANVAS_WIDTH || image.height !== CANVAS_HEIGHT) {
    issues.push({
      code: 'canvas-size',
      verdict: 'REJECT',
      penalty: 45,
      message: `キャンバスが ${image.width}x${image.height} です（${CANVAS_WIDTH}x${CANVAS_HEIGHT} にしてください）`,
    });
  }

  /* ---- 中身があるか ---- */
  if (bounds.empty) {
    issues.push({
      code: 'empty',
      verdict: 'REJECT',
      penalty: 100,
      message: '不透明な画素が1つもありません（真っ白な素材です）',
    });
    return finish(id, category, issues, bounds, []);
  }

  /* ---- 背景が残っていないか ---- */
  if (!looksTransparent(image)) {
    issues.push({
      code: 'opaque-corners',
      verdict: 'REJECT',
      penalty: 40,
      message: '四隅が透明ではありません（背景が残っています）',
    });
  }

  const stats = analyse(image);
  if (stats.opaqueRatio > 0.92) {
    issues.push({
      code: 'background-left',
      verdict: 'REJECT',
      penalty: 30,
      message: `画面の ${Math.round(stats.opaqueRatio * 100)}% が不透明です（背景が抜けていません）`,
    });
  }

  /* ---- 切れていないか ---- */
  const touching = edgesTouched(image, bounds);
  if (touching.length > 0) {
    issues.push({
      code: 'cropped',
      verdict: 'REJECT',
      penalty: 25,
      message: `中身が画面の端（${touching.join('・')}）に接しています。切れている可能性があります`,
    });
  }

  /* ---- 小さすぎないか ---- */
  const areaRatio = (bounds.width * bounds.height) / (image.width * image.height);
  if (areaRatio < 0.005) {
    issues.push({
      code: 'too-small',
      verdict: 'REJECT',
      penalty: 30,
      message: `中身が小さすぎます（画面の ${(areaRatio * 100).toFixed(2)}%）`,
    });
  } else if (areaRatio < 0.02 && entry.required) {
    issues.push({
      code: 'small',
      verdict: 'WARN',
      penalty: 8,
      message: `中身が小さめです（画面の ${(areaRatio * 100).toFixed(1)}%）`,
    });
  }

  /* ---- 置き場所が想定どおりか ---- */
  const region = EXPECTED_REGION[category];
  const top = bounds.top / image.height;
  const bottom = bounds.bottom / image.height;
  if (top < region.top - 0.08 || bottom > region.bottom + 0.08) {
    issues.push({
      code: 'out-of-region',
      verdict: 'WARN',
      penalty: 12,
      message: `想定より上下にはみ出しています（${top.toFixed(2)}〜${bottom.toFixed(2)}、想定 ${region.top}〜${region.bottom}）`,
    });
  }

  /* ---- アルファの状態 ---- */
  if (stats.softRatio > 0.35) {
    issues.push({
      code: 'soft-alpha',
      verdict: 'WARN',
      penalty: 10,
      message: `半透明の画素が多すぎます（${Math.round(stats.softRatio * 100)}%）。縁がぼやけています`,
    });
  }
  if (stats.strayRatio > 0.02) {
    issues.push({
      code: 'stray-pixels',
      verdict: 'WARN',
      penalty: 8,
      message: `本体から離れた点が残っています（${(stats.strayRatio * 100).toFixed(1)}%）`,
    });
  }

  /* ---- 色 ---- */
  if (stats.maxSaturation > 0.85) {
    issues.push({
      code: 'neon',
      verdict: 'WARN',
      penalty: 10,
      message: '彩度が高すぎる色が入っています（紙とインクの世界から外れます）',
    });
  }
  if (stats.uniqueColors < 4) {
    issues.push({
      code: 'flat',
      verdict: 'WARN',
      penalty: 12,
      message: `色が ${stats.uniqueColors} 段階しかありません。陰影がついていない可能性があります`,
    });
  }

  /* ---- 左右のつり合い ---- */
  if (PAIRED.includes(category)) {
    const skew = horizontalSkew(image, bounds);
    if (skew > 0.22) {
      issues.push({
        code: 'asymmetric',
        verdict: 'WARN',
        penalty: 12,
        message: `左右のつり合いが崩れています（ずれ ${(skew * 100).toFixed(0)}%）`,
      });
    }
    const centre = (bounds.left + bounds.right) / 2 / image.width;
    if (Math.abs(centre - 0.5) > 0.06) {
      issues.push({
        code: 'off-centre',
        verdict: 'WARN',
        penalty: 8,
        message: `中心からずれています（中心 ${(centre * 100).toFixed(0)}%）`,
      });
    }
  }

  const humanChecks = [
    '文字・数字・署名が入っていないか',
    'ロゴ・チームマーク・透かしが入っていないか',
    '実在の選手・有名人に似ていないか',
    '既存のゲーム・アニメのキャラクターに似ていないか',
    '線の太さが他の素材とそろっているか',
    '陰影の段数が他の素材とそろっているか',
    '重ねたときに他のパーツと干渉しないか',
  ];
  return finish(id, category, issues, bounds, humanChecks);
}

function finish(
  id: string,
  category: CatalogId,
  issues: QualityIssue[],
  bounds: Bounds,
  humanChecks: string[],
): QualityReport {
  const penalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { id, category, score, grade: gradeOf(score, issues), issues, humanChecks, bounds };
}

export function gradeOf(score: number, issues: QualityIssue[]): Grade {
  // REJECT が1つでもあれば、点数に関わらず作り直し
  if (issues.some((issue) => issue.verdict === 'REJECT')) return 'REJECT';
  if (score >= 80) return 'APPROVED';
  if (score >= 60) return 'REVIEW';
  return 'REJECT';
}

/* ================================================================
 * 画素を数える
 * ============================================================== */

export interface ImageStats {
  /** 不透明な画素の割合 */
  opaqueRatio: number;
  /** 半透明（1〜254）の割合 */
  softRatio: number;
  /** 本体から離れた点の割合 */
  strayRatio: number;
  /** いちばん高い彩度（0〜1） */
  maxSaturation: number;
  /** 明るさの段階の数（16段階に丸めて数える） */
  uniqueColors: number;
}

export function analyse(image: RgbaImage): ImageStats {
  const total = image.width * image.height;
  if (total === 0) {
    return { opaqueRatio: 0, softRatio: 0, strayRatio: 0, maxSaturation: 0, uniqueColors: 0 };
  }
  let opaque = 0;
  let soft = 0;
  let maxSaturation = 0;
  const levels = new Set<number>();

  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (alpha === 0) continue;
    opaque += 1;
    if (alpha < 255) soft += 1;
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 0) maxSaturation = Math.max(maxSaturation, (max - min) / max);
    levels.add(Math.round(luminance(r, g, b) / 16));
  }

  return {
    opaqueRatio: opaque / total,
    softRatio: opaque === 0 ? 0 : soft / opaque,
    strayRatio: strayRatio(image, opaque),
    maxSaturation,
    uniqueColors: levels.size,
  };
}

/**
 * いちばん大きなかたまりに入っていない不透明画素の割合。
 * 背景の消し残りや、ぽつんと浮いたごみを見つける。
 */
function strayRatio(image: RgbaImage, opaque: number): number {
  if (opaque === 0) return 0;
  const { width, height, data } = image;
  const seen = new Uint8Array(width * height);
  let largest = 0;

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || data[start * 4 + 3] === 0) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      const visit = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const next = ny * width + nx;
        if (seen[next] || data[next * 4 + 3] === 0) return;
        seen[next] = 1;
        stack.push(next);
      };
      visit(x - 1, y);
      visit(x + 1, y);
      visit(x, y - 1);
      visit(x, y + 1);
    }
    if (size > largest) largest = size;
  }
  return (opaque - largest) / opaque;
}

/** 左半分と右半分の重さの差（0 ならぴったり対称） */
export function horizontalSkew(image: RgbaImage, bounds: Bounds): number {
  const middle = Math.round((bounds.left + bounds.right) / 2);
  let left = 0;
  let right = 0;
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha === 0) continue;
      if (x < middle) left += alpha;
      else if (x > middle) right += alpha;
    }
  }
  const sum = left + right;
  return sum === 0 ? 0 : Math.abs(left - right) / sum;
}

/** 中身が画面の端に接しているか */
export function edgesTouched(image: RgbaImage, bounds: Bounds): string[] {
  const out: string[] = [];
  if (bounds.left <= 0) out.push('左');
  if (bounds.top <= 0) out.push('上');
  if (bounds.right >= image.width - 1) out.push('右');
  if (bounds.bottom >= image.height - 1) out.push('下');
  return out;
}
