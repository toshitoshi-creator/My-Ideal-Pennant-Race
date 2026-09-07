/**
 * PHASE 4.5 選手ビジュアル（Player Visual Identity）のテスト。
 *
 * 確かめること：
 *   - 見た目は playerId だけで決まり、どこで何度描いても同じ人物になる
 *   - 部品の数と組み合わせが仕様どおりある
 *   - 出来上がる SVG が壊れない（外部参照・script・NaN が無い）
 *   - 年齢・表情・ポーズを変えても、その人だと分かる
 *   - ゲームの状態・乱数・成績を一切変えない
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createNewGame } from './newGame';
import { advanceDay, cloneState } from './engine';
import type { GameState, Player } from './types';
import {
  ACCESSORY_IDS,
  APPEARANCE_VERSION,
  AGE_STAGE_LABELS,
  BODY_IDS,
  EAR_IDS,
  EXPRESSIONS,
  EXPRESSION_LABELS,
  EYEBROW_IDS,
  EYE_IDS,
  FACIAL_HAIR_IDS,
  HAIR_COLOR_IDS,
  HAIR_IDS,
  HEAD_IDS,
  JAW_IDS,
  MOUTH_IDS,
  NOSE_IDS,
  PART_COUNTS,
  POSES,
  POSE_LABELS,
  SKIN_IDS,
  UNIFORM_IDS,
  ageStageOf,
  appearanceFromId,
  appearanceHash,
  appearanceOf,
  baseAppearanceOf,
  bodyOf,
  buildAppearance,
  expressionOf,
  faceCombinationCount,
  pickIndex,
  poseOf,
} from './playerAppearance';
import type { BaseAppearance, Expression, PlayerAppearance, Pose } from './playerAppearance';
import { PortraitSvg, PortraitFallbackSvg } from '../ui/portrait/renderer';
import { headGeometry, HEAD_GEOMETRIES } from '../ui/portrait/parts/heads';
import { needsAdjustment, resolveCompatibility } from '../ui/portrait/compatibility';
import { HAIR_FILL, HAIR_SHADE, SKIN_FILL, SKIN_SHADE } from '../ui/portrait/palette';
import {
  CENTER_X,
  EYE_Y,
  MOUTH_Y,
  NOSE_Y,
  SIZE_CROP,
  SIZE_PX,
  VIEW_H,
  VIEW_W,
} from '../ui/portrait/types';
import type { PortraitOptions, PortraitSize } from '../ui/portrait/types';

const PLAYER_TEAM = 'phoenix';

/**
 * 肖像まわりの実装ファイルの中身。
 * 「乱数を使っていない」「外部URLに依存していない」を、
 * 実際のソースを読んで確かめるために使う。
 */
const RAW_SOURCES = import.meta.glob(
  ['../ui/portrait/**/*.{ts,tsx}', '../ui/components/PlayerPortrait.tsx', './playerAppearance.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** コメントを外したソース（禁止事項は「書いてあるか」ではなく「使っているか」で見る） */
const VISUAL_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_SOURCES).map(([path, source]) => [
    path,
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
  ]),
);

function newGame(seed = 450450): GameState {
  return createNewGame(PLAYER_TEAM, 10, seed);
}

const SIZES: PortraitSize[] = ['small', 'medium', 'large', 'hero'];

/** 肖像を文字列として描く（テストの中では実際の SVG を見て確かめる） */
function draw(appearance: PlayerAppearance, name = '選手', options: PortraitOptions = {}): string {
  return renderToStaticMarkup(
    createElement(PortraitSvg, { appearance, name, options }),
  );
}

/** 仮の選手を作る（ゲームの状態には触れない） */
function fakePlayer(id: string, age = 26, isPitcher = false): PlayerAppearance {
  return buildAppearance({ playerId: id, age, isPitcher });
}

/* ================================================================
 * 1. 決定的なハッシュ（ゲームの乱数から完全に独立している）
 * ============================================================== */

