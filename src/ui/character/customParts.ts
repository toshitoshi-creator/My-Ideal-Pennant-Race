/**
 * PHASE 4.8-B あなたが描いたパーツを拾う（§1）。
 *
 * `custom/<種類>/<名前>.svg` に置いたファイルが、そのままゲームに入ります。
 * 登録する作業はありません。**置けば入ります。**
 *
 *   src/ui/character/custom/head/head_06.svg   ← 置く
 *   → 頭の6番目として使われる
 *
 * 読めないファイルは飛ばして、理由を覚えておきます。
 * ここで落とすと、1枚間違えただけでゲームが起動しなくなるためです。
 * 理由は Workshop（npm run character:workshop）で見られます。
 */
import type { CharacterPart, CharacterPartCategory } from './types';
import { CHARACTER_PART_CATEGORIES } from './types';
import { parseSvgPart, toCharacterPart } from './svgPart';

/** 読めなかったファイル */
export interface CustomPartProblem {
  file: string;
  reason: string;
}

const problems: CustomPartProblem[] = [];

/**
 * `custom/` の中の SVG をすべて読む。
 *
 * ビルドのときにファイルの中身が埋め込まれます。
 * 実行時にファイルを取りに行くことはありません（外部通信の禁止）。
 *
 * `import.meta.glob` は Vite の機能なので、
 * Vite を通さずに動かしたとき（開発用スクリプトを tsx で直接動かすとき）は
 * 使えません。そこで落とさず、空として扱います。
 * その場合は Workshop が自分でフォルダを読むので、見るものは同じです。
 */
let files: Record<string, string> = {};
try {
  files = import.meta.glob('./custom/**/*.svg', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;
} catch {
  files = {};
}

/** ファイルの置き場所から種類を読む（フォルダ名が種類） */
function categoryFromPath(path: string): CharacterPartCategory | null {
  const match = /\.\/custom\/([^/]+)\//.exec(path);
  if (!match) return null;
  const name = match[1];
  return (CHARACTER_PART_CATEGORIES as readonly string[]).includes(name)
    ? (name as CharacterPartCategory)
    : null;
}

function build(): Record<CharacterPartCategory, CharacterPart[]> {
  const table = Object.fromEntries(
    CHARACTER_PART_CATEGORIES.map((category) => [category, [] as CharacterPart[]]),
  ) as Record<CharacterPartCategory, CharacterPart[]>;

  // 並び順をファイル名で固定する。読み込み順に左右されると、
  // 同じセーブから違う顔が出てしまう（決定論が壊れる）
  for (const path of Object.keys(files).sort()) {
    const folder = categoryFromPath(path);
    if (!folder) {
      problems.push({ file: path, reason: 'フォルダ名が種類として正しくありません' });
      continue;
    }

    const parsed = parseSvgPart(files[path]);
    if ('error' in parsed) {
      problems.push({ file: path, reason: parsed.error });
      continue;
    }

    if (parsed.category !== folder) {
      problems.push({
        file: path,
        reason: `data-category（${parsed.category}）とフォルダ（${folder}）が違います`,
      });
      continue;
    }

    table[folder].push(toCharacterPart(parsed));
  }

  return table;
}

export const CUSTOM_PARTS = build();

/** 読めなかったファイルの一覧。Workshop が見せる */
export const CUSTOM_PART_PROBLEMS: readonly CustomPartProblem[] = problems;

/** あなたが描いたパーツの合計 */
export function customPartTotal(): number {
  return Object.values(CUSTOM_PARTS).reduce((sum, list) => sum + list.length, 0);
}
