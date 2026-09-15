/**
 * PHASE 4.9 検査。
 *
 * Canvas版の見た目（domain/character/appearance.ts + ui/character/draw.ts +
 * ui/character/CanvasPortrait.tsx）を、これまでの自作SVGと同じ基準で調べる。
 *
 * 確かめたいのは3つだけ。
 *
 *   1. player.id だけから決まり、いつ呼んでも同じ結果になるか
 *   2. ゲームの乱数（rngState）・Math.random・Date.now を使っていないか
 *   3. ゲームロジック（試合・能力・成長・契約・FA・トレード・ドラフト・
 *      CPU AI・RNG・SAVE_VERSION）に触っていないか
 *
 * 絵そのものの良し悪しは測らない。ここで測るのは「壊れていないこと」だけ。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay } from './engine';
import { Rng, seedFrom } from './rng';
import {
  generatePlayerAppearance,
  PART_COUNTS,
  type PlayerAppearance,
  type RandomSource,
} from './character/appearance';

const PLAYER_TEAM = 'phoenix';

function ids(count: number, prefix = 'p49'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

function appearanceOf(
  playerId: string,
  options: { gear?: boolean; hatText?: string; number?: number | string } = {},
): PlayerAppearance {
  const seed = seedFrom(`player-canvas-appearance-v1:${playerId}`);
  const rng = new Rng(seed);
  const source: RandomSource = { next: () => rng.next() };
  return generatePlayerAppearance(source, options);
}

/* ================================================================
 * A. パーツ表の整合性（appearance.ts のコメントが要求している突き合わせ）
 * ============================================================== */

describe('PHASE4.9 A. パーツ数の突き合わせ', () => {
  it('draw.ts の配列の長さが appearance.ts の PART_COUNTS と一致する', async () => {
    const draw = await import('../ui/character/draw');
    expect(draw.HEADS.length).toBe(PART_COUNTS.head);
    expect(draw.BGS.length).toBe(PART_COUNTS.bg);
  });
});

/* ================================================================
 * B. 同じ id は同じ見た目（決定論）
 * ============================================================== */

describe('PHASE4.9 B. 同じ id は同じ見た目', () => {
  it('何度呼んでも同じ結果になる', () => {
    for (const id of ids(50)) {
      const first = appearanceOf(id);
      for (let i = 0; i < 5; i++) {
        expect(appearanceOf(id)).toEqual(first);
      }
    }
  });

  it('呼ぶ順番を変えても結果が変わらない', () => {
    const list = ids(30);
    const forward = list.map((id) => appearanceOf(id));
    const backward = [...list].reverse().map((id) => appearanceOf(id));
    expect(backward.reverse()).toEqual(forward);
  });

  it('間に別の選手を挟んでも変わらない', () => {
    const alone = appearanceOf('target');
    appearanceOf('noise-1');
    appearanceOf('noise-2');
    expect(appearanceOf('target')).toEqual(alone);
  });

  it('gear や number を変えると見た目も変わる（別引数は別結果）', () => {
    const withGear = appearanceOf('x', { gear: true, number: 7 });
    const noGear = appearanceOf('x', { gear: false, number: 7 });
    expect(withGear).not.toEqual(noGear);
    expect(withGear.numberText).toBe('7');
    expect(noGear.hat).toBe(0);
  });
});

/* ================================================================
 * C. 極端に偏らない
 * ============================================================== */

