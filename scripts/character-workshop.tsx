/**
 * PHASE 4.8-B Character Workshop（§7・§8）。
 *
 *   npm run character:workshop            1回だけ書き出す
 *   npm run character:workshop -- --watch  保存するたびに作り直す
 *
 * `character-workshop.html` をブラウザで開いてください。
 *
 * ここで見たいのは「絵がうまいか」ではありません。
 * **どの組み合わせでも位置が合っているか** です。
 * だから同じパーツを5種類の頭に載せて並べます。
 * 頭が変わっても位置が合っていれば、そのパーツは完成です。
 */
import { writeFileSync } from 'node:fs';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { CharacterRenderer } from '../src/ui/character/CharacterRenderer';
import { CHARACTER_PARTS, builtInCount } from '../src/ui/character/registry';
import { buildCharacterProfile } from '../src/domain/characterProfile';
import type { CharacterProfile } from '../src/domain/characterProfile';
import type { CharacterPart, CharacterPartCategory } from '../src/ui/character/types';
import { CUSTOM_ROOT, loadCustomFiles } from './character/loadCustom';
import type { LoadedFile } from './character/loadCustom';

const OUT = fileURLToPath(new URL('../character-workshop.html', import.meta.url));
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 見比べるときの土台。ここを固定しないと差が分からない */
const BASE: CharacterProfile = {
  version: 3,
  head: 0, body: 1, hair: 0, hairColor: 1, skin: 2,
  eyes: 0, eyebrow: 0, nose: 0, mouth: 0, ears: 0, beard: 0, cap: 0,
};

/** その種類が帽子の有無で見え方が変わるか */
const NEEDS_CAP: ReadonlySet<CharacterPartCategory> = new Set(['cap']);
const HIDE_CAP: ReadonlySet<CharacterPartCategory> = new Set([
  'head', 'hairFront', 'hairBack', 'ear', 'eye', 'eyebrow', 'nose', 'mouth', 'beard',
]);

/** そのパーツだけを差し替えるための指定を作る */
function override(
  part: CharacterPart,
  category: CharacterPartCategory,
): Partial<Record<CharacterPartCategory, CharacterPart>> {
  return { [category]: part } as Partial<Record<CharacterPartCategory, CharacterPart>>;
}

function cell(
  part: CharacterPart,
  category: CharacterPartCategory,
  profile: CharacterProfile,
  showCap: boolean,
  caption: string,
  width = 132,
): string {
  const svg = html(
    <CharacterRenderer
      profile={profile}
      width={width}
      showCap={showCap}
      overrideParts={override(part, category)}
    />,
  );
  return `<figure><div class="frame">${svg}</div><figcaption>${caption}</figcaption></figure>`;
}

/**
 * 組み合わせを変えて並べる。
 *
 * **これがこの道具のいちばん大事なところです。**
 * PHASE 4.8-A では、ここを見て耳・髪・帽子のズレを3つとも見つけました。
 *
 * 何を変えるかは種類によって違います。
 *   ・頭以外 … **頭**を変える（頭の幅についてこられるかを見る）
 *   ・頭     … 頭を変えても意味がないので、**載るもの**のほうを変える
 */
function combinations(part: CharacterPart, category: CharacterPartCategory): {
  title: string;
  hint: string;
  markup: string;
} {
  const showCap = NEEDS_CAP.has(category) ? true : !HIDE_CAP.has(category);

  if (category === 'head') {
    const variants: Array<{ profile: CharacterProfile; caption: string; cap: boolean }> = [
      { profile: { ...BASE, hair: 6 }, caption: '髪 短め<br><span>帽子なし</span>', cap: false },
      { profile: { ...BASE, hair: 5 }, caption: '髪 長め<br><span>帽子なし</span>', cap: false },
      { profile: { ...BASE, cap: 0 }, caption: '帽子 標準<br><span>かぶる</span>', cap: true },
      { profile: { ...BASE, cap: 1 }, caption: '帽子 深め<br><span>かぶる</span>', cap: true },
      { profile: { ...BASE, eyes: 5, eyebrow: 1 }, caption: '目 大きめ<br><span>眉 太い</span>', cap: false },
      { profile: { ...BASE, eyes: 4, mouth: 3 }, caption: '目 小さめ<br><span>口ちがい</span>', cap: false },
    ];
    return {
      title: '載るものを変える',
      hint: '髪・帽子・目が、この頭の輪郭に合っていれば完成',
      markup: `<div class="row">${variants
        .map((v) => cell(part, category, v.profile, v.cap, v.caption))
        .join('')}</div>`,
    };
  }

  const markup = CHARACTER_PARTS.head
    .map((head, i) =>
      cell(
        part,
        category,
        { ...BASE, head: i },
        showCap,
        `${esc(head.id)}<br><span>${esc(head.label)}</span>`,
      ),
    )
    .join('');
  return {
    title: '5種類の頭に載せる',
    hint: 'どの頭でも位置が合っていれば完成',
    markup: `<div class="row">${markup}</div>`,
  };
}

