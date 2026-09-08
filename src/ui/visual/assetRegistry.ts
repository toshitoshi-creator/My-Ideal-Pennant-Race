/**
 * PHASE 4.6 画像素材の台帳。
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
  /** src/assets/players/ からの相対パス */
  path: string | null;
  width: number;
  height: number;
  bytes?: number;
  sha1?: string;
  /** small / medium / large / hero などのサイズ違い */
  variants?: Record<string, string>;
  anchor?: Record<string, number> | null;
  /** この素材と組み合わせてよい相手（空なら制限なし。§14） */
  compatibleTypes?: string[];
  tags?: string[];
}

export interface AssetManifest {
  version: number;
  canvas: { width: number; height: number };
  note?: string;
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
for (const [category, entries] of Object.entries(manifest.parts ?? {})) {
  const map = new Map<string, AssetEntry>();
  for (const entry of entries ?? []) map.set(entry.id, entry);
  INDEX.set(category, map);
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
): string | null {
  const entry = INDEX.get(category)?.get(id);
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

/** その素材が実際に同梱されているか */
export function hasAsset(category: VisualCategory, id: string): boolean {
  return resolveAsset(category, id) !== null;
}

/** その種類に何点の素材があるか（設計図の割り当てに使う） */
export function assetCount(category: VisualCategory): number {
  const entries = manifest.parts?.[category];
  if (!entries) return 0;
  let usable = 0;
  for (const entry of entries) {
    if (entry.path && URL_BY_PATH.has(entry.path)) usable += 1;
  }
  return usable;
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
