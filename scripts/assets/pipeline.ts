/**
 * PHASE 4.7 生成画像の後処理（§5）。
 *
 * 画像生成AIは、頼んだとおりの位置・大きさ・背景では返してこない。
 * プロンプトで直そうとしても直らないので、必ず機械で直す。
 *
 *   生成画像
 *     ↓ 背景除去
 *     ↓ アルファの掃除
 *     ↓ 中身の切り出し
 *     ↓ 基準点合わせ（拡大縮小 + 平行移動）
 *     ↓ 共通キャンバスへ配置
 *     ↓ 色の振り分け（髪色・肌色）
 *     ↓ 派生サイズ書き出し
 *
 * ここは画素をいじるだけ。ファイルも通信も知らない。
 */
import { createImage, type RgbaImage } from './png';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type AnchorPoint } from './anchors';

/* ================================================================
 * 背景除去
 * ============================================================== */

export interface RemoveBackgroundOptions {
  /** 背景と見なす色の許容差（0〜255） */
  tolerance?: number;
  /** 端から塗りつぶす。中の同じ色は残す */
  fromEdges?: boolean;
}

/**
 * 背景を透明にする。
 *
 * 単純な色置換ではなく、画像の端から広がるところだけを消す。
 * そうしないと、白いユニフォームや白目まで一緒に消える。
 */
export function removeBackground(
  source: RgbaImage,
  options: RemoveBackgroundOptions = {},
): RgbaImage {
  const tolerance = options.tolerance ?? 24;
  const fromEdges = options.fromEdges ?? true;
  const out: RgbaImage = {
    width: source.width,
    height: source.height,
    data: new Uint8Array(source.data),
  };
  const { width, height, data } = out;
  if (width === 0 || height === 0) return out;

  // 四隅の色の中央値を「背景の色」とみなす
  const corners = [
    pixelAt(data, width, 0, 0),
    pixelAt(data, width, width - 1, 0),
    pixelAt(data, width, 0, height - 1),
    pixelAt(data, width, width - 1, height - 1),
  ];
  const bg = medianColor(corners);

  if (!fromEdges) {
    for (let i = 0; i < data.length; i += 4) {
      if (colorDistance(data[i], data[i + 1], data[i + 2], bg) <= tolerance) data[i + 3] = 0;
    }
    return out;
  }

  // 端から、背景に近い色をたどって消していく
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    seen[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length > 0) {
    const index = stack.pop()!;
    const at = index * 4;
    if (data[at + 3] === 0) {
      // もともと透明なところも背景として広げる
    } else if (colorDistance(data[at], data[at + 1], data[at + 2], bg) > tolerance) {
      continue;
    }
    data[at + 3] = 0;
    const x = index % width;
    const y = (index - x) / width;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return out;
}

function pixelAt(data: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const at = (y * width + x) * 4;
  return [data[at], data[at + 1], data[at + 2]];
}

function medianColor(colors: Array<[number, number, number]>): [number, number, number] {
  const pick = (channel: number) => {
    const values = colors.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return [pick(0), pick(1), pick(2)];
}

function colorDistance(r: number, g: number, b: number, to: [number, number, number]): number {
  return Math.max(Math.abs(r - to[0]), Math.abs(g - to[1]), Math.abs(b - to[2]));
}

/* ================================================================
 * アルファの掃除
 * ============================================================== */

export interface CleanAlphaOptions {
  /** これ以下は完全な透明にする */
  floor?: number;
  /** これ以上は完全な不透明にする */
  ceiling?: number;
  /** ぽつんと残った点を消す */
  despeckle?: boolean;
}

/**
 * 半端なアルファを整える。
 * 背景を抜いたあとに残る「うっすら見える縁」を消すのが目的。
 */
export function cleanAlpha(source: RgbaImage, options: CleanAlphaOptions = {}): RgbaImage {
  const floor = options.floor ?? 12;
  const ceiling = options.ceiling ?? 243;
  const despeckle = options.despeckle ?? true;
  const out: RgbaImage = {
    width: source.width,
    height: source.height,
    data: new Uint8Array(source.data),
  };
  const { data, width, height } = out;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= floor) data[i] = 0;
    else if (data[i] >= ceiling) data[i] = 255;
  }

  if (despeckle) {
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (alpha[index] === 0) continue;
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (alpha[ny * width + nx] > 0) neighbours += 1;
          }
        }
        // 周りが全部透明なら、ただのごみ
        if (neighbours === 0) data[index * 4 + 3] = 0;
      }
    }
  }

  // 完全に透明な画素の色は 0 にそろえる（縁の色にじみを防ぐ）
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
  return out;
}

/* ================================================================
 * 中身の範囲
 * ============================================================== */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  empty: boolean;
}

/** 不透明な画素が入っている範囲を求める */
export function contentBounds(image: RgbaImage, threshold = 8): Bounds {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, empty: true };
  }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    empty: false,
  };
}

/** 中身だけを切り出す */
export function cropToContent(image: RgbaImage, threshold = 8): RgbaImage {
  const bounds = contentBounds(image, threshold);
  if (bounds.empty) return createImage(1, 1);
  return crop(image, bounds.left, bounds.top, bounds.width, bounds.height);
}

