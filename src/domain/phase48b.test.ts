/**
 * PHASE 4.8-B 制作環境の検査。
 *
 * 確かめたいのは2つです。
 *
 *   1. **あなたが描いたSVGが、規格どおりにゲームへ入るか**
 *   2. **規格から外れたものが、確実に止まるか**
 *
 * 2つめのほうが大事です。
 * 止まらずに入ってしまうと、あとで「なぜか顔がずれる」になり、
 * 原因を探すのに時間がかかります。入り口で止めます。
 *
 * ここでは絵の good / bad は測りません。測れませんし、測るものでもありません。
 */
import { describe, it, expect } from 'vitest';
import {
  CHARACTER_GUIDES,
  adjustGuides,
  anchorsFrom,
} from '../ui/character/coordinates';
import {
  COLOR_TOKENS,
  TEMPLATE_HALF_WIDTH,
  applyPalette,
  isColorToken,
  parseSvgPart,
  partTransform,
  toCharacterPart,
  unsafeReason,
  usedTokens,
} from '../ui/character/svgPart';
import { buildPalette } from '../ui/character/palette';
import { CHARACTER_PARTS, builtInCount, partCount } from '../ui/character/registry';
import { CUSTOM_PARTS, CUSTOM_PART_PROBLEMS, customPartTotal } from '../ui/character/customParts';
import { CHARACTER_PART_CATEGORIES } from '../ui/character/types';

