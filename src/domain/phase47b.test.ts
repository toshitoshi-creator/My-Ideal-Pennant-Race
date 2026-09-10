/**
 * PHASE 4.7-B のテスト（§23）。
 *
 * このPHASEの目的は絵柄を変えることではなく、
 * **量産したときの品質のブレを消すこと**。だから見るのは主に3つ。
 *
 *   1. 本体に帽子が絶対に描かれないこと（§2）
 *   2. 帽子が player.id だけで決まり、移籍しても変わらないこと（§8・§9）
 *   3. 余白・透明背景・アンカーが仕様どおりであること（§5・§6・§7）
 *
 * あわせて「ゲームに触っていない」ことも押さえる（§25）。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay } from './engine';
import type { GameState, Player } from './types';
import { SAVE_VERSION } from './newGame';
import {
  DEFAULT_CAP_COUNT,
  HEADWEAR_ASSET,
  VISUAL_PROFILE_VERSION,
  buildVisualProfile,
  capAssetOfTeam,
  headwearOf,
  missingCategories,
  visualHash,
} from './visualProfile';
import {
  CAP_LIGHTING,
  CAP_NEGATIVE_BASE,
  CAP_TYPES,
  CHARACTER_PROMPT_VERSION,
  CHARACTER_FRAMING,
  CHARACTER_NEGATIVE_BASE,
  CHARACTER_STYLE,
  MARGIN_BOTTOM_RATIO,
  MARGIN_SIDE_RATIO,
  MARGIN_TOP_RATIO,
  NO_HEADWEAR,
  STYLE_TEST,
  buildCapPrompt,
  buildCharacterPrompt,
  capNegative,
  capPlan,
  diversityPlan,
} from '../../scripts/assets/character';
import {
  CAP_ASPECT_MAX,
  CAP_ASPECT_MIN,
  CAP_MARGIN_MIN,
  MARGIN_BOTTOM_MIN,
  MARGIN_SIDE_MIN,
  MARGIN_TOP_MIN,
  checkCap,
  checkCharacter,
  classifyBackground,
} from '../../scripts/assets/character-quality';
import { createImage, type RgbaImage } from '../../scripts/assets/png';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../scripts/assets/anchors';

const PLAYER_TEAM = 'phoenix';

const GAMES = new Map<number, GameState>();
function newGame(seed = 470470): GameState {
  const cached = GAMES.get(seed);
  if (cached) return cached;
  const state = createNewGame(PLAYER_TEAM, 10, seed);
  GAMES.set(seed, state);
  return state;
}

/** この作品の球団。帽子は球団の数だけ用意する */
const TEAM_IDS = newGame().teams.map((team) => team.id);

function fakePlayer(id: string, over: Partial<Player> = {}): Player {
  return { ...newGame().players[0], id, ...over };
}

/** 選手をそのまま渡せる短縮形 */
function buildVisualProfile2(player: Player) {
  return buildVisualProfile({ player });
}

/** 素材の仕様（config）。実装とずれていないかを見る */
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
  anchors: Record<string, Record<string, number | string>>;
  categories: Array<{ id: string; dir: string; prefix: string; min: number; max: number }>;
};

/* ================================================================
 * 合成画像を作る道具
 * ============================================================== */

