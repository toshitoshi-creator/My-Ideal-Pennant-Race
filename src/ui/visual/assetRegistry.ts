/**
 * PHASE 4.7 画像素材の台帳（PHASE 4.6 から拡張）。
 *
 * ビルド時に同梱された素材だけを見る。実行時に外部へ取りに行くことは一切しない
 * （CDN・外部URL・画像生成AI・APIキーのいずれも使わない。§33・§34）。
 *
 * 素材が1枚も無くても正常に動く。そのとき resolve は null を返し、
 * 描画側は PHASE 4.5 の SVG に落とす（§1・§37・§50）。
 */
import manifestJson from '../../assets/players/manifest.json';
import type { VisualCategory } from '../../domain/visualProfile';

/** manifest に載る1点ぶんの素材 */
export interface AssetEntry {
  id: string;
  /** 色違いのもとになった「形」のID。色違いでなければ id と同じ */
  base?: string;
  /** 色の番号（1から）。色違いでなければ無い */
  color?: number;
  /** 種類 */
  type?: string;
  /** src/assets/players/ からの相対パス */
  path: string | null;
  width: number;
  height: number;
  bytes?: number;
  sha1?: string;
  /** small / medium / large / hero などのサイズ違い */
  variants?: Record<string, string>;
  anchor?: Record<string, number> | null;
  /** 重ねる順。素材ごとに変えられる（§8） */
  zIndex?: number;
  /** 機械検査の点数（0〜100）。検査していなければ null */
  quality?: number | null;
  /** 採用してよいか。false のものはゲームに出さない（§15・§40） */
  approved?: boolean;
  /** 出所（§17）。鍵・利用者情報は入らない */
  source?: string;
  version?: number;
  /** この素材と組み合わせてよい相手（空なら制限なし。§14） */
  compatibleTypes?: string[];
  tags?: string[];
}

export interface AssetManifest {
  version: number;
  canvas: { width: number; height: number };
  note?: string;
  /** 色違いを除いた「形」の数。素材の充実度はこれで測る */
  structural?: Partial<Record<VisualCategory, number>>;
  parts: Partial<Record<VisualCategory, AssetEntry[]>>;
}

export const manifest = manifestJson as AssetManifest;

/**
 * 実際に同梱されている画像のURL。
 * Vite が解決するので、存在しないファイルはここに現れない。
 * manifest に書いてあってもファイルが無ければ「無い」として扱える。
 */
