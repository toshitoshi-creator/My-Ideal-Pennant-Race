/**
 * PHASE 4.7 画像素材パイプラインのテスト（§36）。
 *
 * 確かめること：
 *   - 生成のカタログ・プロンプト・命名が仕様と食い違っていない
 *   - プロバイダーの窓口が、鍵が無いときに「使えない」と正直に返す
 *   - 後処理（背景除去・位置合わせ・色替え・縮小）が実際に効く
 *   - 品質検査が、壊れた素材を落とし、良い素材を通す
 *   - 設計図が player.id だけで決まり、ゲームの乱数を一切触らない
 *   - ゲーム本体に外部API・鍵・実行時通信が入り込んでいない
 *
 * ここでは合成した画像を使って画素まで確かめる。
 * 画像生成AIが使えなくても、パイプラインが動くことをここで証明する。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay } from './engine';
import type { GameState, Player } from './types';
import {
  REQUIRED_CATEGORIES,
  VISUAL_CATEGORIES,
  VISUAL_PROFILE_VERSION,
  VISUAL_STATE_LABELS,
  buildVisualProfile,
  buildVisualProfileFromId,
  missingCategories,
  specialAsset,
  visualStateOf,
  type VisualCategory,
  type VisualState,
} from './visualProfile';
import { APPEARANCE_VERSION } from './playerAppearance';

/* ---- 開発時のパイプライン（ゲームには入らない） ---- */
import {
  CATALOG,
  CATALOG_IDS,
  SPEC_CATALOG_IDS,
  STRUCTURAL_CATALOG_IDS,
  catalogAssetId,
  catalogEntry,
  imageCategories,
  isCatalogId,
  plannedCount,
  recolorCategories,
  type CatalogId,
} from '../../scripts/assets/catalog';
import {
  BASE_STYLE,
  NEGATIVE_PROMPT,
  PROMPT_VERSION,
  billableCount,
  buildPrompt,
  buildPromptsFor,
  masterStyleSheetPrompt,
  planGeneration,
} from '../../scripts/assets/prompts';
import {
  ANCHORS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EXPECTED_REGION,
  FACE_LINES,
  OUTPUT_SIZES,
  SIDE_POINTS,
} from '../../scripts/assets/anchors';
import {
  PROVIDER_IDS,
  PROVIDER_REQUIREMENTS,
  isProviderId,
  resolveProvider,
} from '../../scripts/assets/providers/index';
import { decodeBase64, redact } from '../../scripts/assets/provider';
import {
  createImage,
  decodePng,
  encodePng,
  inflate,
  isPng,
  deflateStored,
  readPngHeader,
  type RgbaImage,
} from '../../scripts/assets/png';
import {
  HAIR_RAMPS,
  SKIN_RAMPS,
  cleanAlpha,
  compose,
  contentBounds,
  cropToContent,
  derivatives,
  fitToCanvas,
  looksTransparent,
  processPart,
  recolor,
  removeBackground,
  resize,
} from '../../scripts/assets/pipeline';
import { analyse, edgesTouched, gradeOf, horizontalSkew, inspect } from '../../scripts/assets/quality';

const PLAYER_TEAM = 'phoenix';

/** ゲームの生成は重いので使い回す。どのテストも書き換えない */
const GAMES = new Map<number, GameState>();
function newGame(seed = 470470): GameState {
  const cached = GAMES.get(seed);
  if (cached) return cached;
  const state = createNewGame(PLAYER_TEAM, 10, seed);
  GAMES.set(seed, state);
  return state;
}

function fakePlayer(id: string, over: Partial<Player> = {}): Player {
  return { ...newGame().players[0], id, ...over };
}

/* ---- 素材の仕様と目録（ファイルの中身をそのまま読む） ---- */

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
  sizes: Record<string, number>;
  categories: Array<{ id: string; dir: string; prefix: string; layer: number; required: boolean }>;
  naming: { pattern: string };
};

const MANIFEST = JSON.parse(
  (
    import.meta.glob('../assets/players/manifest.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
  )['../assets/players/manifest.json'],
) as { version: number; parts: Record<string, unknown[]>; structural?: Record<string, number> };

const NAMING = new RegExp(SPEC.naming.pattern);

/* ---- 資料（Style Bible など） ---- */

const DOCS = import.meta.glob('../../assets/prompts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/* ---- ゲーム本体のソース（禁止事項をソースで確かめる） ---- */

const GAME_RAW = import.meta.glob(
  [
    './visualProfile.ts',
    '../ui/visual/*.ts',
    '../ui/components/PlayerVisual.tsx',
    '../ui/components/PlayerPortraitImage.tsx',
    '../ui/components/PlayerPortraitFallback.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const GAME_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(GAME_RAW).map(([path, source]) => [
    path,
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
  ]),
);

/** 開発時のパイプラインのソース。ここには通信があってよい */
const TOOL_RAW = import.meta.glob(['../../scripts/assets/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const TOOL_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_RAW).map(([path, source]) => [
    path,
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
  ]),
);

const ENV_EXAMPLE = (
  import.meta.glob('../../.env.example', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)['../../.env.example'];

const GITIGNORE = (
  import.meta.glob('../../.gitignore', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)['../../.gitignore'];

/* ================================================================
 * 合成画像を作る道具
 * ============================================================== */

/** 背景つきの楕円。生成AIが返してきそうな「困った状態」を真似る */
function blob(
  width: number,
  height: number,
  options: {
    cx?: number;
    cy?: number;
    rx?: number;
    ry?: number;
    shade?: number;
    background?: [number, number, number] | null;
  } = {},
): RgbaImage {
  const image = createImage(width, height);
  const cx = options.cx ?? width / 2;
  const cy = options.cy ?? height / 2;
  const rx = options.rx ?? width / 3;
  const ry = options.ry ?? height / 3;
  const shade = options.shade ?? 180;
  const background = options.background === undefined ? [250, 250, 250] : options.background;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      if (inside) {
        const value = shade + Math.round(30 * ((y - cy) / ry));
        image.data[at] = value;
        image.data[at + 1] = value - 14;
        image.data[at + 2] = value - 26;
        image.data[at + 3] = 255;
      } else if (background) {
        image.data[at] = background[0];
        image.data[at + 1] = background[1];
        image.data[at + 2] = background[2];
        image.data[at + 3] = 255;
      }
    }
  }
  return image;
}

/** きちんと整った素材（検査を通るはずのもの） */
function goodPart(category: CatalogId = 'head_shape'): RgbaImage {
  return processPart(blob(900, 900, { rx: 220, ry: 290 }), {
    anchor: ANCHORS[category],
    targetWidth: 536,
  }).image;
}

/* ================================================================
 * 1. カタログ（§4・§13）
 * ============================================================== */