export function crop(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const out = createImage(width, height);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    for (let column = 0; column < width; column++) {
      const sx = x + column;
      if (sx < 0 || sx >= image.width) continue;
      const from = (sy * image.width + sx) * 4;
      const to = (row * width + column) * 4;
      out.data[to] = image.data[from];
      out.data[to + 1] = image.data[from + 1];
      out.data[to + 2] = image.data[from + 2];
      out.data[to + 3] = image.data[from + 3];
    }
  }
  return out;
}

/* ================================================================
 * 拡大縮小
 * ============================================================== */

/**
 * 双一次で拡大縮小する。
 * アルファを掛けてから混ぜる（そうしないと縁に黒が出る）。
 */
export function resize(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) {
    return { width, height, data: new Uint8Array(image.data) };
  }
  const out = createImage(width, height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sx - x0;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const mix = (px: number, py: number, weight: number) => {
        const at = (py * image.width + px) * 4;
        const alpha = image.data[at + 3] / 255;
        r += image.data[at] * alpha * weight;
        g += image.data[at + 1] * alpha * weight;
        b += image.data[at + 2] * alpha * weight;
        a += image.data[at + 3] * weight;
      };
      mix(x0, y0, (1 - fx) * (1 - fy));
      mix(x1, y0, fx * (1 - fy));
      mix(x0, y1, (1 - fx) * fy);
      mix(x1, y1, fx * fy);

      const to = (y * width + x) * 4;
      const alpha = a / 255;
      out.data[to] = alpha > 0 ? clamp255(r / alpha) : 0;
      out.data[to + 1] = alpha > 0 ? clamp255(g / alpha) : 0;
      out.data[to + 2] = alpha > 0 ? clamp255(b / alpha) : 0;
      out.data[to + 3] = clamp255(a);
    }
  }
  return out;
}

function clamp255(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/* ================================================================
 * 共通キャンバスへの配置
 * ============================================================== */

export interface FitOptions {
  /** 置き先のキャンバス */
  canvasWidth?: number;
  canvasHeight?: number;
  /** 中身の中心を、この点に合わせる */
  anchor: AnchorPoint;
  /** 中身の幅をこの値にそろえる。指定しなければ拡大縮小しない */
  targetWidth?: number;
  /** 中身の高さをこの値にそろえる */
  targetHeight?: number;
  /** キャンバスからはみ出さないように縮める */
  clampToCanvas?: boolean;
}

/**
 * 中身を切り出し、大きさをそろえ、基準点へ置き直す（§5・§7）。
 *
 * これがあるおかげで、生成AIが人物をどこに描いてきても、
 * 最後には必ず同じ位置に収まる。
 */
export function fitToCanvas(source: RgbaImage, options: FitOptions): RgbaImage {
  const canvasWidth = options.canvasWidth ?? CANVAS_WIDTH;
  const canvasHeight = options.canvasHeight ?? CANVAS_HEIGHT;
  const out = createImage(canvasWidth, canvasHeight);

  const content = cropToContent(source);
  if (content.width <= 1 && content.height <= 1) return out;

  let scale = 1;
  if (options.targetWidth) scale = options.targetWidth / content.width;
  if (options.targetHeight) {
    const byHeight = options.targetHeight / content.height;
    scale = options.targetWidth ? Math.min(scale, byHeight) : byHeight;
  }
  if (options.clampToCanvas !== false) {
    scale = Math.min(scale, canvasWidth / content.width, canvasHeight / content.height);
  }

  const width = Math.max(1, Math.round(content.width * scale));
  const height = Math.max(1, Math.round(content.height * scale));
  const scaled = resize(content, width, height);

  const left = Math.round(options.anchor.x - width / 2);
  const top = Math.round(options.anchor.y - height / 2);
  compose(out, scaled, left, top);
  return out;
}

/** 上に重ねる（アルファ合成） */
export function compose(target: RgbaImage, source: RgbaImage, left: number, top: number): void {
  for (let y = 0; y < source.height; y++) {
    const ty = top + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < source.width; x++) {
      const tx = left + x;
      if (tx < 0 || tx >= target.width) continue;
      const from = (y * source.width + x) * 4;
      const alpha = source.data[from + 3];
      if (alpha === 0) continue;
      const to = (ty * target.width + tx) * 4;
      if (alpha === 255) {
        target.data[to] = source.data[from];
        target.data[to + 1] = source.data[from + 1];
        target.data[to + 2] = source.data[from + 2];
        target.data[to + 3] = 255;
        continue;
      }
      const sa = alpha / 255;
      const da = target.data[to + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        const value =
          (source.data[from + c] * sa + target.data[to + c] * da * (1 - sa)) / (outA || 1);
        target.data[to + c] = clamp255(value);
      }
      target.data[to + 3] = clamp255(outA * 255);
    }
  }
}

/* ================================================================
 * 色の振り分け
 * ============================================================== */

export type Rgb = [number, number, number];