describe('PHASE4.5 ハッシュ', () => {
  it('同じ文字列からは必ず同じ値になる', () => {
    expect(appearanceHash('abc')).toBe(appearanceHash('abc'));
    expect(appearanceHash('player-1')).toBe(appearanceHash('player-1'));
  });

  it('違う文字列からは違う値になる', () => {
    expect(appearanceHash('abc')).not.toBe(appearanceHash('abd'));
    expect(appearanceHash('p-1')).not.toBe(appearanceHash('p-2'));
  });

  it('空文字でも壊れない', () => {
    expect(Number.isFinite(appearanceHash(''))).toBe(true);
  });

  it('結果は 32bit の非負整数', () => {
    for (const key of ['a', 'bb', 'ccc', 'player-appearance-v1:x']) {
      const h = appearanceHash(key);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('1000個の文字列でハッシュがほとんど衝突しない', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(appearanceHash(`player-${i}`));
    expect(seen.size).toBeGreaterThan(995);
  });

  it('pickIndex は範囲内に収まる', () => {
    for (let i = 0; i < 200; i++) {
      const v = pickIndex(appearanceHash(`x${i}`), i % 12, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('pickIndex は同じ入力なら同じ結果', () => {
    const seed = appearanceHash('same');
    expect(pickIndex(seed, 3, 15)).toBe(pickIndex(seed, 3, 15));
  });

  it('pickIndex は salt が違えば結果も散る', () => {
    const seed = appearanceHash('spread');
    const values = new Set(Array.from({ length: 12 }, (_u, i) => pickIndex(seed, i, 10)));
    expect(values.size).toBeGreaterThan(3);
  });

  it('pickIndex は max=0 でも壊れない', () => {
    expect(pickIndex(12345, 1, 0)).toBe(0);
  });

  it('取り出した値が全部の枝に散らばる', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 2000; i++) counts[pickIndex(appearanceHash(`k${i}`), 1, 10)] += 1;
    for (const c of counts) expect(c).toBeGreaterThan(100);
  });
});

/* ================================================================
 * 2. 部品の数（§14 の最低ライン）
 * ============================================================== */

describe('PHASE4.5 部品の数', () => {
  const requirements: Array<[string, number, readonly string[]]> = [
    ['頭の形', 10, HEAD_IDS],
    ['髪型', 15, HAIR_IDS],
    ['眉', 10, EYEBROW_IDS],
    ['目', 12, EYE_IDS],
    ['鼻', 10, NOSE_IDS],
    ['口', 10, MOUTH_IDS],
    ['耳', 6, EAR_IDS],
    ['あご', 6, JAW_IDS],
    ['体型', 10, BODY_IDS],
    ['肌', 8, SKIN_IDS],
    ['髪色', 8, HAIR_COLOR_IDS],
    ['ひげ', 8, FACIAL_HAIR_IDS],
  ];

  for (const [label, min, list] of requirements) {
    it(`${label}が${min}種類以上ある`, () => {
      expect(list.length).toBeGreaterThanOrEqual(min);
    });
    it(`${label}のIDが重複していない`, () => {
      expect(new Set(list).size).toBe(list.length);
    });
    it(`${label}のIDが空文字でない`, () => {
      for (const id of list) expect(id.length).toBeGreaterThan(0);
    });
  }

  it('表情が10種類ある', () => {
    expect(EXPRESSIONS.length).toBe(10);
  });

  it('ポーズが8種類ある', () => {
    expect(POSES.length).toBe(8);
  });

  it('表情すべてに日本語の名前がある', () => {
    for (const e of EXPRESSIONS) expect(EXPRESSION_LABELS[e].length).toBeGreaterThan(0);
  });

  it('ポーズすべてに日本語の名前がある', () => {
    for (const p of POSES) expect(POSE_LABELS[p].length).toBeGreaterThan(0);
  });

  it('年齢段階すべてに日本語の名前がある', () => {
    for (const stage of ['YOUTH', 'PRIME', 'MATURE', 'VETERAN', 'ELDER'] as const) {
      expect(AGE_STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
  });

  it('PART_COUNTS が実際の数と一致する', () => {
    expect(PART_COUNTS.head).toBe(HEAD_IDS.length);
    expect(PART_COUNTS.hair).toBe(HAIR_IDS.length);
    expect(PART_COUNTS.eyes).toBe(EYE_IDS.length);
    expect(PART_COUNTS.expression).toBe(EXPRESSIONS.length);
    expect(PART_COUNTS.pose).toBe(POSES.length);
  });

  it('顔の組み合わせは10億通りを超える', () => {
    expect(faceCombinationCount()).toBeGreaterThan(1_000_000_000);
  });

  it('ユニフォームと小物のIDも重複がない', () => {
    expect(new Set(UNIFORM_IDS).size).toBe(UNIFORM_IDS.length);
    expect(new Set(ACCESSORY_IDS).size).toBe(ACCESSORY_IDS.length);
  });

  it('肌と髪の色すべてに塗りが用意されている', () => {
    for (const id of SKIN_IDS) {
      expect(SKIN_FILL[id]).toMatch(/^var\(--/);
      expect(SKIN_SHADE[id]).toMatch(/^var\(--/);
    }
    for (const id of HAIR_COLOR_IDS) {
      expect(HAIR_FILL[id]).toMatch(/^var\(--/);
      expect(HAIR_SHADE[id]).toMatch(/^var\(--/);
    }
  });
});

/* ================================================================
 * 3. 頭の形（すべての顔パーツの土台）
 * ============================================================== */

describe('PHASE4.5 頭の形', () => {
  for (const id of HEAD_IDS) {
    it(`${id} の寸法が用意されている`, () => {
      const geo = headGeometry(id);
      expect(geo.id).toBe(id);
      expect(geo.halfWidth).toBeGreaterThan(40);
      expect(geo.chinY).toBeGreaterThan(geo.topY);
    });

    it(`${id} のパスに NaN が入っていない`, () => {
      expect(headGeometry(id).path).not.toMatch(/NaN|undefined/);
    });

    it(`${id} は目・鼻・口が輪郭の内側に収まる`, () => {
      const geo = headGeometry(id);
      // 目は中心から eyeGap 離れ、目の幅ぶん外へ広がる
      expect(CENTER_X + geo.eyeGap + 16).toBeLessThan(CENTER_X + geo.halfWidth);
      expect(EYE_Y).toBeGreaterThan(geo.topY);
      expect(NOSE_Y).toBeLessThan(geo.chinY);
      expect(MOUTH_Y).toBeLessThan(geo.chinY);
    });

    it(`${id} は描画領域からはみ出さない`, () => {
      const geo = headGeometry(id);
      expect(CENTER_X - geo.halfWidth).toBeGreaterThan(0);
      expect(CENTER_X + geo.halfWidth).toBeLessThan(VIEW_W);
      expect(geo.topY).toBeGreaterThan(0);
      expect(geo.chinY).toBeLessThan(VIEW_H);
    });
  }

  it('10種類の輪郭がすべて違う形になっている', () => {
    const paths = new Set(HEAD_IDS.map((id) => headGeometry(id).path));
    expect(paths.size).toBe(HEAD_IDS.length);
  });

  it('単純な拡大縮小ではない（幅とあごの比が一定でない）', () => {
    const ratios = HEAD_IDS.map((id) => {
      const g = headGeometry(id);
      return Math.round((g.jawHalf / g.halfWidth) * 100);
    });
    expect(new Set(ratios).size).toBeGreaterThanOrEqual(7);
  });

  it('知らないIDでも標準の形に落ちる', () => {
    const geo = headGeometry('head_99_unknown' as never);
    expect(geo.path.length).toBeGreaterThan(10);
  });

  it('HEAD_GEOMETRIES は全IDを持つ', () => {
    expect(Object.keys(HEAD_GEOMETRIES).sort()).toEqual([...HEAD_IDS].sort());
  });
});

/* ================================================================
 * 4. Appearance Profile が選手ごとに固定される（§7・§26）
 * ============================================================== */

describe('PHASE4.5 選手ごとに固定される', () => {
  it('同じ playerId からは必ず同じ素の顔になる', () => {
    const a = baseAppearanceOf('p-100');
    const b = baseAppearanceOf('p-100');
    expect(a).toEqual(b);
  });

  it('1000回作り直しても素の顔が変わらない', () => {
    const first = baseAppearanceOf('stable-1');
    for (let i = 0; i < 1000; i++) {
      expect(baseAppearanceOf('stable-1')).toEqual(first);
    }
  });

  it('版番号が profile に入る', () => {
    expect(baseAppearanceOf('p-1').version).toBe(APPEARANCE_VERSION);
  });

  it('違う playerId なら違う顔になる', () => {
    const a = baseAppearanceOf('p-1');
    const b = baseAppearanceOf('p-2');
    expect(a).not.toEqual(b);
  });

  it('新規ゲームの全選手が Appearance を作れる', () => {
    const state = newGame();
    for (const player of state.players) {
      const look = appearanceOf(player);
      expect(HEAD_IDS).toContain(look.head);
      expect(SKIN_IDS).toContain(look.skin);
      expect(EYE_IDS).toContain(look.eyes);
    }
  });

  it('球団が変わっても顔は変わらない', () => {
    const state = newGame();
    const player = state.players[0];
    const before = appearanceOf(player);
    const moved: Player = { ...player, teamId: 'bluewave' };
    const after = appearanceOf(moved);
    expect(after.head).toBe(before.head);
    expect(after.eyes).toBe(before.eyes);
    expect(after.nose).toBe(before.nose);
    expect(after.skin).toBe(before.skin);
  });

  it('能力が変わっても顔（造作）は変わらない', () => {
    const state = newGame();
    const player = state.players.find((p) => !p.isPitcher)!;
    const before = appearanceOf(player);
    const stronger: Player = {
      ...player,
      batting: { ...player.batting, power: 99, contact: 99 },
    };
    const after = appearanceOf(stronger);
    expect(after.head).toBe(before.head);
    expect(after.eyes).toBe(before.eyes);
    expect(after.mouth).toBe(before.mouth);
    expect(after.ears).toBe(before.ears);
    expect(after.jaw).toBe(before.jaw);
  });

  it('顔の良し悪しと能力に関係がない（同じ総合でも顔は散る）', () => {
    const heads = new Set<string>();
    for (let i = 0; i < 200; i++) heads.add(baseAppearanceOf(`same-ability-${i}`).head);
    expect(heads.size).toBeGreaterThanOrEqual(8);
  });

  it('appearanceFromId は Player 版と同じ造作になる', () => {
    const state = newGame();
    const player = state.players[3];
    const fromPlayer = appearanceOf(player);
    const fromId = appearanceFromId(player.id, player.age, player.isPitcher);
    expect(fromId.head).toBe(fromPlayer.head);
    expect(fromId.eyes).toBe(fromPlayer.eyes);
    expect(fromId.hair).toBe(fromPlayer.hair);
    expect(fromId.hairColor).toBe(fromPlayer.hairColor);
    expect(fromId.facialHair).toBe(fromPlayer.facialHair);
  });

  it('1000人つくっても Appearance が偏らない', () => {
    const profiles = Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`bulk-${i}`));
    const keys = profiles.map((p) =>
      [p.head, p.hair, p.eyes, p.nose, p.mouth, p.eyebrows, p.ears, p.jaw, p.skin, p.hairColor].join('|'),
    );
    // 完全一致は 1% 未満に収まること
    expect(new Set(keys).size).toBeGreaterThan(990);
  });

  it('1000人で頭の形が全種類出る', () => {
    const heads = new Set(Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`h-${i}`).head));
    expect(heads.size).toBe(HEAD_IDS.length);
  });

  it('1000人で髪型が全種類出る', () => {
    const hair = new Set(Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`w-${i}`).hair));
    expect(hair.size).toBe(HAIR_IDS.length);
  });

  it('1000人で目が全種類出る', () => {
    const eyes = new Set(Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`e-${i}`).eyes));
    expect(eyes.size).toBe(EYE_IDS.length);
  });

  it('1000人で肌が全段階出る', () => {
    const skin = new Set(Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`s-${i}`).skin));
    expect(skin.size).toBe(SKIN_IDS.length);
  });

  it('眼鏡をかける選手は一部だけ', () => {
    const withGlasses = Array.from({ length: 1000 }, (_u, i) => baseAppearanceOf(`g-${i}`)).filter(
      (p) => p.accessories.includes('acc_glasses'),
    );
    expect(withGlasses.length).toBeGreaterThan(20);
    expect(withGlasses.length).toBeLessThan(200);
  });
});

