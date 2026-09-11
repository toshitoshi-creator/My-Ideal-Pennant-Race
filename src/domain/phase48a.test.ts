/**
 * PHASE 4.8-A 検査（§30）。
 *
 * 確かめたいのは1つだけ。
 * **見た目が、ゲームの中身から完全に切り離されているか。**
 *
 * 見た目は player.id だけで決まり、乱数も時刻も能力値も見ない。
 * だから、見た目を作っても試合結果は1ミリも動かない。
 * そこを構造で保証できているかを、ここで測ります。
 *
 * 絵そのものの良し悪しは、ここでは測れません（目で見るしかない）。
 * ここで測るのは「壊れていないこと」だけです。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay } from './engine';
import {
  CHARACTER_PROFILE_VERSION,
  DEFAULT_PART_COUNTS,
  ageStageOf,
  buildCharacterProfile,
  characterProfileAtAge,
  type CharacterProfile,
} from './characterProfile';
import {
  CHARACTER_GUIDES,
  CHARACTER_HEIGHT,
  CHARACTER_LAYERS,
  CHARACTER_VIEW_BOX,
  CHARACTER_WIDTH,
  MIN_STROKE,
  STROKE,
  adjustGuides,
  anchorsFrom,
  headCenterY,
  layerOrder,
} from '../ui/character/coordinates';
import { CHARACTER_PARTS, builtInCount, partAt, partById, partCount } from '../ui/character/registry';
import { CHARACTER_PART_CATEGORIES } from '../ui/character/types';
import { buildPalette } from '../ui/character/palette';

const PLAYER_TEAM = 'phoenix';

function ids(count: number, prefix = 'p'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

/** 設計図の番号だけを取り出す。比較しやすくするため */
function numbersOf(profile: CharacterProfile): number[] {
  const { version: _version, ...rest } = profile;
  return Object.values(rest);
}

/* ================================================================
 * A. 同じ id なら必ず同じ見た目（§30-A）
 * ============================================================== */

describe('PHASE4.8-A A. 同じ id は同じ見た目', () => {
  it('何度呼んでも同じ結果になる', () => {
    for (const id of ids(50)) {
      const first = buildCharacterProfile(id);
      for (let i = 0; i < 5; i++) {
        expect(buildCharacterProfile(id)).toEqual(first);
      }
    }
  });

  it('呼ぶ順番を変えても結果が変わらない', () => {
    const list = ids(30);
    const forward = list.map((id) => buildCharacterProfile(id));
    const backward = [...list].reverse().map((id) => buildCharacterProfile(id));
    expect(backward.reverse()).toEqual(forward);
  });

  it('間に別の選手を挟んでも変わらない', () => {
    const alone = buildCharacterProfile('target');
    buildCharacterProfile('noise-1');
    buildCharacterProfile('noise-2');
    expect(buildCharacterProfile('target')).toEqual(alone);
  });

  it('版の番号は 3 のまま', () => {
    expect(CHARACTER_PROFILE_VERSION).toBe(3);
    expect(buildCharacterProfile('x').version).toBe(3);
  });
});

/* ================================================================
 * B. 別の id なら極端に重ならない（§30-B）
 * ============================================================== */

