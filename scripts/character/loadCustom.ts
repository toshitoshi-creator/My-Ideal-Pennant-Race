/**
 * PHASE 4.8-B 開発用: `custom/` をフォルダから読む（§9）。
 *
 * ゲーム本体は Vite の仕組みで同じフォルダを読みます（customParts.ts）。
 * こちらは開発ツール（検査・Workshop）用で、Vite を通さずに読みます。
 *
 * **読み取りと組み立ては同じ関数を使います**（parseSvgPart / toCharacterPart）。
 * 別々に書くと「検査は通るのにゲームでは出ない」が起きるためです。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharacterPart, CharacterPartCategory } from '../../src/ui/character/types';
import { CHARACTER_PART_CATEGORIES } from '../../src/ui/character/types';
import { parseSvgPart, toCharacterPart } from '../../src/ui/character/svgPart';
import type { ParsedSvgPart } from '../../src/ui/character/svgPart';

export const CUSTOM_ROOT = fileURLToPath(
  new URL('../../src/ui/character/custom', import.meta.url),
);

/** 1ファイルの読み取り結果 */
export interface LoadedFile {
  /** ゲーム側と同じ形の名前（./custom/head/head_06.svg） */
  key: string;
  /** 実際の場所 */
  path: string;
  /** フォルダから決まる種類 */
  folder: CharacterPartCategory | null;
  source: string;
  parsed?: ParsedSvgPart;
  part?: CharacterPart;
  error?: string;
}

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (name.endsWith('.svg')) found.push(full);
  }
  return found;
}

function categoryOf(key: string): CharacterPartCategory | null {
  const match = /^\.\/custom\/([^/]+)\//.exec(key);
  if (!match) return null;
  const name = match[1];
  return (CHARACTER_PART_CATEGORIES as readonly string[]).includes(name)
    ? (name as CharacterPartCategory)
    : null;
}

/**
 * `custom/` を全部読む。
 *
 * 並び順はファイル名で固定します。ゲーム側と同じ順でなければ、
 * 同じセーブから違う顔が出てしまいます。
 */
export function loadCustomFiles(): LoadedFile[] {
  const files = walk(CUSTOM_ROOT);
  const loaded: LoadedFile[] = files.map((path) => {
    // ゲーム側（import.meta.glob）と同じ形の名前に揃える
    const key = './custom/' + relative(CUSTOM_ROOT, path).split(sep).join('/');
    const folder = categoryOf(key);
    const source = readFileSync(path, 'utf8');
    const base: LoadedFile = { key, path, folder, source };

    if (!folder) return { ...base, error: 'フォルダ名が種類として正しくありません' };

    const parsed = parseSvgPart(source);
    if ('error' in parsed) return { ...base, error: parsed.error };
    if (parsed.category !== folder) {
      return {
        ...base,
        error: `data-category（${parsed.category}）とフォルダ（${folder}）が違います`,
      };
    }
    return { ...base, parsed, part: toCharacterPart(parsed) };
  });

  return loaded.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