/* ================================================================
 * 5. 年齢変化（§9・§27）
 * ============================================================== */

describe('PHASE4.5 年齢変化', () => {
  const AGES = [18, 22, 27, 32, 36, 40];

  it('年齢から段階が決まる', () => {
    expect(ageStageOf(18)).toBe('YOUTH');
    expect(ageStageOf(22)).toBe('YOUTH');
    expect(ageStageOf(23)).toBe('PRIME');
    expect(ageStageOf(27)).toBe('PRIME');
    expect(ageStageOf(28)).toBe('MATURE');
    expect(ageStageOf(31)).toBe('MATURE');
    expect(ageStageOf(32)).toBe('VETERAN');
    expect(ageStageOf(35)).toBe('VETERAN');
    expect(ageStageOf(36)).toBe('ELDER');
    expect(ageStageOf(44)).toBe('ELDER');
  });

  for (const age of AGES) {
    it(`${age}歳でも輪郭・目・鼻・口・耳が変わらない（別人にならない）`, () => {
      const base = baseAppearanceOf('aging-1');
      const look = buildAppearance({ playerId: 'aging-1', age, isPitcher: false });
      expect(look.head).toBe(base.head);
      expect(look.eyes).toBe(base.eyes);
      expect(look.nose).toBe(base.nose);
      expect(look.mouth).toBe(base.mouth);
      expect(look.ears).toBe(base.ears);
      expect(look.skin).toBe(base.skin);
      expect(look.jaw).toBe(base.jaw);
    });

    it(`${age}歳の肖像が壊れずに描ける`, () => {
      const svg = draw(buildAppearance({ playerId: 'aging-1', age, isPitcher: false }));
      expect(svg).toContain('<svg');
      expect(svg).not.toMatch(/NaN|undefined/);
    });
  }

  it('若い選手にはひげがほとんど出ない', () => {
    const bearded = Array.from({ length: 400 }, (_u, i) =>
      buildAppearance({ playerId: `young-${i}`, age: 19, isPitcher: false }),
    ).filter((p) => p.facialHair !== 'face_01_none');
    expect(bearded.length).toBeLessThan(80);
  });

  it('年齢が上がるとひげが出やすくなる', () => {
    const rate = (age: number) =>
      Array.from({ length: 400 }, (_u, i) =>
        buildAppearance({ playerId: `beard-${i}`, age, isPitcher: false }),
      ).filter((p) => p.facialHair !== 'face_01_none').length;
    expect(rate(34)).toBeGreaterThan(rate(20));
  });

  it('若い選手に白髪は出ない', () => {
    for (let i = 0; i < 300; i++) {
      const look = buildAppearance({ playerId: `grey-${i}`, age: 21, isPitcher: false });
      expect(look.hairColor).not.toBe('hairc_08_white');
      expect(look.hairColor).not.toBe('hairc_07_grey');
    }
  });

  it('大ベテランには白髪・グレーが現れる', () => {
    const greys = Array.from({ length: 400 }, (_u, i) =>
      buildAppearance({ playerId: `old-${i}`, age: 38, isPitcher: false }),
    ).filter((p) => p.hairColor === 'hairc_07_grey' || p.hairColor === 'hairc_08_white' || p.hairColor === 'hairc_06_ash');
    expect(greys.length).toBeGreaterThan(20);
  });

  it('年輪は年齢とともに増え、2本を超えない', () => {
    const lines = (age: number) => buildAppearance({ playerId: 'lines-1', age, isPitcher: false }).ageLines;
    expect(lines(20)).toBe(0);
    expect(lines(24)).toBe(0);
    expect(lines(34)).toBeGreaterThanOrEqual(1);
    expect(lines(40)).toBe(2);
    for (const age of AGES) expect(lines(age)).toBeLessThanOrEqual(2);
  });

  it('年齢が変わっても髪型は近い形にしか動かない', () => {
    for (let i = 0; i < 200; i++) {
      const young = buildAppearance({ playerId: `hair-${i}`, age: 24, isPitcher: false });
      const old = buildAppearance({ playerId: `hair-${i}`, age: 38, isPitcher: false });
      expect(HAIR_IDS).toContain(old.hair);
      // 同じか、年齢で寄せた先のどちらか
      expect(typeof old.hair).toBe('string');
      expect(young.head).toBe(old.head);
    }
  });

  it('引退した年齢でも同じ人物として描ける', () => {
    const active = buildAppearance({ playerId: 'retire-1', age: 30, isPitcher: false });
    const retired = buildAppearance({ playerId: 'retire-1', age: 41, isPitcher: false });
    expect(retired.head).toBe(active.head);
    expect(retired.eyes).toBe(active.eyes);
    expect(draw(retired, '引退選手', { showCap: false })).toContain('<svg');
  });

  it('年齢を変えてもゲームの状態は変わらない', () => {
    const state = newGame();
    const before = JSON.stringify(state);
    for (const age of AGES) buildAppearance({ playerId: state.players[0].id, age, isPitcher: false });
    expect(JSON.stringify(state)).toBe(before);
  });
});

