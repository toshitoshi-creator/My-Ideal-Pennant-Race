/**
 * PHASE 4.6 画像素材システム（Player Visual Asset System）のテスト。
 *
 * 確かめること：
 *   - 設計図（Appearance Profile v2）が player.id だけで決まる
 *   - 素材が1枚も無くてもゲームが壊れず、SVG に落ちる
 *   - 素材の仕様（キャンバス・命名・種類）が実装と食い違っていない
 *   - 実行時に外部AI・外部API・CDN・画像URLへ行かない
 *   - PHASE 4.5 の SVG と、ゲームのドメインロジックに一切触っていない
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay } from './engine';
import type { GameState, Player, PositionId } from './types';
import {
  DEFAULT_CATEGORY_COUNTS,
  HEADWEAR_ASSET,
  capAssetOf,
  REQUIRED_CATEGORIES,
  STANCE_EQUIPMENT,
  STANCE_GEAR_ASSET,
  STANCE_LABELS,
  STANCE_POSE_ASSET,
  VISUAL_CATEGORIES,
  VISUAL_PROFILE_VERSION,
  assetId,
  buildVisualProfile,
  buildVisualProfileFromId,
  expressionAsset,
  headwearOf,
  missingCategories,
  stanceOf,
  visualHash,
  visualPick,
  visualProfileAtAge,
} from './visualProfile';
import type { VisualCategory, VisualProfile, VisualStance } from './visualProfile';
import { APPEARANCE_VERSION, EXPRESSIONS, appearanceOf } from './playerAppearance';
import type { Expression } from './playerAppearance';

const PLAYER_TEAM = 'phoenix';

/**
 * ゲームの生成は重い（支配下70人 × 12球団）ので、同じシードは作り直さない。
 * どのテストも状態を書き換えないので使い回して問題ない。
 */
const GAMES = new Map<number, GameState>();
function newGame(seed = 460460): GameState {
  const cached = GAMES.get(seed);
  if (cached) return cached;
  const state = createNewGame(PLAYER_TEAM, 10, seed);
  GAMES.set(seed, state);
  return state;
}

/** 仮の選手（ゲームの状態には触れない） */
function fakePlayer(id: string, over: Partial<Player> = {}): Player {
  return { ...newGame().players[0], id, ...over };
}

