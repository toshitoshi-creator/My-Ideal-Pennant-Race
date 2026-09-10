/**
 * PHASE 4.7-A のテスト。
 *
 * 見るのは3つだけ。
 *   1. プロンプトが仕様どおりの文言を持っているか（§13・§14）
 *   2. 体型・髪型・表情・ポーズ・目の数が足りているか（§1〜§10）
 *   3. 自動検査が、壊れた絵をちゃんと落とすか（§15）
 *
 * ゲームに触っていないことも、ここで押さえる（§19・§20）。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay } from './engine';
import { REQUIRED_CATEGORIES } from './visualProfile';
import {
  AGE_LOOKS,
  BODY_TYPES,
  CHARACTER_LIGHTING,
  CHARACTER_NEGATIVE_BASE,
  CHARACTER_PROMPT_VERSION,
  CHARACTER_STYLE,
  EXPRESSIONS,
  EYE_SHAPES,
  FACIAL_HAIR,
  HAIR_STYLES,
  JAW_SHAPES,
  POSES,
  STYLE_TEST,
  buildCharacterPrompt,
  characterNegative,
  countDiversity,
  diversityPlan,
} from '../../scripts/assets/character';
import {
  DUPLICATE_DISTANCE,
  HEADS_TALL_MAX,
  HEADS_TALL_MIN,
  NEEDS_EYE,
  checkCharacter,
  figureMetrics,
  hashDistance,
  largestComponentShare,
  perceptualHash,
} from '../../scripts/assets/character-quality';
import { BASE_STYLE, NEGATIVE_PROMPT, PROMPT_VERSION } from '../../scripts/assets/prompts';
import { catalogEntry } from '../../scripts/assets/catalog';
import { createImage, type RgbaImage } from '../../scripts/assets/png';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../scripts/assets/anchors';

/* ================================================================
 * 合成画像を作る道具
 * ============================================================== */

/**
 * デフォルメ選手を真似た合成画像。
 *
 * 大きな頭・細い首・小さな胴・短い脚。
 * 自動検査は「首でいちばん細くなる」ことだけを頼りに頭身を測るので、
 * その形さえ作れば検査の筋道を確かめられる。
 */
function figure(
  options: {
    headR?: number;
    headTop?: number;
    bodyHeight?: number;
    background?: [number, number, number] | null;
    offsetX?: number;
    second?: boolean;
  } = {},
): RgbaImage {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const image = createImage(width, height);
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
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const at = (y * width + x) * 4;
    image.data[at] = 190;
    image.data[at + 1] = 150;
    image.data[at + 2] = 120;
    image.data[at + 3] = 255;
  };

  const drawOne = (cx: number) => {
    const headR = options.headR ?? (options.second ? 110 : 170);
    const headTop = options.headTop ?? 120;
    const headCy = headTop + headR;
    const neckY = headTop + headR * 2;
    const bodyHeight = options.bodyHeight ?? (options.second ? 250 : 380);

    for (let y = headTop; y <= neckY; y++) {
      for (let x = cx - headR; x <= cx + headR; x++) {
        if ((x - cx) ** 2 + (y - headCy) ** 2 <= headR * headR) put(x, y);
      }
    }
    // 首（頭よりずっと細い）
    for (let y = neckY; y < neckY + 18; y++) {
      for (let x = cx - 34; x <= cx + 34; x++) put(x, y);
    }
    // 胴と脚（頭より狭く、下へ伸びる）
    for (let y = neckY + 18; y < neckY + 18 + bodyHeight; y++) {
      const half = (y < neckY + 18 + bodyHeight * 0.55 ? 118 : 96) * (options.second ? 0.6 : 1);
      for (let x = cx - half; x <= cx + half; x++) put(x, y);
    }
  };

  if (options.second) {
    // 2人が重ならないように、小さめにして左右へ離す
    drawOne(width / 2 - 250);
    drawOne(width / 2 + 250);
  } else {
    drawOne(width / 2 + (options.offsetX ?? 0));
  }
  return image;
}

/* ================================================================
 * 1. MASTER PROMPT（§13）
 * ============================================================== */