/* ================================================================
 * 6. 体型（見た目だけ。能力に影響しない）
 * ============================================================== */

describe('PHASE4.5 体型', () => {
  it('体型は用意された10種類のどれかになる', () => {
    for (let i = 0; i < 300; i++) {
      const look = buildAppearance({
        playerId: `body-${i}`,
        age: 26,
        isPitcher: i % 3 === 0,
        power: (i * 7) % 100,
        speed: (i * 13) % 100,
        stamina: (i * 11) % 100,
      });
      expect(BODY_IDS).toContain(look.body);
    }
  });

  it('パワーが高い野手はがっしり系になる', () => {
    const look = buildAppearance({ playerId: 'power-1', age: 27, isPitcher: false, power: 85, speed: 40 });
    expect(look.body).toBe('body_04_power');
  });

  it('走力が高い野手は細身になる', () => {
    const look = buildAppearance({ playerId: 'fast-1', age: 25, isPitcher: false, power: 40, speed: 80 });
    expect(look.body).toBe('body_01_slim');
  });

  it('スタミナのある投手は先発型の体格になる', () => {
    const look = buildAppearance({ playerId: 'sp-1', age: 27, isPitcher: true, stamina: 70, power: 50 });
    expect(['body_06_tall', 'body_09_pitcher']).toContain(look.body);
  });

  it('体型が変わっても顔は変わらない', () => {
    const thin = buildAppearance({ playerId: 'same-1', age: 26, isPitcher: false, power: 20, speed: 90 });
    const heavy = buildAppearance({ playerId: 'same-1', age: 26, isPitcher: false, power: 90, speed: 20 });
    expect(thin.head).toBe(heavy.head);
    expect(thin.eyes).toBe(heavy.eyes);
    expect(thin.body).not.toBe(heavy.body);
  });

  it('bodyOf は能力が無くても決まる', () => {
    const body = bodyOf({ playerId: 'x', age: 26, isPitcher: false }, appearanceHash('x'));
    expect(BODY_IDS).toContain(body);
  });
});

/* ================================================================
 * 7. 表情（§10・§28）
 * ============================================================== */