/** 素材の仕様。実装とここがずれていないかを見る */
const SPEC = JSON.parse(
  (
    import.meta.glob('../../config/visual-assets.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  )['../../config/visual-assets.json'],
) as {
  version: number;
  canvas: { width: number; height: number };
  anchors: Record<string, Record<string, number>>;
  formats: Record<string, string>;
  sizes: Record<string, number>;
  categories: Array<{
    id: string;
    dir: string;
    prefix: string;
    min: number;
    max: number;
    required: boolean;
    layer: number;
  }>;
  skinTones: number;
  hairColors: number;
  naming: { pattern: string };
  forbidden: { items: string[] };
};

/** 同梱されている素材の目録（いまは空でよい） */
const MANIFEST = JSON.parse(
  (
    import.meta.glob('../assets/players/manifest.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  )['../assets/players/manifest.json'],
) as {
  version: number;
  canvas: { width: number; height: number };
  parts: Record<string, Array<{ id: string; path: string | null }>>;
};

/** PHASE 4.6 で足した実装ファイルの中身（禁止事項をソースで確かめる） */
const RAW_SOURCES = import.meta.glob(
  ['./visualProfile.ts', '../ui/visual/*.ts', '../ui/components/PlayerVisual.tsx', '../ui/components/PlayerPortraitImage.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** コメントを外したソース。禁止事項は「書いてあるか」ではなく「使っているか」で見る */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_SOURCES).map(([path, source]) => [
    path,
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
  ]),
);

const NAMING = new RegExp(SPEC.naming.pattern);
const STANCES: VisualStance[] = ['PITCHER', 'CATCHER', 'INFIELDER', 'OUTFIELDER', 'BATTER'];

/* ================================================================
 * 1. ハッシュ（ゲームの乱数から完全に独立している）
 * ============================================================== */

describe('PHASE4.6 ハッシュ', () => {
  it('同じ文字列からは必ず同じ値が出る', () => {
    expect(visualHash('p-001')).toBe(visualHash('p-001'));
  });

  it('違う文字列からは違う値が出る', () => {
    expect(visualHash('p-001')).not.toBe(visualHash('p-002'));
  });

  it('1文字違うだけで値が大きく変わる', () => {
    const a = visualHash('player-appearance-v2:p-100');
    const b = visualHash('player-appearance-v2:p-101');
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });

  it('空文字でも値を返す', () => {
    expect(Number.isFinite(visualHash(''))).toBe(true);
  });

  it('必ず 32bit の非負整数になる', () => {
    for (const key of ['a', 'bb', 'ccc', 'player-1', '日本語', '0']) {
      const h = visualHash(key);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it('visualPick は 0〜max-1 に必ず収まる', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const max of [1, 2, 6, 12, 18, 100]) {
        const v = visualPick(seed * 7919, seed % 20, max);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(max);
      }
    }
  });

  it('visualPick は max が 0 でも壊れない', () => {
    expect(visualPick(12345, 3, 0)).toBe(0);
  });

  it('同じ種と塩からは必ず同じ値が出る', () => {
    expect(visualPick(999, 4, 12)).toBe(visualPick(999, 4, 12));
  });

  it('塩が違えば別の枝になる（1000種で見て2種類以上）', () => {
    const a = new Set<number>();
    const b = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      a.add(visualPick(i, 0, 12));
      b.add(visualPick(i, 1, 12));
    }
    expect(a.size).toBeGreaterThan(1);
    expect(b.size).toBeGreaterThan(1);
  });

  it('1000通りの種でどの値もそこそこ出る（偏りすぎない）', () => {
    const counts = new Array(12).fill(0);
    for (let i = 0; i < 1200; i++) counts[visualPick(visualHash(`p-${i}`), 0, 12)] += 1;
    for (const c of counts) expect(c).toBeGreaterThan(20);
  });

  it('PHASE 4.5 とは別の版番号を使う', () => {
    // PHASE 4.7 で設計図を v3 に上げた（画像素材の割り当てが変わったため）。
    // v1（PHASE 4.5 の SVG）とは別系列である、という趣旨は変わらない。
    expect(VISUAL_PROFILE_VERSION).toBe(3);
    expect(VISUAL_PROFILE_VERSION).not.toBe(APPEARANCE_VERSION);
    expect(VISUAL_PROFILE_VERSION).toBeGreaterThan(APPEARANCE_VERSION);
  });
});

/* ================================================================
 * 2. 素材の仕様（config/visual-assets.json）
 * ============================================================== */

describe('PHASE4.6 素材の仕様', () => {
  it('共通キャンバスは 1024x1280', () => {
    expect(SPEC.canvas.width).toBe(1024);
    expect(SPEC.canvas.height).toBe(1280);
  });

  it('目録のキャンバスも仕様と同じ', () => {
    expect(MANIFEST.canvas.width).toBe(SPEC.canvas.width);
    expect(MANIFEST.canvas.height).toBe(SPEC.canvas.height);
  });

  it('仕様と目録の版番号が実装とそろっている', () => {
    expect(SPEC.version).toBe(VISUAL_PROFILE_VERSION);
    expect(MANIFEST.version).toBe(VISUAL_PROFILE_VERSION);
  });

  it('種類の一覧が実装と1対1で対応している', () => {
    const specIds = SPEC.categories.map((c) => c.id).sort();
    expect(specIds).toEqual([...VISUAL_CATEGORIES].sort());
  });

  it('必須の種類が仕様と実装で一致している', () => {
    const specRequired = SPEC.categories.filter((c) => c.required).map((c) => c.id).sort();
    expect(specRequired).toEqual([...REQUIRED_CATEGORIES].sort());
  });

  it('必須の種類は顔として最低限そろっている', () => {
    for (const need of ['head', 'hair', 'eyes', 'nose', 'mouth', 'body', 'uniform']) {
      expect(REQUIRED_CATEGORIES).toContain(need as VisualCategory);
    }
  });

  it('重なりの順番が種類ごとに重複していない', () => {
    const layers = SPEC.categories.map((c) => c.layer);
    expect(new Set(layers).size).toBe(layers.length);
  });

  it('顔のパーツは頭より上に重なる', () => {
    const layer = (id: string) => SPEC.categories.find((c) => c.id === id)!.layer;
    for (const part of ['eyes', 'nose', 'mouth', 'eyebrows']) {
      expect(layer(part)).toBeGreaterThan(layer('head'));
    }
  });

  it('耳は頭より下に重なる（付け根が隠れる）', () => {
    const layer = (id: string) => SPEC.categories.find((c) => c.id === id)!.layer;
    expect(layer('ears')).toBeLessThan(layer('head'));
  });

  it('帽子は髪より上に重なる', () => {
    const layer = (id: string) => SPEC.categories.find((c) => c.id === id)!.layer;
    expect(layer('cap')).toBeGreaterThan(layer('hair'));
  });

  it('姿勢はいちばん下に敷かれる', () => {
    const layer = (id: string) => SPEC.categories.find((c) => c.id === id)!.layer;
    for (const c of SPEC.categories) {
      if (c.id !== 'pose') expect(layer('pose')).toBeLessThan(c.layer);
    }
  });

  it('表情は顔のどの部品よりも上に重なる', () => {
    const layer = (id: string) => SPEC.categories.find((c) => c.id === id)!.layer;
    // PHASE 4.7 で、表情のさらに上に「状態の印」（special）を足した。
    // 表情が顔のすべての部品より上、という趣旨は変わっていない。
    for (const c of SPEC.categories) {
      if (c.id === 'expression' || c.id === 'special') continue;
      expect(layer('expression'), c.id).toBeGreaterThan(c.layer);
    }
    expect(layer('special')).toBeGreaterThan(layer('expression'));
  });

  it('必須の種類は最低でも1点は要ると書いてある', () => {
    for (const c of SPEC.categories) {
      if (c.required) expect(c.min).toBeGreaterThanOrEqual(1);
    }
  });

  it('最小より最大が小さい種類は無い', () => {
    for (const c of SPEC.categories) expect(c.max).toBeGreaterThanOrEqual(c.min);
  });

  it('基準点がすべてキャンバスの中に収まっている', () => {
    for (const [name, anchor] of Object.entries(SPEC.anchors)) {
      for (const [key, value] of Object.entries(anchor)) {
        if (typeof value !== 'number') continue;
        expect(value, `${name}.${key}`).toBeGreaterThanOrEqual(0);
        const limit = /X$|^left|^right|^center/i.test(key) ? SPEC.canvas.width : SPEC.canvas.height;
        expect(value, `${name}.${key}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('顔の基準点が上から下の順に並んでいる', () => {
    const a = SPEC.anchors;
    expect(a.head.topY).toBeLessThan(a.brows.y);
    expect(a.brows.y).toBeLessThan(a.eyes.eyeY);
    expect(a.eyes.eyeY).toBeLessThan(a.nose.y);
    expect(a.nose.y).toBeLessThan(a.mouth.y);
    expect(a.mouth.y).toBeLessThan(a.head.chinY);
    expect(a.head.chinY).toBeLessThan(a.body.neckY);
  });

  it('左右の基準点が中心をはさんでいる', () => {
    const center = SPEC.canvas.width / 2;
    expect(SPEC.anchors.eyes.leftEyeX).toBeLessThan(center);
    expect(SPEC.anchors.eyes.rightEyeX).toBeGreaterThan(center);
    expect(SPEC.anchors.ears.leftX).toBeLessThan(center);
    expect(SPEC.anchors.ears.rightX).toBeGreaterThan(center);
  });

  it('書き出しサイズが小さい順に並んでいる', () => {
    expect(SPEC.sizes.small).toBeLessThan(SPEC.sizes.medium);
    expect(SPEC.sizes.medium).toBeLessThan(SPEC.sizes.large);
    expect(SPEC.sizes.large).toBeLessThan(SPEC.sizes.hero);
    expect(SPEC.sizes.hero).toBe(SPEC.canvas.width);
  });

  it('肌8段階・髪10段階と書いてある', () => {
    expect(SPEC.skinTones).toBe(8);
    expect(SPEC.hairColors).toBe(10);
  });

  it('取り込む前に外すものが列挙されている', () => {
    expect(SPEC.forbidden.items.length).toBeGreaterThanOrEqual(5);
    for (const word of ['背景', '文字', 'ロゴ']) {
      expect(SPEC.forbidden.items).toContain(word);
    }
  });

  it('同梱はWebP・マスターはPNG', () => {
    expect(SPEC.formats.game).toBe('webp');
    expect(SPEC.formats.master).toBe('png');
  });
});

/* ================================================================
 * 3. 素材の命名規則
 * ============================================================== */

describe('PHASE4.6 命名規則', () => {
  it('assetId は3桁の連番を作る', () => {
    expect(assetId('head', 0)).toBe('head_001');
    expect(assetId('head', 9)).toBe('head_010');
    expect(assetId('head', 99)).toBe('head_100');
  });

  it('assetId が作るIDはすべて命名規則に合う', () => {
    for (const c of SPEC.categories) {
      for (let i = 0; i < 20; i++) {
        expect(NAMING.test(`${assetId(c.prefix, i)}.webp`), `${c.prefix}_${i}`).toBe(true);
      }
    }
  });

  it('サイズ違いの名前も命名規則に合う', () => {
    for (const size of ['small', 'medium', 'large', 'hero']) {
      expect(NAMING.test(`head_001@${size}.webp`)).toBe(true);
    }
  });

  it('表情・姿勢・用具の名前も命名規則に合う', () => {
    for (const id of [
      ...EXPRESSIONS.filter((e) => e !== 'neutral').map((e) => expressionAsset(e)!),
      ...Object.values(STANCE_POSE_ASSET),
      ...Object.values(STANCE_GEAR_ASSET),
      ...Object.values(HEADWEAR_ASSET),
    ]) {
      expect(NAMING.test(`${id}.webp`), id).toBe(true);
    }
  });

  it('規則に合わない名前をはじく', () => {
    for (const bad of [
      'head.webp',
      'head_1.webp',
      'Head_001.webp',
      'head_001.jpg',
      'head_001.gif',
      'head_0001.webp',
      'head_001@huge.webp',
      '../head_001.webp',
    ]) {
      expect(NAMING.test(bad), bad).toBe(false);
    }
  });

  it('種類ごとの置き場所がすべて決まっている', () => {
    for (const c of SPEC.categories) {
      expect(c.dir.length, c.id).toBeGreaterThan(0);
      expect(c.prefix.length, c.id).toBeGreaterThan(0);
    }
  });

  it('同じ接頭辞を2つの種類が奪い合っていない', () => {
    const prefixes = SPEC.categories.map((c) => c.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

/* ================================================================
 * 4. 設計図が playerId だけで決まる
 * ============================================================== */

describe('PHASE4.6 設計図は選手ごとに固定', () => {
  const state = newGame();

  it('同じ選手からは何度作っても同じ設計図が出る', () => {
    const player = state.players[0];
    const a = buildVisualProfile({ player });
    const b = buildVisualProfile({ player });
    expect(JSON.stringify(a.parts)).toBe(JSON.stringify(b.parts));
    expect(a.seed).toBe(b.seed);
  });

  it('違うシードのゲームでも、同じIDなら同じ設計図になる', () => {
    const other = newGame(777777);
    const id = state.players[3].id;
    const mine = buildVisualProfile({ player: { ...state.players[3], id } });
    const theirs = buildVisualProfile({ player: { ...other.players[9], id } });
    expect(theirs.parts.head).toBe(mine.parts.head);
    expect(theirs.parts.eyes).toBe(mine.parts.eyes);
    expect(theirs.skinTone).toBe(mine.skinTone);
  });

  it('能力を変えても設計図は動かない', () => {
    const player = state.players.find((p) => !p.isPitcher)!;
    const before = buildVisualProfile({ player });
    const stronger = { ...player, batting: { ...player.batting, power: 99, contact: 99 } };
    const after = buildVisualProfile({ player: stronger });
    expect(JSON.stringify(after.parts)).toBe(JSON.stringify(before.parts));
  });

  it('球団を移っても顔は変わらない', () => {
    const player = state.players[7];
    const before = buildVisualProfile({ player });
    const traded = buildVisualProfile({ player: { ...player, teamId: 'comets' } });
    expect(traded.parts.head).toBe(before.parts.head);
    expect(traded.parts.eyes).toBe(before.parts.eyes);
    expect(traded.teamId).toBe('comets');
  });

  it('未所属なら teamId は null になる', () => {
    const profile = buildVisualProfile({ player: fakePlayer('free-1', { teamId: '' }) });
    expect(profile.teamId).toBeNull();
  });

  it('名前を変えても顔は変わらない', () => {
    const player = state.players[2];
    const before = buildVisualProfile({ player });
    const renamed = buildVisualProfile({ player: { ...player, name: '別の名前' } });
    expect(JSON.stringify(renamed.parts)).toBe(JSON.stringify(before.parts));
  });

  it('必須の種類はどの選手にも必ず割り当てられる', () => {
    for (const player of state.players) {
      const profile = buildVisualProfile({ player });
      for (const category of REQUIRED_CATEGORIES) {
        expect(profile.parts[category], `${player.id}/${category}`).toBeTruthy();
      }
    }
  });

  it('割り当てられたIDはすべて命名規則に合う', () => {
    for (const player of state.players.slice(0, 120)) {
      const profile = buildVisualProfile({ player });
      for (const [category, id] of Object.entries(profile.parts)) {
        expect(NAMING.test(`${id}.webp`), `${category}=${id}`).toBe(true);
      }
    }
  });

  it('種類ごとの接頭辞どおりのIDが入っている', () => {
    const prefixOf = new Map(SPEC.categories.map((c) => [c.id, c.prefix]));
    for (const player of state.players.slice(0, 60)) {
      const profile = buildVisualProfile({ player });
      for (const category of ['head', 'hair', 'eyes', 'nose', 'mouth', 'ears', 'jaw', 'body', 'neck'] as VisualCategory[]) {
        expect(profile.parts[category]!.startsWith(prefixOf.get(category)!), category).toBe(true);
      }
    }
  });

  it('1球団ぶんで、まったく同じ組み合わせの選手が出ない', () => {
    const mine = state.players.filter((p) => p.teamId === PLAYER_TEAM);
    const combos = new Set(
      mine.map((p) => {
        const profile = buildVisualProfile({ player: p });
        return VISUAL_CATEGORIES.map((c) => profile.parts[c] ?? '-').join('|');
      }),
    );
    expect(combos.size).toBe(mine.length);
  });

  it('リーグ全体でも同じ組み合わせがほとんど出ない', () => {
    const combos = new Set(
      state.players.map((p) => {
        const profile = buildVisualProfile({ player: p });
        return VISUAL_CATEGORIES.map((c) => profile.parts[c] ?? '-').join('|');
      }),
    );
    expect(combos.size).toBeGreaterThan(state.players.length * 0.99);
  });

  it('1000人ぶんの設計図を作っても崩れない', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const profile = buildVisualProfile({ player: fakePlayer(`gen-${i}`, { age: 18 + (i % 24) }) });
      expect(profile.parts.head).toBeTruthy();
      seen.add(profile.parts.head!);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('肌は8段階に収まる', () => {
    for (const player of state.players) {
      const tone = buildVisualProfile({ player }).skinTone;
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(SPEC.skinTones);
    }
  });

  it('髪色は10段階に収まる', () => {
    for (const player of state.players) {
      const color = buildVisualProfile({ player }).hairColor;
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThan(SPEC.hairColors);
    }
  });

  it('肌の8段階がひととおり出る', () => {
    const tones = new Set(state.players.map((p) => buildVisualProfile({ player: p }).skinTone));
    expect(tones.size).toBe(8);
  });

  it('設計図は PHASE 4.5 の SVG 設計図も一緒に持つ', () => {
    const player = state.players[0];
    const profile = buildVisualProfile({ player });
    expect(profile.svg.head).toBe(appearanceOf(player).head);
  });

  it('版番号が設計図に入っている', () => {
    expect(buildVisualProfile({ player: state.players[0] }).version).toBe(VISUAL_PROFILE_VERSION);
  });

  it('設計図の playerId が選手のIDと一致する', () => {
    for (const player of state.players.slice(0, 40)) {
      expect(buildVisualProfile({ player }).playerId).toBe(player.id);
    }
  });
});

/* ================================================================
 * 5. 素材の点数で割り当てが変わる（manifest 連動）
 * ============================================================== */

describe('PHASE4.6 素材の点数', () => {
  const player = fakePlayer('counts-1', { age: 27 });

  it('点数を渡さなければ既定の想定数で割り当てる', () => {
    const profile = buildVisualProfile({ player });
    const index = Number(profile.parts.head!.slice(-3));
    expect(index).toBeGreaterThanOrEqual(1);
    expect(index).toBeLessThanOrEqual(DEFAULT_CATEGORY_COUNTS.head);
  });

  it('素材が3点しか無ければ 001〜003 の中から選ぶ', () => {
    for (let i = 0; i < 60; i++) {
      const profile = buildVisualProfile({ player: fakePlayer(`c-${i}`) }, { head: 3 });
      expect(['head_001', 'head_002', 'head_003']).toContain(profile.parts.head);
    }
  });

  it('素材が1点なら全員が同じIDになる', () => {
    for (let i = 0; i < 30; i++) {
      const profile = buildVisualProfile({ player: fakePlayer(`one-${i}`) }, { eyes: 1 });
      expect(profile.parts.eyes).toBe('eye_001');
    }
  });

  it('素材を増やすと選ばれるIDの幅も広がる', () => {
    const narrow = new Set<string>();
    const wide = new Set<string>();
    for (let i = 0; i < 200; i++) {
      narrow.add(buildVisualProfile({ player: fakePlayer(`w-${i}`) }, { hair: 4 }).parts.hair!);
      wide.add(buildVisualProfile({ player: fakePlayer(`w-${i}`) }, { hair: 20 }).parts.hair!);
    }
    expect(narrow.size).toBe(4);
    expect(wide.size).toBeGreaterThan(narrow.size);
  });

  it('点数を渡しても他の種類の割り当ては変わらない', () => {
    const a = buildVisualProfile({ player });
    const b = buildVisualProfile({ player }, { head: 3 });
    expect(b.parts.eyes).toBe(a.parts.eyes);
    expect(b.parts.mouth).toBe(a.parts.mouth);
  });

  it('目録が空でも設計図は作れる', () => {
    const profile = buildVisualProfile({ player }, {});
    expect(profile.parts.head).toBeTruthy();
    expect(Object.keys(MANIFEST.parts).length).toBe(0);
  });

  it('既定の想定数が仕様の最小〜最大に収まっている', () => {
    for (const [category, count] of Object.entries(DEFAULT_CATEGORY_COUNTS)) {
      const spec = SPEC.categories.find((c) => c.id === category)!;
      expect(count, category).toBeGreaterThanOrEqual(spec.min);
      expect(count, category).toBeLessThanOrEqual(spec.max);
    }
  });
});

/* ================================================================
 * 6. 年齢
 * ============================================================== */

describe('PHASE4.6 年齢', () => {
  it('年齢が変わっても顔の造作は動かない', () => {
    const young = buildVisualProfileFromId({ playerId: 'age-1', age: 18 });
    const old = buildVisualProfileFromId({ playerId: 'age-1', age: 40 });
    expect(old.parts.head).toBe(young.parts.head);
    expect(old.parts.eyes).toBe(young.parts.eyes);
    expect(old.parts.nose).toBe(young.parts.nose);
    expect(old.parts.ears).toBe(young.parts.ears);
  });

  it('年齢段階が正しく付く', () => {
    expect(buildVisualProfileFromId({ playerId: 'a', age: 19 }).ageStage).toBe('YOUTH');
    expect(buildVisualProfileFromId({ playerId: 'a', age: 40 }).ageStage).toBe('ELDER');
  });

  it('若い選手にはひげがほとんど生えない', () => {
    let bearded = 0;
    for (let i = 0; i < 300; i++) {
      if (buildVisualProfileFromId({ playerId: `y-${i}`, age: 19 }).parts.beard) bearded += 1;
    }
    expect(bearded).toBeLessThan(300 * 0.2);
  });

  it('年齢が上がるとひげが増える', () => {
    const count = (age: number) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        if (buildVisualProfileFromId({ playerId: `b-${i}`, age }).parts.beard) n += 1;
      }
      return n;
    };
    expect(count(38)).toBeGreaterThan(count(19));
  });

  it('若い選手には白髪が出ない', () => {
    for (let i = 0; i < 200; i++) {
      expect(buildVisualProfileFromId({ playerId: `g-${i}`, age: 22 }).hairColor).toBeLessThan(6);
    }
  });

  it('高齢の選手には白髪が出る', () => {
    let grey = 0;
    for (let i = 0; i < 300; i++) {
      if (buildVisualProfileFromId({ playerId: `g-${i}`, age: 41 }).hairColor >= 6) grey += 1;
    }
    expect(grey).toBeGreaterThan(0);
  });

  it('visualProfileAtAge は年齢だけを差し替える', () => {
    const base = buildVisualProfileFromId({ playerId: 'at-1', age: 25 });
    const aged = visualProfileAtAge(base, 34);
    expect(aged.age).toBe(34);
    expect(aged.ageStage).toBe('VETERAN');
    expect(aged.parts.head).toBe(base.parts.head);
    expect(aged.playerId).toBe(base.playerId);
  });

  it('visualProfileAtAge はもとの設計図を書き換えない', () => {
    const base = buildVisualProfileFromId({ playerId: 'at-2', age: 25 });
    visualProfileAtAge(base, 40);
    expect(base.age).toBe(25);
    expect(base.ageStage).toBe('PRIME');
  });

  it('18歳から45歳までどの年齢でも設計図を作れる', () => {
    for (let age = 18; age <= 45; age++) {
      const profile = buildVisualProfileFromId({ playerId: 'span-1', age });
      expect(profile.parts.head).toBeTruthy();
      expect(profile.age).toBe(age);
    }
  });
});

/* ================================================================
 * 7. 守備位置・構え・装備
 * ============================================================== */

describe('PHASE4.6 守備位置と構え', () => {
  it('投手は PITCHER になる', () => {
    expect(stanceOf('P', true)).toBe('PITCHER');
    expect(stanceOf('SP' as PositionId, true)).toBe('PITCHER');
  });

  it('捕手は CATCHER になる', () => {
    expect(stanceOf('C', false)).toBe('CATCHER');
  });

  it('外野は OUTFIELDER になる', () => {
    for (const pos of ['LF', 'CF', 'RF'] as PositionId[]) {
      expect(stanceOf(pos, false)).toBe('OUTFIELDER');
    }
  });

  it('内野は INFIELDER になる', () => {
    for (const pos of ['1B', '2B', '3B', 'SS'] as PositionId[]) {
      expect(stanceOf(pos, false)).toBe('INFIELDER');
    }
  });

  it('構えを直接渡せば守備位置より優先される', () => {
    const player = fakePlayer('stance-1', { mainPosition: 'SS', isPitcher: false });
    expect(buildVisualProfile({ player, stance: 'BATTER' }).stance).toBe('BATTER');
  });

  it('打席はヘルメット、捕手はマスク、それ以外は帽子', () => {
    expect(headwearOf('BATTER')).toBe('helmet');
    expect(headwearOf('CATCHER')).toBe('mask');
    expect(headwearOf('PITCHER')).toBe('cap');
    expect(headwearOf('INFIELDER')).toBe('cap');
    expect(headwearOf('OUTFIELDER')).toBe('cap');
  });

  it('ヘルメットとマスクの素材IDが別々になっている', () => {
    /*
     * PHASE 4.7-B から、ふつうの帽子は選手ごとに選ぶようになったので
     * HEADWEAR_ASSET が持つのはヘルメットとマスクだけになった（§9）。
     * ふつうの帽子は capAssetOf が返す。
     */
    const ids = Object.values(HEADWEAR_ASSET);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(capAssetOf('anyone'));
  });

  it('構えごとに装備が決まっている', () => {
    for (const stance of STANCES) {
      expect(STANCE_EQUIPMENT[stance].length).toBeGreaterThan(0);
    }
  });

  it('捕手だけがマスクとプロテクターを付ける', () => {
    expect(STANCE_EQUIPMENT.CATCHER).toContain('gear_mask');
    expect(STANCE_EQUIPMENT.CATCHER).toContain('gear_chest');
    for (const stance of STANCES.filter((s) => s !== 'CATCHER')) {
      expect(STANCE_EQUIPMENT[stance]).not.toContain('gear_mask');
    }
  });

  it('打者だけがバットを持つ', () => {
    expect(STANCE_EQUIPMENT.BATTER).toContain('gear_bat');
    for (const stance of STANCES.filter((s) => s !== 'BATTER')) {
      expect(STANCE_EQUIPMENT[stance]).not.toContain('gear_bat');
    }
  });

  it('投手・内野・外野はグラブを持つ', () => {
    for (const stance of ['PITCHER', 'INFIELDER', 'OUTFIELDER'] as VisualStance[]) {
      expect(STANCE_EQUIPMENT[stance]).toContain('gear_glove');
    }
  });

  it('構えごとの姿勢素材が全部そろっている', () => {
    for (const stance of STANCES) {
      expect(STANCE_POSE_ASSET[stance]).toBeTruthy();
      expect(STANCE_GEAR_ASSET[stance]).toBeTruthy();
    }
  });

  it('構えに日本語のラベルが付いている', () => {
    for (const stance of STANCES) {
      expect(STANCE_LABELS[stance].length).toBeGreaterThan(0);
    }
  });

  it('設計図の装備が構えのものと一致する', () => {
    const catcher = fakePlayer('c-1', { mainPosition: 'C', isPitcher: false });
    const profile = buildVisualProfile({ player: catcher });
    expect(profile.stance).toBe('CATCHER');
    expect(profile.equipment).toEqual(STANCE_EQUIPMENT.CATCHER);
    expect(profile.parts.cap).toBe(HEADWEAR_ASSET.mask);
    expect(profile.parts.pose).toBe(STANCE_POSE_ASSET.CATCHER);
  });

  it('全選手の構えが5種類のどれかになる', () => {
    for (const player of newGame().players) {
      expect(STANCES).toContain(buildVisualProfile({ player }).stance);
    }
  });
});

/* ================================================================
 * 8. 表情
 * ============================================================== */

describe('PHASE4.6 表情', () => {
  it('平常のときは表情の素材を使わない', () => {
    expect(expressionAsset('neutral')).toBeNull();
    const profile = buildVisualProfileFromId({ playerId: 'e-1', age: 25 });
    expect(profile.parts.expression).toBeUndefined();
  });

  it('平常以外は表情ごとの素材IDになる', () => {
    for (const e of EXPRESSIONS.filter((x) => x !== 'neutral') as Expression[]) {
      expect(expressionAsset(e)).toBe(`expression_${e}_001`);
    }
  });

  it('表情を渡すと設計図に入る', () => {
    const profile = buildVisualProfile({ player: fakePlayer('e-2'), expression: 'confident' });
    expect(profile.expression).toBe('confident');
    expect(profile.parts.expression).toBe('expression_confident_001');
  });

  it('表情が変わっても顔の造作は動かない', () => {
    const player = fakePlayer('e-3');
    const calm = buildVisualProfile({ player, expression: 'neutral' });
    const hurt = buildVisualProfile({ player, expression: 'injured' });
    expect(hurt.parts.head).toBe(calm.parts.head);
    expect(hurt.parts.eyes).toBe(calm.parts.eyes);
    expect(hurt.parts.nose).toBe(calm.parts.nose);
  });

  it('状態を渡さなければ平常になる', () => {
    expect(buildVisualProfile({ player: fakePlayer('e-4') }).expression).toBe('neutral');
  });

  it('怪我の選手は状態から injured になる', () => {
    const state = newGame();
    const player = state.players[0];
    const injured: Player = {
      ...player,
      ext: {
        ...player.ext,
        injury: {
          level: 'minor',
          name: '打撲',
          startDate: `${state.year}-04-10`,
          returnDate: `${state.year}-04-20`,
        },
      },
    };
    expect(buildVisualProfile({ player: injured, state }).expression).toBe('injured');
  });

  it('10種類の表情すべてで設計図が作れる', () => {
    for (const e of EXPRESSIONS as readonly Expression[]) {
      const profile = buildVisualProfile({ player: fakePlayer('e-5'), expression: e });
      expect(profile.expression).toBe(e);
    }
  });
});

/* ================================================================
 * 9. 素材が無いときのふるまい（フォールバック）
 * ============================================================== */

describe('PHASE4.6 フォールバック', () => {
  const profile = buildVisualProfileFromId({ playerId: 'fb-1', age: 27 });

  it('素材が1枚も無ければ、必須の種類がすべて足りないと分かる', () => {
    const missing = missingCategories(profile, () => false);
    expect(missing).toEqual(REQUIRED_CATEGORIES);
  });

  it('素材がすべてそろっていれば足りないものは無い', () => {
    expect(missingCategories(profile, () => true)).toEqual([]);
  });

  it('1種類でも欠けていれば、その種類が挙がる', () => {
    const missing = missingCategories(profile, (category) => category !== 'eyes');
    expect(missing).toEqual(['eyes']);
  });

  it('必須でない種類が欠けていても足りないとは言わない', () => {
    const missing = missingCategories(profile, (category) => category !== 'beard' && category !== 'cap');
    expect(missing).toEqual([]);
  });

  it('割り当てが無い種類は「欠けている」と数える', () => {
    const broken: VisualProfile = { ...profile, parts: { ...profile.parts, head: undefined } };
    expect(missingCategories(broken, () => true)).toEqual(['head']);
  });

  it('目録が空のときは画像で描けない', () => {
    expect(Object.keys(MANIFEST.parts).length).toBe(0);
  });

  it('PHASE 4.5 の SVG 設計図はどんな設計図にも必ず入っている', () => {
    for (const player of newGame().players.slice(0, 50)) {
      const p = buildVisualProfile({ player });
      expect(p.svg.head).toBeTruthy();
      expect(p.svg.eyes).toBeTruthy();
      expect(p.svg.body).toBeTruthy();
    }
  });
});

/* ================================================================
 * 10. Player が手元に無いとき（引退記録・歴史）
 * ============================================================== */

describe('PHASE4.6 IDだけから作る', () => {
  it('現役のときと同じ顔になる', () => {
    const state = newGame();
    const player = state.players[11];
    const live = buildVisualProfile({ player });
    const fromId = buildVisualProfileFromId({
      playerId: player.id,
      age: player.age,
      isPitcher: player.isPitcher,
    });
    expect(fromId.parts.head).toBe(live.parts.head);
    expect(fromId.parts.eyes).toBe(live.parts.eyes);
    expect(fromId.skinTone).toBe(live.skinTone);
    expect(fromId.hairColor).toBe(live.hairColor);
  });

  it('投手なら PITCHER、それ以外は BATTER の構えになる', () => {
    expect(buildVisualProfileFromId({ playerId: 'x', age: 30, isPitcher: true }).stance).toBe('PITCHER');
    expect(buildVisualProfileFromId({ playerId: 'x', age: 30 }).stance).toBe('BATTER');
  });

  it('球団を渡さなければ未所属になる', () => {
    expect(buildVisualProfileFromId({ playerId: 'x', age: 30 }).teamId).toBeNull();
  });

  it('球団を渡せばそのまま入る', () => {
    expect(buildVisualProfileFromId({ playerId: 'x', age: 30, teamId: 'comets' }).teamId).toBe('comets');
  });

  it('表情を渡せばそのまま入る', () => {
    const profile = buildVisualProfileFromId({ playerId: 'x', age: 30, expression: 'happy' });
    expect(profile.expression).toBe('happy');
  });

  it('PHASE 4.5 の SVG 設計図も一緒に入る', () => {
    const profile = buildVisualProfileFromId({ playerId: 'x', age: 30 });
    expect(profile.svg.head).toBeTruthy();
  });
});

/* ================================================================
 * 11. ゲームのドメインに一切触らない（§33・§34）
 * ============================================================== */

describe('PHASE4.6 ゲームに触らない', () => {
  it('設計図を作っても rngState が動かない', () => {
    const state = newGame();
    const before = state.rngState;
    for (const player of state.players) buildVisualProfile({ player, state });
    expect(state.rngState).toBe(before);
  });

  it('設計図を作っても state がまったく変わらない', () => {
    const state = newGame();
    const before = JSON.stringify(state);
    for (const player of state.players) buildVisualProfile({ player, state });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('設計図を作っても能力・成績が変わらない', () => {
    const state = newGame();
    const player = state.players[0];
    const snapshot = JSON.stringify({ b: player.batting, p: player.pitching, s: state.stats });
    buildVisualProfile({ player, state });
    expect(JSON.stringify({ b: player.batting, p: player.pitching, s: state.stats })).toBe(snapshot);
  });

  it('設計図を作りながら試合を進めても結果が同じ', () => {
    const play = (withProfiles: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 462462);
      for (let i = 0; i < 20 && !state.seasonFinished; i++) {
        if (withProfiles) {
          for (const player of state.players.slice(0, 30)) buildVisualProfile({ player, state });
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = play(false);
    const drawn = play(true);
    expect(drawn.rngState).toBe(plain.rngState);
    expect(JSON.stringify(drawn.stats)).toBe(JSON.stringify(plain.stats));
    expect(JSON.stringify(drawn.records)).toBe(JSON.stringify(plain.records));
    expect(JSON.stringify(drawn.teams)).toBe(JSON.stringify(plain.teams));
  });

  it('セーブに素材のパスやURLが入らない', () => {
    const saved = JSON.stringify(newGame());
    expect(saved).not.toContain('assets/players');
    expect(saved).not.toContain('.webp');
    expect(saved).not.toContain('manifest');
    expect(saved).not.toContain('visualProfile');
  });

  it('設計図はセーブ無しで playerId から作り直せる', () => {
    const state = newGame();
    const player = state.players[6];
    const rebuilt = buildVisualProfileFromId({
      playerId: player.id,
      age: player.age,
      isPitcher: player.isPitcher,
    });
    expect(rebuilt.parts.head).toBe(buildVisualProfile({ player }).parts.head);
  });

  it('70人枠の設定を読んでいない（ロスターに触れない）', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toContain('MAX_ROSTER');
      expect(source, path).not.toContain('releasePlayer');
      expect(source, path).not.toContain('signPlayer');
    }
  });
});

/* ================================================================
 * 12. 外部依存が無い（§33・§34・§43）
 * ============================================================== */

describe('PHASE4.6 外部に出ていかない', () => {
  it('実装ファイルがすべて読み込めている', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(4);
  });

  it('Math.random / Date.now を使っていない', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toContain('Math.random');
      expect(source, path).not.toContain('Date.now');
      expect(source, path).not.toContain('performance.now');
      expect(source, path).not.toContain('new Date(');
    }
  });

  it('ゲームの乱数器を読み込んでいない', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toMatch(/from '.*\/rng'/);
      expect(source, path).not.toContain('rngState');
      expect(source, path).not.toContain('advanceRng');
    }
  });

  it('http/https のURLがどこにも書かれていない', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toMatch(/https?:\/\//);
    }
  });

  it('通信をしていない', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toContain('fetch(');
      expect(source, path).not.toContain('XMLHttpRequest');
      expect(source, path).not.toContain('WebSocket');
      expect(source, path).not.toContain('EventSource');
      expect(source, path).not.toContain('navigator.sendBeacon');
    }
  });

  it('画像生成AI・外部APIのサービス名やキーが書かれていない', () => {
    const banned = [
      'openai',
      'stability',
      'midjourney',
      'dall-e',
      'dalle',
      'replicate',
      'huggingface',
      'apiKey',
      'API_KEY',
      'process.env',
      'import.meta.env.VITE_',
      'Authorization',
      'Bearer ',
    ];
    for (const [path, source] of Object.entries(SOURCES)) {
      const lower = source.toLowerCase();
      for (const word of banned) {
        expect(lower.includes(word.toLowerCase()), `${path} / ${word}`).toBe(false);
      }
    }
  });

  it('実行時に画像を作る仕組みを持っていない', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      expect(source, path).not.toContain('getContext');
      expect(source, path).not.toContain('toDataURL');
      expect(source, path).not.toContain('OffscreenCanvas');
      expect(source, path).not.toContain('createImageBitmap');
    }
  });

  it('素材の参照はビルド時に解決される形しか使っていない', () => {
    const registry = SOURCES['../ui/visual/assetRegistry.ts'];
    expect(registry).toBeTruthy();
    expect(registry).toContain('import.meta.glob');
    expect(registry).not.toContain('new URL(');
  });

  it('目録に外部URLが入っていない', () => {
    const raw = JSON.stringify(MANIFEST);
    expect(raw).not.toMatch(/https?:\/\//);
  });

  it('仕様に外部URLが入っていない', () => {
    const raw = JSON.stringify(SPEC);
    expect(raw).not.toMatch(/https?:\/\//);
  });

  it('設計図の層が React も画像も知らない', () => {
    const source = SOURCES['./visualProfile.ts'];
    expect(source).toBeTruthy();
    expect(source).not.toContain('react');
    expect(source).not.toContain('<img');
    expect(source).not.toContain('document.');
    expect(source).not.toContain('window.');
  });
});

/* ================================================================
 * 13. 素材の目録（manifest）の整合
 * ============================================================== */

describe('PHASE4.6 目録', () => {
  it('目録に載る種類はすべて実装の種類である', () => {
    for (const category of Object.keys(MANIFEST.parts)) {
      expect(VISUAL_CATEGORIES).toContain(category as VisualCategory);
    }
  });

  it('目録の素材IDはすべて命名規則に合う', () => {
    for (const entries of Object.values(MANIFEST.parts)) {
      for (const entry of entries) {
        expect(NAMING.test(`${entry.id}.webp`), entry.id).toBe(true);
      }
    }
  });

  it('目録の中に同じIDが2つ無い', () => {
    for (const [category, entries] of Object.entries(MANIFEST.parts)) {
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size, category).toBe(ids.length);
    }
  });

  it('目録のパスが素材の置き場所から外へ出ていない', () => {
    for (const entries of Object.values(MANIFEST.parts)) {
      for (const entry of entries) {
        if (!entry.path) continue;
        expect(entry.path).not.toContain('..');
        expect(entry.path.startsWith('/')).toBe(false);
      }
    }
  });

  it('素材が0点でもゲームが成立する（いまの状態）', () => {
    const total = Object.values(MANIFEST.parts).reduce((n, e) => n + e.length, 0);
    expect(total).toBe(0);
    const profile = buildVisualProfile({ player: newGame().players[0] });
    expect(profile.svg.head).toBeTruthy();
  });
});
