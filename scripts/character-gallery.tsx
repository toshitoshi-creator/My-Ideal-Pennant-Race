/**
 * PHASE 4.8-A キャラクターの一覧と100人検証（§25・§26）。
 *
 *   npm run character:gallery     パーツ一覧と100人を書き出す
 *
 * 書き出し先: character-gallery.html（.gitignore 済み）
 *
 * 開発時にだけ動きます。ゲーム実行時には1行も動きません。
 * 生成AIも通信も使いません。React を文字列へ描くだけです。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { CharacterRenderer } from '../src/ui/character/CharacterRenderer';
import { CHARACTER_PARTS, partCount } from '../src/ui/character/registry';
import { CHARACTER_EXPRESSIONS, type CharacterPartCategory } from '../src/ui/character/types';
import {
  buildCharacterProfile,
  type CharacterProfile,
} from '../src/domain/characterProfile';

const OUT = join(process.cwd(), 'character-gallery.html');

/** 実際に作ってあるパーツ数 */
const COUNTS = {
  head: partCount('head'),
  body: partCount('body'),
  hair: partCount('hairFront'),
  eyes: partCount('eye'),
  eyebrow: partCount('eyebrow'),
  nose: partCount('nose'),
  mouth: partCount('mouth'),
  ears: partCount('ear'),
  cap: partCount('cap'),
};

const html = (node: ReactElement) => renderToStaticMarkup(node);

/** 基準になる設計図。ここから1種類だけ差し替えて見比べる */
const BASE: CharacterProfile = {
  version: 3,
  head: 0,
  body: 1,
  hair: 0,
  hairColor: 0,
  skin: 2,
  eyes: 0,
  eyebrow: 0,
  nose: 0,
  mouth: 0,
  ears: 0,
  beard: 0,
  cap: 0,
};

/**
 * 1種類ぶんの並び。
 * 他をすべて固定して1つだけ動かすので、その種類の差だけが見える。
 */
function categoryRow(
  title: string,
  category: CharacterPartCategory,
  key: keyof CharacterProfile,
): string {
  const parts = CHARACTER_PARTS[category];
  const cells = parts
    .map((part, i) => {
      const profile = { ...BASE, [key]: i };
      const svg = html(
        <CharacterRenderer profile={profile} width={110} showCap={category === 'cap'} />,
      );
      return `<figure><div>${svg}</div><figcaption>${part.id}<br><span>${part.label}</span></figcaption></figure>`;
    })
    .join('');
  return `<section><h2>${title}<small>${parts.length}種類</small></h2><div class="row">${cells}</div></section>`;
}

/* ================================================================
 * 100人（§26）
 * ============================================================== */

const HUNDRED = Array.from({ length: 100 }, (_, i) => {
  const id = `gallery-${String(i + 1).padStart(3, '0')}`;
  return { id, profile: buildCharacterProfile(id, COUNTS) };
});

/** 組み合わせの重なりを数える */
const seen = new Map<string, number>();
for (const item of HUNDRED) {
  const key = [
    item.profile.head,
    item.profile.body,
    item.profile.hair,
    item.profile.hairColor,
    item.profile.skin,
    item.profile.eyes,
    item.profile.eyebrow,
    item.profile.nose,
    item.profile.mouth,
    item.profile.cap,
  ].join('-');
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const duplicates = [...seen.values()].filter((n) => n > 1).length;

const hundredCells = HUNDRED.map(
  (item) =>
    `<figure><div>${html(
      <CharacterRenderer profile={item.profile} width={104} />,
    )}</div><figcaption>${item.id}</figcaption></figure>`,
).join('');

/* ================================================================
 * 表情（§17）
 * ============================================================== */

/*
 * 表情は「その人の顔」を変えてはいけない（§21）。
 * 変わってよいのは、まぶたの開き・眉の傾き・口の形だけ。
 * 同じ設計図で並べれば、同じ人物のままかどうかがひと目で分かる。
 */
const expressionCells = CHARACTER_EXPRESSIONS.map(
  (expression) =>
    `<figure><div>${html(
      <CharacterRenderer profile={BASE} width={110} expression={expression} showCap={false} />,
    )}</div><figcaption>${expression}</figcaption></figure>`,
).join('');

/* ================================================================
 * デバッグ表示（§24）
 * ============================================================== */

const debugCells = CHARACTER_PARTS.head
  .map((part, i) =>
    `<figure><div>${html(
      <CharacterRenderer profile={{ ...BASE, head: i }} width={190} debug showCap={false} />,
    )}</div><figcaption>${part.id} ${part.label}</figcaption></figure>`,
  )
  .join('');

/* ================================================================
 * 書き出し
 * ============================================================== */

const page = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>キャラクター一覧（PHASE 4.8-A）</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f4f4f2;color:#20191a}
 h1{font-size:20px;margin:0 0 4px}
 p.note{color:#5a5550;margin:0 0 24px;font-size:13px}
 section{margin:0 0 28px;background:#fff;border-radius:10px;padding:16px 18px}
 h2{font-size:15px;margin:0 0 12px;display:flex;align-items:baseline;gap:8px}
 h2 small{font-weight:400;color:#87817b;font-size:12px}
 .row{display:flex;flex-wrap:wrap;gap:10px}
 figure{margin:0;text-align:center;background:#faf9f7;border:1px solid #e6e3de;border-radius:8px;padding:6px}
 figcaption{font-size:10px;color:#5a5550;margin-top:4px;line-height:1.35}
 figcaption span{color:#8a847e}
 .grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px}
 .stat{display:flex;gap:20px;font-size:13px;margin:0 0 12px;color:#3c3733}
 .stat b{font-weight:600}
</style></head><body>
<h1>キャラクター一覧（PHASE 4.8-A）</h1>
<p class="note">自作SVGパーツを決定論的に組み合わせたもの。生成AIも外部通信も使っていません。</p>

${categoryRow('頭', 'head', 'head')}
${categoryRow('体', 'body', 'body')}
${categoryRow('髪', 'hairFront', 'hair')}
${categoryRow('目', 'eye', 'eyes')}
${categoryRow('眉', 'eyebrow', 'eyebrow')}
${categoryRow('鼻', 'nose', 'nose')}
${categoryRow('口', 'mouth', 'mouth')}
${categoryRow('帽子', 'cap', 'cap')}

<section>
  <h2>表情<small>顔は変えず、眉・目・口だけ</small></h2>
  <div class="row">${expressionCells}</div>
</section>

<section>
  <h2>基準線の確認<small>開発時のみ</small></h2>
  <div class="row">${debugCells}</div>
</section>

<section>
  <h2>100人<small>固定の seed から生成</small></h2>
  <div class="stat">
    <span>人数 <b>${HUNDRED.length}</b></span>
    <span>組み合わせの重複 <b>${duplicates}</b></span>
  </div>
  <div class="grid">${hundredCells}</div>
</section>
</body></html>`;

writeFileSync(OUT, page);

console.log('=== キャラクター一覧（PHASE 4.8-A）===\n');
for (const [category, parts] of Object.entries(CHARACTER_PARTS)) {
  if (parts.length === 0) continue;
  console.log(`  ${category.padEnd(11)} ${String(parts.length).padStart(2)}種類  ${parts.map((p) => p.id).join(' ')}`);
}
console.log(`\n  100人の組み合わせの重複: ${duplicates}件`);
console.log(`  書き出し: ${OUT}`);
