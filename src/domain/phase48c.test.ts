/**
 * CHARACTER CREATION TEMPLATE の検査（§21・§22）。
 *
 * 確かめたいのは1つだけ。
 * **12枚が本当に同じ座標系に乗っているか。**
 *
 * ここが崩れていると、絵をいくら丁寧に描いても重ねた瞬間にずれます。
 * しかも「重ねるまで気づかない」ので、いちばん高くつきます。
 * だから機械で毎回見ます。
 *
 * 絵の good / bad は測りません。測れませんし、測るものでもありません。
 */
import { describe, it, expect } from 'vitest';
import {
  CENTER_X,
  GUIDES,
  GUIDE_RANGES,
  HEIGHT,
  LAYERS,
  VIEW_BOX,
  WIDTH,
  fileNameOf,
  groupIdOf,
  type GuideName,
} from '../../scripts/character/templateSpec';
import { checkSvg, hasDrawing } from '../../scripts/character/templateCheck';

/** character-template/ の中身を読み込む（node:fs を使わない） */
const files = import.meta.glob('../../character-template/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const preview = import.meta.glob('../../character-template/preview/index.html', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function read(name: string): string {
  const key = Object.keys(files).find((k) => k.endsWith('/' + name));
  if (!key) throw new Error(`${name} がありません`);
  return files[key];
}

const LAYER_FILES = LAYERS.map(fileNameOf);

/* ================================================================
 * A. 12レイヤーがそろっている（§5・§20・§22）
 * ============================================================== */