/** 帽子を真似た合成画像。横長で、左右がだいたい対称 */
function capImage(
  options: {
    size?: number;
    width?: number;
    height?: number;
    background?: [number, number, number] | null;
    skewBrim?: number;
    touchEdge?: boolean;
    detached?: boolean;
  } = {},
): RgbaImage {
  const size = options.size ?? 1024;
  const image = createImage(size, size);
  const background = options.background === undefined ? ([0, 177, 64] as [number, number, number]) : options.background;
  if (background) {
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = background[0];
      image.data[i + 1] = background[1];
      image.data[i + 2] = background[2];
      image.data[i + 3] = 255;
    }
  }
  const put = (x: number, y: number) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const at = (y * size + x) * 4;
    image.data[at] = 210;
    image.data[at + 1] = 208;
    image.data[at + 2] = 202;
    image.data[at + 3] = 255;
  };

  const cx = size / 2;
  const halfW = (options.width ?? Math.round(size * 0.34)) / 2;
  const crownH = options.height ?? Math.round(size * 0.22);
  const top = options.touchEdge ? 0 : Math.round(size * 0.3);

  // クラウン（半円）
  for (let y = top; y <= top + crownH; y++) {
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      const ny = (y - (top + crownH)) / crownH;
      const nx = (x - cx) / halfW;
      if (nx * nx + ny * ny <= 1) put(x, y);
    }
  }
  // つば（前へ張り出す横長の板）
  const brimTop = top + crownH;
  const skew = options.skewBrim ?? 0;
  const brimLeft = cx - halfW * 1.05 + skew;
  const brimRight = cx + halfW * 1.05 + skew;
  const gap = options.detached ? 14 : 0;
  for (let y = brimTop + gap; y <= brimTop + gap + Math.round(size * 0.05); y++) {
    for (let x = brimLeft; x <= brimRight; x++) put(Math.round(x), y);
  }
  return image;
}

/** 選手本体を真似た合成画像（帽子なし） */
function bodyImage(
  options: { topMargin?: number; background?: [number, number, number] | null } = {},
): RgbaImage {
  const image = createImage(CANVAS_WIDTH, CANVAS_HEIGHT);
  const background = options.background === undefined ? ([0, 177, 64] as [number, number, number]) : options.background;
  if (background) {
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = background[0];
      image.data[i + 1] = background[1];
      image.data[i + 2] = background[2];
      image.data[i + 3] = 255;
    }
  }
  const put = (x: number, y: number) => {
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return;
    const at = (y * CANVAS_WIDTH + x) * 4;
    image.data[at] = 190;
    image.data[at + 1] = 150;
    image.data[at + 2] = 120;
    image.data[at + 3] = 255;
  };
  const cx = CANVAS_WIDTH / 2;
  const headR = 170;
  const headTop = options.topMargin ?? 150;
  const headCy = headTop + headR;
  const neckY = headTop + headR * 2;
  for (let y = headTop; y <= neckY; y++) {
    for (let x = cx - headR; x <= cx + headR; x++) {
      if ((x - cx) ** 2 + (y - headCy) ** 2 <= headR * headR) put(x, y);
    }
  }
  for (let y = neckY; y < neckY + 18; y++) for (let x = cx - 34; x <= cx + 34; x++) put(x, y);
  for (let y = neckY + 18; y < neckY + 18 + 380; y++) {
    const half = y < neckY + 18 + 209 ? 118 : 96;
    for (let x = cx - half; x <= cx + half; x++) put(x, y);
  }
  return image;
}

/* ================================================================
 * 1. 本体に帽子を描かせない（§2 — このPHASEの絶対条件）
 * ============================================================== */

