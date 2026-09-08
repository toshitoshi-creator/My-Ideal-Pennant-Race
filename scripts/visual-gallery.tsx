/**
 * PHASE 4.6 Visual Gallery（§38）。
 *
 *   npx tsx scripts/visual-gallery.tsx [人数] [出力先]
 *   npm run gallery -- 300 gallery.html
 *
 * 選手を大量に並べて、目で「別人に見えるか」「破綻していないか」を確かめる資料。
 * 人数は 100 / 300 / 500 / 1000 を想定している（既定は 300）。
 *
 * ここが読むのは設計図（VisualProfile）と PHASE 4.5 の SVG だけで、
 * 画像素材は読まない（素材の見え方は npm run assets:audit で確かめる）。
 * ゲームの状態は読むだけで、一切書き換えない。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { appearanceFromId } from '../src/domain/playerAppearance';
import { EXPRESSIONS, EXPRESSION_LABELS, POSES, POSE_LABELS } from '../src/domain/playerAppearance';
import type { Expression, Pose } from '../src/domain/playerAppearance';
import {
  REQUIRED_CATEGORIES,
  VISUAL_CATEGORIES,
  buildVisualProfile,
  stanceOf,
  type VisualCategory,
  type VisualProfile,
} from '../src/domain/visualProfile';
import { PortraitSvg } from '../src/ui/portrait/renderer';
import type { PortraitSize } from '../src/ui/portrait/types';
import { POSITION_LABELS } from '../src/domain/positions';
import type { Player } from '../src/domain/types';

const COUNT = Number(process.argv[2] ?? 300);
const OUT = process.argv[3] ?? 'visual-gallery.html';

if (!Number.isFinite(COUNT) || COUNT < 1) {
  console.error('人数は1以上の数で指定してください（例: npm run gallery -- 300）');
  process.exit(1);
}

/* ---------------- 選手を集める ---------------- */

// 1球団ぶんでは足りないので、シードを変えて何度も作って集める
const pool: Player[] = [];
const states = [4601, 4602, 4603, 4604, 4605, 4606, 4607, 4608];
let base = createNewGame('phoenix', 10, states[0]);
for (const seed of states) {
  const state = seed === states[0] ? base : createNewGame('phoenix', 10, seed);
  if (seed !== states[0]) base = state;
  for (const p of state.players) {
    pool.push(p);
    if (pool.length >= COUNT) break;
  }
  if (pool.length >= COUNT) break;
}
const players = pool.slice(0, COUNT);
const teamColor = base.teams.find((t) => t.id === 'phoenix')?.color;

/* ---------------- 1人を描く ---------------- */

