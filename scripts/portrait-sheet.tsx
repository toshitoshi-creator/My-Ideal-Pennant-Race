/**
 * PHASE 4.5 選手ビジュアルの見本（§51 Visual Regression）。
 *
 *   npx tsx scripts/portrait-sheet.tsx [出力先]
 *
 * 代表的な10パターンの選手を1枚のHTMLに並べる。
 * 画像の善し悪しは自動では測れないので、人が見て確かめるための資料として出す。
 * ゲームの状態は読むだけで、一切書き換えない。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { createNewGame } from '../src/domain/newGame';
import { appearanceFromId, appearanceOf } from '../src/domain/playerAppearance';
import type { Expression, Pose } from '../src/domain/playerAppearance';
import { PortraitSvg } from '../src/ui/portrait/renderer';
import type { PortraitSize } from '../src/ui/portrait/types';
import type { Player } from '../src/domain/types';

const OUT = process.argv[2] ?? 'portrait-sheet.html';
const state = createNewGame('phoenix', 10, 4545);
const mine = state.players.filter((p) => p.teamId === 'phoenix');
const teamColor = state.teams.find((t) => t.id === 'phoenix')!.color;

const pick = (test: (p: Player) => boolean): Player => mine.find(test) ?? mine[0];

interface Case {
  label: string;
  player: Player;
  size: PortraitSize;
  expression: Expression;
  pose?: Pose;
  showCap?: boolean;
  age?: number;
}

const youngest = [...mine].sort((a, b) => a.age - b.age)[0];
const oldest = [...mine].sort((a, b) => b.age - a.age)[0];

const cases: Case[] = [
  { label: '若手（18〜22歳）', player: youngest, size: 'large', expression: 'focused' },
  { label: 'ベテラン（36歳〜）', player: oldest, size: 'large', expression: 'neutral' },
  { label: '投手', player: pick((p) => p.isPitcher), size: 'large', expression: 'focused', pose: 'pose_pitch' },
  { label: '野手', player: pick((p) => !p.isPitcher && p.mainPosition !== 'C'), size: 'large', expression: 'neutral', pose: 'pose_bat' },
  { label: '捕手', player: pick((p) => p.mainPosition === 'C'), size: 'large', expression: 'focused', pose: 'pose_ready' },
  { label: '好調', player: mine[4], size: 'large', expression: 'confident' },
  { label: '不振', player: mine[5], size: 'large', expression: 'disappointed' },
  { label: '怪我', player: mine[6], size: 'large', expression: 'injured' },
  { label: 'ドラフト新人', player: mine[7], size: 'hero', expression: 'focused', pose: 'pose_standing' },
  { label: '引退選手', player: mine[8], size: 'large', expression: 'neutral', showCap: false, age: 41 },
];

const cards = cases.map((c) => {
  const appearance = c.age
    ? appearanceFromId(c.player.id, c.age, c.player.isPitcher)
    : appearanceOf(c.player);
  const svg = renderToStaticMarkup(
    <PortraitSvg
      appearance={appearance}
      name={c.player.name}
      options={{
        size: c.size,
        expression: c.expression,
        pose: c.pose,
        showCap: c.showCap,
        teamColor,
      }}
    />,
  );
  return `<figure class="case">
    ${svg}
    <figcaption>
      <strong>${c.label}</strong><br>
      ${c.player.name}（${c.age ?? c.player.age}歳・${c.player.isPitcher ? '投手' : '野手'}）<br>
      <span class="dim">${c.expression}${c.pose ? ` / ${c.pose}` : ''}</span>
    </figcaption>
  </figure>`;
});

const css = readFileSync('src/styles.css', 'utf8');
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>選手ビジュアル見本</title><style>${css}
   body{background:var(--paper);color:var(--ink);font-family:system-ui;padding:20px}
   h1{font-size:18px;margin:0 0 14px}
   .sheet{display:flex;flex-wrap:wrap;gap:18px}
   .case{margin:0;text-align:center;font-size:12px;line-height:1.5}
   .case .portrait{box-shadow:0 0 0 1px var(--paper-edge);margin-bottom:6px}
   .dim{color:var(--text-dim)}</style>
   <h1>PHASE 4.5 選手ビジュアル見本（10パターン）</h1>
   <div class="sheet">${cards.join('')}</div>`,
);
console.log(`${OUT} を書き出しました（${cases.length}パターン）`);