describe('4.8-C A. 12レイヤー', () => {
  it('12枚ある', () => {
    expect(LAYERS.length).toBe(12);
  });

  it('順番が 01〜12 で、変わっていない（§5）', () => {
    expect(LAYERS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('ファイル名が仕様どおり', () => {
    expect(LAYER_FILES).toEqual([
      '01_body.svg',
      '02_neck.svg',
      '03_ears.svg',
      '04_head.svg',
      '05_hair_back.svg',
      '06_eyes.svg',
      '07_eyebrows.svg',
      '08_nose.svg',
      '09_mouth.svg',
      '10_hair_front.svg',
      '11_cap.svg',
      '12_details.svg',
    ]);
  });

  it('12枚すべてが実在する（パーツ欠落チェック）', () => {
    for (const name of LAYER_FILES) {
      expect(() => read(name), name).not.toThrow();
    }
  });

  it('GUIDE.svg がある（§8）', () => {
    expect(() => read('GUIDE.svg')).not.toThrow();
  });

  it('レイヤー名が重複していない', () => {
    expect(new Set(LAYERS.map((l) => l.slug)).size).toBe(LAYERS.length);
  });

  it('それぞれに専用の g がある', () => {
    for (const layer of LAYERS) {
      expect(read(fileNameOf(layer)), layer.slug).toContain(`id="${groupIdOf(layer)}"`);
    }
  });
});

/* ================================================================
 * B. 同じ座標系（§3・§21-1・§21-2・§21-9）
 * ============================================================== */

describe('4.8-C B. 同じ座標系', () => {
  const all = ['GUIDE.svg', ...LAYER_FILES];

  it('すべて 256 x 320（§21-1）', () => {
    for (const name of all) {
      const svg = read(name);
      expect(svg, name).toContain(`width="${WIDTH}"`);
      expect(svg, name).toContain(`height="${HEIGHT}"`);
    }
  });

  it('すべて viewBox が "0 0 256 320"（§21-2）', () => {
    for (const name of all) {
      expect(read(name), name).toContain(`viewBox="${VIEW_BOX}"`);
    }
  });

  it('12枚の viewBox が1つに揃っている（重ねたとき位置が一致する / §21-9）', () => {
    const boxes = new Set(
      LAYER_FILES.map((name) => /viewBox="([^"]*)"/.exec(read(name))![1]),
    );
    expect(boxes.size).toBe(1);
    expect([...boxes][0]).toBe(VIEW_BOX);
  });

  it('別のキャンバスサイズが混ざっていない', () => {
    for (const name of all) {
      const svg = read(name);
      for (const bad of ['300 300', '512 512', '1024 1280', '0 0 512 512']) {
        expect(svg.includes(bad), `${name} に ${bad}`).toBe(false);
      }
    }
  });
});

/* ================================================================
 * C. 透明背景（§7・§21-3）
 * ============================================================== */

describe('4.8-C C. 透明背景', () => {
  it('全面を塗る rect が無い', () => {
    for (const name of LAYER_FILES) {
      const body = read(name).replace(/<!--[\s\S]*?-->/g, '');
      expect(
        /<rect\b[^>]*width\s*=\s*"256"[^>]*height\s*=\s*"320"[^>]*fill\s*=\s*"(?!none)/.test(body),
        name,
      ).toBe(false);
    }
  });

  it('svg に background が付いていない', () => {
    for (const name of LAYER_FILES) {
      expect(/<svg\b[^>]*style\s*=\s*"[^"]*background/.test(read(name)), name).toBe(false);
    }
  });

  it('白い塗りつぶしの背景を書いていない', () => {
    for (const name of LAYER_FILES) {
      const body = read(name).replace(/<!--[\s\S]*?-->/g, '');
      expect(body.includes('fill="white"'), name).toBe(false);
      expect(body.includes('fill="#fff"'), name).toBe(false);
      expect(body.includes('fill="#ffffff"'), name).toBe(false);
    }
  });
});

/* ================================================================
 * D. 外部参照と画像（§16・§21-4〜6）
 * ============================================================== */

describe('4.8-C D. 外部参照と画像', () => {
  const all = ['GUIDE.svg', ...LAYER_FILES];

  it('外部URLが無い（§21-4）', () => {
    for (const name of all) {
      const body = read(name)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\sxmlns(:[A-Za-z][\w.-]*)?\s*=\s*"https?:\/\/www\.w3\.org\/[^"]*"/g, ' ');
      expect(/https?:\/\//.test(body), name).toBe(false);
    }
  });

  it('raster画像が無い（§21-5）', () => {
    for (const name of all) {
      expect(/<image\b/i.test(read(name)), name).toBe(false);
    }
  });

  it('base64画像が無い（§21-6）', () => {
    for (const name of all) {
      expect(/data:image\//i.test(read(name)), name).toBe(false);
    }
  });

  it('script とイベント属性が無い', () => {
    for (const name of all) {
      const body = read(name).replace(/<!--[\s\S]*?-->/g, '');
      expect(/<script/i.test(body), name).toBe(false);
      expect(/\bon[a-z]+\s*=/i.test(body), name).toBe(false);
    }
  });
});

/* ================================================================
 * E. 自動補正をしていない（§13・§21-7・§21-8）
 * ============================================================== */

describe('4.8-C E. 自動補正なし', () => {
  it('一番外の g に scale / matrix が無い（勝手に縮尺を変えない / §21-7）', () => {
    for (const name of LAYER_FILES) {
      const body = read(name).replace(/<!--[\s\S]*?-->/g, '');
      const g = /<g\b([^>]*)>/.exec(body);
      expect(/(scale|matrix)/.test(g ? g[1] : ''), name).toBe(false);
    }
  });

  it('一番外の g に translate が無い（勝手に位置を補正しない / §21-8）', () => {
    for (const name of LAYER_FILES) {
      const body = read(name).replace(/<!--[\s\S]*?-->/g, '');
      const g = /<g\b([^>]*)>/.exec(body);
      expect(/translate/.test(g ? g[1] : ''), name).toBe(false);
    }
  });

  it('検査そのものが scale を見つけられる（検査が効いていることの確認）', () => {
    const bad = `<svg viewBox="${VIEW_BOX}" width="256" height="320"><g transform="scale(0.5)"></g></svg>`;
    const found = checkSvg(bad).some((f) => f.message.includes('scale'));
    expect(found).toBe(true);
  });
});

/* ================================================================
 * F. 検査そのものが正しく効く
 * ============================================================== */

describe('4.8-C F. 検査が効いている', () => {
  const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}" width="256" height="320"><g id="x"></g></svg>`;

  it('正しいSVGは素通りする', () => {
    expect(checkSvg(good)).toEqual([]);
  });

  it('サイズ違いを止める', () => {
    const bad = good.replace('width="256"', 'width="512"');
    expect(checkSvg(bad).some((f) => f.message.includes('256x320'))).toBe(true);
  });

  it('viewBox違いを止める', () => {
    const bad = good.replace(VIEW_BOX, '0 0 512 640');
    expect(checkSvg(bad).some((f) => f.message.includes('viewBox'))).toBe(true);
  });

  it('背景を止める', () => {
    const bad = good.replace('<g id="x">', '<rect width="256" height="320" fill="white"/><g id="x">');
    expect(checkSvg(bad).some((f) => f.message.includes('背景'))).toBe(true);
  });

  it('画像の埋め込みを止める', () => {
    expect(checkSvg(good.replace('<g id="x">', '<image /><g id="x">')).length).toBeGreaterThan(0);
    expect(checkSvg(good.replace('<g id="x">', '<rect fill="data:image/png;base64,AA"/><g id="x">')).length)
      .toBeGreaterThan(0);
  });

  it('外部URLを止める（ただし xmlns は通す）', () => {
    expect(checkSvg(good)).toEqual([]);
    const bad = good.replace('<g id="x">', '<g id="x" data-src="https://example.com/a.png">');
    expect(checkSvg(bad).some((f) => f.message.includes('外部URL'))).toBe(true);
  });

  it('中身があるかどうかを見分けられる', () => {
    expect(hasDrawing(good)).toBe(false);
    expect(hasDrawing(good.replace('<g id="x">', '<g id="x"><circle r="5"/>'))).toBe(true);
    // コメントだけなら「空」
    expect(hasDrawing(good.replace('<g id="x">', '<g id="x"><!-- ここに描く -->'))).toBe(false);
  });
});

/* ================================================================
 * G. 基準座標（§4）
 * ============================================================== */

describe('4.8-C G. 基準座標', () => {
  it('中心が 128', () => {
    expect(CENTER_X).toBe(WIDTH / 2);
  });

  it('基準線が §4 の範囲に収まっている', () => {
    for (const [name, value] of Object.entries(GUIDES) as Array<[GuideName, number]>) {
      const [lo, hi] = GUIDE_RANGES[name];
      expect(value, name).toBeGreaterThanOrEqual(lo);
      expect(value, name).toBeLessThanOrEqual(hi);
    }
  });

  it('基準線が上から下へ正しい順に並んでいる', () => {
    const order = [
      GUIDES.HEAD_TOP,
      GUIDES.BROW_LINE,
      GUIDES.EYE_LINE,
      GUIDES.NOSE_LINE,
      GUIDES.MOUTH_LINE,
      GUIDES.CHIN_LINE,
      GUIDES.NECK_LINE,
      GUIDES.SHOULDER_LINE,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `${i}番目`).toBeGreaterThan(order[i - 1]);
    }
  });

  it('すべてキャンバスの中に収まっている', () => {
    for (const value of Object.values(GUIDES)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(HEIGHT);
    }
  });

  it('GUIDE.svg に基準線がすべて入っている', () => {
    const svg = read('GUIDE.svg');
    for (const [name, value] of Object.entries(GUIDES)) {
      expect(svg, name).toContain(`${name} ${value}`);
    }
    expect(svg).toContain(`CENTER_X ${CENTER_X}`);
  });

  it('目安の範囲がキャンバスの中に収まっている', () => {
    for (const layer of LAYERS) {
      expect(layer.area.x[0], layer.slug).toBeGreaterThanOrEqual(0);
      expect(layer.area.x[1], layer.slug).toBeLessThanOrEqual(WIDTH);
      expect(layer.area.y[0], layer.slug).toBeGreaterThanOrEqual(0);
      expect(layer.area.y[1], layer.slug).toBeLessThanOrEqual(HEIGHT);
      expect(layer.area.x[1], layer.slug).toBeGreaterThan(layer.area.x[0]);
      expect(layer.area.y[1], layer.slug).toBeGreaterThan(layer.area.y[0]);
    }
  });
});