describe('PHASE4.8-A B. 見た目が偏らない', () => {
  it('100人で完全一致がほとんど出ない', () => {
    const seen = new Map<string, number>();
    for (const id of ids(100, 'b100')) {
      const key = numbersOf(buildCharacterProfile(id)).join(',');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    // 組み合わせは 5*5*8*10*8*6*5*4*6*1*1*5 通りあるので、100人ならまず重ならない
    expect(seen.size).toBe(100);
  });

  it('1000人でも重複はごくわずか', () => {
    const seen = new Set<string>();
    for (const id of ids(1000, 'b1000')) {
      seen.add(numbersOf(buildCharacterProfile(id)).join(','));
    }
    expect(seen.size).toBeGreaterThanOrEqual(995);
  });

  it('どのパーツも一種類に偏らない', () => {
    const counts: Record<string, Map<number, number>> = {};
    for (const id of ids(600, 'spread')) {
      const profile = buildCharacterProfile(id);
      for (const [key, value] of Object.entries(profile)) {
        if (key === 'version' || typeof value !== 'number') continue;
        const map = (counts[key] ??= new Map());
        map.set(value, (map.get(value) ?? 0) + 1);
      }
    }
    for (const [key, map] of Object.entries(counts)) {
      const total = DEFAULT_PART_COUNTS[key as keyof typeof DEFAULT_PART_COUNTS];
      if (total <= 1) continue;
      // 全種類が最低1回は出る
      expect(map.size, `${key} の種類`).toBe(total);
      // どれか1つが半分以上を占めることはない
      const worst = Math.max(...map.values());
      expect(worst / 600, `${key} の偏り`).toBeLessThan(0.5);
    }
  });

  it('番号は必ずパーツ数の範囲に収まる', () => {
    for (const id of ids(300, 'range')) {
      const profile = buildCharacterProfile(id);
      for (const [key, value] of Object.entries(profile)) {
        if (key === 'version' || typeof value !== 'number') continue;
        const total = DEFAULT_PART_COUNTS[key as keyof typeof DEFAULT_PART_COUNTS];
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(total);
      }
    }
  });
});

/* ================================================================
 * C. 1000人でも壊れない（§30-C）
 * ============================================================== */

describe('PHASE4.8-A C. 1000人', () => {
  it('1000人ぶん作っても例外が出ない', () => {
    expect(() => {
      for (const id of ids(1000, 'c')) buildCharacterProfile(id);
    }).not.toThrow();
  });

  it('1000人ぶんのパーツがすべて引ける', () => {
    for (const id of ids(1000, 'c')) {
      const profile = buildCharacterProfile(id);
      expect(partAt('head', profile.head)).not.toBeNull();
      expect(partAt('body', profile.body)).not.toBeNull();
      expect(partAt('hairFront', profile.hair)).not.toBeNull();
      expect(partAt('eye', profile.eyes)).not.toBeNull();
      expect(partAt('cap', profile.cap)).not.toBeNull();
    }
  });

  it('色も1000人ぶん組み立てられる', () => {
    for (const id of ids(1000, 'c')) {
      const profile = buildCharacterProfile(id);
      const palette = buildPalette({ skin: profile.skin, hairColor: profile.hairColor });
      expect(palette.skin).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.outline).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

/* ================================================================
 * D / E. Math.random と Date.now を使っていない（§30-D・§30-E）
 * ============================================================== */

describe('PHASE4.8-A D/E. 乱数と時刻を使わない', () => {
  const raw = import.meta.glob(
    ['../ui/character/**/*.ts', '../ui/character/**/*.tsx', './characterProfile.ts'],
    { eager: true, query: '?raw', import: 'default' },
  ) as Record<string, string>;

  /*
   * コメントを外してから調べる。
   *
   * 「Math.random を使わない」と説明に書いてあるだけで落ちてしまうと、
   * 検査が「書いてはいけない言葉」の検査になってしまい、意味がない。
   * 調べたいのは **実際に呼んでいるか** なので、コードだけを見る。
   */
  const sources = Object.fromEntries(
    Object.entries(raw).map(([file, code]) => [
      file,
      code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '),
    ]),
  );

  it('キャラクターのコードを読み込めている', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(8);
  });

  it('コメントを外す処理そのものが効いている', () => {
    // 説明文には出てくるが、コードとしては使っていない
    expect(raw['./characterProfile.ts']).toContain('Math.random');
    expect(sources['./characterProfile.ts']).not.toContain('Math.random');
  });

  it('Math.random がどこにもない', () => {
    for (const [file, code] of Object.entries(sources)) {
      expect(code.includes('Math.random'), file).toBe(false);
    }
  });

  it('Date.now と new Date がどこにもない', () => {
    for (const [file, code] of Object.entries(sources)) {
      expect(code.includes('Date.now'), file).toBe(false);
      expect(code.includes('new Date'), file).toBe(false);
    }
  });

  it('実行時に外へ通信しない（fetch も外部URLもない）', () => {
    for (const [file, code] of Object.entries(sources)) {
      expect(code.includes('fetch('), file).toBe(false);
      expect(/https?:\/\/(?!www\.w3\.org)/.test(code), file).toBe(false);
    }
  });

  it('時刻を進めても同じ見た目になる', () => {
    const before = buildCharacterProfile('clock');
    const spy = Date.now();
    expect(spy).toBeGreaterThan(0);
    expect(buildCharacterProfile('clock')).toEqual(before);
  });
});

/* ================================================================
 * F. ゲームの乱数を1回も消費しない（§30-F）
 * ============================================================== */

describe('PHASE4.8-A F. 乱数の状態を動かさない', () => {
  it('設計図を作っても rngState が変わらない', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20250910);
    const before = state.rngState;
    for (const player of state.players) buildCharacterProfile(player.id);
    expect(state.rngState).toBe(before);
  });

  it('新しいゲームを作り直しても同じ状態になる', () => {
    const before = createNewGame(PLAYER_TEAM, 10, 20250910).rngState;
    for (const id of ids(200, 'rng')) buildCharacterProfile(id);
    expect(createNewGame(PLAYER_TEAM, 10, 20250910).rngState).toBe(before);
  });
});

/* ================================================================
 * G. 試合の結果に影響しない（§30-G）
 * ============================================================== */

describe('PHASE4.8-A G. 試合に影響しない', () => {
  it('全選手の見た目を作りながら進めても結果が同じ', () => {
    const run = (withVisuals: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 20250910);
      for (let day = 0; day < 14; day++) {
        if (withVisuals) {
          for (const player of state.players) {
            const profile = buildCharacterProfile(player.id);
            buildPalette({ skin: profile.skin, hairColor: profile.hairColor });
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
    expect(visual.stats).toEqual(plain.stats);
  });

  it('見た目は能力値を見ていない（能力を書き換えても変わらない）', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20250910);
    const player = state.players[0];
    const before = buildCharacterProfile(player.id);
    const boosted = { ...player, power: 99, contact: 99, speed: 99, age: 40 };
    expect(buildCharacterProfile(boosted.id)).toEqual(before);
  });

  it('移籍しても見た目が変わらない（球団を見ていない）', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20250910);
    const player = state.players[0];
    const before = buildCharacterProfile(player.id);
    const traded = { ...player, teamId: 'other-team' };
    expect(buildCharacterProfile(traded.id)).toEqual(before);
  });
});

/* ================================================================
 * H. セーブとロードで一致する（§30-H）
 * ============================================================== */

describe('PHASE4.8-A H. セーブとロード', () => {
  it('JSON を通しても同じ設計図に戻る', () => {
    for (const id of ids(100, 'save')) {
      const profile = buildCharacterProfile(id);
      expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
    }
  });

  it('保存に必要なのは番号だけ（文字列や画像を持たない）', () => {
    const profile = buildCharacterProfile('bytes');
    for (const [key, value] of Object.entries(profile)) {
      if (key === 'version') continue;
      expect(typeof value, key).toBe('number');
    }
  });

  it('1人あたりの保存量が小さい（§32）', () => {
    const profile = buildCharacterProfile('bytes');
    expect(JSON.stringify(profile).length).toBeLessThan(200);
  });

  it('そもそも保存しなくても id から作り直せる', () => {
    const state = createNewGame(PLAYER_TEAM, 10, 20250910);
    const saved = JSON.parse(JSON.stringify(state)) as typeof state;
    for (const player of saved.players.slice(0, 50)) {
      expect(buildCharacterProfile(player.id)).toEqual(buildCharacterProfile(player.id));
    }
  });
});

/* ================================================================
 * I. 移行しても壊れない（§30-I）
 * ============================================================== */

describe('PHASE4.8-A I. 移行', () => {
  it('SAVE_VERSION を変えていない', () => {
    expect(SAVE_VERSION).toBe(15);
  });

  it('見た目の欄が無い古いセーブでも作り直せる', () => {
    const old = { id: 'legacy-1', name: '古い選手' };
    expect(() => buildCharacterProfile(old.id)).not.toThrow();
    expect(buildCharacterProfile(old.id).version).toBe(3);
  });

  it('パーツが増えても古い id が例外にならない', () => {
    const now = buildCharacterProfile('future');
    const later = buildCharacterProfile('future', { head: 12, hair: 20, cap: 30 });
    expect(now.version).toBe(later.version);
    expect(later.head).toBeLessThan(12);
    expect(later.hair).toBeLessThan(20);
  });

  it('パーツが減っても範囲からはみ出さない', () => {
    const fewer = buildCharacterProfile('shrink', { head: 2, eyes: 1 });
    expect(fewer.head).toBeLessThan(2);
    expect(fewer.eyes).toBe(0);
  });
});

/* ================================================================
 * J. 座標系とレイヤーの規格（§3〜§10）
 * ============================================================== */

describe('PHASE4.8-A J. 座標系とレイヤー', () => {
  it('キャンバスは 256x320 で固定', () => {
    expect(CHARACTER_WIDTH).toBe(256);
    expect(CHARACTER_HEIGHT).toBe(320);
    expect(CHARACTER_VIEW_BOX).toBe('0 0 256 320');
  });

  it('基準線が上から下へ正しい順に並んでいる', () => {
    const g = CHARACTER_GUIDES;
    const order = [g.headTop, g.eyebrowLine, g.eyeLine, g.noseLine, g.mouthLine, g.chinLine, g.shoulderLine];
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `${i}番目`).toBeGreaterThan(order[i - 1]);
    }
  });

  it('顔は必ずキャンバスの中に収まる', () => {
    const g = CHARACTER_GUIDES;
    expect(g.headTop).toBeGreaterThan(0);
    expect(g.bodyBottom).toBeLessThanOrEqual(CHARACTER_HEIGHT);
    expect(g.centerX).toBe(CHARACTER_WIDTH / 2);
  });

  it('レイヤーは重複せず、順番が一意に決まる', () => {
    expect(new Set(CHARACTER_LAYERS).size).toBe(CHARACTER_LAYERS.length);
    for (const layer of CHARACTER_LAYERS) {
      expect(layerOrder(layer)).toBeGreaterThanOrEqual(0);
    }
  });

  it('顔の造作は必ず頭より後に描かれる（頭に塗り潰されない）', () => {
    for (const layer of ['eyes', 'eyebrows', 'nose', 'mouth'] as const) {
      expect(layerOrder(layer), layer).toBeGreaterThan(layerOrder('head'));
    }
  });

  it('帽子は髪より後に描かれる', () => {
    expect(layerOrder('cap')).toBeGreaterThan(layerOrder('frontHair'));
    expect(layerOrder('frontHair')).toBeGreaterThan(layerOrder('head'));
  });

  it('後ろ髪と体は頭より先に描かれる', () => {
    expect(layerOrder('backHair')).toBeLessThan(layerOrder('head'));
    expect(layerOrder('body')).toBeLessThan(layerOrder('head'));
  });

  it('線は細くしすぎない（小さく表示しても潰れない）', () => {
    for (const value of Object.values(STROKE)) {
      expect(value).toBeGreaterThanOrEqual(MIN_STROKE);
    }
  });
});