/**
 * 明るさを手がかりに色を差し替える（§13 の hair_color / skin_tone）。
 *
 * AIには「形」だけ作らせて、色はここで振り分ける。
 * そうすれば、同じ形のまま10色そろい、費用も10分の1で済む。
 */
export function recolor(source: RgbaImage, dark: Rgb, light: Rgb): RgbaImage {
  const out: RgbaImage = {
    width: source.width,
    height: source.height,
    data: new Uint8Array(source.data),
  };
  const { data } = out;

  // 不透明な画素の明るさの範囲を先に測る（素材ごとに明るさの幅が違うため）
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const value = luminance(data[i], data[i + 1], data[i + 2]);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = Math.max(1, max - min);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const t = (luminance(data[i], data[i + 1], data[i + 2]) - min) / span;
    data[i] = clamp255(dark[0] + (light[0] - dark[0]) * t);
    data[i + 1] = clamp255(dark[1] + (light[1] - dark[1]) * t);
    data[i + 2] = clamp255(dark[2] + (light[2] - dark[2]) * t);
  }
  return out;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 髪の10色（暗い側・明るい側）。style-bible.md と同じ並び */
export const HAIR_RAMPS: Array<{ name: string; dark: Rgb; light: Rgb }> = [
  { name: 'black', dark: [17, 15, 14], light: [72, 66, 62] },
  { name: 'dark brown', dark: [30, 22, 17], light: [96, 76, 60] },
  { name: 'brown', dark: [48, 34, 24], light: [128, 100, 74] },
  { name: 'light brown', dark: [66, 48, 33], light: [160, 128, 96] },
  { name: 'auburn', dark: [60, 30, 22], light: [154, 92, 62] },
  { name: 'dark blond', dark: [84, 64, 38], light: [190, 160, 110] },
  { name: 'grey streaked', dark: [46, 44, 42], light: [168, 164, 158] },
  { name: 'mostly grey', dark: [92, 90, 88], light: [198, 196, 192] },
  { name: 'white', dark: [140, 138, 136], light: [238, 237, 234] },
  { name: 'silver', dark: [112, 116, 120], light: [214, 218, 222] },
];

/** 肌の8段階 */
export const SKIN_RAMPS: Array<{ name: string; dark: Rgb; light: Rgb }> = [
  { name: 'very light', dark: [214, 172, 146], light: [250, 226, 208] },
  { name: 'light', dark: [200, 156, 128], light: [244, 216, 194] },
  { name: 'light medium', dark: [178, 134, 106], light: [232, 198, 172] },
  { name: 'medium', dark: [156, 114, 86], light: [216, 176, 146] },
  { name: 'medium tan', dark: [134, 96, 70], light: [196, 152, 120] },
  { name: 'tan', dark: [112, 78, 56], light: [172, 128, 98] },
  { name: 'deep', dark: [86, 58, 40], light: [140, 100, 74] },
  { name: 'very deep', dark: [62, 42, 30], light: [108, 76, 56] },
];

/* ================================================================
 * ひとつながりの流れ
 * ============================================================== */

export interface ProcessOptions {
  anchor: AnchorPoint;
  targetWidth?: number;
  targetHeight?: number;
  tolerance?: number;
  /** すでに透明背景なら背景除去を飛ばす */
  skipBackgroundRemoval?: boolean;
}

export interface ProcessResult {
  image: RgbaImage;
  /** 何をしたかの記録（検査の説明に使う） */
  steps: string[];
  /** 後処理する前の中身の範囲 */
  sourceBounds: Bounds;
}

/** 生成された1枚を、そのまま取り込める形にする */
export function processPart(source: RgbaImage, options: ProcessOptions): ProcessResult {
  const steps: string[] = [];
  const sourceBounds = contentBounds(source);

  let image = source;
  if (!options.skipBackgroundRemoval && !looksTransparent(source)) {
    image = removeBackground(image, { tolerance: options.tolerance });
    steps.push('背景除去');
  } else {
    steps.push('背景除去（不要）');
  }

  image = cleanAlpha(image);
  steps.push('アルファの掃除');

  image = fitToCanvas(image, {
    anchor: options.anchor,
    ...(options.targetWidth === undefined ? {} : { targetWidth: options.targetWidth }),
    ...(options.targetHeight === undefined ? {} : { targetHeight: options.targetHeight }),
  });
  steps.push('基準点合わせ');

  return { image, steps, sourceBounds };
}

/** すでに透明背景かどうか（四隅がすべて透明なら、抜く必要はない） */
export function looksTransparent(image: RgbaImage): boolean {
  if (image.width === 0 || image.height === 0) return true;
  const corner = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];
  return (
    corner(0, 0) === 0 &&
    corner(image.width - 1, 0) === 0 &&
    corner(0, image.height - 1) === 0 &&
    corner(image.width - 1, image.height - 1) === 0
  );
}

/** 派生サイズを作る（元は残す。§6・§19） */
export function derivatives(image: RgbaImage, widths: number[]): Map<number, RgbaImage> {
  const out = new Map<number, RgbaImage>();
  for (const width of widths) {
    const height = Math.round((width * image.height) / image.width);
    out.set(width, resize(image, width, height));
  }
  return out;
}