const FILES = import.meta.glob('../../assets/players/**/*.{webp,png}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** '../../assets/players/base/head_001.webp' → 'base/head_001.webp' */
function relativeKey(globPath: string): string {
  const marker = 'assets/players/';
  const at = globPath.indexOf(marker);
  return at >= 0 ? globPath.slice(at + marker.length) : globPath;
}

const URL_BY_PATH = new Map<string, string>();
for (const [globPath, url] of Object.entries(FILES)) {
  URL_BY_PATH.set(relativeKey(globPath), url);
}

/** 種類 → 素材ID → 素材 */
const INDEX = new Map<string, Map<string, AssetEntry>>();
/** 種類 → 「形」のID → 色の番号 → 素材 */
const COLOR_INDEX = new Map<string, Map<string, Map<number, AssetEntry>>>();

for (const [category, entries] of Object.entries(manifest.parts ?? {})) {
  const byId = new Map<string, AssetEntry>();
  const byColor = new Map<string, Map<number, AssetEntry>>();
  for (const entry of entries ?? []) {
    // 却下された素材は最初から無いものとして扱う（§15）
    if (entry.approved === false) continue;
    byId.set(entry.id, entry);
    if (entry.color !== undefined && entry.base) {
      const colors = byColor.get(entry.base) ?? new Map<number, AssetEntry>();
      colors.set(entry.color, entry);
      byColor.set(entry.base, colors);
    }
  }
  INDEX.set(category, byId);
  COLOR_INDEX.set(category, byColor);
}

export type AssetSize = 'small' | 'medium' | 'large' | 'hero';

/**
 * 素材のURLを返す。
 * manifest に載っていない・ファイルが無い・パスが空、のいずれでも null。
 */
export function resolveAsset(
  category: VisualCategory,
  id: string,
  size: AssetSize = 'medium',
  colorIndex?: number,
): string | null {
  const entry = pickEntry(category, id, colorIndex);
  if (!entry) return null;
  // サイズ違いがあればそれを使う（一覧で巨大画像を読まないため。§49）
  const variantPath = entry.variants?.[size];
  if (variantPath) {
    const url = URL_BY_PATH.get(variantPath);
    if (url) return url;
  }
  if (!entry.path) return null;
  return URL_BY_PATH.get(entry.path) ?? null;
}

/**
 * 色の指定があればその色を、無ければ「形」そのものを返す。
 * 指定した色が無ければ、いちばん近い色に寄せる（色が10段階そろっていなくても破綻しない）。
 */
function pickEntry(
  category: VisualCategory,
  id: string,
  colorIndex?: number,
): AssetEntry | undefined {
  const byId = INDEX.get(category);
  if (!byId) return undefined;
  if (colorIndex === undefined) return byId.get(id);

  const colors = COLOR_INDEX.get(category)?.get(id);
  if (!colors || colors.size === 0) return byId.get(id);

  const wanted = colorIndex + 1;
  const exact = colors.get(wanted);
  if (exact) return exact;
  let best: AssetEntry | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [number, entry] of colors) {
    const distance = Math.abs(number - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best ?? byId.get(id);
}

/** その素材が実際に同梱されているか */
export function hasAsset(category: VisualCategory, id: string): boolean {
  return resolveAsset(category, id) !== null;
}

/**
 * その種類に「形」が何通りあるか（設計図の割り当てに使う）。
 * 色違いは形の数には数えない。数えてしまうと、
 * 同じ形の色違いが別人として割り当てられてしまう。
 */
export function assetCount(category: VisualCategory): number {
  const entries = manifest.parts?.[category];
  if (!entries) return 0;
  const shapes = new Set<string>();
  for (const entry of entries) {
    if (entry.approved === false) continue;
    if (!entry.path || !URL_BY_PATH.has(entry.path)) continue;
    shapes.add(entry.base ?? entry.id);
  }
  return shapes.size;
}

/** その種類に色が何段階そろっているか */
export function colorCount(category: VisualCategory, id: string): number {
  return COLOR_INDEX.get(category)?.get(id)?.size ?? 0;
}

/** 全種類の点数（設計図を作るときに渡す） */
export function assetCounts(): Partial<Record<VisualCategory, number>> {
  const counts: Partial<Record<VisualCategory, number>> = {};
  for (const category of Object.keys(manifest.parts ?? {}) as VisualCategory[]) {
    const n = assetCount(category);
    if (n > 0) counts[category] = n;
  }
  return counts;
}

/** 同梱されている素材の総数。0 なら SVG だけで動いている */
export function totalAssets(): number {
  let total = 0;
  for (const category of Object.keys(manifest.parts ?? {}) as VisualCategory[]) {
    total += assetCount(category);
  }
  return total;
}

/** 画像で選手を描ける状態かどうか（1点でもあれば試す価値がある） */
export function imageModeAvailable(): boolean {
  return totalAssets() > 0;
}

/** 素材の台帳そのもの（検証・ギャラリー用） */
export function listAssets(category: VisualCategory): AssetEntry[] {
  return manifest.parts?.[category] ?? [];
}

/** 重ねる順。manifest に指定があればそれを使う（§8） */
export function zIndexOf(category: VisualCategory, id: string): number | null {
  const entry = INDEX.get(category)?.get(id);
  return entry?.zIndex ?? null;
}

/** 却下された素材の数（検査の報告に使う） */
export function rejectedCount(): number {
  let total = 0;
  for (const entries of Object.values(manifest.parts ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.approved === false) total += 1;
    }
  }
  return total;
}