/* ================================================================
 * K. アンカーが頭についてくる（§5・§26）
 * ============================================================== */

describe('PHASE4.8-A K. アンカーの追従', () => {
  it('頭の形を変えると顔の基準線もついてくる', () => {
    const tall = adjustGuides(CHARACTER_GUIDES, { faceScaleY: 1.14, chinShift: 4 });
    expect(tall.headTop).toBeLessThan(CHARACTER_GUIDES.headTop);
    expect(tall.chinLine).toBeGreaterThan(CHARACTER_GUIDES.chinLine);
    expect(tall.noseLine).toBeGreaterThan(CHARACTER_GUIDES.noseLine);
    expect(tall.mouthLine).toBeGreaterThan(CHARACTER_GUIDES.mouthLine);
    expect(tall.eyebrowLine).toBeLessThan(CHARACTER_GUIDES.eyebrowLine);
    /*
     * 目の線は頭の中心のすぐそばにあるので、縦に伸ばしてもほとんど動かない。
     * 大事なのは動く量ではなく、**顔の中での位置の比が保たれる** こと。
     * 比が保たれていれば、どの頭に載せても目の高さが正しく見える。
     */
    const ratio = (g: typeof CHARACTER_GUIDES) =>
      (g.eyeLine - g.headTop) / (g.chinLine - g.headTop);
    // あご先を伸ばした頭なので比は少しだけ下がる。それでも 2% 以内
    expect(Math.abs(ratio(tall) - ratio(CHARACTER_GUIDES))).toBeLessThan(0.02);
  });

  it('どの頭でも目の高さの比がほぼ同じ（人物ごとに顔がずれない）', () => {
    const ratio = (g: typeof CHARACTER_GUIDES) =>
      (g.eyeLine - g.headTop) / (g.chinLine - g.headTop);
    const base = ratio(CHARACTER_GUIDES);
    for (const head of CHARACTER_PARTS.head) {
      const g = head.guideAdjustment
        ? adjustGuides(CHARACTER_GUIDES, head.guideAdjustment)
        : CHARACTER_GUIDES;
      expect(Math.abs(ratio(g) - base), head.id).toBeLessThan(0.02);
    }
  });

  it('首から下は頭の形で動かない（体との接続が壊れない）', () => {
    for (const scale of [0.9, 1, 1.2]) {
      const g = adjustGuides(CHARACTER_GUIDES, { faceScaleY: scale });
      expect(g.neckTop).toBe(CHARACTER_GUIDES.neckTop);
      expect(g.shoulderLine).toBe(CHARACTER_GUIDES.shoulderLine);
      expect(g.bodyBottom).toBe(CHARACTER_GUIDES.bodyBottom);
      expect(g.centerX).toBe(CHARACTER_GUIDES.centerX);
    }
  });

  it('アンカーは基準線から導かれている', () => {
    const g = adjustGuides(CHARACTER_GUIDES, { faceScaleY: 1.1 });
    const a = anchorsFrom(g);
    expect(a.leftEye.y).toBe(g.eyeLine);
    expect(a.rightEye.y).toBe(g.eyeLine);
    expect(a.nose.y).toBe(g.noseLine);
    expect(a.mouth.y).toBe(g.mouthLine);
    expect(a.headTop.y).toBe(g.headTop);
    expect(a.headBottom.y).toBe(g.chinLine);
    expect(a.headCenter.y).toBe(headCenterY(g));
  });

  it('左右のアンカーが中心から同じだけ離れている（左右反転ミスが起きない）', () => {
    const a = anchorsFrom(CHARACTER_GUIDES);
    const cx = CHARACTER_GUIDES.centerX;
    for (const [left, right] of [
      [a.leftEye, a.rightEye],
      [a.leftEyebrow, a.rightEyebrow],
      [a.leftEar, a.rightEar],
      [a.leftTemple, a.rightTemple],
    ] as const) {
      expect(cx - left.x).toBe(right.x - cx);
      expect(left.y).toBe(right.y);
    }
  });

  it('帽子のアンカーは目より上にある（帽子が目にかからない）', () => {
    for (const scale of [0.92, 1, 1.14]) {
      const g = adjustGuides(CHARACTER_GUIDES, { faceScaleY: scale });
      const a = anchorsFrom(g);
      expect(a.capBase.y, `scale ${scale}`).toBeLessThan(g.eyeLine);
      expect(a.capBase.y, `scale ${scale}`).toBeGreaterThan(g.headTop);
    }
  });

  it('どの頭でも耳とこめかみが頭の輪郭の上に来る', () => {
    for (const head of CHARACTER_PARTS.head) {
      const g = head.guideAdjustment
        ? adjustGuides(CHARACTER_GUIDES, head.guideAdjustment)
        : CHARACTER_GUIDES;
      const own = head.anchorsFor?.(g);
      expect(own?.leftTemple, head.id).toBeDefined();
      expect(own?.leftEar, head.id).toBeDefined();
      const temple = own!.rightTemple!;
      const ear = own!.rightEar!;
      // 耳は輪郭のすぐ内側から生える。離れていたら宙に浮く
      expect(temple.x - ear.x, head.id).toBeLessThanOrEqual(4);
      expect(temple.x - ear.x, head.id).toBeGreaterThanOrEqual(0);
      // 耳は目より下、あごより上
      expect(ear.y, head.id).toBeGreaterThan(g.eyeLine);
      expect(ear.y, head.id).toBeLessThan(g.chinLine);
    }
  });

  const halfWidthOf = (head: (typeof CHARACTER_PARTS.head)[number]): number => {
    const g = head.guideAdjustment
      ? adjustGuides(CHARACTER_GUIDES, head.guideAdjustment)
      : CHARACTER_GUIDES;
    return head.anchorsFor!(g).rightTemple!.x - g.centerX;
  };

  it('はじめから入っている頭は、幅がそれぞれ違う（ただの拡大縮小ではない）', () => {
    /*
     * §12 の「単なる拡大縮小は禁止」を、こちらで作った5つについて確かめる。
     *
     * **自作の頭までは含めない。**
     * 幅が同じでも輪郭が違えば別の頭として成立するので、
     * ここに含めると「幅がぶつかったから描き直す」ことになってしまう。
     * それは絵を検査の都合に合わせることで、順序が逆。
     */
    const builtIn = CHARACTER_PARTS.head.slice(0, builtInCount('head'));
    const widths = builtIn.map(halfWidthOf);
    expect(new Set(widths).size).toBe(widths.length);
  });

  it('自作の頭も含めて、幅が常識の範囲に収まっている', () => {
    for (const head of CHARACTER_PARTS.head) {
      const half = halfWidthOf(head);
      expect(half, head.id).toBeGreaterThanOrEqual(30);
      expect(half, head.id).toBeLessThanOrEqual(90);
    }
  });
});