/** 実際の画面と同じ小ささで見る。小さくして潰れないかがいちばん壊れやすい */
function atSizes(part: CharacterPart, category: CharacterPartCategory): string {
  const showCap = NEEDS_CAP.has(category) ? true : !HIDE_CAP.has(category);
  const sizes: Array<{ width: number; label: string }> = [
    { width: 150, label: '選手詳細 150px' },
    { width: 96, label: '編成 96px' },
    { width: 44, label: '一覧 44px' },
    { width: 28, label: 'ニュース 28px' },
  ];
  const cells = sizes
    .map(({ width, label }) => {
      const svg = html(
        <CharacterRenderer
          profile={BASE}
          width={width}
          showCap={showCap}
          overrideParts={override(part, category)}
        />,
      );
      return `<figure><div class="frame small">${svg}</div><figcaption>${esc(label)}</figcaption></figure>`;
    })
    .join('');
  return `<div class="row baseline">${cells}</div>`;
}

/** 100人に混ぜてみる。ほかのパーツと組んだときに壊れないか */
function inCrowd(part: CharacterPart, category: CharacterPartCategory): string {
  const showCap = !HIDE_CAP.has(category) || NEEDS_CAP.has(category);
  const cells = Array.from({ length: 24 }, (_, i) => {
    const id = `workshop-${String(i + 1).padStart(3, '0')}`;
    const profile = buildCharacterProfile(id);
    return `<figure><div class="frame">${html(
      <CharacterRenderer
        profile={profile}
        width={80}
        showCap={showCap}
        overrideParts={override(part, category)}
      />,
    )}</div></figure>`;
  }).join('');
  return `<div class="grid">${cells}</div>`;
}

function partSection(file: LoadedFile): string {
  const part = file.part!;
  const parsed = file.parsed!;
  const meta: string[] = [`種類 ${parsed.category}`, `名前 ${parsed.id}`, `表示名 ${parsed.label}`];
  if (parsed.halfWidth !== undefined) meta.push(`半幅 ${parsed.halfWidth}`);
  if (parsed.faceScaleY !== undefined) meta.push(`顔の伸び ${parsed.faceScaleY}`);
  if (parsed.chinShift !== undefined) meta.push(`あご ${parsed.chinShift}`);

  const combo = combinations(part, parsed.category);

  return `<section>
  <h2>${esc(parsed.id)}<small>${esc(file.key)}</small></h2>
  <p class="meta">${meta.map(esc).join('　/　')}</p>

  <h3>${combo.title}<span>${combo.hint}</span></h3>
  ${combo.markup}

  <h3>実際の大きさ<span>小さくして潰れないか</span></h3>
  ${atSizes(part, parsed.category)}

  <h3>ほかのパーツと組む<span>24人ぶん</span></h3>
  ${inCrowd(part, parsed.category)}
</section>`;
}

function problemSection(files: LoadedFile[]): string {
  const broken = files.filter((f) => f.error);
  if (broken.length === 0) return '';
  const rows = broken
    .map((f) => `<li><code>${esc(f.key)}</code><br><span>${esc(f.error!)}</span></li>`)
    .join('');
  return `<section class="problems">
  <h2>読めなかったファイル<small>${broken.length}件</small></h2>
  <p>ゲームには入りません。直すと自動で入ります。</p>
  <ul>${rows}</ul>
</section>`;
}