/* ================================================================
 * H. preview（§9・§10・§11・§21-10）
 * ============================================================== */

describe('4.8-C H. preview', () => {
  const html = Object.values(preview)[0];

  it('preview が書き出されている', () => {
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(1000);
  });

  it('12レイヤーすべての切り替えがある（§9）', () => {
    for (const layer of LAYERS) {
      expect(html, layer.slug).toContain(`data-layer="${layer.order}"`);
    }
  });

  it('GUIDE とグリッドの切り替えがある（§8・§10）', () => {
    expect(html).toContain('btn-guide');
    expect(html).toContain('btn-grid');
    expect(html).toContain('GRID 10px');
  });

  it('bounding box の表示がある（§11）', () => {
    expect(html).toContain('data-bbox');
    expect(html).toContain('getBBox');
  });

  it('390x844 の確認ができる（§21-10）', () => {
    expect(html).toContain('390');
    expect(html).toContain('844');
  });

  it('外へ取りに行っていない（中身が埋め込まれている）', () => {
    expect(html.includes('fetch(')).toBe(false);
    expect(/<img\b/i.test(html)).toBe(false);
    expect(html.includes('data:image/')).toBe(false);
  });
});

/* ================================================================
 * I. ゲーム本体に触っていない（§17）
 * ============================================================== */

describe('4.8-C I. ゲームに触らない', () => {
  const sources = import.meta.glob(
    ['../../scripts/character/templateSpec.ts', '../../scripts/character/templateCheck.ts'],
    { eager: true, query: '?raw', import: 'default' },
  ) as Record<string, string>;

  it('制作環境のコードを読み込めている', () => {
    expect(Object.keys(sources).length).toBe(2);
  });

  it('乱数も時刻も使っていない', () => {
    for (const [file, raw] of Object.entries(sources)) {
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
      expect(code.includes('Math.random'), file).toBe(false);
      expect(code.includes('Date.now'), file).toBe(false);
    }
  });

  it('ゲームのコードを読み込んでいない', () => {
    for (const [file, code] of Object.entries(sources)) {
      expect(code.includes('src/domain'), file).toBe(false);
      expect(code.includes('SAVE_VERSION'), file).toBe(false);
      expect(code.includes('rngState'), file).toBe(false);
    }
  });

  it('画像生成まわりを一切呼んでいない（§1・§23）', () => {
    for (const [file, code] of Object.entries(sources)) {
      for (const banned of ['fal.', 'FAL_KEY', 'openai', 'replicate', 'fetch(']) {
        expect(code.toLowerCase().includes(banned.toLowerCase()), `${file} / ${banned}`).toBe(false);
      }
    }
  });
});