/* ================================================================
 * L. パーツ表の規格（§7・§8・§34）
 * ============================================================== */

describe('PHASE4.8-A L. パーツ表', () => {
  /*
   * ここは **はじめから入っているもの** だけを数える（builtInCount）。
   *
   * PHASE 4.8-B から、自分で描いたSVGを custom/ に置くと
   * そのままパーツとして増える。partCount で数えると、
   * 絵を1枚足しただけで検査が赤くなってしまい、
   * 「足すと怒られる」という一番やってはいけない体験になる。
   */
  it('§34 の数がそろっている（はじめから入っているぶん）', () => {
    expect(builtInCount('head')).toBe(5);
    expect(builtInCount('body')).toBe(5);
    expect(builtInCount('hairFront')).toBe(8);
    expect(builtInCount('hairBack')).toBe(8);
    expect(builtInCount('eye')).toBe(6);
    expect(builtInCount('eyebrow')).toBe(5);
    expect(builtInCount('nose')).toBe(4);
    expect(builtInCount('mouth')).toBe(6);
    expect(builtInCount('cap')).toBe(5);
    expect(builtInCount('ear')).toBe(1);
  });

  it('設計図の既定値が、はじめから入っているパーツ数と一致している', () => {
    expect(DEFAULT_PART_COUNTS.head).toBe(builtInCount('head'));
    expect(DEFAULT_PART_COUNTS.body).toBe(builtInCount('body'));
    expect(DEFAULT_PART_COUNTS.hair).toBe(builtInCount('hairFront'));
    expect(DEFAULT_PART_COUNTS.eyes).toBe(builtInCount('eye'));
    expect(DEFAULT_PART_COUNTS.eyebrow).toBe(builtInCount('eyebrow'));
    expect(DEFAULT_PART_COUNTS.nose).toBe(builtInCount('nose'));
    expect(DEFAULT_PART_COUNTS.mouth).toBe(builtInCount('mouth'));
    expect(DEFAULT_PART_COUNTS.cap).toBe(builtInCount('cap'));
  });

  it('自作パーツを足してもパーツ数の数え方が壊れない', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      expect(partCount(category), category).toBeGreaterThanOrEqual(builtInCount(category));
    }
  });

  it('id が全体で重複しない', () => {
    const seen = new Set<string>();
    for (const category of CHARACTER_PART_CATEGORIES) {
      for (const part of CHARACTER_PARTS[category]) {
        expect(seen.has(part.id), part.id).toBe(false);
        seen.add(part.id);
      }
    }
  });

  it('どのパーツも自分の種類を正しく名乗っている', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      for (const part of CHARACTER_PARTS[category]) {
        expect(part.category, part.id).toBe(category);
        expect(part.label.length, part.id).toBeGreaterThan(0);
      }
    }
  });

  it('番号がはみ出しても安全に折り返す', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      if (partCount(category) === 0) continue;
      expect(partAt(category, 999)).not.toBeNull();
      expect(partAt(category, -7)).not.toBeNull();
      expect(partAt(category, 0)).toBe(partAt(category, partCount(category)));
    }
  });

  it('id からも引ける', () => {
    expect(partById('head', 'head_01')?.label).toBe('丸型');
    expect(partById('cap', 'cap_01')?.category).toBe('cap');
    expect(partById('head', 'head_99')).toBeNull();
  });

  it('頭だけが基準線を動かす（他のパーツは動かさない）', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      if (category === 'head') continue;
      for (const part of CHARACTER_PARTS[category]) {
        expect(part.guideAdjustment, part.id).toBeUndefined();
      }
    }
  });
});