describe('PHASE4.7-A キャラクターの絵柄', () => {
  it('仕様§13 の要点がすべて入っている', () => {
    for (const phrase of [
      'high quality original Japanese baseball video game character',
      'stylized super-deformed professional baseball player',
      'approximately 2.5 heads tall',
      'large expressive head',
      'clear readable silhouette',
      'game-ready character illustration',
      'high readability at small UI sizes',
      'original character design',
    ]) {
      expect(CHARACTER_STYLE, phrase).toContain(phrase);
    }
  });

  it('照明は均一で柔らかい（§7）', () => {
    expect(CHARACTER_LIGHTING).toContain('neutral even lighting');
    expect(CHARACTER_LIGHTING).toContain('no harsh shadows on the face');
    expect(CHARACTER_LIGHTING).toContain('no lens flare');
  });

  it('部品のプロンプトも同じ絵柄を使う（並べたときに揃うように）', () => {
    expect(BASE_STYLE).toContain(CHARACTER_STYLE);
    expect(BASE_STYLE).toContain(CHARACTER_LIGHTING);
  });

  it('絵柄を変えたので部品のプロンプトの版が上がっている', () => {
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(7);
    expect(CHARACTER_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('実在の作品名やキャラクター名を書いていない（§0）', () => {
    const all = [CHARACTER_STYLE, CHARACTER_LIGHTING, buildCharacterPrompt(STYLE_TEST[0]).prompt]
      .join(' ')
      .toLowerCase();
    for (const banned of ['powerpro', 'pawapuro', 'konami', 'nintendo', 'famista', 'npb', 'mlb']) {
      expect(all, banned).not.toContain(banned);
    }
  });
});

/* ================================================================
 * 2. NEGATIVE PROMPT（§14）
 * ============================================================== */

describe('PHASE4.7-A 必ず外すもの', () => {
  it('仕様§14 が挙げるものがすべて入っている', () => {
    for (const word of [
      'photorealistic',
      'realistic human',
      'cinematic',
      'detailed skin pores',
      'beautiful anime character',
      'bishoujo',
      'fantasy character',
      'exaggerated muscles',
      'long limbs',
      'realistic proportions',
      'stadium',
      'baseball field',
      'crowd',
      'multiple characters',
      'text',
      'logo',
      'watermark',
      'existing character',
      'copyrighted character',
      'recognizable franchise style',
      'specific game style',
      'specific anime style',
      'lens flare',
      'motion blur',
      'fisheye',
      'cropped head',
      'cropped feet',
      'extra fingers',
      'deformed hands',
      'duplicate face',
    ]) {
      expect(CHARACTER_NEGATIVE_BASE, word).toContain(word);
    }
  });

  it('部品のネガティブにも §14 が入っている', () => {
    for (const word of ['bishoujo', 'stadium', 'cropped feet', 'specific game style']) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('権利と年齢の歯止めは残してある（§14 に無くても外さない）', () => {
    for (const word of ['real athlete', 'celebrity likeness', 'child', 'sexualised', 'gore']) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('柔らかい陰影は禁止していない（§8 でむしろ欲しいもの）', () => {
    expect(CHARACTER_NEGATIVE_BASE).not.toContain('soft shading');
    expect(CHARACTER_NEGATIVE_BASE).not.toContain('gradient shading');
  });

  it('単色の下地を描かせるときは背景を丸ごと否定しない', () => {
    // 否定すると下地まで消えて、かえって抜きにくくなる
    expect(characterNegative(true)).toContain('background,');
    expect(characterNegative(false).startsWith('background,')).toBe(false);
  });
});

/* ================================================================
 * 3. 作り分けの数（§1〜§10）
 * ============================================================== */

describe('PHASE4.7-A 作り分けの数', () => {
  it('体型は10種類以上（§4）', () => {
    expect(BODY_TYPES.length).toBeGreaterThanOrEqual(10);
  });

  it('髪型は15種類以上（§5）', () => {
    expect(HAIR_STYLES.length).toBeGreaterThanOrEqual(15);
  });

  it('表情は10種類以上（§9）', () => {
    expect(EXPRESSIONS.length).toBeGreaterThanOrEqual(10);
    expect(catalogEntry('expression').variants.length).toBeGreaterThanOrEqual(10);
  });

  it('ポーズは8種類以上（§10）', () => {
    expect(POSES.length).toBeGreaterThanOrEqual(8);
    expect(catalogEntry('pose').variants.length).toBeGreaterThanOrEqual(8);
  });

  it('目は8種類以上（§2）', () => {
    expect(EYE_SHAPES.length).toBeGreaterThanOrEqual(8);
  });

  it('§10 のポーズがひととおりそろっている', () => {
    const ids = POSES.map((pose) => pose.id);
    for (const need of ['standing', 'ready', 'batting', 'pitching', 'throwing', 'fielding']) {
      expect(ids, need).toContain(need);
    }
  });

  it('§9 の表情がひととおりそろっている', () => {
    const ids = EXPRESSIONS.map((item) => item.id);
    for (const need of ['neutral', 'happy', 'confident', 'focused', 'angry', 'determined']) {
      expect(ids, need).toContain(need);
    }
  });

  it('種類の名前はすべて重複していない', () => {
    for (const list of [BODY_TYPES, HAIR_STYLES, EYE_SHAPES, EXPRESSIONS, POSES, AGE_LOOKS]) {
      const ids = list.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

/* ================================================================
 * 4. 1人ぶんのプロンプト
 * ============================================================== */

describe('PHASE4.7-A 1人ぶんのプロンプト', () => {
  it('同じ指定からは必ず同じ文字列が出る（乱数を使わない）', () => {
    const a = buildCharacterPrompt(STYLE_TEST[3]).prompt;
    const b = buildCharacterPrompt(STYLE_TEST[3]).prompt;
    expect(a).toBe(b);
  });

  it('指定した体型・髪型・年齢が文面に入る', () => {
    const built = buildCharacterPrompt({
      id: 'x',
      body: 'stocky',
      hair: 'buzz',
      age: 'veteran',
      eyes: 'narrow',
    });
    expect(built.prompt).toContain('stocky solid build');
    expect(built.prompt).toContain('buzz cut');
    expect(built.prompt).toContain('veteran player in his late thirties');
    expect(built.prompt).toContain('narrow slim eyes');
  });

  it('冠詞が二重にならない', () => {
    expect(buildCharacterPrompt(STYLE_TEST[5]).prompt).not.toContain('A single a ');
    expect(buildCharacterPrompt(STYLE_TEST[5]).prompt).not.toContain(': a player');
  });

  it('知らない指定は落とす（黙って無視しない）', () => {
    expect(() => buildCharacterPrompt({ id: 'x', body: 'no_such_body' })).toThrow();
  });

  it('球団色とロゴを焼き込ませない（§12・§14）', () => {
    const built = buildCharacterPrompt(STYLE_TEST[0]);
    expect(built.prompt).toContain('no logo, no number and no lettering');
    expect(built.negativePrompt).toContain('logo');
  });

  it('全身が入ることを毎回頼む（§11）', () => {
    for (const spec of STYLE_TEST) {
      const built = buildCharacterPrompt(spec);
      expect(built.prompt, spec.id).toContain('FULL CHARACTER VISIBLE');
      expect(built.prompt, spec.id).toContain('HEAD FULLY INSIDE CANVAS');
      expect(built.prompt, spec.id).toContain('FEET FULLY INSIDE CANVAS');
      expect(built.prompt, spec.id).toContain('NO CUT OFF HEAD');
    }
  });

  it('余白を空けるよう頼む（「切るな」だけでは頭が上端に接した）', () => {
    const built = buildCharacterPrompt(STYLE_TEST[0]);
    expect(built.prompt).toContain('GENEROUS EMPTY MARGIN ABOVE THE HEAD');
    expect(built.prompt).toContain('GENEROUS EMPTY MARGIN BELOW THE FEET');
    expect(built.prompt).toContain('NO BODY PART TOUCHING THE IMAGE EDGE');
  });

  it('透明を頼むときも灰色や白の下地を描かせない', () => {
    // 透明を出せるモデルでも、10枚中2枚は薄い灰色の下地で返ってきた
    const built = buildCharacterPrompt(STYLE_TEST[0], { transparent: true });
    expect(built.prompt).toContain('do not paint a grey, white, off-white or coloured backdrop');
  });

  it('透明を出せないモデルには単色の下地を頼む（§12）', () => {
    const flat = buildCharacterPrompt(STYLE_TEST[0], { transparent: false });
    expect(flat.prompt).toContain('chroma green background');
    expect(flat.prompt).toContain('can be removed cleanly afterwards');
    const clear = buildCharacterPrompt(STYLE_TEST[0], { transparent: true });
    expect(clear.prompt).toContain('FULLY TRANSPARENT background');
  });

  it('文字数の上限があるモデルでは、大事な指定が残る', () => {
    const built = buildCharacterPrompt(STYLE_TEST[0], { maxLength: 700 });
    expect(built.prompt.length).toBeLessThanOrEqual(700);
    // 「誰を描くか」と「帽子を描くな」は先頭に置いてあるので残る
    expect(built.prompt).toContain('A single male baseball player');
    expect(built.prompt).toContain('NO HAT, NO CAP');
  });
});

/* ================================================================
 * 5. STYLE TEST と多様性（§17・§18）
 * ============================================================== */

describe('PHASE4.7-A STYLE TEST', () => {
  it('まず作るのは10人（§17）', () => {
    expect(STYLE_TEST.length).toBe(10);
  });

  it('10人の体型はすべて違う（絵柄を見るのが目的なので体型を振る）', () => {
    const bodies = STYLE_TEST.map((spec) => spec.body);
    expect(new Set(bodies).size).toBe(STYLE_TEST.length);
  });

  it('100人の組み合わせは何度作っても同じ（乱数を使わない）', () => {
    expect(diversityPlan(100)).toEqual(diversityPlan(100));
  });

  it('100人はすべて違うIDを持つ', () => {
    const ids = diversityPlan(100).map((spec) => spec.id);
    expect(new Set(ids).size).toBe(100);
  });

  it('100人の体型・髪型・顔が偏っていない（§18）', () => {
    const plan = diversityPlan(100);
    // どれかひとつが4分の1を超えて占めていたら偏りすぎ
    for (const key of ['body', 'hair', 'eyes', 'jaw'] as const) {
      const count = countDiversity(plan, key);
      expect(count.topShare, key).toBeLessThanOrEqual(0.25);
    }
  });

  it('100人に同じ組み合わせが2人といない', () => {
    const seen = new Set(
      diversityPlan(100).map((spec) =>
        [spec.body, spec.hair, spec.eyes, spec.jaw, spec.age, spec.facialHair].join('|'),
      ),
    );
    expect(seen.size).toBe(100);
  });

  it('年齢もひととおり出てくる', () => {
    const count = countDiversity(diversityPlan(100), 'age');
    expect(count.counts.length).toBe(AGE_LOOKS.length);
  });

  it('ひげは若い選手だけに偏らない', () => {
    const count = countDiversity(diversityPlan(100), 'facialHair');
    expect(count.counts.length).toBe(FACIAL_HAIR.length);
  });

  it('顔の輪郭もひととおり出てくる', () => {
    const count = countDiversity(diversityPlan(100), 'jaw');
    expect(count.counts.length).toBe(JAW_SHAPES.length);
  });
});

/* ================================================================
 * 6. 自動検査（§15）
 * ============================================================== */

describe('PHASE4.7-A 自動検査', () => {
  const check = (image: RgbaImage, known: string[] = []) =>
    checkCharacter({ id: 'x', image, known });
  const levelOf = (report: ReturnType<typeof checkCharacter>, id: string) =>
    report.checks.find((c) => c.id === id)?.level;

  it('ふつうの立ち姿は通る', () => {
    const report = check(figure());
    const fails = report.checks.filter((c) => c.level === 'FAIL');
    expect(fails.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(report.accepted).toBe(true);
  });

  it('頭身を測れる（2〜3頭身）', () => {
    const metrics = figureMetrics(figure());
    expect(metrics).not.toBeNull();
    expect(metrics!.headsTall).toBeGreaterThan(HEADS_TALL_MIN);
    expect(metrics!.headsTall).toBeLessThan(HEADS_TALL_MAX);
  });

  it('頭が切れていたら落とす（§15）', () => {
    expect(levelOf(check(figure({ headTop: 0 })), 'head-inside')).toBe('FAIL');
  });

  it('足が切れていたら落とす（§15）', () => {
    expect(levelOf(check(figure({ bodyHeight: 1200 })), 'feet-inside')).toBe('FAIL');
  });

  it('人物が2人いたら落とす（§15）', () => {
    expect(levelOf(check(figure({ second: true })), 'single-figure')).toBe('FAIL');
  });

  it('頭が小さすぎる（リアル頭身）と落とす（§1）', () => {
    const report = check(figure({ headR: 60, bodyHeight: 800 }));
    expect(levelOf(report, 'heads-tall')).toBe('FAIL');
  });

  it('空の画像は落とす', () => {
    const report = check(createImage(CANVAS_WIDTH, CANVAS_HEIGHT));
    expect(report.accepted).toBe(false);
  });

  it('すでに透明な絵も検査できる', () => {
    const report = check(figure({ background: null }));
    expect(levelOf(report, 'background-removable')).toBe('PASS');
  });

  it('同じ絵が2枚あれば重複として落とす（§18）', () => {
    const image = figure();
    const first = check(image);
    const second = check(image, [first.hash]);
    expect(levelOf(second, 'duplicate')).toBe('FAIL');
  });

  it('違う絵は重複にしない', () => {
    const first = check(figure());
    const second = check(figure({ headR: 130, bodyHeight: 500 }), [first.hash]);
    expect(levelOf(second, 'duplicate')).toBe('PASS');
  });

  it('指紋は同じ絵なら必ず同じ', () => {
    expect(perceptualHash(figure())).toBe(perceptualHash(figure()));
    expect(hashDistance(perceptualHash(figure()), perceptualHash(figure()))).toBe(0);
  });

  it('重複とみなす近さが決まっている', () => {
    // 256ビットのうち、ごく一部しか違わないものだけを「同じ」とみなす
    expect(DUPLICATE_DISTANCE).toBeGreaterThan(0);
    expect(DUPLICATE_DISTANCE).toBeLessThan(256 * 0.1);
  });

  it('かたまりが1つなら割合はほぼ1', () => {
    expect(largestComponentShare(figure(), [0, 177, 64])).toBeGreaterThan(0.95);
  });

  it('かたまりが2つなら割合が下がる', () => {
    expect(largestComponentShare(figure({ second: true }), [0, 177, 64])).toBeLessThan(0.8);
  });

  it('検査しても画像を変えない', () => {
    const image = figure();
    const before = new Uint8Array(image.data);
    check(image);
    expect(image.data).toEqual(before);
  });

  it('目で見ないと分からないことを、分かったふりで PASS にしない', () => {
    // 「顔の破綻」「既存キャラクターを想起させる意匠」は自動では見ていない
    expect(NEEDS_EYE.length).toBeGreaterThan(0);
    const ids = check(figure()).checks.map((c) => c.id);
    expect(ids).not.toContain('face-not-broken');
    expect(ids).not.toContain('hands-not-broken');
  });
});

/* ================================================================
 * 7. ゲームに触っていない（§19・§20）
 * ============================================================== */

describe('PHASE4.7-A ゲームに触らない', () => {
  it('キャラクターの文面を組み立てても試合の結果が変わらない', () => {
    const run = (withPrompts: boolean) => {
      let state = createNewGame('phoenix', 10, 20250909);
      for (let day = 0; day < 12; day++) {
        if (withPrompts) {
          for (const spec of STYLE_TEST) buildCharacterPrompt(spec);
          diversityPlan(20);
        }
        state = advanceDay(state).state;
      }
      return state;
    };
    const plain = run(false);
    const withPrompts = run(true);
    expect(withPrompts.rngState).toBe(plain.rngState);
    expect(withPrompts.records).toEqual(plain.records);
  });

  it('素材が1枚も無くても遊べる（SVGフォールバックを消していない）', () => {
    // 必須の種類が決まっていて、足りなければ SVG に落ちる仕組みが残っている
    expect(REQUIRED_CATEGORIES.length).toBeGreaterThan(0);
    const state = createNewGame('phoenix', 10, 20250909);
    expect(state.players.length).toBeGreaterThan(0);
  });
});