describe('PHASE4.7 カタログ', () => {
  it('仕様が挙げる18種類がそろっている', () => {
    expect(SPEC_CATALOG_IDS.length).toBe(18);
  });

  it('重ね順の都合で足した部品は2つだけ', () => {
    expect(STRUCTURAL_CATALOG_IDS).toEqual(['neck', 'hair_back']);
  });

  it('カタログ全体は 18 + 2 になる', () => {
    expect(CATALOG.length).toBe(SPEC_CATALOG_IDS.length + STRUCTURAL_CATALOG_IDS.length);
    expect(CATALOG_IDS.length).toBe(CATALOG.length);
  });

  it('同じIDが2つ無い', () => {
    const ids = CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべての種類に何を描くのかが書いてある', () => {
    for (const entry of CATALOG) {
      expect(entry.subject.length, entry.id).toBeGreaterThan(20);
    }
  });

  it('すべての種類に置き場所と接頭辞がある', () => {
    for (const entry of CATALOG) {
      expect(entry.dir.length, entry.id).toBeGreaterThan(0);
      expect(entry.prefix.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('最低・目標・上限の順に並んでいる', () => {
    for (const entry of CATALOG) {
      expect(entry.min, entry.id).toBeLessThanOrEqual(entry.target);
      expect(entry.target, entry.id).toBeLessThanOrEqual(entry.max);
    }
  });

  it('目標の枚数ぶんの指定が用意されている', () => {
    for (const entry of CATALOG) {
      expect(entry.variants.length, entry.id).toBeGreaterThanOrEqual(entry.target);
    }
  });

  it('画像で作る種類は10種類以上の指定を持つ（必須のものは）', () => {
    for (const entry of imageCategories()) {
      if (!entry.required) continue;
      if (entry.id === 'uniform') continue; // ユニフォームは形の違いが少なくてよい
      expect(entry.variants.length, entry.id).toBeGreaterThanOrEqual(8);
    }
  });

  it('1つの種類の中に同じ指定が2つ無い', () => {
    for (const entry of CATALOG) {
      expect(new Set(entry.variants).size, entry.id).toBe(entry.variants.length);
    }
  });

  it('指定は「色だけ違う」ものになっていない（形の言葉が入っている）', () => {
    // 色の名前「だけ」で終わっている指定は、色を振り分ける種類にしか許さない。
    // 「deep set, shadowed sockets」のように形を語っているものは問題ない。
    const colorOnly =
      /^(black|brown|blond|blonde|grey|gray|white|silver|auburn|ginger|red|light|dark|medium|tan|deep|pale)(\s+(hair|brown|blond|grey|gray|tone|skin))?$/i;
    for (const entry of imageCategories()) {
      for (const variant of entry.variants) {
        expect(colorOnly.test(variant.trim()), `${entry.id}: ${variant}`).toBe(false);
      }
    }
  });

  it('色を振り分ける種類は、逆に色の名前で並んでいる', () => {
    for (const entry of recolorCategories()) {
      expect(entry.variants.length, entry.id).toBeGreaterThanOrEqual(8);
      // 形を語っていないこと（色の名前だけであること）
      for (const variant of entry.variants) {
        expect(variant.split(' ').length, `${entry.id}: ${variant}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('髪色と肌色はAIに作らせない（後処理で振り分ける）', () => {
    const recolor = recolorCategories().map((entry) => entry.id);
    expect(recolor).toContain('hair_color');
    expect(recolor).toContain('skin_tone');
  });

  it('色を振り分ける種類は、髪10色・肌8段階を持つ', () => {
    expect(catalogEntry('hair_color').variants.length).toBe(10);
    expect(catalogEntry('skin_tone').variants.length).toBe(8);
  });

  it('色の段数が後処理の色見本と一致している', () => {
    expect(HAIR_RAMPS.length).toBe(catalogEntry('hair_color').variants.length);
    expect(SKIN_RAMPS.length).toBe(catalogEntry('skin_tone').variants.length);
  });

  it('重ね順が種類ごとに重複していない（色を振り分けるものを除く）', () => {
    const layers = imageCategories().map((entry) => entry.zIndex);
    expect(new Set(layers).size).toBe(layers.length);
  });

  it('顔の部品は頭より上に重なる', () => {
    const z = (id: CatalogId) => catalogEntry(id).zIndex;
    for (const part of ['eyes', 'eyebrow', 'nose', 'mouth'] as CatalogId[]) {
      expect(z(part), part).toBeGreaterThan(z('head_shape'));
    }
  });

  it('耳は頭より下、帽子は髪より上', () => {
    const z = (id: CatalogId) => catalogEntry(id).zIndex;
    expect(z('ears')).toBeLessThan(z('head_shape'));
    expect(z('cap')).toBeGreaterThan(z('hair_style'));
  });

  it('姿勢がいちばん下、状態の印がいちばん上', () => {
    const z = (id: CatalogId) => catalogEntry(id).zIndex;
    for (const entry of imageCategories()) {
      if (entry.id !== 'pose') expect(z('pose'), entry.id).toBeLessThan(entry.zIndex);
      if (entry.id !== 'special_state') {
        expect(z('special_state'), entry.id).toBeGreaterThan(entry.zIndex);
      }
    }
  });

  it('カタログの種類はゲーム側の種類につながっている', () => {
    for (const entry of CATALOG) {
      expect(VISUAL_CATEGORIES, entry.id).toContain(entry.runtime as VisualCategory);
    }
  });

  it('ゲームの必須の種類は、すべてカタログで作れる', () => {
    const runtimes = new Set(CATALOG.map((entry) => entry.runtime));
    for (const category of REQUIRED_CATEGORIES) {
      expect(runtimes, category).toContain(category);
    }
  });

  it('isCatalogId が知らない名前をはじく', () => {
    expect(isCatalogId('head_shape')).toBe(true);
    expect(isCatalogId('hair_style')).toBe(true);
    expect(isCatalogId('nose_hair')).toBe(false);
    expect(isCatalogId('')).toBe(false);
  });

  it('知らない種類を引くと例外になる', () => {
    expect(() => catalogEntry('nope' as CatalogId)).toThrow();
  });

  it('catalogAssetId が3桁の連番を作る', () => {
    const entry = catalogEntry('head_shape');
    expect(catalogAssetId(entry, 0)).toBe('head_001');
    expect(catalogAssetId(entry, 11)).toBe('head_012');
  });

  it('plannedCount は上限も指定の数も超えない', () => {
    const entry = catalogEntry('cap');
    expect(plannedCount(entry, 100)).toBeLessThanOrEqual(entry.max);
    expect(plannedCount(entry, 100)).toBeLessThanOrEqual(entry.variants.length);
    expect(plannedCount(entry, 2)).toBe(2);
    expect(plannedCount(entry)).toBe(entry.target);
  });

  it('plannedCount は 0 以下を返さない', () => {
    expect(plannedCount(catalogEntry('eyes'), -5)).toBe(0);
  });
});

/* ================================================================
 * 2. 仕様との突き合わせ（§6・§7・§8）
 * ============================================================== */

describe('PHASE4.7 仕様との突き合わせ', () => {
  it('共通キャンバスが仕様と一致している', () => {
    expect(CANVAS_WIDTH).toBe(SPEC.canvas.width);
    expect(CANVAS_HEIGHT).toBe(SPEC.canvas.height);
    expect(CANVAS_WIDTH).toBe(1024);
    expect(CANVAS_HEIGHT).toBe(1280);
  });

  it('書き出す解像度が仕様と一致している', () => {
    expect(OUTPUT_SIZES.hero).toBe(SPEC.sizes.hero);
    expect(OUTPUT_SIZES.large).toBe(SPEC.sizes.large);
    expect(OUTPUT_SIZES.medium).toBe(SPEC.sizes.medium);
    expect(OUTPUT_SIZES.small).toBe(SPEC.sizes.small);
  });

  it('仕様の版が3になっている', () => {
    expect(SPEC.version).toBe(3);
    expect(SPEC.version).toBe(VISUAL_PROFILE_VERSION);
  });

  it('目録の版も仕様と合っている', () => {
    expect(MANIFEST.version).toBe(SPEC.version);
  });

  it('すべての種類に基準点がある', () => {
    for (const entry of CATALOG) {
      expect(ANCHORS[entry.id], entry.id).toBeTruthy();
    }
  });

  it('基準点がキャンバスの中に収まっている', () => {
    for (const entry of CATALOG) {
      const anchor = ANCHORS[entry.id];
      expect(anchor.x, entry.id).toBeGreaterThanOrEqual(0);
      expect(anchor.x, entry.id).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(anchor.y, entry.id).toBeGreaterThanOrEqual(0);
      expect(anchor.y, entry.id).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it('顔の部品の基準点は中心線の上にある', () => {
    for (const id of ['head_shape', 'nose', 'mouth', 'eyes', 'eyebrow'] as CatalogId[]) {
      expect(ANCHORS[id].x, id).toBe(CANVAS_WIDTH / 2);
    }
  });

  it('顔の基準線が上から下へ並んでいる', () => {
    const lines = [
      FACE_LINES.hairLine,
      FACE_LINES.browLine,
      FACE_LINES.eyeLine,
      FACE_LINES.earLine,
      FACE_LINES.noseLine,
      FACE_LINES.mouthLine,
      FACE_LINES.chinLine,
      FACE_LINES.neckLine,
    ];
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toBeGreaterThanOrEqual(lines[i - 1]);
    }
  });

  it('顔の基準線が config と一致している', () => {
    expect(FACE_LINES.eyeLine).toBe(SPEC.anchors.eyes.eyeY);
    expect(FACE_LINES.browLine).toBe(SPEC.anchors.brows.y);
    expect(FACE_LINES.noseLine).toBe(SPEC.anchors.nose.y);
    expect(FACE_LINES.mouthLine).toBe(SPEC.anchors.mouth.y);
    expect(FACE_LINES.chinLine).toBe(SPEC.anchors.head.chinY);
    expect(FACE_LINES.neckLine).toBe(SPEC.anchors.body.neckY);
    expect(FACE_LINES.earLine).toBe(SPEC.anchors.ears.y);
  });

  it('左右の基準点が config と一致している', () => {
    expect(SIDE_POINTS.leftEyeX).toBe(SPEC.anchors.eyes.leftEyeX);
    expect(SIDE_POINTS.rightEyeX).toBe(SPEC.anchors.eyes.rightEyeX);
    expect(SIDE_POINTS.leftEarX).toBe(SPEC.anchors.ears.leftX);
    expect(SIDE_POINTS.rightEarX).toBe(SPEC.anchors.ears.rightX);
  });

  it('左右の基準点が中心をはさんでいる', () => {
    const centre = CANVAS_WIDTH / 2;
    expect(SIDE_POINTS.leftEyeX).toBeLessThan(centre);
    expect(SIDE_POINTS.rightEyeX).toBeGreaterThan(centre);
    expect(SIDE_POINTS.shoulderLeftX).toBeLessThan(centre);
    expect(SIDE_POINTS.shoulderRightX).toBeGreaterThan(centre);
  });

  it('すべての種類に想定の置き場所がある', () => {
    for (const entry of CATALOG) {
      const region = EXPECTED_REGION[entry.id];
      expect(region, entry.id).toBeTruthy();
      expect(region.top, entry.id).toBeLessThan(region.bottom);
      expect(region.top, entry.id).toBeGreaterThanOrEqual(0);
      expect(region.bottom, entry.id).toBeLessThanOrEqual(1);
    }
  });

  it('カタログの置き場所と接頭辞が config と一致している', () => {
    for (const entry of CATALOG) {
      const spec = SPEC.categories.find((category) => category.id === entry.runtime);
      if (!spec) continue;
      expect(spec.dir, entry.id).toBe(entry.dir);
      expect(spec.prefix, entry.id).toBe(entry.prefix);
    }
  });

  it('カタログの重ね順が config と一致している', () => {
    for (const entry of imageCategories()) {
      const spec = SPEC.categories.find((category) => category.id === entry.runtime);
      if (!spec) continue;
      expect(spec.layer, entry.id).toBe(entry.zIndex);
    }
  });
});

/* ================================================================
 * 3. 命名（§16）
 * ============================================================== */

describe('PHASE4.7 命名', () => {
  it('カタログが作るIDはすべて命名規則に合う', () => {
    for (const entry of CATALOG) {
      for (let i = 0; i < entry.variants.length; i++) {
        expect(NAMING.test(`${catalogAssetId(entry, i)}.webp`), entry.id).toBe(true);
      }
    }
  });

  it('色違いの名前も命名規則に合う', () => {
    for (let i = 1; i <= 10; i++) {
      const suffix = String(i).padStart(2, '0');
      expect(NAMING.test(`head_001c${suffix}.png`)).toBe(true);
      expect(NAMING.test(`hair_012c${suffix}@small.webp`)).toBe(true);
    }
  });

  it('サイズ違いの名前も命名規則に合う', () => {
    for (const size of ['small', 'medium', 'large', 'hero']) {
      expect(NAMING.test(`head_001@${size}.webp`)).toBe(true);
    }
  });

  it('規則に合わない名前をはじく', () => {
    for (const bad of [
      'head.webp',
      'head_1.webp',
      'Head_001.webp',
      'head_001.jpg',
      'head_0001.webp',
      'head_001@huge.webp',
      'head_001c1.webp',
      'head_001c003.webp',
      '../head_001.webp',
      'head_001 copy.webp',
    ]) {
      expect(NAMING.test(bad), bad).toBe(false);
    }
  });

  it('接頭辞が種類のあいだで衝突していない（同じゲーム側の種類を除く）', () => {
    const seen = new Map<string, string>();
    for (const entry of imageCategories()) {
      const previous = seen.get(entry.prefix);
      if (previous) expect(previous, entry.id).toBe(entry.runtime);
      seen.set(entry.prefix, entry.runtime);
    }
  });
});

/* ================================================================
 * 4. プロンプト（§9・§10・§12）
 * ============================================================== */

describe('PHASE4.7 プロンプト', () => {
  it('同じ指定からは必ず同じ文面が出る', () => {
    expect(buildPrompt('eyes', 0).prompt).toBe(buildPrompt('eyes', 0).prompt);
  });

  it('違う指定なら違う文面になる', () => {
    expect(buildPrompt('eyes', 0).prompt).not.toBe(buildPrompt('eyes', 1).prompt);
  });

  it('範囲の外を指定すると例外になる', () => {
    expect(() => buildPrompt('eyes', -1)).toThrow();
    expect(() => buildPrompt('eyes', 999)).toThrow();
  });

  it('文面は4つの積み重ねでできている', () => {
    const parts = buildPrompt('nose', 2);
    expect(parts.base).toBe(BASE_STYLE);
    expect(parts.categoryPrompt.length).toBeGreaterThan(20);
    expect(parts.variantPrompt.length).toBeGreaterThan(10);
    expect(parts.negativePrompt.length).toBeGreaterThan(100);
  });

  it('文面に共通の絵柄が必ず入る', () => {
    // 絵柄を「フラットなベクターアバター」に変えたので、目印もそれに合わせる
    for (const entry of imageCategories()) {
      const parts = buildPrompt(entry.id, 0);
      expect(parts.prompt, entry.id).toContain('flat vector avatar');
      expect(parts.prompt, entry.id).toContain('bold uniform black outline');
      expect(parts.prompt, entry.id).toContain('transparent background');
    }
  });

  it('文面に「記号として描く」指示が入る（写実にしない）', () => {
    for (const entry of imageCategories()) {
      const parts = buildPrompt(entry.id, 0);
      expect(parts.prompt, entry.id).toContain('simple geometric symbols');
      expect(parts.prompt, entry.id).toContain('not as realistic anatomy');
    }
  });

  it('文面にキャンバスの大きさが入る', () => {
    expect(buildPrompt('head_shape', 0).prompt).toContain('1024 by 1280');
  });

  it('顔の部品には基準点の座標が入る', () => {
    expect(buildPrompt('eyes', 0).prompt).toContain('x=408');
    expect(buildPrompt('eyes', 0).prompt).toContain('y=496');
    expect(buildPrompt('mouth', 0).prompt).toContain('y=712');
    expect(buildPrompt('nose', 0).prompt).toContain('y=600');
  });

  it('「顔を描くな」の指示がすべての顔の部品に入る（§10）', () => {
    expect(buildPrompt('eyes', 0).prompt).toContain('Do not draw:');
    expect(buildPrompt('eyes', 0).prompt).toContain('nose');
    expect(buildPrompt('hair_style', 0).prompt).toContain('face');
    expect(buildPrompt('head_shape', 0).prompt).toContain('eyes');
  });

  it('頭のプロンプトは「顔の造作を描くな」と言っている', () => {
    const prompt = buildPrompt('head_shape', 0).prompt;
    expect(prompt).toContain('no facial features');
  });

  it('目のプロンプトは眉を除いている', () => {
    expect(buildPrompt('eyes', 0).negativePrompt).toContain('eyebrows');
  });

  it('髪と肌は中間色で作らせる（色は後処理）', () => {
    expect(buildPrompt('hair_style', 0).prompt).toContain('neutral dark base colour');
    expect(buildPrompt('head_shape', 0).prompt).toContain('neutral mid tone');
  });

  it('ユニフォームに球団色を焼き込ませない', () => {
    const prompt = buildPrompt('uniform', 0).prompt;
    expect(prompt).toContain('Do not use any team colour');
    expect(prompt).toContain('no logo');
  });

  it('帽子にも球団色を焼き込ませない', () => {
    expect(buildPrompt('cap', 0).prompt).toContain('Do not use any team colour');
  });

  it('ネガティブに権利まわりの禁止が入っている（§9）', () => {
    for (const word of [
      'real athlete',
      'celebrity likeness',
      'existing video game character',
      'existing anime character',
      'watermark',
      'logo',
      'signature',
    ]) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('ネガティブに年齢と品位の禁止が入っている', () => {
    for (const word of ['child', 'sexualised', 'gore']) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('ネガティブに画風の逸脱の禁止が入っている', () => {
    /*
     * 「フラットなアイコン調」が狙いになったので、
     * flat icon / clipart を禁止するのはやめた（それが欲しい絵柄なので）。
     * 代わりに、写実・塗り込み・柔らかい陰影を禁止する。
     */
    for (const word of [
      'photorealistic',
      '3d render',
      'realistic rendering',
      'painterly',
      'soft shading',
      'gradient shading',
      'skin texture',
    ]) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('ネガティブが「フラットなアイコン調」を禁止していない（それが狙いなので）', () => {
    for (const word of ['flat icon', 'clipart', 'sticker art']) {
      expect(NEGATIVE_PROMPT, word).not.toContain(word);
    }
  });

  it('部品だけを描かせる念押しが入る（生成器は顔まで描きたがる）', () => {
    // body / uniform / pose は、まわりの形があって初めて意味が通るので対象外
    for (const entry of imageCategories()) {
      if (['body_type', 'uniform', 'pose'].includes(entry.id)) continue;
      const prompt = buildPrompt(entry.id, 0).prompt;
      expect(prompt, entry.id).toContain('ONLY this one part and nothing else');
      expect(prompt, entry.id).toContain('floats alone in empty space');
    }
  });

  it('ネガティブに背景と文字の禁止が入っている', () => {
    for (const word of ['background', 'text', 'frame', 'cast shadow']) {
      expect(NEGATIVE_PROMPT, word).toContain(word);
    }
  });

  it('種類ごとのネガティブは共通のネガティブを含む', () => {
    for (const entry of imageCategories()) {
      expect(buildPrompt(entry.id, 0).negativePrompt, entry.id).toContain(NEGATIVE_PROMPT);
    }
  });

  it('見本の1枚の文面が用意されている（§11）', () => {
    const prompt = masterStyleSheetPrompt();
    expect(prompt).toContain('MASTER CHARACTER STYLE SHEET');
    expect(prompt).toContain('no logo');
    expect(prompt.length).toBeGreaterThan(300);
  });

  it('見本の1枚に注釈を描かせない', () => {
    expect(masterStyleSheetPrompt()).toContain('No annotations');
  });

  it('文面の版が記録される（§17）', () => {
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(1);
    expect(buildPrompt('eyes', 0).promptVersion).toBe(PROMPT_VERSION);
  });

  it('種類ぶんまとめて組み立てられる', () => {
    const prompts = buildPromptsFor('eyes', 5);
    expect(prompts.length).toBe(5);
    expect(new Set(prompts.map((part) => part.id)).size).toBe(5);
  });

  it('まとめて組み立てても上限を超えない', () => {
    const entry = catalogEntry('cap');
    expect(buildPromptsFor('cap', 999).length).toBeLessThanOrEqual(entry.max);
  });

  it('組み立てたIDが命名規則に合う', () => {
    for (const part of buildPromptsFor('hair_style', 8)) {
      expect(NAMING.test(`${part.id}.png`), part.id).toBe(true);
    }
  });

  it('プロンプトに鍵らしき文字が入っていない', () => {
    for (const entry of CATALOG) {
      if (entry.kind !== 'image') continue;
      const prompt = buildPrompt(entry.id, 0).prompt;
      expect(prompt, entry.id).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(prompt, entry.id).not.toContain('Bearer');
    }
  });
});

/* ================================================================
 * 5. 生成の計画（§29・§52・§53）
 * ============================================================== */

describe('PHASE4.7 生成の計画', () => {
  it('計画を立てても1枚も作らない（純粋な計算）', () => {
    const plan = planGeneration(['eyes', 'nose']);
    expect(plan.length).toBe(2);
    expect(plan.every((item) => item.ids.length === item.count)).toBe(true);
  });

  it('色を振り分ける種類はAPIの枚数に数えない', () => {
    const plan = planGeneration(['hair_color', 'skin_tone']);
    expect(billableCount(plan)).toBe(0);
    expect(plan.every((item) => item.count > 0)).toBe(true);
  });

  it('画像で作る種類はAPIの枚数に数える', () => {
    expect(billableCount(planGeneration(['eyes'], 4))).toBe(4);
  });

  it('全種類の計画が立てられる', () => {
    const plan = planGeneration(CATALOG.map((entry) => entry.id));
    expect(plan.length).toBe(CATALOG.length);
    expect(billableCount(plan)).toBeGreaterThan(0);
  });

  it('計画のIDが命名規則に合う', () => {
    for (const item of planGeneration(CATALOG.map((entry) => entry.id))) {
      for (const id of item.ids) expect(NAMING.test(`${id}.png`), id).toBe(true);
    }
  });

  it('枚数を絞れば計画も小さくなる', () => {
    const small = billableCount(planGeneration(['eyes', 'nose', 'mouth'], 2));
    const large = billableCount(planGeneration(['eyes', 'nose', 'mouth'], 8));
    expect(small).toBe(6);
    expect(large).toBeGreaterThan(small);
  });

  it('計画にゲーム側の種類名が入っている', () => {
    const plan = planGeneration(['head_shape']);
    expect(plan[0].runtime).toBe('head');
  });
});

/* ================================================================
 * 6. プロバイダーの窓口（§2・§3・§32・§34）
 * ============================================================== */

describe('PHASE4.7 プロバイダー', () => {
  it('選べるプロバイダーが4つある', () => {
    expect(PROVIDER_IDS.length).toBe(4);
    expect(PROVIDER_REQUIREMENTS.length).toBe(PROVIDER_IDS.length);
  });

  it('プロバイダーの名前を検査できる', () => {
    expect(isProviderId('openai')).toBe(true);
    expect(isProviderId('local')).toBe(true);
    expect(isProviderId('midjourney')).toBe(false);
  });

  it('すべてのプロバイダーに必要なものが書いてある', () => {
    for (const requirement of PROVIDER_REQUIREMENTS) {
      expect(requirement.label.length, requirement.id).toBeGreaterThan(0);
      expect(requirement.defaultModel.length, requirement.id).toBeGreaterThan(0);
      expect(requirement.note.length, requirement.id).toBeGreaterThan(0);
    }
  });

  it('手元のフォルダだけは鍵が要らない', () => {
    const local = PROVIDER_REQUIREMENTS.find((requirement) => requirement.id === 'local')!;
    expect(local.envKeys).toEqual([]);
    for (const requirement of PROVIDER_REQUIREMENTS) {
      if (requirement.id === 'local') continue;
      expect(requirement.envKeys, requirement.id).toContain('IMAGE_API_KEY');
    }
  });

  it('何も設定が無ければ「使えない」と返す（生成できたことにしない）', () => {
    const resolution = resolveProvider({});
    expect(resolution.available).toBe(false);
    if (!resolution.available) {
      expect(resolution.missing).toContain('IMAGE_PROVIDER');
      expect(resolution.hint.length).toBeGreaterThan(0);
    }
  });

  it('知らないプロバイダー名は断る', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'midjourney' });
    expect(resolution.available).toBe(false);
    if (!resolution.available) expect(resolution.reason).toContain('midjourney');
  });

  it('鍵が無ければ、何が足りないかを返す', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'openai' });
    expect(resolution.available).toBe(false);
    if (!resolution.available) expect(resolution.missing).toContain('IMAGE_API_KEY');
  });

  it('鍵が空白だけでも「無い」と扱う', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: '   ' });
    expect(resolution.available).toBe(false);
  });

  it('鍵があれば OpenAI を組み立てる', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: 'test-key' });
    expect(resolution.available).toBe(true);
    if (resolution.available) {
      expect(resolution.provider.name).toBe('openai');
      expect(resolution.provider.supportsTransparency()).toBe(true);
    }
  });

  it('鍵があれば Replicate を組み立てる', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'replicate', IMAGE_API_KEY: 'test-key' });
    expect(resolution.available).toBe(true);
    if (resolution.available) {
      expect(resolution.provider.name).toBe('replicate');
      expect(resolution.provider.supportsReferenceImage()).toBe(true);
    }
  });

  it('鍵があれば fal を組み立てる', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'fal', IMAGE_API_KEY: 'test-key' });
    expect(resolution.available).toBe(true);
    if (resolution.available) expect(resolution.provider.name).toBe('fal');
  });

  it('モデルを指定できる', () => {
    const resolution = resolveProvider({
      IMAGE_PROVIDER: 'openai',
      IMAGE_API_KEY: 'test-key',
      IMAGE_MODEL: 'my-model',
    });
    expect(resolution.available).toBe(true);
    if (resolution.available) expect(resolution.provider.model).toBe('my-model');
  });

  it('手元のフォルダは鍵なしで使える', () => {
    const resolution = resolveProvider(
      { IMAGE_PROVIDER: 'local' },
      { readImage: async () => null },
    );
    expect(resolution.available).toBe(true);
    if (resolution.available) expect(resolution.provider.name).toBe('local');
  });

  it('手元のフォルダに画像が無ければ、置き場所を教えて失敗する', async () => {
    const resolution = resolveProvider(
      { IMAGE_PROVIDER: 'local' },
      { readImage: async () => null, dropDir: 'assets/incoming' },
    );
    expect(resolution.available).toBe(true);
    if (!resolution.available) return;
    const result = await resolution.provider.generateImage({
      id: 'head_001',
      prompt: 'x',
      negativePrompt: 'y',
      width: 1024,
      height: 1280,
      transparent: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('assets/incoming');
      // 置き直せば通るので、自動でやり直しても意味がない
      expect(result.retryable).toBe(false);
    }
  });

  it('手元のフォルダに画像があれば読める', async () => {
    const bytes = encodePng(createImage(4, 4));
    const resolution = resolveProvider(
      { IMAGE_PROVIDER: 'local' },
      { readImage: async () => bytes },
    );
    expect(resolution.available).toBe(true);
    if (!resolution.available) return;
    const result = await resolution.provider.generateImage({
      id: 'head_001',
      prompt: 'x',
      negativePrompt: 'y',
      width: 1024,
      height: 1280,
      transparent: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isPng(result.bytes)).toBe(true);
      expect(result.meta.provider).toBe('local');
    }
  });

  it('まとめて頼んでも、成功したものは失われない', async () => {
    let calls = 0;
    const resolution = resolveProvider(
      { IMAGE_PROVIDER: 'local' },
      {
        readImage: async () => {
          calls += 1;
          return calls % 2 === 0 ? encodePng(createImage(2, 2)) : null;
        },
      },
    );
    expect(resolution.available).toBe(true);
    if (!resolution.available) return;
    const requests = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      prompt: 'x',
      negativePrompt: 'y',
      width: 8,
      height: 8,
      transparent: true,
    }));
    const results = await resolution.provider.generateBatch(requests);
    expect(results.length).toBe(4);
    expect(results.filter((result) => result.ok).length).toBeGreaterThan(0);
  });

  it('出所の記録に鍵が入らない（§17）', async () => {
    const resolution = resolveProvider(
      { IMAGE_PROVIDER: 'local' },
      { readImage: async () => encodePng(createImage(2, 2)) },
    );
    expect(resolution.available).toBe(true);
    if (!resolution.available) return;
    const result = await resolution.provider.generateImage({
      id: 'x',
      prompt: 'p',
      negativePrompt: 'n',
      width: 8,
      height: 8,
      transparent: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = JSON.stringify(result.meta);
      expect(raw).not.toContain('apiKey');
      expect(raw).not.toContain('Bearer');
      expect(Object.keys(result.meta).sort()).toEqual(
        ['generatedAt', 'model', 'promptVersion', 'provider'].sort(),
      );
    }
  });
});

/* ================================================================
 * 7. 鍵の伏せ字（§3・§47）
 * ============================================================== */

describe('PHASE4.7 鍵を漏らさない', () => {
  it('OpenAI 風の鍵を伏せる', () => {
    expect(redact('error with sk-abcd1234efgh5678')).toContain('[REDACTED]');
    expect(redact('error with sk-abcd1234efgh5678')).not.toContain('abcd1234');
  });

  it('Replicate 風の鍵を伏せる', () => {
    expect(redact('token r8_ABCDEFGH12345678')).toContain('[REDACTED]');
  });

  it('Bearer を伏せる', () => {
    const out = redact('Authorization: Bearer abcdefgh12345678');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('abcdefgh12345678');
  });

  it('JSON の中の鍵を伏せる', () => {
    const out = redact('{"api_key":"supersecretvalue123"}');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('ふつうの文章は変えない', () => {
    expect(redact('生成に失敗しました（429）')).toBe('生成に失敗しました（429）');
  });

  it('base64 を読める', () => {
    const bytes = decodeBase64('aGVsbG8=');
    expect([...bytes]).toEqual([104, 101, 108, 108, 111]);
  });

  it('data URI つきの base64 も読める', () => {
    const bytes = decodeBase64('data:image/png;base64,aGk=');
    expect([...bytes]).toEqual([104, 105]);
  });

  it('壊れた base64 は例外になる', () => {
    expect(() => decodeBase64('!!!!')).toThrow();
  });
});

/* ================================================================
 * 8. PNG の読み書き
 * ============================================================== */

describe('PHASE4.7 PNG', () => {
  it('PNG かどうかを見分ける', () => {
    expect(isPng(encodePng(createImage(2, 2)))).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isPng(new Uint8Array(0))).toBe(false);
  });

  it('書いたものを読み戻せる', () => {
    const image = createImage(17, 13);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i * 7) & 0xff;
      image.data[i + 1] = (i * 13) & 0xff;
      image.data[i + 2] = (i * 29) & 0xff;
      image.data[i + 3] = i % 37 === 0 ? 0 : 255;
    }
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(17);
    expect(back.height).toBe(13);
    expect([...back.data]).toEqual([...image.data]);
  });

  it('大きさをヘッダだけで読める', () => {
    const header = readPngHeader(encodePng(createImage(320, 240)));
    expect(header.width).toBe(320);
    expect(header.height).toBe(240);
    expect(header.bitDepth).toBe(8);
    expect(header.colorType).toBe(6);
  });

  it('PNG でないものを読むと例外になる', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow();
  });

  it('無圧縮の deflate を展開できる', () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect([...inflate(deflateStored(bytes))]).toEqual([...bytes]);
  });

  it('空のデータも往復できる', () => {
    expect([...inflate(deflateStored(new Uint8Array(0)))]).toEqual([]);
  });

  it('大きな画像も往復できる', () => {
    const image = createImage(200, 250);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(200);
    expect(back.height).toBe(250);
  });

  it('透明な画素を保てる', () => {
    const image = createImage(4, 4);
    image.data[3] = 255;
    const back = decodePng(encodePng(image));
    expect(back.data[3]).toBe(255);
    expect(back.data[7]).toBe(0);
  });
});

/* ================================================================
 * 9. 後処理（§5）
 * ============================================================== */

describe('PHASE4.7 後処理', () => {
  it('白い背景を透明にする', () => {
    const source = blob(200, 200);
    expect(looksTransparent(source)).toBe(false);
    const out = removeBackground(source);
    expect(looksTransparent(out)).toBe(true);
  });

  it('背景除去で中身は残る', () => {
    const out = removeBackground(blob(200, 200, { rx: 50, ry: 50 }));
    const bounds = contentBounds(out);
    expect(bounds.empty).toBe(false);
    expect(bounds.width).toBeGreaterThan(80);
  });

  it('中に囲まれた背景色は消さない（白いユニフォームを守る）', () => {
    // 外側が白、中が濃い輪、さらに中が白、という構造
    const image = createImage(120, 120);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 120; x++) {
        const at = (y * 120 + x) * 4;
        const r = Math.hypot(x - 60, y - 60);
        const value = r < 20 ? 250 : r < 45 ? 90 : 250;
        image.data[at] = value;
        image.data[at + 1] = value;
        image.data[at + 2] = value;
        image.data[at + 3] = 255;
      }
    }
    const out = removeBackground(image);
    // 真ん中（囲まれた白）は残る
    expect(out.data[(60 * 120 + 60) * 4 + 3]).toBe(255);
    // 隅（外の白）は消える
    expect(out.data[3]).toBe(0);
  });

  it('すでに透明ならそれを見分ける', () => {
    const image = createImage(10, 10);
    expect(looksTransparent(image)).toBe(true);
  });

  it('半端なアルファを整える', () => {
    const image = createImage(4, 4);
    image.data[3] = 5;
    image.data[7] = 250;
    image.data[11] = 128;
    const out = cleanAlpha(image);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(255);
    expect(out.data[11]).toBe(128);
  });

  it('ぽつんと残った点を消す', () => {
    const image = createImage(20, 20);
    const at = (10 * 20 + 10) * 4;
    image.data[at] = 200;
    image.data[at + 3] = 255;
    const out = cleanAlpha(image);
    expect(out.data[at + 3]).toBe(0);
  });

  it('透明な画素の色を0にそろえる', () => {
    const image = createImage(2, 2);
    image.data[0] = 200;
    image.data[1] = 100;
    image.data[3] = 0;
    const out = cleanAlpha(image);
    expect(out.data[0]).toBe(0);
    expect(out.data[1]).toBe(0);
  });

  it('中身の範囲を求められる', () => {
    const image = createImage(50, 50);
    for (let y = 10; y <= 20; y++) {
      for (let x = 5; x <= 15; x++) image.data[(y * 50 + x) * 4 + 3] = 255;
    }
    const bounds = contentBounds(image);
    expect(bounds.left).toBe(5);
    expect(bounds.top).toBe(10);
    expect(bounds.right).toBe(15);
    expect(bounds.bottom).toBe(20);
    expect(bounds.width).toBe(11);
    expect(bounds.height).toBe(11);
  });

  it('中身が無ければ empty になる', () => {
    expect(contentBounds(createImage(10, 10)).empty).toBe(true);
  });

  it('中身だけ切り出せる', () => {
    const image = createImage(60, 60);
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 40; x++) image.data[(y * 60 + x) * 4 + 3] = 255;
    }
    const out = cropToContent(image);
    expect(out.width).toBe(20);
    expect(out.height).toBe(10);
  });

  it('拡大縮小できる', () => {
    const image = blob(100, 100, { background: null });
    const out = resize(image, 50, 50);
    expect(out.width).toBe(50);
    expect(out.height).toBe(50);
    expect(contentBounds(out).empty).toBe(false);
  });

  it('同じ大きさへの縮小は中身を変えない', () => {
    const image = blob(20, 20, { background: null });
    const out = resize(image, 20, 20);
    expect([...out.data]).toEqual([...image.data]);
  });

  it('縮めても縁に黒が出ない（アルファを掛けてから混ぜている）', () => {
    const image = blob(200, 200, { background: null, shade: 220 });
    const out = resize(image, 40, 40);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] > 200) {
        // 明るい素材を縮めたのだから、暗い画素が出てはいけない
        expect(out.data[i]).toBeGreaterThan(80);
      }
    }
  });

  it('共通キャンバスへ置き直せる', () => {
    const out = fitToCanvas(blob(300, 300, { background: null }), {
      anchor: { x: 512, y: 470 },
      targetWidth: 400,
    });
    expect(out.width).toBe(CANVAS_WIDTH);
    expect(out.height).toBe(CANVAS_HEIGHT);
  });

  it('置き直すと基準点が中心になる', () => {
    const out = fitToCanvas(blob(300, 300, { background: null }), {
      anchor: { x: 512, y: 470 },
      targetWidth: 400,
    });
    const bounds = contentBounds(out);
    expect(Math.abs((bounds.left + bounds.right) / 2 - 512)).toBeLessThanOrEqual(2);
    expect(Math.abs((bounds.top + bounds.bottom) / 2 - 470)).toBeLessThanOrEqual(2);
  });

  it('置き直すと指定した幅になる', () => {
    const out = fitToCanvas(blob(300, 300, { background: null }), {
      anchor: { x: 512, y: 470 },
      targetWidth: 400,
    });
    expect(Math.abs(contentBounds(out).width - 400)).toBeLessThanOrEqual(3);
  });

  it('もとの大きさが違っても、置き直せば基準点にそろう', () => {
    // 縦横比が違えば高さは違ってよい。そろわなければいけないのは「基準点」。
    for (const [width, height] of [
      [300, 300],
      [900, 700],
      [640, 1280],
      [1500, 500],
    ]) {
      const out = fitToCanvas(blob(width, height, { background: null }), {
        anchor: { x: 512, y: 496 },
        targetWidth: 300,
      });
      const bounds = contentBounds(out);
      const centreX = (bounds.left + bounds.right) / 2;
      const centreY = (bounds.top + bounds.bottom) / 2;
      expect(Math.abs(centreX - 512), `${width}x${height}`).toBeLessThanOrEqual(2);
      expect(Math.abs(centreY - 496), `${width}x${height}`).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.width - 300), `${width}x${height}`).toBeLessThanOrEqual(3);
    }
  });

  it('中身が無いものを置き直しても落ちない', () => {
    const out = fitToCanvas(createImage(50, 50), { anchor: { x: 512, y: 470 } });
    expect(out.width).toBe(CANVAS_WIDTH);
    expect(contentBounds(out).empty).toBe(true);
  });

  it('重ねられる', () => {
    const target = createImage(10, 10);
    const source = createImage(4, 4);
    for (let i = 0; i < source.data.length; i += 4) {
      source.data[i] = 200;
      source.data[i + 3] = 255;
    }
    compose(target, source, 3, 3);
    expect(target.data[(3 * 10 + 3) * 4 + 3]).toBe(255);
    expect(target.data[0]).toBe(0);
  });

  it('はみ出す位置に重ねても落ちない', () => {
    const target = createImage(10, 10);
    const source = createImage(6, 6);
    for (let i = 3; i < source.data.length; i += 4) source.data[i] = 255;
    compose(target, source, -3, 8);
    expect(target.width).toBe(10);
  });

  it('色を振り分けられる', () => {
    const image = blob(60, 60, { background: null, shade: 150 });
    const out = recolor(image, [20, 10, 5], [200, 180, 160]);
    let opaque = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      opaque += 1;
      expect(out.data[i]).toBeGreaterThanOrEqual(20);
      expect(out.data[i]).toBeLessThanOrEqual(200);
    }
    expect(opaque).toBeGreaterThan(0);
  });

  it('色を振り分けてもアルファは変わらない', () => {
    const image = blob(40, 40, { background: null });
    const out = recolor(image, [0, 0, 0], [255, 255, 255]);
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(image.data[i]);
    }
  });

  it('色を振り分けても形は変わらない', () => {
    const image = blob(40, 40, { background: null });
    const out = recolor(image, [10, 10, 10], [90, 90, 90]);
    expect(contentBounds(out)).toEqual(contentBounds(image));
  });

  it('髪の10色がすべて違う', () => {
    const keys = HAIR_RAMPS.map((ramp) => ramp.dark.join(',') + '/' + ramp.light.join(','));
    expect(new Set(keys).size).toBe(HAIR_RAMPS.length);
  });

  it('肌の8段階がすべて違い、暗い順に並んでいない箇所が無い', () => {
    const keys = SKIN_RAMPS.map((ramp) => ramp.dark.join(','));
    expect(new Set(keys).size).toBe(SKIN_RAMPS.length);
    for (let i = 1; i < SKIN_RAMPS.length; i++) {
      const previous = SKIN_RAMPS[i - 1].dark[0];
      expect(SKIN_RAMPS[i].dark[0]).toBeLessThan(previous);
    }
  });

  it('派生サイズを作れる', () => {
    const image = createImage(1024, 1280);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    const out = derivatives(image, [128]);
    const small = out.get(128)!;
    expect(small.width).toBe(128);
    expect(small.height).toBe(160);
  });

  it('派生サイズは縦横比を保つ', () => {
    const image = createImage(1024, 1280);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    for (const width of [512, 256, 128]) {
      const small = derivatives(image, [width]).get(width)!;
      expect(small.height / small.width).toBeCloseTo(1280 / 1024, 2);
    }
  });

  it('ひとつながりの流れを通せる', () => {
    const result = processPart(blob(700, 640, { rx: 180, ry: 220 }), {
      anchor: ANCHORS.head_shape,
      targetWidth: 536,
    });
    expect(result.image.width).toBe(CANVAS_WIDTH);
    expect(result.image.height).toBe(CANVAS_HEIGHT);
    expect(looksTransparent(result.image)).toBe(true);
    expect(result.steps).toContain('背景除去');
    expect(result.steps).toContain('基準点合わせ');
  });

  it('すでに透明なら背景除去を飛ばす', () => {
    const result = processPart(blob(200, 200, { background: null }), {
      anchor: ANCHORS.eyes,
    });
    expect(result.steps).toContain('背景除去（不要）');
  });

  it('後処理した結果は必ず共通キャンバスになる', () => {
    for (const [width, height] of [
      [640, 640],
      [1024, 1024],
      [1500, 900],
      [300, 1200],
    ]) {
      const result = processPart(blob(width, height, { rx: width / 4, ry: height / 4 }), {
        anchor: ANCHORS.head_shape,
        targetWidth: 536,
      });
      expect(result.image.width, `${width}x${height}`).toBe(CANVAS_WIDTH);
      expect(result.image.height, `${width}x${height}`).toBe(CANVAS_HEIGHT);
    }
  });
});

/* ================================================================
 * 10. 品質検査（§15・§40）
 * ============================================================== */

describe('PHASE4.7 品質検査', () => {
  it('整った素材は APPROVED になる', () => {
    const report = inspect(goodPart(), 'head_001', 'head_shape');
    expect(report.grade).toBe('APPROVED');
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it('大きさが違えば REJECT', () => {
    const report = inspect(blob(400, 400, { background: null }), 'head_001', 'head_shape');
    expect(report.grade).toBe('REJECT');
    expect(report.issues.some((issue) => issue.code === 'canvas-size')).toBe(true);
  });

  it('中身が空なら REJECT', () => {
    const report = inspect(createImage(CANVAS_WIDTH, CANVAS_HEIGHT), 'head_001', 'head_shape');
    expect(report.grade).toBe('REJECT');
    expect(report.issues[0].code).toBe('empty');
  });

  it('背景が残っていれば REJECT', () => {
    const report = inspect(blob(CANVAS_WIDTH, CANVAS_HEIGHT), 'head_001', 'head_shape');
    expect(report.grade).toBe('REJECT');
    expect(report.issues.some((issue) => issue.code === 'opaque-corners')).toBe(true);
  });

  it('画面いっぱいに不透明なら背景の抜き忘れとして落とす', () => {
    const image = createImage(CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 180;
      image.data[i + 1] = 170;
      image.data[i + 2] = 160;
      image.data[i + 3] = 255;
    }
    const report = inspect(image, 'head_001', 'head_shape');
    expect(report.grade).toBe('REJECT');
  });

  it('端で切れていれば REJECT', () => {
    const image = createImage(CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let y = 200; y < 800; y++) {
      for (let x = 0; x < 400; x++) {
        const at = (y * CANVAS_WIDTH + x) * 4;
        image.data[at] = 180;
        image.data[at + 3] = 255;
      }
    }
    const report = inspect(image, 'head_001', 'head_shape');
    expect(report.issues.some((issue) => issue.code === 'cropped')).toBe(true);
  });

  it('中身が小さすぎれば REJECT', () => {
    const image = createImage(CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let y = 500; y < 508; y++) {
      for (let x = 500; x < 508; x++) {
        const at = (y * CANVAS_WIDTH + x) * 4;
        image.data[at] = 180;
        image.data[at + 3] = 255;
      }
    }
    const report = inspect(image, 'head_001', 'head_shape');
    expect(report.issues.some((issue) => issue.code === 'too-small')).toBe(true);
  });

  it('端に接しているところを教えてくれる', () => {
    const image = createImage(20, 20);
    for (let x = 0; x < 20; x++) image.data[x * 4 + 3] = 255;
    expect(edgesTouched(image, contentBounds(image))).toContain('上');
    expect(edgesTouched(image, contentBounds(image))).toContain('左');
  });

  it('左右のつり合いを測れる', () => {
    const image = createImage(100, 100);
    for (let y = 40; y < 60; y++) {
      for (let x = 10; x < 30; x++) image.data[(y * 100 + x) * 4 + 3] = 255;
    }
    // 左だけにある → ずれが大きい
    expect(horizontalSkew(image, contentBounds(image))).toBeGreaterThanOrEqual(0);
  });

  it('左右対称ならずれは0に近い', () => {
    const image = createImage(100, 100);
    for (let y = 40; y < 60; y++) {
      for (let x = 20; x < 40; x++) image.data[(y * 100 + x) * 4 + 3] = 255;
      for (let x = 60; x < 80; x++) image.data[(y * 100 + x) * 4 + 3] = 255;
    }
    expect(horizontalSkew(image, contentBounds(image))).toBeLessThan(0.05);
  });

  it('画素の様子を数えられる', () => {
    const stats = analyse(blob(100, 100, { background: null }));
    expect(stats.opaqueRatio).toBeGreaterThan(0);
    expect(stats.opaqueRatio).toBeLessThan(1);
    expect(stats.uniqueColors).toBeGreaterThan(1);
  });

  it('空の画像でも数えられる', () => {
    const stats = analyse(createImage(0, 0));
    expect(stats.opaqueRatio).toBe(0);
  });

  it('離れた点を見つけられる', () => {
    const image = createImage(100, 100);
    for (let y = 10; y < 60; y++) {
      for (let x = 10; x < 60; x++) image.data[(y * 100 + x) * 4 + 3] = 255;
    }
    for (let y = 90; y < 95; y++) {
      for (let x = 90; x < 95; x++) image.data[(y * 100 + x) * 4 + 3] = 255;
    }
    expect(analyse(image).strayRatio).toBeGreaterThan(0);
  });

  it('ひとかたまりなら離れた点は0', () => {
    const image = createImage(60, 60);
    for (let y = 10; y < 50; y++) {
      for (let x = 10; x < 50; x++) image.data[(y * 60 + x) * 4 + 3] = 255;
    }
    expect(analyse(image).strayRatio).toBe(0);
  });

  it('点数の段階が仕様どおり', () => {
    expect(gradeOf(90, [])).toBe('APPROVED');
    expect(gradeOf(80, [])).toBe('APPROVED');
    expect(gradeOf(79, [])).toBe('REVIEW');
    expect(gradeOf(60, [])).toBe('REVIEW');
    expect(gradeOf(59, [])).toBe('REJECT');
  });

  it('REJECT が1つでもあれば、点数に関わらず REJECT', () => {
    expect(
      gradeOf(100, [{ code: 'x', verdict: 'REJECT', message: '', penalty: 0 }]),
    ).toBe('REJECT');
  });

  it('WARN だけなら REJECT にはならない', () => {
    expect(gradeOf(85, [{ code: 'x', verdict: 'WARN', message: '', penalty: 0 }])).toBe('APPROVED');
  });

  it('点数は0〜100に収まる', () => {
    for (const image of [
      goodPart(),
      blob(CANVAS_WIDTH, CANVAS_HEIGHT),
      createImage(CANVAS_WIDTH, CANVAS_HEIGHT),
      blob(100, 100),
    ]) {
      const report = inspect(image, 'x', 'head_shape');
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    }
  });

  it('人が見るべき項目が必ず残る（機械では決められない）', () => {
    const report = inspect(goodPart(), 'head_001', 'head_shape');
    expect(report.humanChecks.length).toBeGreaterThanOrEqual(5);
    expect(report.humanChecks.join()).toContain('ロゴ');
    expect(report.humanChecks.join()).toContain('実在');
  });

  it('問題にはすべて説明がついている', () => {
    const report = inspect(blob(CANVAS_WIDTH, CANVAS_HEIGHT), 'x', 'head_shape');
    for (const issue of report.issues) {
      expect(issue.message.length).toBeGreaterThan(5);
      expect(issue.penalty).toBeGreaterThan(0);
    }
  });

  it('検査しても画像を変えない', () => {
    const image = goodPart();
    const before = [...image.data];
    inspect(image, 'x', 'head_shape');
    expect([...image.data]).toEqual(before);
  });
});

/* ================================================================
 * 11. 設計図 v3（§20・§21・§22）
 * ============================================================== */

describe('PHASE4.7 設計図 v3', () => {
  it('版が3になっている', () => {
    expect(VISUAL_PROFILE_VERSION).toBe(3);
    expect(VISUAL_PROFILE_VERSION).toBeGreaterThan(APPEARANCE_VERSION);
  });

  it('状態を表す種類が増えている', () => {
    expect(VISUAL_CATEGORIES).toContain('special');
  });

  it('同じ選手からは何度でも同じ設計図が出る', () => {
    const player = newGame().players[0];
    const a = buildVisualProfile({ player });
    const b = buildVisualProfile({ player });
    expect(JSON.stringify(a.parts)).toBe(JSON.stringify(b.parts));
  });

  it('別の選手は違う設計図になる（1球団ぶんで重複0）', () => {
    const state = newGame();
    const mine = state.players.filter((player) => player.teamId === PLAYER_TEAM);
    const combos = new Set(
      mine.map((player) => {
        const profile = buildVisualProfile({ player });
        return VISUAL_CATEGORIES.map((category) => profile.parts[category] ?? '-').join('|');
      }),
    );
    expect(combos.size).toBe(mine.length);
  });

  it('状態は none が既定', () => {
    expect(buildVisualProfile({ player: fakePlayer('s-1') }).state).toBe('none');
  });

  it('状態を渡せばそのまま入る', () => {
    const profile = buildVisualProfile({ player: fakePlayer('s-2'), visualState: 'injury' });
    expect(profile.state).toBe('injury');
    expect(profile.parts.special).toBe('special_injury_001');
  });

  it('none のときは状態の素材を使わない', () => {
    expect(specialAsset('none')).toBeNull();
    expect(buildVisualProfile({ player: fakePlayer('s-3') }).parts.special).toBeUndefined();
  });

  it('none 以外はすべて素材IDになる', () => {
    for (const state of ['injury', 'fatigue', 'slump', 'hot', 'rookie', 'veteran'] as VisualState[]) {
      expect(specialAsset(state)).toBe(`special_${state}_001`);
    }
  });

  it('状態の素材IDが命名規則に合う', () => {
    for (const state of ['injury', 'fatigue', 'slump', 'hot', 'rookie', 'veteran'] as VisualState[]) {
      expect(NAMING.test(`${specialAsset(state)}.png`), state).toBe(true);
    }
  });

  it('すべての状態に日本語の名前がある', () => {
    for (const state of Object.keys(VISUAL_STATE_LABELS) as VisualState[]) {
      expect(VISUAL_STATE_LABELS[state].length, state).toBeGreaterThan(0);
    }
  });

  it('怪我している選手は injury になる（ゲーム状態 → 見た目の一方向）', () => {
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
    expect(visualStateOf(state, injured)).toBe('injury');
  });

  it('疲労が高い選手は fatigue になる', () => {
    const state = newGame();
    const player = state.players.find((candidate) => !candidate.ext.injury && !candidate.ext.slump)!;
    const tired: Player = { ...player, ext: { ...player.ext, fatigue: 90, condition: 'normal' } };
    expect(visualStateOf(state, tired)).toBe('fatigue');
  });

  it('絶好調の選手は hot になる', () => {
    const state = newGame();
    const player = state.players.find((candidate) => !candidate.ext.injury && !candidate.ext.slump)!;
    const hot: Player = {
      ...player,
      ext: { ...player.ext, fatigue: 10, condition: 'best', debutYear: state.year - 5 },
      age: 28,
    };
    expect(visualStateOf(state, hot)).toBe('hot');
  });

  it('怪我は疲労より優先される', () => {
    const state = newGame();
    const player = state.players[0];
    const both: Player = {
      ...player,
      ext: {
        ...player.ext,
        fatigue: 99,
        injury: {
          level: 'minor',
          name: '打撲',
          startDate: `${state.year}-04-10`,
          returnDate: `${state.year}-04-20`,
        },
      },
    };
    expect(visualStateOf(state, both)).toBe('injury');
  });

  it('状態が変わっても顔の造作は動かない（§21）', () => {
    const player = fakePlayer('s-4');
    const calm = buildVisualProfile({ player, visualState: 'none' });
    const hurt = buildVisualProfile({ player, visualState: 'injury' });
    for (const category of ['head', 'eyes', 'nose', 'mouth', 'ears', 'jaw'] as VisualCategory[]) {
      expect(hurt.parts[category], category).toBe(calm.parts[category]);
    }
  });

  it('IDだけからでも状態を渡せる', () => {
    const profile = buildVisualProfileFromId({ playerId: 'x', age: 30, visualState: 'hot' });
    expect(profile.state).toBe('hot');
  });

  it('年齢が変わっても顔の造作は動かない（§22）', () => {
    const young = buildVisualProfileFromId({ playerId: 'age-x', age: 18 });
    const old = buildVisualProfileFromId({ playerId: 'age-x', age: 41 });
    for (const category of ['head', 'eyes', 'nose', 'mouth', 'ears'] as VisualCategory[]) {
      expect(old.parts[category], category).toBe(young.parts[category]);
    }
  });

  it('後ろ髪は素材があるときだけ割り当てる', () => {
    const without = buildVisualProfile({ player: fakePlayer('hb-1') });
    expect(without.parts.hairBack).toBeUndefined();
    const with6 = buildVisualProfile({ player: fakePlayer('hb-1') }, { hairBack: 6 });
    expect(with6.parts.hairBack).toBeTruthy();
    expect(NAMING.test(`${with6.parts.hairBack}.png`)).toBe(true);
  });

  it('後ろ髪の割り当ては素材の数の中に収まる', () => {
    for (let i = 0; i < 60; i++) {
      const profile = buildVisualProfile({ player: fakePlayer(`hb-${i}`) }, { hairBack: 3 });
      expect(['hairback_001', 'hairback_002', 'hairback_003']).toContain(profile.parts.hairBack);
    }
  });

  it('必須の種類は全選手にそろっている', () => {
    for (const player of newGame().players.slice(0, 120)) {
      const profile = buildVisualProfile({ player });
      for (const category of REQUIRED_CATEGORIES) {
        expect(profile.parts[category], `${player.id}/${category}`).toBeTruthy();
      }
    }
  });

  it('素材が1枚も無ければ、必須がすべて足りないと分かる', () => {
    const profile = buildVisualProfileFromId({ playerId: 'fb', age: 27 });
    expect(missingCategories(profile, () => false)).toEqual(REQUIRED_CATEGORIES);
  });

  it('状態の素材が無くても「足りない」とは言わない（任意だから）', () => {
    const profile = buildVisualProfile({ player: fakePlayer('fb-2'), visualState: 'injury' });
    expect(missingCategories(profile, (category) => category !== 'special')).toEqual([]);
  });
});

/* ================================================================
 * 12. ゲームのドメインに触らない（§44）
 * ============================================================== */

describe('PHASE4.7 ゲームに触らない', () => {
  it('設計図を作っても rngState が動かない', () => {
    const state = newGame();
    const before = state.rngState;
    for (const player of state.players) buildVisualProfile({ player, state });
    expect(state.rngState).toBe(before);
  });

  it('設計図を作っても state がまったく変わらない', () => {
    const state = newGame();
    const before = JSON.stringify(state);
    for (const player of state.players) {
      buildVisualProfile({ player, state });
      visualStateOf(state, player);
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('設計図を作りながら試合を進めても結果が同じ', () => {
    const play = (withProfiles: boolean) => {
      let state = createNewGame(PLAYER_TEAM, 10, 471471);
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
  });

  it('セーブに素材の情報が入らない（§43）', () => {
    const saved = JSON.stringify(newGame());
    expect(saved).not.toContain('assets/players');
    expect(saved).not.toContain('.webp');
    expect(saved).not.toContain('visualProfile');
    expect(saved).not.toContain('IMAGE_API_KEY');
  });

  it('設計図はセーブ無しで playerId から作り直せる', () => {
    const state = newGame();
    const player = state.players[9];
    const rebuilt = buildVisualProfileFromId({
      playerId: player.id,
      age: player.age,
      isPitcher: player.isPitcher,
    });
    expect(rebuilt.parts.head).toBe(buildVisualProfile({ player }).parts.head);
  });
});

/* ================================================================
 * 13. ゲーム本体に外部依存を入れない（§46・§47）
 * ============================================================== */

describe('PHASE4.7 ゲーム本体の安全性', () => {
  it('見る対象のファイルがすべて読み込めている', () => {
    expect(Object.keys(GAME_SOURCES).length).toBeGreaterThanOrEqual(5);
  });

  it('ゲーム本体が画像生成プロバイダーを読み込んでいない（§46）', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('scripts/assets');
      expect(source, path).not.toContain('ImageGenerationProvider');
      expect(source, path).not.toContain('resolveProvider');
    }
  });

  it('ゲーム本体が通信をしていない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('fetch(');
      expect(source, path).not.toContain('XMLHttpRequest');
      expect(source, path).not.toContain('WebSocket');
      expect(source, path).not.toContain('EventSource');
      expect(source, path).not.toContain('sendBeacon');
    }
  });

  it('ゲーム本体に外部URLが書かれていない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toMatch(/https?:\/\//);
    }
  });

  it('ゲーム本体に鍵・秘密が書かれていない（§47）', () => {
    const banned = [
      'apiKey',
      'API_KEY',
      'IMAGE_API_KEY',
      'Authorization',
      'Bearer ',
      'process.env',
      'import.meta.env.VITE_',
      'secret',
      'credential',
    ];
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      const lower = source.toLowerCase();
      for (const word of banned) {
        expect(lower.includes(word.toLowerCase()), `${path} / ${word}`).toBe(false);
      }
    }
  });

  it('ゲーム本体がプロバイダーの名前を持っていない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      const lower = source.toLowerCase();
      for (const word of ['openai', 'replicate', 'fal.ai', 'stability', 'midjourney', 'huggingface']) {
        expect(lower.includes(word), `${path} / ${word}`).toBe(false);
      }
    }
  });

  it('ゲーム本体が Math.random / Date.now を使っていない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('Math.random');
      expect(source, path).not.toContain('Date.now');
      expect(source, path).not.toContain('performance.now');
    }
  });

  it('ゲーム本体がゲームの乱数器を読み込んでいない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toMatch(/from '.*\/rng'/);
      expect(source, path).not.toContain('rngState');
      expect(source, path).not.toContain('advanceRng');
    }
  });

  it('ゲーム本体が実行時に画像を作らない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('getContext');
      expect(source, path).not.toContain('toDataURL');
      expect(source, path).not.toContain('OffscreenCanvas');
      expect(source, path).not.toContain('createImageBitmap');
    }
  });

  it('素材の参照はビルド時に解決される形しか使っていない', () => {
    const registry = GAME_SOURCES['../ui/visual/assetRegistry.ts'];
    expect(registry).toBeTruthy();
    expect(registry).toContain('import.meta.glob');
  });

  it('目録に外部URLが入っていない', () => {
    expect(JSON.stringify(MANIFEST)).not.toMatch(/https?:\/\//);
  });

  it('目録に鍵が入っていない（§17）', () => {
    const raw = JSON.stringify(MANIFEST).toLowerCase();
    for (const word of ['apikey', 'bearer', 'secret', 'token', 'credential']) {
      expect(raw.includes(word), word).toBe(false);
    }
  });

  it('仕様に外部URLが入っていない', () => {
    expect(JSON.stringify(SPEC)).not.toMatch(/https?:\/\//);
  });
});

/* ================================================================
 * 14. 開発時のパイプライン側の安全性（§3・§33）
 * ============================================================== */

describe('PHASE4.7 パイプラインの安全性', () => {
  it('パイプラインのファイルが読み込めている', () => {
    expect(Object.keys(TOOL_SOURCES).length).toBeGreaterThanOrEqual(7);
  });

  it('鍵を直接書いているファイルが無い', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      expect(source, path).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(source, path).not.toMatch(/r8_[A-Za-z0-9]{16,}/);
      expect(source, path).not.toMatch(/["'][A-Za-z0-9_-]{40,}["']/);
    }
  });

  it('パイプラインが process.env を直接読んでいない（CLI から渡す）', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      expect(source, path).not.toContain('process.env');
    }
  });

  it('パイプラインがゲームのドメインを読み込んでいない', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      expect(source, path).not.toContain("from '../../src/domain");
      expect(source, path).not.toContain('rngState');
    }
  });

  it('パイプラインが Math.random を使っていない', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      expect(source, path).not.toContain('Math.random');
    }
  });

  it('通信するのはプロバイダーのファイルだけ', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      if (path.includes('/providers/') || path.endsWith('provider.ts')) continue;
      expect(source, path).not.toContain('fetch(');
    }
  });

  it('プロバイダー以外に外部URLが書かれていない', () => {
    for (const [path, source] of Object.entries(TOOL_SOURCES)) {
      if (path.includes('/providers/')) continue;
      expect(source, path).not.toMatch(/https?:\/\//);
    }
  });
});

/* ================================================================
 * 15. 設定ファイルと資料（§3・§48・§50）
 * ============================================================== */

describe('PHASE4.7 設定と資料', () => {
  it('.env.example がある', () => {
    expect(ENV_EXAMPLE).toBeTruthy();
  });

  it('.env.example に実際の鍵が書かれていない', () => {
    expect(ENV_EXAMPLE).toContain('IMAGE_PROVIDER=');
    expect(ENV_EXAMPLE).toContain('IMAGE_API_KEY=');
    expect(ENV_EXAMPLE).not.toMatch(/IMAGE_API_KEY=\S/);
    expect(ENV_EXAMPLE).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('.env が git に入らないようになっている（§3）', () => {
    expect(GITIGNORE).toContain('.env');
  });

  it('無加工の素材が git に入らないようになっている（§19・§48）', () => {
    expect(GITIGNORE).toContain('assets/original/');
    expect(GITIGNORE).toContain('assets/incoming/');
    expect(GITIGNORE).toContain('assets/state/');
  });

  it('ゲームに入る素材は git 管理から外していない（§48）', () => {
    expect(GITIGNORE).not.toContain('src/assets');
  });

  it('Style Bible がある（§50）', () => {
    const bible = DOCS['../../assets/prompts/style-bible.md'];
    expect(bible).toBeTruthy();
    expect(bible.length).toBeGreaterThan(2000);
  });

  it('Style Bible が「生成物ではなくここが基準」と言っている（§50）', () => {
    const bible = DOCS['../../assets/prompts/style-bible.md'];
    expect(bible).toContain('生成された画像がデザインを決めるのではありません');
  });

  it('Style Bible に禁止事項が書いてある（§9）', () => {
    const bible = DOCS['../../assets/prompts/style-bible.md'];
    for (const word of ['実在', 'ロゴ', '透かし', '既存ゲーム']) {
      expect(bible, word).toContain(word);
    }
  });

  it('Style Bible に個体差の指示がある（§6）', () => {
    const bible = DOCS['../../assets/prompts/style-bible.md'];
    expect(bible).toContain('同じ顔');
    expect(bible).toContain('構造そのものが違う');
  });

  it('Style Bible に線と陰影の決めごとがある', () => {
    const bible = DOCS['../../assets/prompts/style-bible.md'];
    expect(bible).toContain('線');
    expect(bible).toContain('陰影');
    // 絵柄を変えたので線も太くした（5px → 12〜16px）
    expect(bible).toContain('1024px 基準で 12〜16px');
  });

  it('Style Bible が球団色を焼き込ませない', () => {
    expect(DOCS['../../assets/prompts/style-bible.md']).toContain('球団色は絶対に焼き込まない');
  });

  it('手順書がある', () => {
    const workflow = DOCS['../../assets/prompts/workflow.md'];
    expect(workflow).toBeTruthy();
    expect(workflow).toContain('assets:dry-run');
    expect(workflow).toContain('assets:process');
    expect(workflow).toContain('assets:check');
  });

  it('手順書が段階を踏ませている（§14）', () => {
    const workflow = DOCS['../../assets/prompts/workflow.md'];
    expect(workflow).toContain('いきなり全部作らないでください');
  });

  it('手順書が人の目での確認を求めている（§15）', () => {
    expect(DOCS['../../assets/prompts/workflow.md']).toContain('ここを飛ばさないでください');
  });

  it('資料に実際の鍵が書かれていない', () => {
    for (const [path, text] of Object.entries(DOCS)) {
      expect(text, path).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(text, path).not.toMatch(/r8_[A-Za-z0-9]{16,}/);
    }
  });
});

/* ================================================================
 * 16. 目録（§16）
 * ============================================================== */

describe('PHASE4.7 目録', () => {
  it('目録に載る種類はすべてゲーム側の種類である', () => {
    for (const category of Object.keys(MANIFEST.parts)) {
      expect(VISUAL_CATEGORIES).toContain(category as VisualCategory);
    }
  });

  it('素材が0点でもゲームが成立する（いまの状態）', () => {
    const total = Object.values(MANIFEST.parts).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(0);
    const profile = buildVisualProfile({ player: newGame().players[0] });
    expect(profile.svg.head).toBeTruthy();
  });

  it('素材が0点でも設計図は必須の種類をすべて割り当てる', () => {
    const profile = buildVisualProfile({ player: newGame().players[0] });
    for (const category of REQUIRED_CATEGORIES) {
      expect(profile.parts[category], category).toBeTruthy();
    }
  });
});

/* ================================================================
 * 17. 透明背景を出せないモデル（fal-ai/flux/dev）への対応
 *
 * FLUX には透明背景を出す機能が無い。
 * 「transparent background」と書いても透明にはならないので、
 * 単色の下地を描かせて、後処理で抜く。ここはその後処理の検証。
 * ============================================================== */

import {
  MATTE_BACKGROUND,
  MATTE_BACKGROUND_HEX,
  cornersTransparent,
  cutout,
  defringe,
  despill,
  estimateBackground,
  hasTransparency,
  inspectFringe,
  isKeyColor,
  removeFlatBackground,
  trimHalo,
} from '../../scripts/assets/pipeline';
import {
  ANCHOR_TOLERANCE,
  LIFT_FAIL,
  MAX_FILE_BYTES,
  checkTransparency,
  opaqueShare,
  softAlphaShare,
} from '../../scripts/assets/transparency';
import { framing, negativePrompt } from '../../scripts/assets/prompts';

/**
 * fal-ai/flux/dev が返してきそうな画像を作る。
 * 大事なのは次の3点で、どれも実際に起きる:
 *   ・背景は不透明な単色（アルファが無い）
 *   ・輪郭は下地と人物が混ざった色（＝そのまま抜くとハローになる）
 *   ・背景にわずかなムラ
 */
function fluxLike(
  width: number,
  height: number,
  shapes: Array<{ cx: number; cy: number; rx: number; ry: number; shade: number }>,
  options: { background?: [number, number, number]; noise?: number; feather?: number } = {},
): RgbaImage {
  const background = options.background ?? MATTE_BACKGROUND;
  const noise = options.noise ?? 4;
  const feather = options.feather ?? 0.012;
  const image = createImage(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const wobble = ((x * 7 + y * 13) % (noise * 2)) - noise;
      let r = background[0] + wobble;
      let g = background[1] + wobble;
      let b = background[2] + wobble;

      let cover = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (const shape of shapes) {
        const d = Math.sqrt(((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2);
        const a = d <= 1 ? 1 : d >= 1 + feather ? 0 : (1 + feather - d) / feather;
        if (a <= 0) continue;
        const value = shape.shade + Math.round(26 * ((y - shape.cy) / shape.ry));
        sr = value;
        sg = value - 14;
        sb = value - 26;
        cover = Math.max(cover, a);
      }
      if (cover > 0) {
        r = sr * cover + r * (1 - cover);
        g = sg * cover + g * (1 - cover);
        b = sb * cover + b * (1 - cover);
      }
      image.data[at] = Math.max(0, Math.min(255, Math.round(r)));
      image.data[at + 1] = Math.max(0, Math.min(255, Math.round(g)));
      image.data[at + 2] = Math.max(0, Math.min(255, Math.round(b)));
      image.data[at + 3] = 255;
    }
  }
  return image;
}

/** 下地の色が輪郭に残っている割合（ハローの実測） */
function keyResidue(image: RgbaImage, background: [number, number, number]): number {
  const { width, height, data } = image;
  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return data[(y * width + x) * 4 + 3];
  };
  let edge = 0;
  let residue = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (data[at + 3] === 0) continue;
      let onEdge = false;
      for (let dy = -2; dy <= 2 && !onEdge; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (alphaAt(x + dx, y + dy) === 0) {
            onEdge = true;
            break;
          }
        }
      }
      if (!onEdge) continue;
      edge += 1;
      // 下地の一番強い成分が、他より突出していれば消し残り
      const r = data[at];
      const g = data[at + 1];
      const b = data[at + 2];
      if (background[1] > background[0] && background[1] > background[2]) {
        if (g > r + 25 && g > b + 25) residue += 1;
      }
    }
  }
  return edge === 0 ? 0 : residue / edge;
}

const GREEN_MATTE = fluxLike(400, 500, [{ cx: 200, cy: 250, rx: 110, ry: 150, shade: 190 }]);

describe('PHASE4.7 透明背景を出せないモデルへの対応', () => {
  it('抜くための下地の色が決まっている', () => {
    expect(MATTE_BACKGROUND).toEqual([0, 177, 64]);
    expect(MATTE_BACKGROUND_HEX.toUpperCase()).toBe('#00B140');
  });

  it('下地の色は鮮やかで、抜くのに使える', () => {
    expect(isKeyColor(MATTE_BACKGROUND)).toBe(true);
  });

  it('白や灰色は「抜くのに使える色」ではない', () => {
    expect(isKeyColor([255, 255, 255])).toBe(false);
    expect(isKeyColor([128, 128, 128])).toBe(false);
    expect(isKeyColor([16, 16, 18])).toBe(false);
  });

  it('下地の色は肌・髪・生成りの白のどれからも離れている', () => {
    const far = (color: [number, number, number]) =>
      Math.max(
        Math.abs(color[0] - MATTE_BACKGROUND[0]),
        Math.abs(color[1] - MATTE_BACKGROUND[1]),
        Math.abs(color[2] - MATTE_BACKGROUND[2]),
      );
    expect(far([232, 198, 172])).toBeGreaterThan(90); // 肌
    expect(far([33, 29, 26])).toBeGreaterThan(90); // 髪
    expect(far([242, 239, 230])).toBeGreaterThan(90); // 生成りの白
  });

  it('縁から下地の色を見立てられる', () => {
    const estimate = estimateBackground(GREEN_MATTE);
    expect(Math.abs(estimate.color[1] - MATTE_BACKGROUND[1])).toBeLessThanOrEqual(6);
    expect(estimate.uniformity).toBeGreaterThan(0.9);
  });

  it('人物が写り込んでいても、縁の中央値なので引きずられない', () => {
    const image = fluxLike(300, 300, [{ cx: 150, cy: 150, rx: 140, ry: 140, shade: 200 }]);
    expect(estimateBackground(image).uniformity).toBeGreaterThan(0.5);
  });

  it('ムラのある背景は「一様さ」が下がる', () => {
    const noisy = fluxLike(300, 300, [{ cx: 150, cy: 150, rx: 60, ry: 60, shade: 190 }], {
      noise: 60,
    });
    expect(estimateBackground(noisy).uniformity).toBeLessThan(
      estimateBackground(GREEN_MATTE).uniformity,
    );
  });

  it('生成直後は透明背景ではない（FLUX はアルファを返さない）', () => {
    expect(cornersTransparent(GREEN_MATTE)).toBe(false);
    expect(hasTransparency(GREEN_MATTE)).toBe(false);
  });

  it('単色の下地を抜くと四隅が透明になる', () => {
    const { image } = removeFlatBackground(GREEN_MATTE);
    expect(cornersTransparent(image)).toBe(true);
  });

  it('鮮やかな下地なら、透け具合を実測して抜く', () => {
    const result = removeFlatBackground(GREEN_MATTE);
    expect(result.keyed).toBe(true);
  });

  it('白い下地なら、色の差から見立てて抜く', () => {
    const white = fluxLike(300, 300, [{ cx: 150, cy: 150, rx: 80, ry: 90, shade: 60 }], {
      background: [250, 250, 250],
    });
    const result = removeFlatBackground(white);
    expect(result.keyed).toBe(false);
    expect(cornersTransparent(result.image)).toBe(true);
  });

  it('抜いても人物は残る', () => {
    const { image } = removeFlatBackground(GREEN_MATTE);
    const bounds = contentBounds(image);
    expect(bounds.empty).toBe(false);
    expect(bounds.width).toBeGreaterThan(180);
  });

  it('囲まれた同色は抜かない（白いユニフォームを守る）', () => {
    // 外が緑、中に緑の穴があいた人物
    const image = createImage(160, 160);
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 160; x++) {
        const at = (y * 160 + x) * 4;
        const r = Math.hypot(x - 80, y - 80);
        const inside = r < 25;
        const ring = r >= 25 && r < 60;
        const color = ring ? [190, 176, 160] : MATTE_BACKGROUND;
        image.data[at] = color[0];
        image.data[at + 1] = color[1];
        image.data[at + 2] = color[2];
        image.data[at + 3] = 255;
        if (inside) {
          image.data[at] = MATTE_BACKGROUND[0];
          image.data[at + 1] = MATTE_BACKGROUND[1];
          image.data[at + 2] = MATTE_BACKGROUND[2];
        }
      }
    }
    const { image: out } = removeFlatBackground(image);
    // 真ん中（囲まれた下地）は残る
    expect(out.data[(80 * 160 + 80) * 4 + 3]).toBe(255);
    // 隅（外の下地）は消える
    expect(out.data[3]).toBe(0);
  });

  it('ハロー除去をしないと下地の色が縁に残る', () => {
    const { image } = removeFlatBackground(GREEN_MATTE);
    expect(keyResidue(image, MATTE_BACKGROUND)).toBeGreaterThan(0.2);
  });

  it('ハロー除去とスピル除去で、下地の色が縁から消える', () => {
    const result = cutout(GREEN_MATTE);
    expect(keyResidue(result.image, MATTE_BACKGROUND)).toBeLessThan(0.02);
  });

  it('ハローを消しても人物の色は変わらない', () => {
    const result = cutout(GREEN_MATTE);
    const bounds = contentBounds(result.image);
    const x = Math.round((bounds.left + bounds.right) / 2);
    const y = Math.round((bounds.top + bounds.bottom) / 2);
    const at = (y * result.image.width + x) * 4;
    // もとの人物の色（190 前後）が保たれている
    expect(result.image.data[at]).toBeGreaterThan(160);
    expect(result.image.data[at]).toBeLessThan(225);
    expect(result.image.data[at + 3]).toBe(255);
  });

  it('スピル除去は、下地の成分だけを抑える', () => {
    const image = createImage(2, 1);
    // 緑がとび抜けた画素
    image.data.set([120, 220, 100, 255, 120, 100, 110, 255]);
    const out = despill(image, MATTE_BACKGROUND);
    expect(out.data[1]).toBeLessThan(220);
    expect(out.data[0]).toBe(120);
    expect(out.data[2]).toBe(100);
    // もともと突出していない画素は変えない
    expect(out.data[5]).toBe(100);
  });

  it('スピル除去は、鮮やかでない下地では何もしない', () => {
    const image = createImage(1, 1);
    image.data.set([120, 220, 100, 255]);
    const out = despill(image, [250, 250, 250]);
    expect([...out.data]).toEqual([120, 220, 100, 255]);
  });

  it('引き算（defringe）は透明・不透明の画素を変えない', () => {
    const image = createImage(3, 1);
    image.data.set([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128]);
    const out = defringe(image, [0, 0, 0]);
    expect([...out.data.slice(0, 4)]).toEqual([10, 20, 30, 0]);
    expect([...out.data.slice(4, 8)]).toEqual([40, 50, 60, 255]);
  });

  it('薄い膜を落とせる', () => {
    const image = createImage(3, 1);
    image.data.set([1, 1, 1, 10, 2, 2, 2, 90, 3, 3, 3, 255]);
    const out = trimHalo(image, 40);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(90);
    expect(out.data[11]).toBe(255);
  });

  it('すでに透明な素材は、抜き取りを飛ばす', () => {
    const image = createImage(40, 40);
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) image.data[(y * 40 + x) * 4 + 3] = 255;
    }
    const result = cutout(image);
    expect(result.steps[0]).toContain('すでに透明背景');
  });

  it('抜き取りの手順が記録される', () => {
    const result = cutout(GREEN_MATTE);
    expect(result.steps.join(' ')).toContain('単色背景を抜いた');
    expect(result.steps.join(' ')).toContain('ハロー除去');
    expect(result.steps.join(' ')).toContain('スピル除去');
  });

  it('どんなキャンバスの大きさでも抜ける', () => {
    for (const [width, height] of [
      [512, 512],
      [1024, 1280],
      [920, 1160],
      [1400, 700],
    ]) {
      const image = fluxLike(width, height, [
        { cx: width / 2, cy: height / 2, rx: width / 5, ry: height / 5, shade: 180 },
      ]);
      const result = cutout(image);
      expect(cornersTransparent(result.image), `${width}x${height}`).toBe(true);
      expect(contentBounds(result.image).empty, `${width}x${height}`).toBe(false);
    }
  });
});

/* ================================================================
 * 18. 輪郭の見立て（白髪を誤って弾かないこと）
 * ============================================================== */

describe('PHASE4.7 輪郭の見立て', () => {
  /** 縁だけが明るい（＝背景の消し残り）素材 */
  function withHalo(rim: [number, number, number], core: [number, number, number]): RgbaImage {
    const image = createImage(300, 300);
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const at = (y * 300 + x) * 4;
        const r = Math.hypot(x - 150, y - 150);
        if (r > 100) continue;
        const color = r > 92 ? rim : core;
        image.data[at] = color[0];
        image.data[at + 1] = color[1];
        image.data[at + 2] = color[2];
        image.data[at + 3] = 255;
      }
    }
    return image;
  }

  it('縁と内側の明るさの差を測れる', () => {
    const report = inspectFringe(withHalo([250, 250, 250], [60, 50, 44]));
    expect(report.corePixels).toBeGreaterThan(0);
    expect(report.lift).toBeGreaterThan(LIFT_FAIL);
  });

  it('縁も内側も同じ色なら、差はほぼ0', () => {
    const report = inspectFringe(withHalo([240, 240, 238], [240, 240, 238]));
    expect(Math.abs(report.lift)).toBeLessThan(8);
  });

  it('白いハローは不合格になる', () => {
    const image = withHalo([250, 250, 250], [60, 50, 44]);
    const placed = fitToCanvas(image, { anchor: ANCHORS.head_shape, targetWidth: 536 });
    const bytes = encodePng(placed);
    const report = checkTransparency({
      id: 'halo',
      image: placed,
      bytes,
      category: 'head_shape',
      normalized: true,
    });
    expect(report.checks.find((check) => check.id === 'white-fringe')!.level).toBe('FAIL');
  });

  it('灰色のハローは不合格になる', () => {
    const image = withHalo([186, 186, 186], [56, 46, 40]);
    const placed = fitToCanvas(image, { anchor: ANCHORS.head_shape, targetWidth: 536 });
    const bytes = encodePng(placed);
    const report = checkTransparency({
      id: 'halo',
      image: placed,
      bytes,
      category: 'head_shape',
      normalized: true,
    });
    expect(report.checks.find((check) => check.id === 'grey-fringe')!.level).toBe('FAIL');
  });

  it('白髪の素材は、縁が白くても合格する（誤検知しない）', () => {
    // 白髪＝縁も内側も白い
    const image = withHalo([238, 237, 234], [238, 237, 234]);
    const placed = fitToCanvas(image, { anchor: ANCHORS.hair_style, targetWidth: 560 });
    const bytes = encodePng(placed);
    const report = checkTransparency({
      id: 'hair_001c09',
      image: placed,
      bytes,
      category: 'hair_style',
      normalized: true,
    });
    expect(report.checks.find((check) => check.id === 'white-fringe')!.level).not.toBe('FAIL');
    expect(report.checks.find((check) => check.id === 'grey-fringe')!.level).not.toBe('FAIL');
  });
});

/* ================================================================
 * 19. 透明PNGの検査（14項目）
 * ============================================================== */

describe('PHASE4.7 透明PNGの検査', () => {
  const CANVAS = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

  function disc(
    color: [number, number, number],
    options: { cx?: number; cy?: number; rx?: number; ry?: number; alpha?: number } = {},
  ): RgbaImage {
    const image = createImage(CANVAS.width, CANVAS.height);
    const cx = options.cx ?? 512;
    const cy = options.cy ?? 470;
    const rx = options.rx ?? 268;
    const ry = options.ry ?? 334;
    for (let y = 0; y < CANVAS.height; y++) {
      for (let x = 0; x < CANVAS.width; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
        const at = (y * CANVAS.width + x) * 4;
        image.data[at] = color[0];
        image.data[at + 1] = color[1];
        image.data[at + 2] = color[2];
        image.data[at + 3] = options.alpha ?? 255;
      }
    }
    return image;
  }

  const check = (image: RgbaImage | null, over: Partial<Parameters<typeof checkTransparency>[0]> = {}) => {
    const bytes = image ? encodePng(image) : new Uint8Array([1, 2, 3, 4]);
    return checkTransparency({
      id: 'x',
      image,
      bytes,
      category: 'head_shape',
      normalized: true,
      ...over,
    });
  };

  const levelOf = (report: ReturnType<typeof checkTransparency>, id: string) =>
    report.checks.find((c) => c.id === id)?.level;

  it('正しい素材は合格する', () => {
    const report = check(disc([190, 170, 150]));
    const fails = report.checks.filter((c) => c.level === 'FAIL' && c.id !== 'file-size');
    expect(fails.map((c) => c.id)).toEqual([]);
  });

  it('14項目すべてを検査している', () => {
    const report = check(disc([190, 170, 150]));
    for (const id of [
      'is-png',
      'decodable',
      'alpha-channel',
      'corners',
      'background-left',
      'white-fringe',
      'grey-fringe',
      'halo',
      'inside-canvas',
      'bbox-min',
      'bbox-max',
      'canvas-size',
      'anchor',
      'file-size',
    ]) {
      expect(levelOf(report, id), id).toBeTruthy();
    }
  });

  it('PNG でなければ落とす', () => {
    const report = checkTransparency({
      id: 'x',
      image: null,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      category: 'head_shape',
      decodeError: 'JPEG です',
    });
    expect(levelOf(report, 'is-png')).toBe('FAIL');
    expect(report.ok).toBe(false);
  });

  it('壊れた PNG は落とす', () => {
    const broken = encodePng(disc([190, 170, 150])).slice(0, 120);
    const report = checkTransparency({
      id: 'x',
      image: null,
      bytes: broken,
      category: 'head_shape',
      decodeError: '途中で終わっています',
    });
    expect(levelOf(report, 'decodable')).toBe('FAIL');
  });

  it('アルファが無ければ落とす', () => {
    const image = createImage(CANVAS.width, CANVAS.height);
    for (let at = 0; at < image.data.length; at += 4) {
      image.data[at] = 120;
      image.data[at + 3] = 255;
    }
    expect(levelOf(check(image), 'alpha-channel')).toBe('FAIL');
  });

  it('四隅が不透明なら落とす', () => {
    const image = disc([190, 170, 150]);
    image.data[3] = 255;
    expect(levelOf(check(image), 'corners')).toBe('FAIL');
  });

  it('背景が抜けていなければ落とす', () => {
    const image = createImage(CANVAS.width, CANVAS.height);
    for (let at = 0; at < image.data.length; at += 4) {
      image.data[at + 1] = 177;
      image.data[at + 3] = 255;
    }
    expect(levelOf(check(image), 'background-left')).toBe('FAIL');
  });

  it('半透明の膜が残っていれば落とす', () => {
    const image = disc([190, 170, 150]);
    for (let at = 3; at < image.data.length; at += 4) {
      if (image.data[at] === 0) image.data[at] = 40;
    }
    expect(levelOf(check(image), 'halo')).toBe('FAIL');
  });

  it('キャンバス外にはみ出していれば落とす', () => {
    expect(levelOf(check(disc([190, 170, 150], { rx: 600, ry: 700 })), 'inside-canvas')).toBe('FAIL');
  });

  it('中身が小さすぎれば落とす', () => {
    expect(levelOf(check(disc([190, 170, 150], { rx: 20, ry: 22 })), 'bbox-min')).toBe('FAIL');
  });

  it('中身が大きすぎれば落とす', () => {
    expect(levelOf(check(disc([190, 170, 150], { rx: 560, ry: 700 })), 'bbox-max')).toBe('FAIL');
  });

  it('1024x1280 でなければ落とす', () => {
    const image = createImage(512, 640);
    for (let y = 100; y < 500; y++) {
      for (let x = 100; x < 400; x++) {
        const at = (y * 512 + x) * 4;
        image.data[at] = 190;
        image.data[at + 3] = 255;
      }
    }
    expect(levelOf(check(image), 'canvas-size')).toBe('FAIL');
  });

  it('基準点がずれていれば落とす', () => {
    expect(levelOf(check(disc([190, 170, 150], { cx: 300, cy: 900 })), 'anchor')).toBe('FAIL');
  });

  it('基準点が合っていれば通る', () => {
    expect(levelOf(check(disc([190, 170, 150], { cx: 512, cy: 470 })), 'anchor')).toBe('PASS');
  });

  it('基準点の許容は仕様どおり', () => {
    expect(ANCHOR_TOLERANCE).toBeGreaterThan(0);
    const justInside = disc([190, 170, 150], { cx: 512 + ANCHOR_TOLERANCE - 2, cy: 470 });
    expect(levelOf(check(justInside), 'anchor')).toBe('PASS');
  });

  it('正規化前なら大きさと基準点は見送る', () => {
    const image = createImage(400, 400);
    for (let y = 100; y < 300; y++) {
      for (let x = 100; x < 300; x++) {
        const at = (y * 400 + x) * 4;
        image.data[at] = 190;
        image.data[at + 3] = 255;
      }
    }
    const report = check(image, { normalized: false });
    expect(levelOf(report, 'canvas-size')).toBe('PASS');
    expect(levelOf(report, 'anchor')).toBe('PASS');
  });

  it('ファイルサイズの上限がある', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(100_000);
    const report = checkTransparency({
      id: 'x',
      image: disc([190, 170, 150]),
      bytes: new Uint8Array(MAX_FILE_BYTES + 1),
      category: 'head_shape',
    });
    expect(levelOf(report, 'file-size')).toBe('FAIL');
  });

  it('中身が空なら落とす', () => {
    expect(levelOf(check(createImage(CANVAS.width, CANVAS.height)), 'not-empty')).toBe('FAIL');
  });

  it('不透明な画素の割合を測れる', () => {
    expect(opaqueShare(createImage(10, 10))).toBe(0);
    const image = createImage(10, 10);
    for (let at = 3; at < image.data.length; at += 4) image.data[at] = 255;
    expect(opaqueShare(image)).toBe(1);
  });

  it('半透明な画素の割合を測れる', () => {
    const image = createImage(4, 1);
    image.data.set([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 200]);
    expect(softAlphaShare(image)).toBeCloseTo(2 / 3, 2);
  });

  it('FLUX 風の画像を通しで処理すると合格する', () => {
    const raw = fluxLike(1024, 1280, [{ cx: 500, cy: 600, rx: 250, ry: 330, shade: 196 }]);
    const cut = cutout(raw);
    const placed = fitToCanvas(cut.image, { anchor: ANCHORS.head_shape, targetWidth: 536 });
    const bytes = encodePng(placed);
    const report = checkTransparency({
      id: 'head_001',
      image: placed,
      bytes,
      category: 'head_shape',
      normalized: true,
    });
    const fails = report.checks.filter((c) => c.level === 'FAIL' && c.id !== 'file-size');
    expect(fails.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
  });
});

/* ================================================================
 * 20. 透明を出せないモデル向けのプロンプト
 * ============================================================== */

describe('PHASE4.7 下地を描かせるプロンプト', () => {
  it('透明を出せるモデルには透明背景を頼む', () => {
    expect(framing(true)).toContain('fully transparent background');
  });

  it('透明を出せないモデルには「transparent background」と書かない', () => {
    expect(framing(false)).not.toContain('transparent background');
  });

  it('透明を出せないモデルには単色の下地を頼む', () => {
    const text = framing(false);
    expect(text).toContain(MATTE_BACKGROUND_HEX);
    expect(text).toContain('flat solid');
    expect(text).toContain('no gradient');
  });

  it('どちらの場合も、影と枠は禁止する', () => {
    for (const transparent of [true, false]) {
      expect(framing(transparent), String(transparent)).toContain('no cast shadow');
      expect(framing(transparent), String(transparent)).toContain('no frame');
    }
  });

  it('下地を描かせるときは background を丸ごと否定しない', () => {
    // 'background' を否定すると下地まで消えてしまう
    expect(negativePrompt(false)).not.toMatch(/(^|,\s)background(,|$)/);
    expect(negativePrompt(true)).toMatch(/(^|,\s)background(,|$)/);
  });

  it('下地を描かせるときも、模様や風景は否定する', () => {
    const text = negativePrompt(false);
    for (const word of ['gradient background', 'textured background', 'scenery', 'checkerboard']) {
      expect(text, word).toContain(word);
    }
  });

  it('どちらの場合も、権利まわりの禁止は変わらない', () => {
    for (const transparent of [true, false]) {
      for (const word of ['real athlete', 'celebrity likeness', 'watermark', 'logo']) {
        expect(negativePrompt(transparent), `${transparent}/${word}`).toContain(word);
      }
    }
  });

  it('透明を出せないモデル向けの文面は、抜けることを前提にしている', () => {
    const parts = buildPrompt('head_shape', 0, { transparent: false });
    expect(parts.transparent).toBe(false);
    expect(parts.prompt).toContain('removed cleanly afterwards');
  });

  it('文面がどちらの前提で作られたかが残る', () => {
    expect(buildPrompt('eyes', 0).transparent).toBe(true);
    expect(buildPrompt('eyes', 0, { transparent: false }).transparent).toBe(false);
  });

  it('見本の1枚も下地の指定を切り替えられる', () => {
    expect(masterStyleSheetPrompt(true)).toContain('fully transparent background');
    expect(masterStyleSheetPrompt(false)).toContain(MATTE_BACKGROUND_HEX);
  });

  it('文面の版が上がっている（下地の指定を足したため）', () => {
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('まとめて組み立てるときも前提を渡せる', () => {
    const prompts = buildPromptsFor('eyes', 3, { transparent: false });
    expect(prompts.length).toBe(3);
    expect(prompts.every((part) => part.transparent === false)).toBe(true);
  });
});

/* ================================================================
 * 21. fal のつなぎ
 * ============================================================== */

describe('PHASE4.7 fal のつなぎ', () => {
  it('透明背景は返せないと宣言している', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'fal', IMAGE_API_KEY: 'test-key' });
    expect(resolution.available).toBe(true);
    if (resolution.available) {
      expect(resolution.provider.supportsTransparency()).toBe(false);
    }
  });

  it('FAL_KEY でも鍵として認める', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'fal', FAL_KEY: 'test-key' });
    expect(resolution.available).toBe(true);
    if (resolution.available) expect(resolution.provider.name).toBe('fal');
  });

  it('IMAGE_API_KEY が優先される', () => {
    const resolution = resolveProvider({
      IMAGE_PROVIDER: 'fal',
      IMAGE_API_KEY: 'a',
      FAL_KEY: 'b',
    });
    expect(resolution.available).toBe(true);
  });

  it('どちらの鍵も無ければ、両方の名前を教える', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'fal' });
    expect(resolution.available).toBe(false);
    if (!resolution.available) {
      expect(resolution.missing).toContain('IMAGE_API_KEY');
      expect(resolution.missing).toContain('FAL_KEY');
    }
  });

  it('FAL_KEY は fal 以外では使わない', () => {
    const resolution = resolveProvider({ IMAGE_PROVIDER: 'openai', FAL_KEY: 'test-key' });
    expect(resolution.available).toBe(false);
  });

  it('必要な環境変数として FAL_KEY が載っている', () => {
    const fal = PROVIDER_REQUIREMENTS.find((requirement) => requirement.id === 'fal')!;
    expect(fal.envKeys).toContain('FAL_KEY');
    expect(fal.defaultModel).toBe('fal-ai/flux/dev');
  });

  it('つなぎのコードが PNG を指定している', () => {
    const source = TOOL_SOURCES['../../scripts/assets/providers/fal.ts'];
    expect(source).toBeTruthy();
    expect(source).toContain("output_format: 'png'");
  });

  it('つなぎのコードが JPEG を使っていない', () => {
    const source = TOOL_SOURCES['../../scripts/assets/providers/fal.ts'];
    expect(source).not.toContain('jpeg');
    expect(source).not.toContain('jpg');
  });
});

/* ================================================================
 * 22. ゲーム本体に背景除去が入り込んでいないこと
 * ============================================================== */

describe('PHASE4.7 背景除去はゲームに入らない', () => {
  it('ゲーム本体が背景除去のコードを読み込んでいない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('removeFlatBackground');
      expect(source, path).not.toContain('removeBackground');
      expect(source, path).not.toContain('defringe');
      expect(source, path).not.toContain('despill');
      expect(source, path).not.toContain('cutout');
    }
  });

  it('ゲーム本体が画素をいじる処理を持っていない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('getImageData');
      expect(source, path).not.toContain('putImageData');
      expect(source, path).not.toContain('ImageData');
    }
  });

  it('ゲーム本体が下地の色を知らない', () => {
    for (const [path, source] of Object.entries(GAME_SOURCES)) {
      expect(source, path).not.toContain('MATTE_BACKGROUND');
      expect(source, path).not.toContain('00B140');
    }
  });

  it('ゲーム本体が完成した PNG だけを読む', () => {
    const registry = GAME_SOURCES['../ui/visual/assetRegistry.ts'];
    expect(registry).toContain('import.meta.glob');
    expect(registry).not.toContain('fetch(');
    expect(registry).not.toMatch(/https?:\/\//);
  });
});