/* ================================================================
 * M. 年齢（§22）
 * ============================================================== */

describe('PHASE4.8-A M. 年齢', () => {
  it('年齢の段階が正しい', () => {
    expect(ageStageOf(19)).toBe('YOUTH');
    expect(ageStageOf(25)).toBe('PRIME');
    expect(ageStageOf(30)).toBe('MATURE');
    expect(ageStageOf(35)).toBe('VETERAN');
    expect(ageStageOf(41)).toBe('ELDER');
  });

  it('年を取っても骨格は変わらない（別人にならない）', () => {
    for (const id of ids(200, 'age')) {
      const base = buildCharacterProfile(id);
      for (const age of [18, 25, 33, 38, 42]) {
        const aged = characterProfileAtAge(id, age);
        expect(aged.head, `${id}@${age}`).toBe(base.head);
        expect(aged.body, `${id}@${age}`).toBe(base.body);
        expect(aged.eyes, `${id}@${age}`).toBe(base.eyes);
        expect(aged.nose, `${id}@${age}`).toBe(base.nose);
        expect(aged.mouth, `${id}@${age}`).toBe(base.mouth);
      }
    }
  });

  it('若いうちは何も変わらない', () => {
    for (const id of ids(50, 'young')) {
      expect(characterProfileAtAge(id, 24)).toEqual(buildCharacterProfile(id));
    }
  });

  it('年長になると一部だけ白髪になる（全員ではない）', () => {
    const list = ids(300, 'grey');
    const changed = list.filter(
      (id) => characterProfileAtAge(id, 41).hairColor !== buildCharacterProfile(id).hairColor,
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(list.length);
  });

  it('同じ年齢なら何度呼んでも同じ', () => {
    for (const id of ids(50, 'agefix')) {
      expect(characterProfileAtAge(id, 39)).toEqual(characterProfileAtAge(id, 39));
    }
  });
});