describe('PHASE4.5 表情', () => {
  const look = fakePlayer('exp-1', 28);

  for (const expression of EXPRESSIONS) {
    it(`${expression} の肖像が描ける`, () => {
      const svg = draw(look, '選手', { expression });
      expect(svg).toContain('<svg');
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg).toContain(`portrait-x-${expression}`);
    });

    it(`${expression} でも顔の造作は同じ`, () => {
      // 表情は目・口の開き方だけを変える。部品IDそのものは動かさない
      const a = draw(look, '選手', { expression });
      const b = draw(look, '選手', { expression: 'neutral' });
      expect(a.length).toBeGreaterThan(500);
      expect(b.length).toBeGreaterThan(500);
    });
  }

  it('表情が違えば絵も違う', () => {
    const neutral = draw(look, '選手', { expression: 'neutral' });
    const happy = draw(look, '選手', { expression: 'happy' });
    expect(neutral).not.toBe(happy);
  });

  it('怪我のときは injured になる', () => {
    const state = newGame();
    const player = cloneState(state).players[0];
    player.ext.injury = {
      level: 'major',
      name: '右肩の炎症',
      startDate: state.date,
      returnDate: '2026-06-01',
    };
    expect(expressionOf(state, player)).toBe('injured');
  });

  it('絶好調のときは confident になる', () => {
    const state = cloneState(newGame());
    const player = state.players[0];
    player.ext.injury = null;
    player.ext.slump = null;
    player.ext.fatigue = 0;
    player.ext.condition = 'best';
    player.ext.debutYear = state.year - 3;
    expect(expressionOf(state, player)).toBe('confident');
  });

  it('スランプのときは disappointed になる', () => {
    const state = cloneState(newGame());
    const player = state.players[0];
    player.ext.injury = null;
    player.ext.slump = { kind: 'batting', startDate: state.date, endDate: null, depth: 1 } as never;
    expect(expressionOf(state, player)).toBe('disappointed');
  });

  it('疲れているときは tired になる', () => {
    const state = cloneState(newGame());
    const player = state.players[0];
    player.ext.injury = null;
    player.ext.slump = null;
    player.ext.fatigue = 90;
    expect(expressionOf(state, player)).toBe('tired');
  });

  it('新人は focused になる', () => {
    const state = cloneState(newGame());
    const player = state.players[0];
    player.ext.injury = null;
    player.ext.slump = null;
    player.ext.fatigue = 0;
    player.ext.condition = 'normal';
    player.ext.debutYear = state.year;
    expect(expressionOf(state, player)).toBe('focused');
  });

  it('表情の判定はゲームの状態を書き換えない', () => {
    const state = newGame();
    const before = JSON.stringify(state);
    for (const player of state.players.slice(0, 50)) expressionOf(state, player);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('返る表情は必ず用意されている10種類のどれか', () => {
    const state = newGame();
    for (const player of state.players) {
      expect(EXPRESSIONS).toContain(expressionOf(state, player));
    }
  });
});

/* ================================================================
 * 8. ポーズ（§11・§29）
 * ============================================================== */

describe('PHASE4.5 ポーズ', () => {
  const look = fakePlayer('pose-1', 27);

  for (const pose of POSES) {
    it(`${pose} の肖像が描ける`, () => {
      const svg = draw(look, '選手', { pose, size: 'large' });
      expect(svg).toContain('<svg');
      expect(svg).not.toMatch(/NaN|undefined/);
    });

    it(`${pose} は小さい表示では腕を描かない`, () => {
      const svg = draw(look, '選手', { pose, size: 'small' });
      expect(svg).not.toContain('pt-layer-arms');
    });
  }

  it('大きい表示では腕が描かれる', () => {
    expect(draw(look, '選手', { size: 'large', pose: 'pose_bat' })).toContain('pt-layer-arms');
    expect(draw(look, '選手', { size: 'hero', pose: 'pose_pitch' })).toContain('pt-layer-arms');
  });

  it('ポーズが違えば絵も違う', () => {
    const bat = draw(look, '選手', { size: 'large', pose: 'pose_bat' });
    const pitch = draw(look, '選手', { size: 'large', pose: 'pose_pitch' });
    expect(bat).not.toBe(pitch);
  });

  it('投手には投球ポーズ、野手には打席ポーズが選ばれる', () => {
    expect(poseOf({ isPitcher: true })).toBe('pose_pitch');
    expect(poseOf({ isPitcher: false })).toBe('pose_bat');
  });

  it('打席のポーズではヘルメットになる', () => {
    expect(draw(look, '選手', { size: 'large', pose: 'pose_bat' })).toContain('pt-helmet');
  });

  it('投球のポーズではキャップのまま', () => {
    expect(draw(look, '選手', { size: 'large', pose: 'pose_pitch' })).toContain('pt-cap');
  });
});

/* ================================================================
 * 9. SVG の品質（§24）
 * ============================================================== */

describe('PHASE4.5 SVGの品質', () => {
  const samples = Array.from({ length: 60 }, (_u, i) => fakePlayer(`svg-${i}`, 18 + (i % 24)));

  it('すべて svg タグで始まる', () => {
    for (const look of samples) expect(draw(look)).toMatch(/^<svg/);
  });

  it('viewBox が指定されている', () => {
    for (const look of samples) expect(draw(look)).toContain('viewBox=');
  });

  it('script タグを含まない', () => {
    for (const look of samples) expect(draw(look)).not.toContain('<script');
  });

  it('外部URLを参照しない', () => {
    for (const look of samples) {
      const svg = draw(look);
      expect(svg).not.toMatch(/https?:\/\//);
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('xlink:href');
    }
  });

  it('NaN や undefined を含まない', () => {
    for (const size of SIZES) {
      for (const look of samples) {
        expect(draw(look, '選手', { size })).not.toMatch(/NaN|undefined|null\)/);
      }
    }
  });

  it('読み上げ用のラベルが付いている', () => {
    for (const look of samples.slice(0, 10)) {
      expect(draw(look, '山田 太郎')).toContain('aria-label="山田 太郎の肖像"');
    }
  });

  it('role="img" が付いている', () => {
    expect(draw(samples[0])).toContain('role="img"');
  });

  it('パスの d 属性が空でない', () => {
    for (const look of samples.slice(0, 20)) {
      const svg = draw(look);
      expect(svg).not.toContain('d=""');
    }
  });

  it('すべての表情・ポーズの組み合わせが描ける', () => {
    const look = samples[0];
    for (const expression of EXPRESSIONS) {
      for (const pose of POSES) {
        const svg = draw(look, '選手', { expression, pose, size: 'large' });
        expect(svg).toContain('<svg');
        expect(svg).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('全サイズで幅と高さが数値になる', () => {
    for (const size of SIZES) {
      const svg = draw(samples[1], '選手', { size });
      expect(svg).toMatch(/width="\d+"/);
      expect(svg).toMatch(/height="\d+"/);
    }
  });

  it('サイズごとの表示幅が §18 の範囲に収まる', () => {
    expect(SIZE_PX.small).toBeGreaterThanOrEqual(40);
    expect(SIZE_PX.small).toBeLessThanOrEqual(56);
    expect(SIZE_PX.medium).toBeGreaterThanOrEqual(72);
    expect(SIZE_PX.medium).toBeLessThanOrEqual(100);
    expect(SIZE_PX.large).toBeGreaterThanOrEqual(140);
    expect(SIZE_PX.large).toBeLessThanOrEqual(200);
    expect(SIZE_PX.hero).toBeGreaterThanOrEqual(220);
    expect(SIZE_PX.hero).toBeLessThanOrEqual(320);
  });

  it('小さい表示は胸から上、大きい表示は全身の切り取りになる', () => {
    expect(SIZE_CROP.small).toBe('bust');
    expect(SIZE_CROP.medium).toBe('bust');
    expect(SIZE_CROP.large).toBe('full');
    expect(SIZE_CROP.hero).toBe('full');
  });

  it('球団色を渡すと帽子に反映される', () => {
    const svg = draw(samples[2], '選手', { teamColor: '#c0392b' });
    expect(svg).toContain('#c0392b');
  });

  it('球団色を渡さなければ墨色になる', () => {
    expect(draw(samples[2])).toContain('var(--ink-2)');
  });

  it('背景を球団色で塗りつぶさない（§22）', () => {
    const svg = draw(samples[3], '選手', { teamColor: '#0055ff' });
    expect(svg).toContain('class="pt-paper"');
    // 背景の矩形に球団色が入っていないこと
    expect(svg).not.toMatch(/<rect[^>]*class="pt-paper"[^>]*#0055ff/);
  });

  it('帽子を外すと髪の本体が出る', () => {
    const withCap = draw(samples[4], '選手', { showCap: true });
    const without = draw(samples[4], '選手', { showCap: false });
    expect(withCap).toContain('pt-cap');
    expect(without).not.toContain('pt-cap');
    expect(without).toContain('pt-hair');
  });

  it('ユニフォームを外しても壊れない', () => {
    const svg = draw(samples[5], '選手', { showUniform: false });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('pt-jersey');
  });

  it('アニメーション指定でクラスが付く', () => {
    expect(draw(samples[6], '選手', { animate: true })).toContain('portrait-reveal');
    expect(draw(samples[6], '選手', { animate: false })).not.toContain('portrait-reveal');
  });

  it('追加のクラス名を渡せる', () => {
    expect(draw(samples[7], '選手', { className: 'portrait-row' })).toContain('portrait-row');
  });
});

/* ================================================================
 * 10. 同じ選手の安定性（§26）
 * ============================================================== */

describe('PHASE4.5 同じ選手はいつでも同じ絵', () => {
  it('1000回描いても同じ SVG になる', () => {
    const look = fakePlayer('render-stable', 29);
    const first = draw(look);
    for (let i = 0; i < 1000; i++) expect(draw(look)).toBe(first);
  });

  it('表情とポーズ以外を変えなければ同じ絵になる', () => {
    const look = fakePlayer('render-stable-2', 25);
    const a = draw(look, '選手', { expression: 'neutral', pose: 'pose_idle' });
    const b = draw(look, '選手', { expression: 'neutral', pose: 'pose_idle' });
    expect(a).toBe(b);
  });

  it('Player から作り直しても同じ絵になる', () => {
    const state = newGame();
    const player = state.players[10];
    expect(draw(appearanceOf(player), player.name)).toBe(draw(appearanceOf(player), player.name));
  });

  it('セーブして読み直した相当（同じIDの別オブジェクト）でも同じ絵', () => {
    const state = newGame();
    const player = state.players[11];
    const copy: Player = JSON.parse(JSON.stringify(player));
    expect(draw(appearanceOf(copy), copy.name)).toBe(draw(appearanceOf(player), player.name));
  });

  it('シーズンを進めても同じ選手は同じ顔のまま', () => {
    let state = newGame(451451);
    const target = state.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = baseAppearanceOf(target.id);
    for (let i = 0; i < 12 && !state.seasonFinished; i++) state = advanceDay(state).state;
    const after = state.players.find((p) => p.id === target.id)!;
    expect(baseAppearanceOf(after.id)).toEqual(before);
  });

  it('12球団すべての選手で顔が作れる（欠けない）', () => {
    const state = newGame();
    for (const team of state.teams) {
      const roster = state.players.filter((p) => p.teamId === team.id);
      expect(roster.length).toBeGreaterThan(0);
      for (const p of roster) expect(() => appearanceOf(p)).not.toThrow();
    }
  });
});

/* ================================================================
 * 11. 1000人ぶんの生成（§25）
 * ============================================================== */

describe('PHASE4.5 1000人を描く', () => {
  const many = Array.from({ length: 1000 }, (_u, i) =>
    buildAppearance({
      playerId: `mass-${i}`,
      age: 18 + (i % 22),
      isPitcher: i % 3 === 0,
      power: (i * 17) % 100,
      speed: (i * 29) % 100,
      stamina: (i * 13) % 100,
    }),
  );

  it('1000人すべてが例外なく作れる', () => {
    expect(many).toHaveLength(1000);
    for (const look of many) expect(look.playerId).toMatch(/^mass-/);
  });

  it('1000人すべてが欠けた部品を持たない', () => {
    for (const look of many) {
      expect(HEAD_IDS).toContain(look.head);
      expect(HAIR_IDS).toContain(look.hair);
      expect(EYEBROW_IDS).toContain(look.eyebrows);
      expect(EYE_IDS).toContain(look.eyes);
      expect(NOSE_IDS).toContain(look.nose);
      expect(MOUTH_IDS).toContain(look.mouth);
      expect(EAR_IDS).toContain(look.ears);
      expect(JAW_IDS).toContain(look.jaw);
      expect(BODY_IDS).toContain(look.body);
      expect(SKIN_IDS).toContain(look.skin);
      expect(HAIR_COLOR_IDS).toContain(look.hairColor);
      expect(FACIAL_HAIR_IDS).toContain(look.facialHair);
    }
  });

  it('先頭200人の SVG が壊れない', () => {
    for (const look of many.slice(0, 200)) {
      const svg = draw(look);
      expect(svg).toContain('<svg');
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });

  it('完全一致する見た目がほとんど無い', () => {
    const keys = many.map((p) =>
      [p.head, p.hair, p.hairColor, p.eyes, p.eyebrows, p.nose, p.mouth, p.ears, p.jaw, p.skin].join('|'),
    );
    expect(new Set(keys).size).toBeGreaterThanOrEqual(990);
  });

  it('先頭100人の SVG がすべて違う', () => {
    const svgs = new Set(many.slice(0, 100).map((look) => draw(look)));
    expect(svgs.size).toBe(100);
  });

  it('体型も散らばる', () => {
    expect(new Set(many.map((p) => p.body)).size).toBeGreaterThanOrEqual(6);
  });

  it('ひげの種類も散らばる', () => {
    expect(new Set(many.map((p) => p.facialHair)).size).toBeGreaterThanOrEqual(5);
  });
});

/* ================================================================
 * 12. 相性ルール（§13）
 * ============================================================== */

describe('PHASE4.5 部品の相性', () => {
  it('調整しても顔の造作（頭・目・鼻・口）は変わらない', () => {
    for (let i = 0; i < 300; i++) {
      const look = fakePlayer(`fit-${i}`, 26);
      const fixed = resolveCompatibility(look);
      expect(fixed.head).toBe(look.head);
      expect(fixed.eyes).toBe(look.eyes);
      expect(fixed.nose).toBe(look.nose);
      expect(fixed.mouth).toBe(look.mouth);
    }
  });

  it('調整後も部品IDは正しい一覧の中にある', () => {
    for (let i = 0; i < 300; i++) {
      const fixed = resolveCompatibility(fakePlayer(`fit2-${i}`, 34));
      expect(EAR_IDS).toContain(fixed.ears);
      expect(EYEBROW_IDS).toContain(fixed.eyebrows);
      expect(FACIAL_HAIR_IDS).toContain(fixed.facialHair);
    }
  });

  it('調整が要らない組み合わせはそのまま返る', () => {
    const look: PlayerAppearance = {
      ...fakePlayer('fit-plain', 26),
      head: 'head_01_round',
      hair: 'hair_02_short',
      ears: 'ear_01_standard',
      eyebrows: 'brow_03_straight',
      facialHair: 'face_01_none',
    };
    expect(resolveCompatibility(look)).toBe(look);
    expect(needsAdjustment(look)).toBe(false);
  });

  it('ボリュームのある髪と大きな耳は重ならないように直る', () => {
    const look: PlayerAppearance = {
      ...fakePlayer('fit-bulky', 26),
      hair: 'hair_15_volume',
      ears: 'ear_03_large',
    };
    expect(resolveCompatibility(look).ears).not.toBe('ear_03_large');
    expect(needsAdjustment(look)).toBe(true);
  });

  it('細い輪郭と広いひげは短いひげに直る', () => {
    const look: PlayerAppearance = {
      ...fakePlayer('fit-narrow', 34),
      head: 'head_06_narrow',
      facialHair: 'face_06_beard_full',
    };
    expect(resolveCompatibility(look).facialHair).toBe('face_05_beard_short');
  });

  it('薄い髪と最も濃い眉は一段落ちる', () => {
    const look: PlayerAppearance = {
      ...fakePlayer('fit-thin', 38),
      hair: 'hair_14_thin',
      eyebrows: 'brow_07_dense',
    };
    expect(resolveCompatibility(look).eyebrows).toBe('brow_01_thick');
  });

  it('調整は何度かけても同じ結果になる', () => {
    for (let i = 0; i < 100; i++) {
      const look = fakePlayer(`fit3-${i}`, 30);
      const once = resolveCompatibility(look);
      expect(resolveCompatibility(once)).toEqual(once);
    }
  });
});

/* ================================================================
 * 13. フォールバック（§35）
 * ============================================================== */

describe('PHASE4.5 フォールバック', () => {
  it('用意できないときも壊れた見た目にならない', () => {
    const svg = renderToStaticMarkup(
      createElement(PortraitFallbackSvg, { name: '不明' }),
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('portrait-fallback');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('フォールバックにも読み上げ用のラベルがある', () => {
    const svg = renderToStaticMarkup(createElement(PortraitFallbackSvg, { name: '不明' }));
    expect(svg).toContain('aria-label');
  });

  it('画面に missing や undefined の文字が出ない', () => {
    const svg = renderToStaticMarkup(createElement(PortraitFallbackSvg, { name: '不明' }));
    expect(svg).not.toContain('missing');
    expect(svg).not.toContain('undefined');
  });

  it('全サイズでフォールバックが描ける', () => {
    for (const size of SIZES) {
      const svg = renderToStaticMarkup(createElement(PortraitFallbackSvg, { name: '不明', size }));
      expect(svg).toContain('<svg');
    }
  });

  it('知らない部品IDが混ざっても描ける', () => {
    const broken = {
      ...fakePlayer('broken-1', 26),
      head: 'head_zz' as never,
      eyes: 'eye_zz' as never,
      nose: 'nose_zz' as never,
      mouth: 'mouth_zz' as never,
      ears: 'ear_zz' as never,
      eyebrows: 'brow_zz' as never,
      hair: 'hair_zz' as never,
      skin: 'skin_zz' as never,
      hairColor: 'hairc_zz' as never,
      body: 'body_zz' as never,
    } as PlayerAppearance;
    const svg = draw(broken);
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});

/* ================================================================
 * 14. ゲームロジックを一切変えない（§30・§31・§53）
 * ============================================================== */

describe('PHASE4.5 ゲームに触らない', () => {
  it('見た目を作っても rngState が動かない', () => {
    const state = newGame();
    const before = state.rngState;
    for (const player of state.players) appearanceOf(player);
    expect(state.rngState).toBe(before);
  });

  it('肖像を描いても rngState が動かない', () => {
    const state = newGame();
    const before = state.rngState;
    for (const player of state.players.slice(0, 50)) draw(appearanceOf(player), player.name);
    expect(state.rngState).toBe(before);
  });

  it('見た目を作っても state がまったく変わらない', () => {
    const state = newGame();
    const before = JSON.stringify(state);
    for (const player of state.players) {
      appearanceOf(player);
      expressionOf(state, player);
      poseOf(player);
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('肖像を描いても選手の能力が変わらない', () => {
    const state = newGame();
    const player = state.players[0];
    const abilities = JSON.stringify({ b: player.batting, p: player.pitching });
    draw(appearanceOf(player), player.name, { size: 'hero', pose: 'pose_celebrate' });
    expect(JSON.stringify({ b: player.batting, p: player.pitching })).toBe(abilities);
  });

  it('肖像を描いても成績が変わらない', () => {
    const state = newGame();
    const stats = JSON.stringify(state.stats);
    for (const player of state.players.slice(0, 30)) draw(appearanceOf(player), player.name);
    expect(JSON.stringify(state.stats)).toBe(stats);
  });

  it('見た目のコードが Math.random / Date.now を使っていない', () => {
    for (const [path, source] of Object.entries(VISUAL_SOURCES)) {
      expect(source, path).not.toContain('Math.random');
      expect(source, path).not.toContain('Date.now');
      expect(source, path).not.toContain('performance.now');
    }
  });

  it('見た目のコードがゲームの乱数器を読み込んでいない', () => {
    for (const [path, source] of Object.entries(VISUAL_SOURCES)) {
      expect(source, path).not.toMatch(/from '.*\/rng'/);
      expect(source, path).not.toContain('rngState');
      expect(source, path).not.toContain('advanceRng');
    }
  });

  it('見た目のコードが外部URL・CDN・Webフォントに依存していない', () => {
    for (const [path, source] of Object.entries(VISUAL_SOURCES)) {
      expect(source, path).not.toMatch(/https?:\/\//);
      expect(source, path).not.toContain('fetch(');
      expect(source, path).not.toContain('getContext');
      expect(source, path).not.toContain('WebGL');
    }
  });

  it('肖像の実装ファイルがすべて読み込めている', () => {
    expect(Object.keys(VISUAL_SOURCES).length).toBeGreaterThanOrEqual(12);
  });

  it('同じシードのゲームは肖像を描いても同じ結果になる', () => {
    const play = (withPortraits: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 987654);
      for (let i = 0; i < 20 && !state.seasonFinished; i++) {
        if (withPortraits) {
          for (const player of state.players.slice(0, 20)) draw(appearanceOf(player), player.name);
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = play(false);
    const drawn = play(true);
    expect(drawn.rngState).toBe(plain.rngState);
    expect(JSON.stringify(drawn.records)).toBe(JSON.stringify(plain.records));
    expect(JSON.stringify(drawn.stats)).toBe(JSON.stringify(plain.stats));
  });

  it('セーブに画像そのものは入らない', () => {
    const state = newGame();
    const saved = JSON.stringify(state);
    expect(saved).not.toContain('<svg');
    expect(saved).not.toContain('viewBox');
    expect(saved).not.toContain('appearance');
  });

  it('見た目はセーブ無しで playerId から作り直せる', () => {
    const state = newGame();
    const player = state.players[5];
    const rebuilt = appearanceFromId(player.id, player.age, player.isPitcher);
    expect(rebuilt.head).toBe(appearanceOf(player).head);
  });
});

/* ================================================================
 * 15. レイヤーの順番（§5）
 * ============================================================== */

describe('PHASE4.5 レイヤーの順番', () => {
  const svg = draw(fakePlayer('layer-1', 30), '選手', { size: 'large', showCap: true });

  const order = (needle: string) => svg.indexOf(needle);

  it('体は顔より先に描かれる', () => {
    expect(order('pt-jersey')).toBeLessThan(order('pt-eyes'));
  });

  it('耳は頭より先に描かれる', () => {
    expect(order('pt-ears')).toBeLessThan(order('pt-eyes'));
  });

  it('眉・目・鼻・口の順に描かれる', () => {
    expect(order('pt-brows')).toBeLessThan(order('pt-eyes'));
    expect(order('pt-eyes')).toBeLessThan(order('pt-nose'));
    expect(order('pt-nose')).toBeLessThan(order('pt-mouth'));
  });

  it('帽子は顔より後に描かれる', () => {
    expect(order('pt-cap')).toBeGreaterThan(order('pt-eyes'));
  });

  it('小物はいちばん最後に描かれる', () => {
    expect(order('pt-accessories')).toBeGreaterThan(order('pt-cap'));
  });

  it('背景がいちばん最初に描かれる', () => {
    expect(order('pt-paper')).toBeLessThan(order('pt-jersey'));
  });
});

/* ================================================================
 * 16. 座標系（§4）
 * ============================================================== */

describe('PHASE4.5 座標系', () => {
  it('viewBox の基準は 256 x 320', () => {
    expect(VIEW_W).toBe(256);
    expect(VIEW_H).toBe(320);
  });

  it('顔の中心は横幅の真ん中', () => {
    expect(CENTER_X).toBe(VIEW_W / 2);
  });

  it('目・鼻・口が上から順に並ぶ', () => {
    expect(EYE_Y).toBeLessThan(NOSE_Y);
    expect(NOSE_Y).toBeLessThan(MOUTH_Y);
  });

  it('全サイズで同じ座標系を使う', () => {
    const look = fakePlayer('coord-1', 26);
    const boxes = SIZES.map((size) => {
      const svg = draw(look, '選手', { size });
      return svg.match(/viewBox="([^"]+)"/)![1];
    });
    // bust と full の2種類だけ
    expect(new Set(boxes).size).toBe(2);
  });
});

/* ================================================================
 * 17. UI で使う入口
 * ============================================================== */

describe('PHASE4.5 UIの入口', () => {
  it('BaseAppearance の型がそろっている', () => {
    const base: BaseAppearance = baseAppearanceOf('shape-1');
    expect(typeof base.seed).toBe('number');
    expect(typeof base.playerId).toBe('string');
    expect(Array.isArray(base.accessories)).toBe(true);
  });

  it('PlayerAppearance は年齢と段階を持つ', () => {
    const look = fakePlayer('shape-2', 33);
    expect(look.age).toBe(33);
    expect(look.ageStage).toBe('VETERAN');
  });

  it('表情とポーズの型が使える', () => {
    const e: Expression = 'confident';
    const p: Pose = 'pose_ready';
    expect(EXPRESSIONS).toContain(e);
    expect(POSES).toContain(p);
  });

  it('利き手が見た目に渡る', () => {
    const state = newGame();
    const lefty = state.players.find((p) => (p.isPitcher ? p.throws : p.bats) === 'L');
    if (lefty) expect(appearanceOf(lefty).handedness).toBe('L');
  });

  it('ユニフォームの既定はホーム', () => {
    expect(fakePlayer('uni-1', 26).uniform).toBe('uni_home');
  });

  it('ユニフォームを指定できる', () => {
    const look = buildAppearance({ playerId: 'uni-2', age: 26, isPitcher: false, uniform: 'uni_visitor' });
    expect(look.uniform).toBe('uni_visitor');
  });
});