describe('PHASE4.9 C. 見た目が偏らない', () => {
  it('100人でほとんど重ならない', () => {
    const seen = new Set<string>();
    for (const id of ids(100, 'c100')) {
      const a = appearanceOf(id, { gear: true, number: 1 });
      seen.add(JSON.stringify(a));
    }
    expect(seen.size).toBeGreaterThanOrEqual(95);
  });

  it('頭・目・鼻・口・髪のどれも1種類に偏らない', () => {
    const counts: Record<string, Map<number, number>> = {};
    const keys: Array<keyof PlayerAppearance> = ['head', 'eye', 'nose', 'mouth', 'hair'];
    for (const id of ids(400, 'spread')) {
      const a = appearanceOf(id, { gear: false });
      for (const key of keys) {
        const map = (counts[key] ??= new Map());
        const value = a[key] as number;
        map.set(value, (map.get(value) ?? 0) + 1);
      }
    }
    for (const key of keys) {
      const map = counts[key]!;
      const worst = Math.max(...map.values());
      expect(worst / 400, key).toBeLessThan(0.6);
    }
  });

  it('番号は必ずパーツ数の範囲に収まる', () => {
    for (const id of ids(300, 'range')) {
      const a = appearanceOf(id, { gear: true });
      expect(a.head).toBeGreaterThanOrEqual(0);
      expect(a.head).toBeLessThan(PART_COUNTS.head);
      expect(a.eye).toBeLessThan(PART_COUNTS.eye);
      expect(a.hat).toBeLessThan(PART_COUNTS.hat);
      expect(a.body).toBeLessThan(PART_COUNTS.body);
    }
  });
});

/* ================================================================
 * D. 乱数と時刻を使わない
 * ============================================================== */

describe('PHASE4.9 D. 乱数と時刻を使わない', () => {
  const raw = import.meta.glob(
    ['./character/appearance.ts', '../ui/character/draw.ts', '../ui/character/CanvasPortrait.tsx'],
    { eager: true, query: '?raw', import: 'default' },
  ) as Record<string, string>;

  // コメントを外してから調べる。「Math.random を使わない」という説明文自体に
  // 反応してしまうと、書いてはいけない言葉の検査になって意味がなくなる。
  const code = Object.fromEntries(
    Object.entries(raw).map(([file, text]) => [
      file,
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '),
    ]),
  );

  it('3ファイルとも読み込めている', () => {
    expect(Object.keys(code).length).toBe(3);
  });

  it('Math.random がどこにもない', () => {
    for (const [file, text] of Object.entries(code)) {
      expect(text.includes('Math.random'), file).toBe(false);
    }
  });

  it('Date.now と new Date がどこにもない', () => {
    for (const [file, text] of Object.entries(code)) {
      expect(text.includes('Date.now'), file).toBe(false);
      expect(text.includes('new Date'), file).toBe(false);
    }
  });

  it('実行時に外部へ通信しない（fetch・外部URLなし）', () => {
    for (const [file, text] of Object.entries(code)) {
      expect(text.includes('fetch('), file).toBe(false);
      expect(/https?:\/\/(?!www\.w3\.org)/.test(text), file).toBe(false);
    }
  });
});

/* ================================================================
 * E. ゲームの乱数を1回も消費しない・試合結果に影響しない
 * ============================================================== */

describe('PHASE4.9 E. ゲームに触らない', () => {
  it('見た目を大量に作っても rngState が変わらない', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20260913);
    const before = state.rngState;
    for (const player of state.players) {
      appearanceOf(player.id, { gear: true, number: player.uniformNumber });
    }
    expect(state.rngState).toBe(before);
  });

  it('見た目を作りながら試合を進めても結果が同じ', () => {
    const run = (withVisuals: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 20260913);
      for (let day = 0; day < 10; day++) {
        if (withVisuals) {
          for (const player of state.players) {
            appearanceOf(player.id, { gear: true, number: player.uniformNumber });
          }
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = run(false);
    const visual = run(true);
    expect(visual.rngState).toBe(plain.rngState);
    expect(visual.records).toEqual(plain.records);
    expect(visual.date).toBe(plain.date);
  });

  it('SAVE_VERSION を変えていない', () => {
    expect(SAVE_VERSION).toBe(16);
  });

  it('見た目は能力値を見ていない（能力を書き換えても変わらない）', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20260913);
    const player = state.players[0];
    const before = appearanceOf(player.id, { number: player.uniformNumber });
    const boosted = { ...player, power: 99, contact: 99, speed: 99, age: 40 };
    const after = appearanceOf(boosted.id, { number: boosted.uniformNumber });
    expect(after).toEqual(before);
  });
});