function emptyGuide(): string {
  return `<section class="empty">
  <h2>まだ1枚もありません</h2>
  <p>この道具は、<strong>あなたが描いたパーツ</strong>を実際のキャラクターに載せて見るためのものです。</p>
  <ol>
    <li><code>npm run character:template</code> … 下書きを作る</li>
    <li><code>character-template/</code> の 01〜12 のSVGを開いて、枠の中に描く</li>
    <li><code>src/ui/character/custom/&lt;種類&gt;/</code> に置く</li>
    <li><code>npm run character:check</code> … 壊れていないか見る</li>
    <li><code>npm run character:workshop</code> … ここへ戻る</li>
  </ol>
  <p class="note">くわしい手順は <code>character-template/README.md</code> にあります。</p>
</section>`;
}

function build(watching: boolean): void {
  const files = loadCustomFiles();
  const good = files.filter((f) => f.part);

  const counts = (
    ['head', 'body', 'hairFront', 'eye', 'eyebrow', 'nose', 'mouth', 'cap', 'ear'] as const
  )
    .map((c) => `${c} ${builtInCount(c)}+${CHARACTER_PARTS[c].length - builtInCount(c)}`)
    .join('　');

  const page = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
${watching ? '<meta http-equiv="refresh" content="2">' : ''}
<title>Character Workshop（PHASE 4.8-B）</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f4f4f2;color:#20191a}
 h1{font-size:20px;margin:0 0 4px}
 .lead{color:#6b6560;margin:0 0 20px;font-size:13px;line-height:1.7}
 .lead code{background:#e8e6e1;padding:1px 5px;border-radius:3px}
 section{margin:0 0 28px;background:#fff;border-radius:10px;padding:16px 18px}
 h2{font-size:16px;margin:0 0 8px;display:flex;align-items:baseline;gap:10px}
 h2 small{font-weight:400;color:#9a948e;font-size:11px}
 h3{font-size:12px;margin:18px 0 8px;color:#6b6560;letter-spacing:.04em;
    display:flex;align-items:baseline;gap:8px;border-top:1px solid #eeece8;padding-top:12px}
 h3 span{font-weight:400;color:#a8a29a;font-size:11px}
 .meta{font-size:12px;color:#6b6560;margin:0}
 .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
 .row.baseline{align-items:flex-end}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
 figure{margin:0;text-align:center}
 .frame{background:#faf9f7;border:1px solid #eeece8;border-radius:6px;padding:6px;display:inline-block}
 figcaption{font-size:10px;color:#6b6560;margin-top:5px;line-height:1.5}
 figcaption span{color:#a8a29a}
 .problems{border-left:4px solid #e0245e}
 .problems ul{margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.9}
 .problems span{color:#e0245e}
 .empty ol{font-size:13px;line-height:2.1}
 .empty code{background:#e8e6e1;padding:1px 5px;border-radius:3px}
 .note{font-size:12px;color:#6b6560}
 .stamp{font-size:11px;color:#a8a29a;margin-top:20px}
</style></head><body>
<h1>Character Workshop</h1>
<p class="lead">
  あなたが <code>src/ui/character/custom/</code> に置いたSVGを、実際のキャラクターに載せて見せています。<br>
  はじめから入っているパーツ＋あなたのパーツ：${esc(counts)}<br>
  ${watching ? '<strong>監視中</strong>：保存すると2秒以内に作り直されます。' : '1回だけ書き出しました。<code>-- --watch</code> を付けると保存のたびに作り直します。'}
</p>
${problemSection(files)}
${good.length > 0 ? good.map(partSection).join('\n') : emptyGuide()}
<p class="stamp">自作SVGのみ。生成AIも外部通信も使っていません。</p>
</body></html>`;

  writeFileSync(OUT, page, 'utf8');

  const stamp = new Date().toISOString().slice(11, 19);
  console.log(
    `  [${stamp}] 自作パーツ ${good.length}件 / 読めなかったもの ${files.length - good.length}件 → character-workshop.html`,
  );
}

const watching = process.argv.includes('--watch');

console.log('\n=== Character Workshop（PHASE 4.8-B）===\n');
build(watching);

if (watching) {
  console.log(`\n  監視中: ${CUSTOM_ROOT}`);
  console.log('  character-workshop.html を開いたままにしてください（自動で更新されます）');
  console.log('  止めるには Ctrl+C\n');
  let timer: NodeJS.Timeout | null = null;
  watch(CUSTOM_ROOT, { recursive: true }, () => {
    // 保存が連続するので少し待ってからまとめて作り直す
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => build(true), 250);
  });
} else {
  console.log('\n  開く: character-workshop.html\n');
}