function card(
  player: Player,
  opts: {
    label?: string;
    size?: PortraitSize;
    expression?: Expression;
    pose?: Pose;
    age?: number;
    showCap?: boolean;
    color?: boolean;
  } = {},
): string {
  const age = opts.age ?? player.age;
  const appearance = appearanceFromId(player.id, age, player.isPitcher);
  const svg = renderToStaticMarkup(
    <PortraitSvg
      appearance={appearance}
      name={player.name}
      options={{
        size: opts.size ?? 'medium',
        expression: opts.expression ?? 'neutral',
        pose: opts.pose,
        showCap: opts.showCap,
        teamColor: opts.color === false ? undefined : teamColor,
      }}
    />,
  );
  const caption = opts.label
    ? `<figcaption><strong>${esc(opts.label)}</strong><br>${esc(player.name)}（${age}歳）</figcaption>`
    : `<figcaption>${esc(player.name)}<br><span class="dim">${age}歳 ${
        player.isPitcher ? '投手' : POSITION_LABELS[player.mainPosition]
      }</span></figcaption>`;
  return `<figure class="case">${svg}${caption}</figure>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function section(title: string, note: string, body: string): string {
  return `<section><h2>${esc(title)}</h2><p class="note">${esc(note)}</p>
    <div class="sheet">${body}</div></section>`;
}

/* ---------------- §38-1 大量に並べる ---------------- */

const crowd = section(
  `${COUNT}人`,
  '同じ顔・似すぎている顔が並んでいないかを見る。1画面に同じ顔が2つ出たら、素材の数が足りていない。',
  players.map((p) => card(p, { size: 'medium' })).join(''),
);

/* ---------------- §38-2 同じ選手の年齢変化 ---------------- */

const AGES = [18, 25, 30, 36, 41];
const agingTargets = players.slice(0, 6);
const aging = section(
  '同じ選手の年齢変化',
  `${AGES.join(' → ')}歳。顔の造作は動かず、ひげ・白髪・肌の張りだけが変わるのが正しい。別人になっていたら不具合。`,
  agingTargets
    .map(
      (p) =>
        `<div class="strip">${AGES.map((age) =>
          card(p, { size: 'medium', age, label: `${age}歳` }),
        ).join('')}</div>`,
    )
    .join(''),
);

/* ---------------- §38-3 表情 ---------------- */

const expressionTarget = players[0];
const expressions = section(
  '表情',
  '同じ選手の10通りの表情。目・眉・口だけが変わり、顔の造作は動かない。',
  EXPRESSIONS.map((e: Expression) =>
    card(expressionTarget, { size: 'large', expression: e, label: EXPRESSION_LABELS[e] }),
  ).join(''),
);

/* ---------------- §38-4 ポーズ ---------------- */

const poseTarget = players.find((p) => !p.isPitcher) ?? players[0];
const poses = section(
  'ポーズ',
  '大きく見せるときだけ使う8通りの姿勢。',
  POSES.map((pose: Pose) =>
    card(poseTarget, { size: 'hero', pose, label: POSE_LABELS[pose] }),
  ).join(''),
);

/* ---------------- §38-5 守備位置と用具 ---------------- */

const POSITION_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;
const byPosition = POSITION_ORDER.map((pos) => {
  const p = players.find((q) => q.mainPosition === pos);
  if (!p) return '';
  const profile = buildVisualProfile({ player: p });
  return card(p, {
    size: 'large',
    label: `${POSITION_LABELS[pos]}（${profile.stance} / ${profile.headwear}）`,
    pose: p.isPitcher ? 'pose_pitch' : pos === 'C' ? 'pose_ready' : 'pose_bat',
  });
}).join('');
const positions = section(
  '守備位置と用具',
  '投手は帽子とグラブ、捕手はマスクとミットとプロテクター、打者はヘルメットとバット。守備位置から自動で決まる。',
  byPosition,
);

/* ---------------- §38-6 設計図の内訳 ---------------- */

const profiles: VisualProfile[] = players.map((p) => buildVisualProfile({ player: p }));

// 種類ごとに、何種類の素材IDが実際に使われたか
const used = new Map<VisualCategory, Set<string>>();
for (const category of VISUAL_CATEGORIES) used.set(category, new Set());
for (const profile of profiles) {
  for (const category of VISUAL_CATEGORIES) {
    const id = profile.parts[category];
    if (id) used.get(category)!.add(id);
  }
}
const usageRows = VISUAL_CATEGORIES.map((category) => {
  const ids = used.get(category)!;
  const required = REQUIRED_CATEGORIES.includes(category);
  return `<tr><td>${category}</td><td>${required ? '必須' : '任意'}</td>
    <td class="n">${ids.size}</td>
    <td class="dim">${[...ids].sort().slice(0, 8).join(' ')}${ids.size > 8 ? ' …' : ''}</td></tr>`;
}).join('');

// まったく同じ組み合わせの選手がいないか
const combos = new Map<string, string[]>();
for (const profile of profiles) {
  const key = VISUAL_CATEGORIES.map((c) => profile.parts[c] ?? '-').join('|');
  const list = combos.get(key) ?? [];
  list.push(profile.playerId);
  combos.set(key, list);
}
const collisions = [...combos.values()].filter((ids) => ids.length > 1);

const stances = new Map<string, number>();
for (const profile of profiles) {
  stances.set(profile.stance, (stances.get(profile.stance) ?? 0) + 1);
}

const summary = `<section><h2>設計図の内訳</h2>
  <p class="note">${COUNT}人ぶんの設計図を数えたもの。素材を作るときの目安になる。</p>
  <table>
    <thead><tr><th>種類</th><th></th><th class="n">使われたID数</th><th>内訳</th></tr></thead>
    <tbody>${usageRows}</tbody>
  </table>
  <p class="note">
    同一の組み合わせ: <strong>${collisions.length}組</strong>
    ${collisions.length > 0 ? `（${collisions.map((ids) => esc(ids.join('・'))).slice(0, 5).join(' / ')}）` : ''}
    ／ 姿勢の内訳: ${[...stances].map(([k, v]) => `${k} ${v}人`).join('・')}
  </p>
</section>`;

/* ---------------- 書き出し ---------------- */

const css = readFileSync('src/styles.css', 'utf8');
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>選手ビジュアル一覧（${COUNT}人）</title><style>${css}
   body{background:var(--paper);color:var(--ink);font-family:system-ui;padding:20px;margin:0}
   h1{font-size:20px;margin:0 0 4px}
   h2{font-size:16px;margin:28px 0 4px;border-bottom:1px solid var(--paper-edge);padding-bottom:4px}
   .note{color:var(--text-dim);font-size:12px;margin:0 0 12px}
   .sheet{display:flex;flex-wrap:wrap;gap:14px}
   .strip{display:flex;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dotted var(--paper-edge);width:100%}
   .case{margin:0;text-align:center;font-size:11px;line-height:1.45}
   .case .portrait{box-shadow:0 0 0 1px var(--paper-edge);margin-bottom:4px}
   .dim{color:var(--text-dim)}
   table{border-collapse:collapse;font-size:12px;width:100%;max-width:760px}
   th,td{border-bottom:1px solid var(--paper-edge);padding:4px 8px;text-align:left}
   td.n,th.n{text-align:right}</style>
   <h1>PHASE 4.6 選手ビジュアル一覧</h1>
   <p class="note">${COUNT}人 ／ 生成 ${new Date().getFullYear()} ／ 画像素材ではなく PHASE 4.5 の SVG で描いています</p>
   ${summary}${aging}${expressions}${poses}${positions}${crowd}`,
);

console.log(`${OUT} を書き出しました`);
console.log(`  選手 ${COUNT}人 / 同一の組み合わせ ${collisions.length}組`);
for (const category of REQUIRED_CATEGORIES) {
  console.log(`  ${category}: ${used.get(category)!.size}種類`);
}