/** 最小の正しいファイル。テストの中で組み立てる（絵ではない） */
function svg(inner: string, attrs = 'data-part="cap_06" data-category="cap" data-label="てすと"'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 320" width="256" height="320">
  <g ${attrs}>${inner}</g>
</svg>`;
}

const SIMPLE = '<rect x="100" y="60" width="56" height="20" fill="token:cap" stroke="token:outline" stroke-width="3"/>';

/* ================================================================
 * A. 正しいファイルは通る
 * ============================================================== */

describe('PHASE4.8-B A. 正しいファイルは通る', () => {
  it('読み取れる', () => {
    const parsed = parseSvgPart(svg(SIMPLE));
    expect('error' in parsed).toBe(false);
  });

  it('名前と種類と表示名が取れる', () => {
    const parsed = parseSvgPart(svg(SIMPLE));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.id).toBe('cap_06');
    expect(parsed.category).toBe('cap');
    expect(parsed.label).toBe('てすと');
  });

  it('表示名が無ければ名前を使う', () => {
    const parsed = parseSvgPart(svg(SIMPLE, 'data-part="cap_07" data-category="cap"'));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.label).toBe('cap_07');
  });

  it('中身だけを取り出す（<svg> や目印は入らない）', () => {
    const parsed = parseSvgPart(svg(SIMPLE));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.body).toContain('<rect');
    expect(parsed.body).not.toContain('<svg');
    expect(parsed.body).not.toContain('viewBox');
  });

  it('CharacterPart になる', () => {
    const parsed = parseSvgPart(svg(SIMPLE));
    if ('error' in parsed) throw new Error(parsed.error);
    const part = toCharacterPart(parsed);
    expect(part.id).toBe('cap_06');
    expect(part.category).toBe('cap');
    expect(typeof part.render).toBe('function');
  });

  it('目印のコメントを絵だと思い込まない', () => {
    /*
     * テンプレートには説明のコメントが入っていて、
     * その中にも「<g data-part ...>」という**文字**が出てくる。
     * コメントを外さずに探すと説明のほうを拾う（実際にそうなった）。
     */
    const withComment = `<?xml version="1.0"?>
<!-- 書き方: <g data-part="..." data-category="..."> の中に描く -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 320">
  <g data-part="cap_08" data-category="cap" data-label="本物">${SIMPLE}</g>
</svg>`;
    const parsed = parseSvgPart(withComment);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.id).toBe('cap_08');
    expect(parsed.body).toContain('<rect');
  });

  it('SVGの名札（xmlns）を外部URLとして弾かない', () => {
    expect(unsafeReason('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
  });
});

/* ================================================================
 * B. 規格から外れたものは止まる
 * ============================================================== */

describe('PHASE4.8-B B. 外れたものは止まる', () => {
  const rejected = (source: string): string => {
    const parsed = parseSvgPart(source);
    if (!('error' in parsed)) throw new Error('通ってしまいました');
    return parsed.error;
  };

  it('viewBox が無いと止まる', () => {
    expect(rejected('<svg><g data-part="a_01" data-category="cap"></g></svg>')).toContain('viewBox');
  });

  it('viewBox が違うと止まる', () => {
    const source = svg(SIMPLE).replace('0 0 256 320', '0 0 512 640');
    expect(rejected(source)).toContain('viewBox');
  });

  it('data-part が無いと止まる', () => {
    expect(
      rejected(`<svg viewBox="0 0 256 320"><g data-category="cap">${SIMPLE}</g></svg>`),
    ).toContain('data-part');
  });

  it('data-category が無いと止まる', () => {
    expect(rejected(svg(SIMPLE, 'data-part="cap_06"'))).toContain('data-category');
  });

  it('script は止まる', () => {
    expect(rejected(svg(`${SIMPLE}<script>alert(1)</script>`))).toContain('script');
  });

  it('外部画像は止まる', () => {
    expect(rejected(svg('<image x="0" y="0" width="10" height="10"/>'))).toContain('image');
  });

  it('外部URLは止まる', () => {
    expect(rejected(svg('<rect fill="token:cap" data-src="https://example.com/a.png"/>'))).toContain(
      '外部URL',
    );
  });

  it('イベント属性は止まる', () => {
    expect(rejected(svg('<rect onclick="x()" fill="token:cap"/>'))).toContain('イベント属性');
  });

  it('url(...) は止まる', () => {
    expect(rejected(svg('<rect fill="url(#a)"/>'))).toContain('url');
  });

  it('style タグは止まる', () => {
    expect(rejected(svg('<style>rect{fill:red}</style>'))).toContain('style');
  });

  it('use は止まる', () => {
    expect(rejected(svg('<use x="0"/>'))).toContain('use');
  });

  it('foreignObject は止まる', () => {
    expect(rejected(svg('<foreignObject><div/></foreignObject>'))).toContain('foreignObject');
  });

  it('href は止まる', () => {
    expect(rejected(svg('<a href="x"><rect/></a>'))).toContain('href');
  });

  it('危ないものが1つでもあれば理由が返る', () => {
    for (const bad of ['<script/>', '<image/>', '<use/>', '<style/>', 'onclick="x"', 'https://x.test']) {
      expect(unsafeReason(bad), bad).not.toBeNull();
    }
  });
});

/* ================================================================
 * C. 色は名前で入れ替わる
 * ============================================================== */

describe('PHASE4.8-B C. 色', () => {
  const palette = buildPalette({ skin: 2, hairColor: 1 });

  it('名前が実際の色に置き換わる', () => {
    const out = applyPalette('<rect fill="token:skin" stroke="token:outline"/>', palette);
    expect(out).toContain(palette.skin);
    expect(out).toContain(palette.outline);
    expect(out).not.toContain('token:');
  });

  it('肌の色が違えば結果も違う（選手ごとに肌が変わる）', () => {
    const light = applyPalette('<rect fill="token:skin"/>', buildPalette({ skin: 0, hairColor: 0 }));
    const dark = applyPalette('<rect fill="token:skin"/>', buildPalette({ skin: 7, hairColor: 0 }));
    expect(light).not.toBe(dark);
  });

  it('球団色が帽子に入る', () => {
    const teamed = buildPalette({ skin: 2, hairColor: 1, teamColor: '#c8102e' });
    expect(applyPalette('<rect fill="token:cap"/>', teamed)).toContain('#c8102e');
  });

  it('知らない名前はそのまま残す（検査が拾えるように）', () => {
    expect(applyPalette('<rect fill="token:banana"/>', palette)).toContain('token:banana');
  });

  it('使われている名前を数え上げられる', () => {
    const tokens = usedTokens('<rect fill="token:skin" stroke="token:outline"/><circle fill="token:skin"/>');
    expect(tokens.sort()).toEqual(['outline', 'skin']);
  });

  it('使ってよい名前がパレットに実在する', () => {
    for (const token of COLOR_TOKENS) {
      expect(isColorToken(token)).toBe(true);
      expect(typeof palette[token], token).toBe('string');
      expect(palette[token], token).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });
});

/* ================================================================
 * D. 位置は自動で合う（§4）
 * ============================================================== */

describe('PHASE4.8-B D. 位置の追従', () => {
  const base = CHARACTER_GUIDES;
  const baseAnchors = anchorsFrom(base);

  it('基準の頭では何もずらさない', () => {
    expect(partTransform('eye', base, baseAnchors)).toBeNull();
    expect(partTransform('mouth', base, baseAnchors)).toBeNull();
  });

  it('顔が縦に伸びると、口も鼻もついていく', () => {
    const tall = adjustGuides(base, { faceScaleY: 1.14, chinShift: 4 });
    const anchors = anchorsFrom(tall);
    expect(partTransform('mouth', tall, anchors)).toContain('translate');
    expect(partTransform('nose', tall, anchors)).toContain('translate');
  });

  it('首から下は頭の形で動かない（体との接続が壊れない）', () => {
    for (const scale of [0.9, 1, 1.2]) {
      const guides = adjustGuides(base, { faceScaleY: scale });
      const anchors = anchorsFrom(guides);
      expect(partTransform('body', guides, anchors), `scale ${scale}`).toBeNull();
      expect(partTransform('uniform', guides, anchors), `scale ${scale}`).toBeNull();
    }
  });

  it('髪・耳・帽子は頭の幅についていく', () => {
    const narrow = { ...baseAnchors, rightTemple: { x: base.centerX + 40, y: 113 } };
    for (const category of ['hairFront', 'hairBack', 'cap', 'ear'] as const) {
      const transform = partTransform(category, base, narrow);
      expect(transform, category).toContain('scale');
    }
  });

  it('目・鼻・口は頭の幅についていかない（顔が横に伸びない）', () => {
    const wide = { ...baseAnchors, rightTemple: { x: base.centerX + 80, y: 113 } };
    for (const category of ['eye', 'nose', 'mouth', 'eyebrow'] as const) {
      const transform = partTransform(category, base, wide);
      expect(transform ?? '', category).not.toContain('scale');
    }
  });

  it('幅が半分なら横も半分になる', () => {
    const half = {
      ...baseAnchors,
      rightTemple: { x: base.centerX + TEMPLATE_HALF_WIDTH / 2, y: 113 },
    };
    expect(partTransform('cap', base, half)).toContain('scale(0.5 1)');
  });

  it('伸び縮みしても顔の中心はずれない', () => {
    const narrow = { ...baseAnchors, rightTemple: { x: base.centerX + 40, y: 113 } };
    const transform = partTransform('cap', base, narrow) ?? '';
    // 中心へ寄せて → 伸ばして → 戻す、の3つが揃っていること
    expect(transform).toContain(`translate(${base.centerX} 0)`);
    expect(transform).toContain(`translate(${-base.centerX} 0)`);
  });

  it('回転は入れない（原因の分からない傾きを作らない）', () => {
    const odd = adjustGuides(base, { faceScaleY: 1.2, chinShift: 6 });
    for (const category of CHARACTER_PART_CATEGORIES) {
      const transform = partTransform(category, odd, anchorsFrom(odd)) ?? '';
      expect(transform, category).not.toContain('rotate');
      expect(transform, category).not.toContain('skew');
    }
  });
});

/* ================================================================
 * E. 頭は自分の形を申告する（§5 の一方通行）
 * ============================================================== */

describe('PHASE4.8-B E. 頭の申告', () => {
  const head = (attrs: string) =>
    parseSvgPart(svg('<circle cx="128" cy="113" r="60" fill="token:skin"/>', attrs));

  it('data-half-width から耳とこめかみのアンカーを作る', () => {
    const parsed = head('data-part="head_06" data-category="head" data-half-width="55"');
    if ('error' in parsed) throw new Error(parsed.error);
    const part = toCharacterPart(parsed);
    const own = part.anchorsFor?.(CHARACTER_GUIDES);
    expect(own?.rightTemple?.x).toBe(CHARACTER_GUIDES.centerX + 55);
    expect(own?.leftTemple?.x).toBe(CHARACTER_GUIDES.centerX - 55);
    // 耳は輪郭のすぐ内側から生える
    expect(own?.rightEar?.x).toBe(CHARACTER_GUIDES.centerX + 53);
  });

  it('data-face-scale-y と data-chin-shift が基準線の調整になる', () => {
    const parsed = head(
      'data-part="head_07" data-category="head" data-half-width="60" data-face-scale-y="1.1" data-chin-shift="3"',
    );
    if ('error' in parsed) throw new Error(parsed.error);
    const part = toCharacterPart(parsed);
    expect(part.guideAdjustment).toEqual({ faceScaleY: 1.1, chinShift: 3 });
  });

  it('指定が無ければ調整も付けない', () => {
    const parsed = head('data-part="head_08" data-category="head" data-half-width="60"');
    if ('error' in parsed) throw new Error(parsed.error);
    expect(toCharacterPart(parsed).guideAdjustment).toBeUndefined();
  });

  it('頭以外は自分の形を申告できない', () => {
    const parsed = parseSvgPart(
      svg(SIMPLE, 'data-part="cap_06" data-category="cap" data-half-width="80"'),
    );
    if ('error' in parsed) throw new Error(parsed.error);
    const part = toCharacterPart(parsed);
    expect(part.anchorsFor).toBeUndefined();
    expect(part.guideAdjustment).toBeUndefined();
  });

  it('左右のアンカーが中心から同じだけ離れる', () => {
    const parsed = head('data-part="head_09" data-category="head" data-half-width="58"');
    if ('error' in parsed) throw new Error(parsed.error);
    const own = toCharacterPart(parsed).anchorsFor!(CHARACTER_GUIDES);
    const cx = CHARACTER_GUIDES.centerX;
    expect(cx - own.leftTemple!.x).toBe(own.rightTemple!.x - cx);
    expect(cx - own.leftEar!.x).toBe(own.rightEar!.x - cx);
  });
});

/* ================================================================
 * F. 書き方の見本が規格を満たしている
 * ============================================================== */

describe('PHASE4.8-B F. 見本', () => {
  // 見本はプロジェクトの中にあるので、読み込みの仕組みで取る（node:fs を使わない）
  const examples = import.meta.glob('../../character-template/examples/*.svg', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;
  const example = Object.values(examples)[0];

  it('見本が1枚ある', () => {
    expect(Object.keys(examples).length).toBe(1);
    expect(typeof example).toBe('string');
  });

  it('見本がそのまま読める', () => {
    const parsed = parseSvgPart(example);
    expect('error' in parsed ? parsed.error : 'ok').toBe('ok');
  });

  it('見本がパーツになる', () => {
    const parsed = parseSvgPart(example);
    if ('error' in parsed) throw new Error(parsed.error);
    const part = toCharacterPart(parsed);
    expect(part.category).toBe('head');
    expect(part.anchorsFor).toBeDefined();
  });

  it('見本は色を直に書いていない', () => {
    const parsed = parseSvgPart(example);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.body).not.toMatch(/(?:fill|stroke)\s*=\s*"#/);
  });
});

/* ================================================================
 * G. 取り込み経路（custom/）
 * ============================================================== */

describe('PHASE4.8-B G. 取り込み経路', () => {
  it('置き場所が種類ごとに用意されている', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      expect(CUSTOM_PARTS[category], category).toBeDefined();
      expect(Array.isArray(CUSTOM_PARTS[category]), category).toBe(true);
    }
  });

  it('自作パーツは、はじめから入っているものの**後ろ**に並ぶ', () => {
    /*
     * 前に足すと、既存の選手の顔が全部ずれる。
     * 後ろに足す限り、足しても既存の番号は動かない。
     */
    for (const category of CHARACTER_PART_CATEGORIES) {
      const builtIn = builtInCount(category);
      const all = CHARACTER_PARTS[category];
      expect(all.length, category).toBe(builtIn + CUSTOM_PARTS[category].length);
      for (let i = 0; i < builtIn; i++) {
        expect(all[i].id, `${category}[${i}]`).toBe(all[i].id);
      }
    }
  });

  it('パーツ数は、はじめから入っているもの以上', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      expect(partCount(category), category).toBeGreaterThanOrEqual(builtInCount(category));
    }
  });

  it('読めなかったファイルがあっても数え上げられる（起動は止まらない）', () => {
    expect(Array.isArray(CUSTOM_PART_PROBLEMS)).toBe(true);
    for (const problem of CUSTOM_PART_PROBLEMS) {
      expect(typeof problem.file).toBe('string');
      expect(typeof problem.reason).toBe('string');
    }
  });

  it('自作パーツの合計が数えられる', () => {
    expect(customPartTotal()).toBe(
      CHARACTER_PART_CATEGORIES.reduce((sum, c) => sum + CUSTOM_PARTS[c].length, 0),
    );
  });

  it('自作パーツにも id と表示名がある', () => {
    for (const category of CHARACTER_PART_CATEGORIES) {
      for (const part of CUSTOM_PARTS[category]) {
        expect(part.id.length, part.id).toBeGreaterThan(0);
        expect(part.label.length, part.id).toBeGreaterThan(0);
        expect(part.category, part.id).toBe(category);
      }
    }
  });
});

/* ================================================================
 * H. 制作環境がゲームに触っていない
 * ============================================================== */

describe('PHASE4.8-B H. ゲームに触らない', () => {
  const sources = import.meta.glob(
    ['../ui/character/svgPart.tsx', '../ui/character/customParts.ts'],
    { eager: true, query: '?raw', import: 'default' },
  ) as Record<string, string>;

  const code = Object.fromEntries(
    Object.entries(sources).map(([file, text]) => [
      file,
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '),
    ]),
  );

  it('読み込めている', () => {
    expect(Object.keys(code).length).toBe(2);
  });

  it('乱数も時刻も使わない', () => {
    for (const [file, text] of Object.entries(code)) {
      expect(text.includes('Math.random'), file).toBe(false);
      expect(text.includes('Date.now'), file).toBe(false);
      expect(text.includes('new Date'), file).toBe(false);
    }
  });

  it('実行時に取りに行かない（fetch なし）', () => {
    for (const [file, text] of Object.entries(code)) {
      expect(text.includes('fetch('), file).toBe(false);
    }
  });

  it('同じファイルからは必ず同じパーツになる', () => {
    const source = svg(SIMPLE);
    const a = parseSvgPart(source);
    const b = parseSvgPart(source);
    expect(a).toEqual(b);
  });
});