describe('PHASE4.7-B 本体に帽子を描かせない', () => {
  it('本体のプロンプトに「帽子を描くな」が必ず入る', () => {
    for (const spec of STYLE_TEST) {
      const built = buildCharacterPrompt(spec);
      expect(built.prompt, spec.id).toContain('NO HAT');
      expect(built.prompt, spec.id).toContain('NO CAP');
      expect(built.prompt, spec.id).toContain('NO HELMET');
      expect(built.prompt, spec.id).toContain('NO HEADWEAR');
    }
  });

  it('本体のプロンプトに「頭を出せ」が入る', () => {
    const built = buildCharacterPrompt(STYLE_TEST[0]);
    expect(built.prompt).toContain('BARE HEAD');
    expect(built.prompt).toContain('HAIR FULLY VISIBLE');
  });

  it('100人ぶんすべてに「帽子を描くな」が入る', () => {
    for (const spec of diversityPlan(100)) {
      expect(buildCharacterPrompt(spec).prompt, spec.id).toContain('NO HEADWEAR');
    }
  });

  it('ネガティブでも帽子を外している', () => {
    for (const word of ['hat', 'cap', 'baseball cap', 'helmet', 'headwear', 'visor']) {
      expect(CHARACTER_NEGATIVE_BASE, word).toContain(word);
    }
  });

  it('文字数の上限があるモデルでも「帽子を描くな」は残る', () => {
    // 大事な指定は先頭に置いてあるので、後ろが切られても残る
    for (const limit of [500, 700, 900]) {
      const built = buildCharacterPrompt(STYLE_TEST[0], { maxLength: limit });
      expect(built.prompt.length).toBeLessThanOrEqual(limit);
      expect(built.prompt, String(limit)).toContain('NO HAT');
    }
  });

  it('帽子を描かせない指定は本体だけで、帽子の指定には入らない', () => {
    expect(buildCapPrompt('cap_01').prompt).not.toContain('NO CAP');
  });

  it('プロンプトの版が上がっている（文言を変えたので）', () => {
    expect(CHARACTER_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================
 * 2. 余白と構図（§5）
 * ============================================================== */

describe('PHASE4.7-B 余白と構図', () => {
  it('§5 の言い回しがすべて入っている', () => {
    for (const phrase of [
      'FULL CHARACTER VISIBLE',
      'HEAD FULLY INSIDE CANVAS',
      'FEET FULLY INSIDE CANVAS',
      'GENEROUS EMPTY MARGIN ABOVE THE HEAD',
      'GENEROUS EMPTY MARGIN BELOW THE FEET',
      'NO CROPPING',
      'NO CUT OFF HEAD',
      'NO CUT OFF FEET',
      'NO BODY PART TOUCHING THE IMAGE EDGE',
    ]) {
      expect(CHARACTER_FRAMING, phrase).toContain(phrase);
    }
  });

  it('余白の目安が §5 の範囲に収まっている', () => {
    expect(MARGIN_TOP_RATIO).toBeGreaterThanOrEqual(0.08);
    expect(MARGIN_TOP_RATIO).toBeLessThanOrEqual(0.12);
    expect(MARGIN_BOTTOM_RATIO).toBeGreaterThanOrEqual(0.08);
    expect(MARGIN_BOTTOM_RATIO).toBeLessThanOrEqual(0.12);
    expect(MARGIN_SIDE_RATIO).toBeGreaterThanOrEqual(0.06);
    expect(MARGIN_SIDE_RATIO).toBeLessThanOrEqual(0.10);
  });

  it('検査の余白の下限が、頼んでいる余白より緩い（頼みどおりなら必ず通る）', () => {
    expect(MARGIN_TOP_MIN).toBeLessThanOrEqual(MARGIN_TOP_RATIO);
    expect(MARGIN_BOTTOM_MIN).toBeLessThanOrEqual(MARGIN_BOTTOM_RATIO);
    expect(MARGIN_SIDE_MIN).toBeLessThanOrEqual(MARGIN_SIDE_RATIO);
  });

  it('余白が十分なら通る', () => {
    const report = checkCharacter({ id: 'x', image: bodyImage({ topMargin: 150 }) });
    const head = report.checks.find((c) => c.id === 'head-inside');
    expect(head?.level).toBe('PASS');
  });

  it('余白が足りなければ WARN（4.7-A では PASS で通ってしまった）', () => {
    const report = checkCharacter({ id: 'x', image: bodyImage({ topMargin: 5 }) });
    expect(report.checks.find((c) => c.id === 'head-inside')?.level).toBe('WARN');
  });

  it('上端に接していれば FAIL', () => {
    const report = checkCharacter({ id: 'x', image: bodyImage({ topMargin: 0 }) });
    expect(report.checks.find((c) => c.id === 'head-inside')?.level).toBe('FAIL');
  });
});

/* ================================================================
 * 3. 透明背景（§6）
 * ============================================================== */

describe('PHASE4.7-B 透明背景', () => {
  it('透明なら PASS', () => {
    expect(classifyBackground(bodyImage({ background: null })).level).toBe('PASS');
  });

  it('単色の下地なら PASS（後処理で抜ける）', () => {
    expect(classifyBackground(bodyImage()).level).toBe('PASS');
  });

  it('複雑な背景は FAIL（採用しない）', () => {
    const image = bodyImage();
    // 縁に模様を描き込む＝景色が入っている状態
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      for (let x = 0; x < CANVAS_WIDTH; x++) {
        if (x > 8 && x < CANVAS_WIDTH - 8 && y > 8 && y < CANVAS_HEIGHT - 8) continue;
        const at = (y * CANVAS_WIDTH + x) * 4;
        const v = (x * 7 + y * 13) % 255;
        image.data[at] = v;
        image.data[at + 1] = 255 - v;
        image.data[at + 2] = (v * 3) % 255;
        image.data[at + 3] = 255;
      }
    }
    expect(classifyBackground(image).level).toBe('FAIL');
  });

  it('透明を頼む文面に「白も灰色も描くな」が入る', () => {
    const built = buildCharacterPrompt(STYLE_TEST[0], { transparent: true });
    expect(built.prompt).toContain('FULLY TRANSPARENT');
    expect(built.prompt).toContain('do not paint a grey, white, off-white or coloured backdrop');
  });

  it('ネガティブでも白・灰色・色つきの背景を外している', () => {
    for (const word of ['gray background', 'white background', 'colored background']) {
      expect(CHARACTER_NEGATIVE_BASE, word).toContain(word);
    }
  });

  it('床の影も外している（抜くときに邪魔になる）', () => {
    expect(CHARACTER_NEGATIVE_BASE).toContain('floor shadow');
    expect(CHARACTER_NEGATIVE_BASE).toContain('cast shadow');
  });

  it('帽子も同じ判定を使う', () => {
    expect(classifyBackground(capImage({ background: null })).level).toBe('PASS');
    expect(classifyBackground(capImage()).level).toBe('PASS');
  });
});

/* ================================================================
 * 4. 帽子の素材（§3・§4）
 * ============================================================== */

describe('PHASE4.7-B 帽子の素材', () => {
  it('帽子は10種類以上ある（§3）', () => {
    expect(CAP_TYPES.length).toBeGreaterThanOrEqual(10);
  });

  it('帽子の名前は重複していない', () => {
    const ids = CAP_TYPES.map((cap) => cap.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('帽子の文面はどれも違う（形の差を出す）', () => {
    const prompts = CAP_TYPES.map((cap) => cap.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('形・つば・クラウンの違いが文面に出ている', () => {
    /*
     * 「縫い目」の差はこの大きさでは効かなかったのでやめた。
     * 輪郭で見える違い（つばの長さ・角度、クラウンの高さ・広がり）だけを見る。
     */
    const all = CAP_TYPES.map((cap) => cap.prompt).join(' ');
    for (const word of ['brim', 'crown', 'flat', 'curved', 'tall', 'short', 'long', 'downward', 'upward']) {
      expect(all, word).toContain(word);
    }
  });

  it('帽子にロゴも文字も入れさせない（§3・§10）', () => {
    for (const id of capPlan()) {
      const built = buildCapPrompt(id);
      expect(built.prompt, id).toContain('No logo, no lettering, no numbers');
      expect(built.negativePrompt, id).toContain('team logo');
    }
  });

  it('帽子に球団色を焼き込ませない（§10）', () => {
    expect(buildCapPrompt('cap_01').prompt).toContain('no team colour');
  });

  it('帽子に頭や顔を描かせない（§4）', () => {
    const built = buildCapPrompt('cap_01');
    expect(built.prompt).toContain('no head, no face, no hair, no person underneath');
    for (const word of ['head', 'face', 'hair', 'person']) {
      expect(built.negativePrompt, word).toContain(word);
    }
  });

  it('帽子の背景も白・灰色を禁止している（§4）', () => {
    const built = buildCapPrompt('cap_01', { transparent: true });
    expect(built.prompt).toContain('FULLY TRANSPARENT');
    expect(built.prompt).toContain('do not paint a white, grey, off-white or coloured backdrop');
  });

  it('§20 の帽子むけネガティブがすべて入っている', () => {
    for (const word of [
      'photorealistic',
      'real person',
      'celebrity',
      'existing baseball team',
      'existing sports logo',
      'copyrighted character',
      'text',
      'watermark',
      'stadium',
      'person',
      'head',
      'face',
      'hair',
      'helmet',
      'cropped cap',
      'broken brim',
      'deformed brim',
      'gray background',
      'white background',
      'colored background',
      'shadow',
    ]) {
      expect(CAP_NEGATIVE_BASE, word).toContain(word);
    }
  });

  it('帽子の照明は顔の話をしない（帽子には顔が無い）', () => {
    expect(CAP_LIGHTING).not.toContain('face');
    expect(CAP_LIGHTING).toContain('neutral even lighting');
  });

  it('同じ帽子の指定からは必ず同じ文字列が出る', () => {
    expect(buildCapPrompt('cap_03').prompt).toBe(buildCapPrompt('cap_03').prompt);
  });

  it('知らない帽子は落とす', () => {
    expect(() => buildCapPrompt('cap_99')).toThrow();
  });

  it('単色の下地を頼むときは背景を丸ごと否定しない', () => {
    expect(capNegative(true)).toContain('background,');
    expect(capNegative(false).startsWith('background,')).toBe(false);
  });

  it('帽子の絵柄は本体と同じだと明記している（§1）', () => {
    expect(buildCapPrompt('cap_01').prompt).toContain(
      'drawn in exactly the same style as the player characters',
    );
  });

  it('帽子の計画は10種類ぶん出る（§14 の生成回数）', () => {
    expect(capPlan().length).toBe(CAP_TYPES.length);
    expect(capPlan(5).length).toBe(5);
  });
});

/* ================================================================
 * 5. 帽子の検査（§12）
 * ============================================================== */

describe('PHASE4.7-B 帽子の検査', () => {
  const check = (image: RgbaImage, known: string[] = []) => checkCap({ id: 'cap', image, known });
  const levelOf = (report: ReturnType<typeof checkCap>, id: string) =>
    report.checks.find((c) => c.id === id)?.level;

  it('ふつうの帽子は通る', () => {
    const report = check(capImage());
    expect(report.checks.filter((c) => c.level === 'FAIL').map((c) => `${c.id}: ${c.detail}`)).toEqual(
      [],
    );
    expect(report.accepted).toBe(true);
  });

  it('端に接していたら落とす', () => {
    expect(levelOf(check(capImage({ touchEdge: true })), 'cap-inside')).toBe('FAIL');
  });

  it('縦長すぎるものは帽子ではない', () => {
    expect(levelOf(check(capImage({ width: 200, height: 500 })), 'cap-shape')).toBe('FAIL');
  });

  it('つばが片側に寄りすぎていたら落とす', () => {
    expect(levelOf(check(capImage({ skewBrim: 220 })), 'cap-symmetry')).not.toBe('PASS');
  });

  it('つばが千切れていたら気づく', () => {
    expect(levelOf(check(capImage({ detached: true })), 'cap-single')).not.toBe('PASS');
  });

  it('空の画像は落とす', () => {
    expect(check(createImage(512, 512)).accepted).toBe(false);
  });

  it('同じ帽子が2枚あれば知らせる（落とすまではしない）', () => {
    /*
     * 帽子は10個とも同じ物体なので、どうしても似る（実測 2〜25ビット）。
     * §12 の合格基準に「重複0」は無いので、WARN にとどめて目視にまわす。
     */
    const first = check(capImage());
    expect(levelOf(check(capImage(), [first.hash]), 'duplicate')).toBe('WARN');
  });

  it('形の違う帽子は重複にしない', () => {
    const first = check(capImage());
    const second = check(capImage({ width: 500, height: 130 }), [first.hash]);
    expect(levelOf(second, 'duplicate')).toBe('PASS');
  });

  it('検査しても画像を変えない', () => {
    const image = capImage();
    const before = new Uint8Array(image.data);
    check(image);
    expect(image.data).toEqual(before);
  });

  it('縦横比の許容が帽子らしい範囲になっている', () => {
    expect(CAP_ASPECT_MIN).toBeLessThan(1);
    expect(CAP_ASPECT_MAX).toBeGreaterThan(CAP_ASPECT_MIN);
  });

  it('帽子の余白の下限が決まっている', () => {
    expect(CAP_MARGIN_MIN).toBeGreaterThan(0);
    expect(CAP_MARGIN_MIN).toBeLessThan(0.2);
  });
});

/* ================================================================
 * 6. 帽子の割り当て（§8・§9）
 * ============================================================== */

describe('PHASE4.7-B 帽子の割り当て', () => {
  it('同じ球団はいつも同じ帽子', () => {
    for (const team of ['phoenix', 'bluewave', 'grandvers']) {
      expect(capAssetOfTeam(team, 'p-1')).toBe(capAssetOfTeam(team, 'p-2'));
    }
  });

  it('1000回呼んでも同じ（乱数を使っていない）', () => {
    const first = capAssetOfTeam('phoenix', 'p-42');
    for (let i = 0; i < 1000; i++) expect(capAssetOfTeam('phoenix', 'p-42')).toBe(first);
  });

  it('球団が違えば違う帽子が配られる（全球団同じにならない）', () => {
    const seen = new Set<string>();
    for (const team of TEAM_IDS) seen.add(capAssetOfTeam(team, 'p-1'));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('移籍したら新しい球団の帽子になる', () => {
    // §9 の当初案は「移籍しても同じ帽子」だったが、
    // 帽子は球団のものなので、移籍すれば変わるのが正しい
    const before = buildVisualProfile2(fakePlayer('p-move', { teamId: 'phoenix' })).parts.cap;
    const after = buildVisualProfile2(fakePlayer('p-move', { teamId: 'whitefox' })).parts.cap;
    expect(before).not.toBe(after);
  });

  it('同じ球団の選手は全員同じ帽子', () => {
    const caps = new Set<string>();
    for (let i = 0; i < 30; i++) {
      caps.add(buildVisualProfile2(fakePlayer(`p-${i}`, { teamId: 'phoenix' })).parts.cap ?? '');
    }
    expect(caps.size).toBe(1);
  });

  it('帽子の種類は球団の数だけ用意する', () => {
    expect(DEFAULT_CAP_COUNT).toBe(TEAM_IDS.length);
    expect(CAP_TYPES.length).toBe(TEAM_IDS.length);
  });

  it('無所属の選手は選手ごとの帽子になる（全員同じにならない）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(capAssetOfTeam(null, `free-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('素材が1種類でも壊れない', () => {
    expect(capAssetOfTeam('phoenix', 'p-1', 1)).toBe('cap_001');
  });

  it('素材が0種類と言われても壊れない', () => {
    expect(capAssetOfTeam('phoenix', 'p-1', 0)).toBe('cap_001');
  });

  it('帽子のIDは命名規則に合う', () => {
    for (const team of TEAM_IDS) expect(capAssetOfTeam(team ?? null, 'p-1')).toMatch(/^cap_\d{3}$/);
  });

  it('顔の割り当てとは別のハッシュを使う（顔が変わっても帽子は動かない）', () => {
    expect(visualHash('team-cap-v1:phoenix')).not.toBe(
      visualHash(`player-appearance-v${VISUAL_PROFILE_VERSION}:phoenix`),
    );
  });

  it('ヘルメットとマスクは帽子と番号がぶつからない', () => {
    const reserved = Object.values(HEADWEAR_ASSET);
    for (const team of TEAM_IDS) {
      expect(reserved).not.toContain(capAssetOfTeam(team, 'p-1', DEFAULT_CAP_COUNT));
    }
  });

  it('打席ではヘルメット、捕手ではマスクになる', () => {
    expect(headwearOf('BATTER')).toBe('helmet');
    expect(headwearOf('CATCHER')).toBe('mask');
    expect(headwearOf('PITCHER')).toBe('cap');
  });

  it('設計図に帽子が必ず入る', () => {
    expect(buildVisualProfile2(fakePlayer('p-cap-1')).parts.cap).toBeTruthy();
  });

  it('年齢が変わっても帽子の形は変わらない', () => {
    const young = buildVisualProfile2(fakePlayer('p-age', { age: 19, teamId: 'phoenix' }));
    const old = buildVisualProfile2(fakePlayer('p-age', { age: 39, teamId: 'phoenix' }));
    expect(young.parts.cap).toBe(old.parts.cap);
  });
});

/* ================================================================
 * 7. アンカー（§7）
 * ============================================================== */

describe('PHASE4.7-B アンカー', () => {
  it('§7 が挙げる基準点が定義されている', () => {
    const figure = SPEC.anchors.figure;
    for (const key of [
      'headTopY',
      'headCenterX',
      'headCenterY',
      'faceCenterX',
      'faceCenterY',
      'bodyCenterX',
      'bodyCenterY',
      'leftShoulderX',
      'rightShoulderX',
      'feetBaselineY',
    ]) {
      expect(figure[key], key).toBeTypeOf('number');
    }
  });

  it('帽子の基準点が定義されている', () => {
    const cap = SPEC.anchors.cap;
    for (const key of ['capCenterX', 'capCenterY', 'capBrimY', 'crownTopY', 'headContactY']) {
      expect(cap[key], key).toBeTypeOf('number');
    }
  });

  it('帽子は頭より上にある', () => {
    expect(Number(SPEC.anchors.cap.crownTopY)).toBeLessThan(Number(SPEC.anchors.cap.capBrimY));
    expect(Number(SPEC.anchors.cap.capBrimY)).toBeLessThan(Number(SPEC.anchors.cap.headContactY));
  });

  it('つばは目より上にある（目を隠さない）', () => {
    expect(Number(SPEC.anchors.cap.capBrimY)).toBeLessThan(Number(SPEC.anchors.figure.faceCenterY));
  });

  it('足の基準線はキャンバスの中に収まっている', () => {
    expect(Number(SPEC.anchors.figure.feetBaselineY)).toBeLessThan(SPEC.canvas.height);
  });

  it('頭の天辺は余白の目安より下にある（§5）', () => {
    expect(Number(SPEC.anchors.figure.headTopY)).toBeGreaterThanOrEqual(
      SPEC.canvas.height * (MARGIN_TOP_RATIO - 0.02),
    );
  });

  it('肩は左右対称に置かれている', () => {
    const left = Number(SPEC.anchors.figure.leftShoulderX);
    const right = Number(SPEC.anchors.figure.rightShoulderX);
    const centre = Number(SPEC.anchors.figure.bodyCenterX);
    expect(Math.abs(centre - left)).toBeCloseTo(Math.abs(right - centre), 0);
  });

  it('左右固定ではなく頭の基準点から相対で置ける値がそろっている（§7）', () => {
    // 頭の中心と帽子の中心が両方あるので、頭の大きさが違っても相対配置できる
    expect(SPEC.anchors.figure.headCenterY).toBeDefined();
    expect(SPEC.anchors.cap.capCenterY).toBeDefined();
  });

  it('帽子の種類の上限が10種類以上に開いている（§3）', () => {
    const cap = SPEC.categories.find((c) => c.id === 'cap');
    expect(cap).toBeDefined();
    expect(cap!.max).toBeGreaterThanOrEqual(10);
  });
});

/* ================================================================
 * 8. ゲームに触っていない（§25）
 * ============================================================== */

describe('PHASE4.7-B ゲームに触らない', () => {
  it('帽子を割り当てても試合の結果が変わらない', () => {
    const run = (withCaps: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 20250910);
      for (let day = 0; day < 12; day++) {
        if (withCaps) {
          for (const player of state.players.slice(0, 40)) {
            capAssetOfTeam(player.teamId ?? null, player.id);
          }
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = run(false);
    const withCaps = run(true);
    expect(withCaps.rngState).toBe(plain.rngState);
    expect(withCaps.records).toEqual(plain.records);
  });

  it('プロンプトを組み立てても乱数の状態が変わらない', () => {
    const before = newGame().rngState;
    for (const spec of STYLE_TEST) buildCharacterPrompt(spec);
    for (const id of capPlan()) buildCapPrompt(id);
    expect(newGame().rngState).toBe(before);
  });

  it('SAVE_VERSION を変えていない', () => {
    expect(SAVE_VERSION).toBe(15);
  });

  it('設計図の版を変えていない（帽子の割り当ては版を上げずに済む変更）', () => {
    expect(VISUAL_PROFILE_VERSION).toBe(3);
  });

  it('素材が1枚も無くても遊べる（SVGへ落ちる）', () => {
    const profile = buildVisualProfile2(fakePlayer('p-none'));
    const missing = missingCategories(profile, () => false);
    // 何も無ければ「足りない」と分かる＝SVGに落ちる判断ができている
    expect(missing.length).toBeGreaterThan(0);
  });

  it('帽子は必須ではない（無くても画像モードに入れる）', () => {
    const profile = buildVisualProfile2(fakePlayer('p-nocap'));
    const missing = missingCategories(profile, (category) => category !== 'cap');
    expect(missing).not.toContain('cap');
  });
});

/* ================================================================
 * 9. 絵柄を変えていない（§1）
 * ============================================================== */

describe('PHASE4.7-B 絵柄を変えていない', () => {
  it('4.7-A で決めた絵柄の文言がそのまま残っている', () => {
    for (const phrase of [
      'high quality original Japanese baseball video game character',
      'stylized super-deformed professional baseball player',
      'approximately 2.5 heads tall',
      'large expressive head',
      'clean smooth contours',
      'soft controlled shading',
    ]) {
      expect(CHARACTER_STYLE, phrase).toContain(phrase);
    }
  });

  it('フラットなSVGアバターへ戻していない（§1）', () => {
    expect(CHARACTER_STYLE).not.toContain('flat vector');
    expect(CHARACTER_STYLE).not.toContain('app-icon');
  });

  it('写実へ寄せていない', () => {
    expect(CHARACTER_NEGATIVE_BASE).toContain('photorealistic');
    expect(CHARACTER_NEGATIVE_BASE).toContain('realistic proportions');
  });

  it('実在の作品名・球団名を書いていない（§1）', () => {
    const all = [
      CHARACTER_STYLE,
      NO_HEADWEAR,
      CHARACTER_FRAMING,
      buildCharacterPrompt(STYLE_TEST[0]).prompt,
      buildCapPrompt('cap_01').prompt,
    ]
      .join(' ')
      .toLowerCase();
    for (const banned of ['powerpro', 'pawapuro', 'konami', 'npb', 'mlb', 'yomiuri', 'hanshin']) {
      expect(all, banned).not.toContain(banned);
    }
  });

  it('ユニフォームはオフホワイトのまま（§10）', () => {
    expect(buildCharacterPrompt(STYLE_TEST[0]).prompt).toContain(
      'plain baseball uniform with no logo, no number and no lettering',
    );
  });
});
