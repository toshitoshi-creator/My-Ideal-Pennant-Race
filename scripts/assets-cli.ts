/**
 * PHASE 4.7 素材づくりのCLI（§29・§30・§31・§52・§53）。
 *
 *   npm run assets:dry-run
 *   npm run assets:generate -- --type hair_style --count 3
 *   npm run assets:generate -- --type all --count 3
 *   npm run assets:regenerate -- --failed
 *   npm run assets:check
 *
 * ここは開発時にしか動かない。ゲーム本体には入らない。
 *
 * いちばん大事な決まり：
 *   鍵が無いときに「生成しました」と言わない。BLOCKED と出して止まる（§34）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

/*
 * 会社や実行環境のプロキシごしに動けるようにする。
 *
 * Node の fetch は、HTTPS_PROXY があっても既定では**使いません**。
 * 直に出ようとして、途中の関所に 403 で止められます。
 * しかもその 403 は「許可リストに無い」という文面なので、
 * 設定が足りないように見えて、実際にはプロキシを通っていないだけ、
 * という分かりにくい失敗になります（実際にこれで時間を使いました）。
 *
 * NODE_USE_ENV_PROXY は Node の起動時にしか効かないので、
 * 立っていなければ自分自身を立て直す。
 * プロキシが設定されていない環境では何もしない。
 */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];
if (
  !process.env.NODE_USE_ENV_PROXY &&
  PROXY_ENV.some((name) => (process.env[name] ?? '').trim() !== '')
) {
  // execArgv も渡さないと、TypeScript を読む仕掛け（tsx）が外れてしまう
  const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(result.status ?? 1);
}
import {
  CATALOG,
  catalogEntry,
  isCatalogId,
  plannedCount,
  type CatalogEntry,
  type CatalogId,
} from './assets/catalog';
import {
  PROVIDER_REQUIREMENTS,
  resolveProvider,
  type Env,
  type ProviderResolution,
} from './assets/providers/index';
import {
  buildPrompt,
  buildPromptsFor,
  masterStyleSheetPrompt,
  negativePrompt,
  planGeneration,
  billableCount,
  NEGATIVE_PROMPT,
  PROMPT_VERSION,
} from './assets/prompts';
import { decodePng, encodePng, isPng, type RgbaImage } from './assets/png';
import {
  HAIR_RAMPS,
  SKIN_RAMPS,
  derivatives,
  processPart,
  recolor,
} from './assets/pipeline';
import { inspect, type QualityReport } from './assets/quality';
import {
  CAP_TYPES,
  STYLE_TEST,
  buildCapPrompt,
  buildCharacterPrompt,
  countDiversity,
  diversityPlan,
  capPlan,
  CHARACTER_PROMPT_VERSION,
  type CharacterSpec,
} from './assets/character';
import {
  NEEDS_EYE,
  checkCap,
  checkCharacter,
  type CapReport,
  type CharacterReport,
} from './assets/character-quality';
import { ANCHORS, CANVAS_HEIGHT, CANVAS_WIDTH, OUTPUT_SIZES } from './assets/anchors';
import type { GenerationRequest, GenerationResult } from './assets/provider';

/* ================================================================
 * 置き場所
 * ============================================================== */

const ROOT = process.cwd();
const DIR = {
  /** 手元で作った画像の受け口（local プロバイダー） */
  incoming: join(ROOT, 'assets/incoming'),
  /** AIが返した無加工のもの。ゲームには入れない（§19） */
  original: join(ROOT, 'assets/original'),
  /** 失敗の記録・見本の1枚など */
  state: join(ROOT, 'assets/state'),
  /** ゲームに入るもの */
  production: join(ROOT, 'src/assets/players'),
  /** 絵柄と多様性の検証。ゲームには入れない（§17・§18） */
  styleTest: join(ROOT, 'assets/style-test'),
  /** PHASE 4.7-B §15: 本体と帽子は置き場所を分ける */
  styleTestPlayers: join(ROOT, 'assets/style-test/players'),
  styleTestCaps: join(ROOT, 'assets/style-test/caps'),
};

const FAILED_QUEUE = join(DIR.state, 'failed.json');
const MASTER_SHEET = join(DIR.state, 'master-style-sheet.png');

/* ================================================================
 * 引数
 * ============================================================== */

interface Args {
  command: string;
  type: string;
  count?: number;
  id?: string;
  failed: boolean;
  confirmLargeBatch: boolean;
  master: boolean;
  json: boolean;
  /** true なら API を一切呼ばず、予定枚数だけ表示する */
  dryRun: boolean;
  /** PHASE 4.7-B: 帽子だけを作る */
  caps: boolean;
  /**
   * PHASE 4.7-B §6: 透明を頼まず、抜きやすい単色の下地を描かせる。
   *
   * 透明を出せると言っているモデルでも、実際には薄い灰色で返ってくることがある。
   * 灰色とオフホワイトのユニフォームは分けにくいので、
   * 「必ず緑」と決めてしまったほうが、あとの背景除去が確実になる。
   */
  matte: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    command: argv[0] ?? 'dry-run',
    type: 'all',
    failed: false,
    confirmLargeBatch: false,
    master: false,
    json: false,
    dryRun: false,
    caps: false,
    matte: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--type') out.type = argv[++i] ?? 'all';
    else if (arg.startsWith('--type=')) out.type = arg.slice(7);
    else if (arg === '--count') out.count = Number(argv[++i]);
    else if (arg.startsWith('--count=')) out.count = Number(arg.slice(8));
    else if (arg === '--id') out.id = argv[++i];
    else if (arg.startsWith('--id=')) out.id = arg.slice(5);
    else if (arg === '--failed') out.failed = true;
    else if (arg === '--confirm-large-batch') out.confirmLargeBatch = true;
    else if (arg === '--master') out.master = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--caps') out.caps = true;
    else if (arg === '--matte') out.matte = true;
  }
  return out;
}

/** --type を種類の並びに直す */
function categoriesOf(type: string): CatalogId[] {
  if (type === 'all') return CATALOG.map((entry) => entry.id);
  const wanted = type.split(',').map((part) => part.trim());
  const out: CatalogId[] = [];
  for (const part of wanted) {
    if (!isCatalogId(part)) {
      console.error(`知らない種類です: ${part}`);
      console.error(`使えるのは: ${CATALOG.map((entry) => entry.id).join(' / ')}`);
      process.exit(2);
    }
    out.push(part);
  }
  return out;
}

/* ================================================================
 * ファイルの読み書き
 * ============================================================== */

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, bytes: Uint8Array): void {
  ensureDir(dirname(path));
  writeFileSync(path, bytes);
}

function readPngFile(path: string): RgbaImage | null {
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  if (!isPng(bytes)) return null;
  return decodePng(bytes);
}

/** node の zlib で縮めて PNG を書く */
function savePng(path: string, image: RgbaImage): number {
  const bytes = encodePng(image, (raw) => new Uint8Array(deflateSync(Buffer.from(raw), { level: 9 })));
  writeFile(path, bytes);
  return bytes.length;
}

function loadFailedQueue(): string[] {
  if (!existsSync(FAILED_QUEUE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(FAILED_QUEUE, 'utf8')) as { ids?: string[] };
    return Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch {
    return [];
  }
}

function saveFailedQueue(ids: string[]): void {
  ensureDir(DIR.state);
  writeFileSync(FAILED_QUEUE, JSON.stringify({ ids: [...new Set(ids)] }, null, 2));
}

/* ================================================================
 * プロバイダー
 * ============================================================== */

function currentEnv(): Env {
  // .env があれば読む。値はここから先へ持ち出さない（表示もしない）
  const envPath = join(ROOT, '.env');
  const fromFile: Env = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) fromFile[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...fromFile, ...process.env };
}

function resolve(): ProviderResolution {
  return resolveProvider(currentEnv(), {
    readImage: async (id) => {
      const path = join(DIR.incoming, `${id}.png`);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    },
    dropDir: 'assets/incoming',
  });
}

/* ================================================================
 * dry-run（§29・§52）
 * ============================================================== */

function printPlan(categories: CatalogId[], count: number | undefined): void {
  const plan = planGeneration(categories, count);
  const billable = billableCount(plan);

  console.log('── 生成の計画 ──');
  console.log('  種類                 枚数   作り方');
  for (const item of plan) {
    const how = item.kind === 'image' ? '画像生成AI' : '後処理で色を振り分け（API不要）';
    console.log(
      `  ${item.category.padEnd(20)} ${String(item.count).padStart(4)}   ${how}`,
    );
  }
  console.log(`  ${'─'.repeat(52)}`);
  console.log(`  APIを叩く枚数: ${billable}枚`);
  console.log(`  後処理だけで増える枚数: ${plan.reduce((n, i) => n + (i.kind === 'recolor' ? i.count : 0), 0)}枚`);
  console.log(`  プロンプトの版: v${PROMPT_VERSION}`);
}

function commandDryRun(args: Args): void {
  const categories = categoriesOf(args.type);
  const resolution = resolve();

  console.log('=== PHASE 4.7 画像素材の生成（下見） ===\n');
  console.log('これは下見です。**画像は1枚も作りません**。APIも叩きません。\n');

  console.log('── プロバイダー ──');
  if (resolution.available) {
    console.log(`  使えます: ${resolution.id} / モデル ${resolution.provider.model}`);
    console.log(`  見本画像を渡せる: ${resolution.provider.supportsReferenceImage() ? 'はい' : 'いいえ'}`);
    console.log(`  透明背景で返せる: ${resolution.provider.supportsTransparency() ? 'はい' : 'いいえ'}`);
  } else {
    console.log(`  使えません: ${resolution.reason}`);
    if (resolution.missing.length > 0) {
      console.log(`  足りない環境変数: ${resolution.missing.join(', ')}`);
    }
    console.log(`  ${resolution.hint}`);
  }
  console.log();

  console.log('── 選べるプロバイダー ──');
  for (const requirement of PROVIDER_REQUIREMENTS) {
    const keys = requirement.envKeys.length === 0 ? '（鍵は不要）' : requirement.envKeys.join(', ');
    console.log(`  ${requirement.id.padEnd(10)} ${requirement.label.padEnd(16)} ${keys}`);
    console.log(`  ${' '.repeat(10)} 既定のモデル: ${requirement.defaultModel}`);
    console.log(`  ${' '.repeat(10)} ${requirement.note}`);
  }
  console.log();

  printPlan(categories, args.count);
  console.log();

  console.log('── 実行に必要なもの ──');
  console.log('  1. cp .env.example .env');
  console.log('  2. .env に IMAGE_PROVIDER と IMAGE_API_KEY を書く');
  console.log('     （APIを契約していないなら IMAGE_PROVIDER=local にして、');
  console.log('       手元で作った PNG を assets/incoming/ へ置く）');
  console.log('  3. npm run assets:generate -- --master');
  console.log('  4. npm run assets:generate -- --type all --count 3');
  console.log('  5. npm run assets:check');
  console.log('  6. npm run assets:manifest');
  console.log('  7. npm run assets:gallery -- 300');
  console.log();

  console.log('── いまの素材 ──');
  const counted = countProduction();
  console.log(`  同梱されている素材: ${counted}点`);
  if (counted === 0) {
    console.log('  素材が0点でもゲームは動きます（PHASE 4.5 の SVG で描かれます）。');
  }
  console.log();
  console.log('=== 下見はここまで。1枚も作っていません ===');
}

function countProduction(): number {
  if (!existsSync(DIR.production)) return 0;
  let total = 0;
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(png|webp)$/i.test(name)) total += 1;
    }
  };
  walk(DIR.production);
  return total;
}

/* ================================================================
 * 生成（§30・§53）
 * ============================================================== */

async function commandGenerate(args: Args): Promise<void> {
  const categories = categoriesOf(args.type);

  // --dry-run は API を一切呼ばない。予定枚数を見せて終わる
  if (args.dryRun) {
    commandDryRun(args);
    return;
  }

  const resolution = resolve();

  if (!resolution.available) {
    console.error('=== BLOCKED: 画像を作れません ===\n');
    console.error(`  理由: ${resolution.reason}`);
    if (resolution.missing.length > 0) {
      console.error(`  足りない環境変数: ${resolution.missing.join(', ')}`);
    }
    console.error(`  ${resolution.hint}\n`);
    printPlan(categories, args.count);
    console.error('\n  画像は1枚も作っていません。');
    console.error('  npm run assets:dry-run で必要なものを確認してください。');
    process.exit(1);
  }

  // 費用の暴走を防ぐ（§53）
  const plan = planGeneration(categories, args.count);
  const billable = billableCount(plan);
  const LARGE = 10;
  // local は API を叩かないので費用がかからない。歯止めは要らない
  const costsMoney = resolution.id !== 'local';
  if (costsMoney && billable > LARGE && !args.confirmLargeBatch) {
    console.error(`=== 中止: ${billable}枚はまとめて作りすぎです ===\n`);
    console.error(`  ${LARGE}枚を超える生成には --confirm-large-batch が要ります。`);
    console.error('  まずは --count 3 で試し、組み合わせを確認してから増やしてください。\n');
    printPlan(categories, args.count);
    process.exit(1);
  }

  const provider = resolution.provider;
  console.log(`=== 生成を始めます（${resolution.id} / ${provider.model}）===\n`);

  ensureDir(DIR.original);
  ensureDir(DIR.state);

  /*
   * 透明背景を出せないモデル（fal-ai/flux/dev など）には、
   * 「transparent background」ではなく「単色の下地」を描かせる。
   * 抜くのは後処理（assets:remove-background）の仕事。
   */
  const transparent = provider.supportsTransparency();
  // モデルによってはプロンプトに文字数の上限がある（Recraft は1000字）
  const promptLimit =
    'promptLimit' in provider && typeof provider.promptLimit === 'function'
      ? (provider.promptLimit as () => number | undefined)()
      : undefined;
  if (!transparent) {
    console.log('  このモデルは透明背景を出せません。');
    console.log('  単色の下地を描かせて、あとで npm run assets:remove-background で抜きます。\n');
  }

  /* ---- 見本の1枚（§11） ---- */
  if (args.master) {
    console.log('── MASTER CHARACTER STYLE SHEET ──');
    const request: GenerationRequest = {
      id: 'master-style-sheet',
      prompt: masterStyleSheetPrompt(transparent),
      negativePrompt: negativePrompt(transparent),
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      transparent,
    };
    const result = await provider.generateImage(request);
    if (result.ok) {
      writeFile(MASTER_SHEET, result.bytes);
      console.log(`  ${MASTER_SHEET} に保存しました`);
    } else {
      console.error(`  失敗: ${result.reason}`);
      process.exit(1);
    }
    console.log();
  }

  /* ---- 見本を参照画像として使う ---- */
  let reference: Uint8Array | undefined;
  if (provider.supportsReferenceImage() && existsSync(MASTER_SHEET)) {
    reference = new Uint8Array(readFileSync(MASTER_SHEET));
    console.log('  見本の1枚を参照画像として使います\n');
  }

  /* ---- 種類ごとに作る ---- */
  const failed: string[] = [];
  let made = 0;
  for (const category of categories) {
    const entry = catalogEntry(category);
    if (entry.kind === 'recolor') continue;

    const prompts = buildPromptsFor(category, args.count, {
      transparent,
      ...(promptLimit === undefined ? {} : { maxLength: promptLimit }),
    });
    if (prompts.length === 0) continue;
    console.log(`── ${category}（${prompts.length}枚）──`);

    const requests: GenerationRequest[] = prompts.map((part) => ({
      id: part.id,
      prompt: part.prompt,
      negativePrompt: part.negativePrompt,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      transparent,
      ...(reference ? { referenceImage: reference } : {}),
    }));

    const results = await provider.generateBatch(requests);
    for (const result of results) {
      if (result.ok) {
        // 無加工のものは original へ。ゲームには入れない（§19）
        writeFile(join(DIR.original, entry.dir, `${result.id}.png`), result.bytes);
        console.log(`  ✅ ${result.id}`);
        made += 1;
      } else {
        failed.push(`${category}:${result.id}`);
        console.log(`  ❌ ${result.id}: ${result.reason}`);
      }
    }
    console.log();
  }

  if (failed.length > 0) {
    saveFailedQueue([...loadFailedQueue(), ...failed]);
    console.log(`失敗した ${failed.length}件を ${FAILED_QUEUE} に記録しました。`);
    console.log('npm run assets:regenerate -- --failed で作り直せます。\n');
  }

  console.log(`=== 生成: 成功 ${made}枚 / 失敗 ${failed.length}枚 ===`);
  console.log('生成したものは assets/original/ にあります（背景つき・ゲームには入りません）。');
  console.log('次はこの順で進めてください：');
  console.log('  1. npm run assets:remove-background   背景を抜く');
  console.log('  2. npm run assets:normalize           1024x1280 へ正規化');
  console.log('  3. npm run assets:compare             元 → 除去後 → 正規化後 を見比べる');
  console.log('  4. npm run assets:validate            透明PNGとして検査');
  console.log('  ここまで確かめてから、量産してください。');
  if (made === 0) process.exit(1);
}

async function commandRegenerate(args: Args): Promise<void> {
  const queue = args.failed ? loadFailedQueue() : args.id ? [args.id] : [];
  if (queue.length === 0) {
    console.error('作り直す対象がありません。--failed か --id を指定してください。');
    process.exit(2);
  }

  const resolution = resolve();
  if (!resolution.available) {
    console.error('=== BLOCKED: 画像を作れません ===');
    console.error(`  理由: ${resolution.reason}`);
    console.error(`  ${resolution.hint}`);
    console.error(`  作り直す予定だったもの: ${queue.join(', ')}`);
    console.error('  画像は1枚も作っていません。');
    process.exit(1);
  }

  const provider = resolution.provider;
  const stillFailed: string[] = [];
  let made = 0;

  for (const item of queue) {
    const [category, id] = item.includes(':') ? item.split(':') : [findCategoryOf(item), item];
    if (!category || !isCatalogId(category)) {
      console.log(`  ⏭ ${item}: どの種類か分かりません`);
      stillFailed.push(item);
      continue;
    }
    const entry = catalogEntry(category);
    const index = Number(id.slice(-3)) - 1;
    const part = buildPrompt(category, index, { transparent: provider.supportsTransparency() });
    const result: GenerationResult = await provider.generateImage({
      id: part.id,
      prompt: part.prompt,
      negativePrompt: part.negativePrompt,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      transparent: provider.supportsTransparency(),
    });
    if (result.ok) {
      writeFile(join(DIR.original, entry.dir, `${result.id}.png`), result.bytes);
      console.log(`  ✅ ${result.id}`);
      made += 1;
    } else {
      console.log(`  ❌ ${result.id}: ${result.reason}`);
      stillFailed.push(item);
    }
  }

  saveFailedQueue(stillFailed);
  console.log(`\n=== 作り直し: 成功 ${made}枚 / まだ失敗 ${stillFailed.length}枚 ===`);
  if (made === 0) process.exit(1);
}

function findCategoryOf(id: string): CatalogId | null {
  const prefix = id.replace(/_\d{3}$/, '');
  const entry = CATALOG.find((candidate) => candidate.prefix === prefix && candidate.kind === 'image');
  return entry ? entry.id : null;
}

/* ================================================================
 * 後処理（§5）
 * ============================================================== */

/** 種類ごとの「中身をどのくらいの大きさにそろえるか」 */
const TARGET_WIDTH: Partial<Record<CatalogId, number>> = {
  head_shape: 536,
  hair_style: 560,
  eyebrow: 320,
  eyes: 300,
  nose: 120,
  mouth: 190,
  ears: 560,
  jaw_cheeks: 460,
  facial_hair: 330,
  expression: 340,
  body_type: 552,
  uniform: 600,
  cap: 520,
  accessory: 360,
  pose: 640,
  special_state: 240,
  neck: 150,
  hair_back: 600,
};

function commandProcess(args: Args): void {
  const categories = categoriesOf(args.type);
  console.log('=== 後処理（背景除去 → 掃除 → 基準点合わせ → 派生サイズ）===\n');

  let processed = 0;
  let rejected = 0;
  const reports: QualityReport[] = [];

  for (const category of categories) {
    const entry = catalogEntry(category);
    if (entry.kind === 'recolor') continue;

    const from = join(DIR.original, entry.dir);
    if (!existsSync(from)) continue;
    const files = readdirSync(from).filter(
      (name) => name.startsWith(entry.prefix + '_') && name.endsWith('.png'),
    );
    if (files.length === 0) continue;

    console.log(`── ${category}（${files.length}枚）──`);
    for (const name of files.sort()) {
      const image = readPngFile(join(from, name));
      if (!image) {
        console.log(`  ❌ ${name}: PNG として読めません`);
        rejected += 1;
        continue;
      }
      const id = name.replace(/\.png$/, '');
      const result = processPart(image, {
        anchor: ANCHORS[category],
        ...(TARGET_WIDTH[category] === undefined ? {} : { targetWidth: TARGET_WIDTH[category] }),
      });

      const report = inspect(result.image, id, category);
      reports.push(report);
      if (report.grade === 'REJECT') {
        console.log(`  ❌ ${id}: ${report.score}点 — ${report.issues[0]?.message ?? ''}`);
        rejected += 1;
        continue;
      }

      writeProduction(entry, id, result.image);
      // 色を振り分ける種類なら、ここで増やす
      const variants = writeRecolorVariants(entry, id, result.image);
      console.log(
        `  ✅ ${id}: ${report.score}点（${report.grade}）${variants > 0 ? ` / 色違い ${variants}点` : ''}`,
      );
      processed += 1;
    }
    console.log();
  }

  saveQualityReports(reports);
  console.log(`=== 後処理: 通過 ${processed}枚 / 却下 ${rejected}枚 ===`);
  if (processed === 0) {
    console.log('元になる画像が assets/original/ にありません。');
    console.log('npm run assets:generate で作るか、手元の PNG を置いてください。');
  } else {
    console.log('次は npm run assets:manifest を実行してください。');
  }
}

function writeProduction(entry: CatalogEntry, id: string, image: RgbaImage): void {
  const base = join(DIR.production, entry.dir);
  savePng(join(base, `${id}.png`), image);
  for (const [size, width] of Object.entries(OUTPUT_SIZES)) {
    if (width >= CANVAS_WIDTH) continue;
    const small = derivatives(image, [width]).get(width)!;
    savePng(join(base, `${id}@${size}.png`), small);
  }
}

/** 髪色・肌色を後処理で増やす（§13） */
function writeRecolorVariants(entry: CatalogEntry, id: string, image: RgbaImage): number {
  const ramps =
    entry.id === 'hair_style' ? HAIR_RAMPS : entry.id === 'head_shape' ? SKIN_RAMPS : null;
  if (!ramps) return 0;
  const base = join(DIR.production, entry.dir);
  let made = 0;
  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i];
    const tinted = recolor(image, ramp.dark, ramp.light);
    const variantId = `${id}c${String(i + 1).padStart(2, '0')}`;
    savePng(join(base, `${variantId}.png`), tinted);
    made += 1;
  }
  return made;
}

function saveQualityReports(reports: QualityReport[]): void {
  if (reports.length === 0) return;
  ensureDir(DIR.state);
  writeFileSync(
    join(DIR.state, 'quality.json'),
    JSON.stringify(
      {
        checkedAt: '',
        promptVersion: PROMPT_VERSION,
        reports: reports.map((report) => ({
          id: report.id,
          category: report.category,
          score: report.score,
          grade: report.grade,
          issues: report.issues,
        })),
      },
      null,
      2,
    ),
  );
}

/* ================================================================
 * 検査（§15）
 * ============================================================== */

function commandCheck(args: Args): void {
  console.log('=== 素材の検査 ===\n');
  const categories = categoriesOf(args.type);
  const reports: QualityReport[] = [];
  let missing = 0;

  for (const category of categories) {
    const entry = catalogEntry(category);
    if (entry.kind === 'recolor') continue;
    const dir = join(DIR.production, entry.dir);
    const files = existsSync(dir)
      ? readdirSync(dir).filter(
          (name) =>
            name.startsWith(entry.prefix + '_') && name.endsWith('.png') && !name.includes('@'),
        )
      : [];

    if (files.length < entry.min) {
      missing += 1;
      const label = entry.required ? '必須' : '任意';
      console.log(
        `  ${category.padEnd(16)} ${String(files.length).padStart(3)}点 / 最低 ${entry.min}点（${label}）`,
      );
    }
    for (const name of files.sort()) {
      const image = readPngFile(join(dir, name));
      if (!image) continue;
      reports.push(inspect(image, name.replace(/\.png$/, ''), category));
    }
  }

  if (reports.length === 0) {
    console.log('  検査できる素材がまだありません。');
    console.log('  ゲームは PHASE 4.5 の SVG で選手を描きます（正常）。');
    console.log(`\n  足りない種類: ${missing}件`);
    console.log('\n=== PASS（素材0点。ゲームは動きます）===');
    return;
  }

  const approved = reports.filter((report) => report.grade === 'APPROVED');
  const review = reports.filter((report) => report.grade === 'REVIEW');
  const reject = reports.filter((report) => report.grade === 'REJECT');

  for (const report of reject) {
    console.log(`  ❌ ${report.id}（${report.score}点）`);
    for (const issue of report.issues) console.log(`       ${issue.verdict} ${issue.message}`);
  }
  for (const report of review) {
    console.log(`  ⚠️  ${report.id}（${report.score}点）`);
    for (const issue of report.issues) console.log(`       ${issue.verdict} ${issue.message}`);
  }

  console.log();
  console.log(`  APPROVED ${approved.length} / REVIEW ${review.length} / REJECT ${reject.length}`);
  console.log(`  足りない種類: ${missing}件`);
  console.log();
  console.log('  機械で見られないものは npm run assets:audit で人が確認してください：');
  console.log('    文字・ロゴ・透かし・実在人物・既存キャラクター・線の統一');
  saveQualityReports(reports);
  console.log();
  console.log(reject.length > 0 ? '=== FAIL ===' : '=== PASS ===');
  if (reject.length > 0) process.exit(1);
}

/* ================================================================
 * プロンプトの書き出し（人が手元のツールで作るとき用）
 * ============================================================== */

function commandPrompts(args: Args): void {
  const categories = categoriesOf(args.type);
  // 透明背景を出せるプロバイダーが決まっていれば、その前提で書き出す
  const resolution = resolve();
  const transparent = resolution.available ? resolution.provider.supportsTransparency() : false;
  const lines: string[] = [
    '# 生成用プロンプト（機械が組み立てたもの）',
    '',
    `プロンプトの版: v${PROMPT_VERSION}`,
    '',
    transparent
      ? '透明背景を出せるモデル向けの文面です。'
      : '**透明背景を出せないモデル向けの文面です。**単色の下地を描かせて、'
        + 'あとで `npm run assets:remove-background` で抜きます。'
        + '「transparent background」とは書きません（書いても透明にはならないため）。',
    '',
    '手元のツール（Web版のUIなど）で作るときは、ここをそのまま貼ってください。',
    '',
    '## MASTER CHARACTER STYLE SHEET',
    '',
    '```',
    masterStyleSheetPrompt(transparent),
    '```',
    '',
    '### Negative prompt（すべて共通）',
    '',
    '```',
    negativePrompt(transparent),
    '```',
    '',
  ];

  for (const category of categories) {
    const entry = catalogEntry(category);
    if (entry.kind === 'recolor') {
      lines.push(`## ${category}`, '', `${entry.subject}`, '');
      lines.push('AIには作らせません。後処理で色を振り分けます（npm run assets:process）。', '');
      continue;
    }
    const prompts = buildPromptsFor(category, args.count, { transparent });
    lines.push(`## ${category}（${prompts.length}枚）`, '');
    for (const part of prompts) {
      lines.push(`### ${part.id}`, '', '```', part.prompt, '```', '');
      lines.push('Negative:', '', '```', part.negativePrompt, '```', '');
    }
  }

  const out = join(ROOT, 'assets/prompts/generated-prompts.md');
  ensureDir(dirname(out));
  writeFileSync(out, lines.join('\n'));
  console.log(`${out} に書き出しました（${categories.length}種類）`);
}


/* ================================================================
 * STYLE TEST（PHASE 4.7-A §17・§18）
 * ============================================================== */

/**
 * 絵柄がそろっているかを見るための生成。
 *
 * ここで作るものは **ゲームには入れません**。assets/style-test/ に置いて、
 * 目で見比べるためだけに使います。
 *
 *   npm run assets:style-test          10人（§17）
 *   npm run assets:style-test:100      100人（§18）
 *
 * 100人は API を100回叩きます。§24 のとおり、
 * 10人の結果を確かめるまでは走らせないでください。
 */
async function commandStyleTest(args: Args): Promise<void> {
  if (args.caps) {
    await commandCapTest(args);
    return;
  }
  const wanted = args.count ?? STYLE_TEST.length;
  const diversity = wanted > STYLE_TEST.length;
  const specs: CharacterSpec[] = diversity ? diversityPlan(wanted) : STYLE_TEST.slice(0, wanted);

  console.log(
    diversity
      ? `=== 多様性テスト（§18）：${specs.length}人 ===\n`
      : `=== STYLE TEST（§17）：${specs.length}人 ===\n`,
  );
  console.log(`  キャラクターの版: v${CHARACTER_PROMPT_VERSION}`);
  console.log(`  書き出し先: ${DIR.styleTestPlayers}（ゲームには入りません）\n`);

  /* ---- 下見。1枚も作らない ---- */
  if (args.dryRun) {
    for (const spec of specs.slice(0, 4)) {
      const built = buildCharacterPrompt(spec);
      console.log(`── ${spec.id} ──`);
      console.log(built.prompt);
      console.log();
    }
    if (specs.length > 4) console.log(`   … ほか ${specs.length - 4}人\n`);
    printDiversity(specs);
    console.log('\n=== 下見はここまで。1枚も作っていません ===');
    return;
  }

  const resolution = resolve();
  if (!resolution.available) {
    console.error('=== BLOCKED: 画像を作れません ===\n');
    console.error(`  理由: ${resolution.reason}`);
    if (resolution.missing.length > 0) {
      console.error(`  足りない環境変数: ${resolution.missing.join(', ')}`);
    }
    console.error(`  ${resolution.hint}\n`);
    console.error('  画像は1枚も作っていません。');
    process.exit(1);
  }

  /*
   * 費用の歯止め（§24）。
   * 10人を超えるときは --confirm-large-batch を要求する。
   */
  const costsMoney = resolution.id !== 'local';
  if (costsMoney && specs.length > STYLE_TEST.length && !args.confirmLargeBatch) {
    console.error(`=== 中止: ${specs.length}人はまとめて作りすぎです ===\n`);
    console.error('  まず npm run assets:style-test（10人）で絵柄を確かめてください。');
    console.error('  そのうえで進めるときは --confirm-large-batch を付けてください。');
    process.exit(1);
  }

  const provider = resolution.provider;
  // --matte なら、透明を出せるモデルでも下地を描かせる（§6）
  const transparent = args.matte ? false : provider.supportsTransparency();
  const promptLimit =
    'promptLimit' in provider && typeof provider.promptLimit === 'function'
      ? (provider.promptLimit as () => number | undefined)()
      : undefined;

  console.log(`  プロバイダー: ${resolution.id} / ${provider.model}`);
  if (!transparent) {
    console.log(
      args.matte
        ? '  --matte: 透明ではなく緑の下地を描かせます（あとで確実に抜くため）。'
        : '  このモデルは透明背景を出せません。単色の下地を描かせて後で抜きます。',
    );
  }
  console.log();

  ensureDir(DIR.styleTestPlayers);

  const started = Date.now();
  const reports: CharacterReport[] = [];
  const known: string[] = [];
  let apiCalls = 0;
  let failed = 0;

  for (const spec of specs) {
    const built = buildCharacterPrompt(spec, {
      transparent,
      ...(promptLimit === undefined ? {} : { maxLength: promptLimit }),
    });
    const request: GenerationRequest = {
      id: built.id,
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      transparent,
    };
    apiCalls += 1;
    const result = await provider.generateImage(request);
    if (!result.ok) {
      failed += 1;
      console.log(`  ❌ ${spec.id}: ${result.reason}`);
      continue;
    }
    const path = join(DIR.styleTestPlayers, `${built.id}.png`);
    writeFile(path, result.bytes);

    let report: CharacterReport | null = null;
    try {
      report = checkCharacter({ id: built.id, image: decodePng(result.bytes), known: [...known] });
    } catch (error) {
      console.log(`  ⚠️ ${spec.id}: 検査できませんでした（${(error as Error).message}）`);
    }
    if (report) {
      reports.push(report);
      known.push(report.hash);
      const bad = report.checks.filter((check) => check.level === 'FAIL');
      const warn = report.checks.filter((check) => check.level === 'WARN');
      const mark = report.accepted ? '✅' : '❌';
      const heads = report.metrics ? `${report.metrics.headsTall.toFixed(1)}頭身` : '頭身不明';
      console.log(
        `  ${mark} ${built.id}: ${heads} / ${(result.bytes.length / 1024).toFixed(0)}KB` +
          (bad.length > 0 ? ` / FAIL ${bad.length}` : '') +
          (warn.length > 0 ? ` / WARN ${warn.length}` : ''),
      );
      for (const check of bad) console.log(`       ✗ ${check.label}: ${check.detail}`);
      for (const check of warn) console.log(`       ! ${check.label}: ${check.detail}`);
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  printStyleTestReport(specs, reports, {
    apiCalls,
    failed,
    elapsed,
  });
}


/**
 * 帽子だけを作る（PHASE 4.7-B §3・§4・§11）。
 *
 *   npm run assets:style-test -- --caps
 *
 * 帽子は10種類を全選手で使い回すので、選手ごとに作り直さない（§14）。
 */
async function commandCapTest(args: Args): Promise<void> {
  /*
   * --id を渡せば、その帽子だけを作り直せる。
   * 1つだけ形を直したいときに、合格しているものまで作り直さずに済む（§26）。
   */
  const ids = args.id
    ? args.id.split(',').map((part) => part.trim())
    : capPlan(args.count ?? CAP_TYPES.length);
  console.log(`=== 帽子の STYLE TEST（§11）：${ids.length}種類 ===\n`);
  console.log(`  キャラクターの版: v${CHARACTER_PROMPT_VERSION}`);
  console.log(`  書き出し先: ${DIR.styleTestCaps}（ゲームには入りません）\n`);

  if (args.dryRun) {
    for (const id of ids.slice(0, 3)) {
      console.log(`── ${id} ──`);
      console.log(buildCapPrompt(id).prompt);
      console.log();
    }
    if (ids.length > 3) console.log(`   … ほか ${ids.length - 3}種類\n`);
    console.log('=== 下見はここまで。1枚も作っていません ===');
    return;
  }

  const resolution = resolve();
  if (!resolution.available) {
    console.error('=== BLOCKED: 画像を作れません ===\n');
    console.error(`  理由: ${resolution.reason}`);
    console.error(`  ${resolution.hint}\n`);
    console.error('  画像は1枚も作っていません。');
    process.exit(1);
  }

  const provider = resolution.provider;
  const transparent = args.matte ? false : provider.supportsTransparency();
  const promptLimit =
    'promptLimit' in provider && typeof provider.promptLimit === 'function'
      ? (provider.promptLimit as () => number | undefined)()
      : undefined;
  console.log(`  プロバイダー: ${resolution.id} / ${provider.model}`);
  if (!transparent && args.matte) {
    console.log('  --matte: 透明ではなく緑の下地を描かせます（あとで確実に抜くため）。');
  }
  console.log();

  ensureDir(DIR.styleTestCaps);

  const started = Date.now();
  const reports: CapReport[] = [];
  const known: string[] = [];
  let apiCalls = 0;
  let failed = 0;

  for (const id of ids) {
    const built = buildCapPrompt(id, {
      transparent,
      ...(promptLimit === undefined ? {} : { maxLength: promptLimit }),
    });
    apiCalls += 1;
    const result = await provider.generateImage({
      id: built.id,
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      // 帽子は正方形でよい（§4）
      width: CANVAS_WIDTH,
      height: CANVAS_WIDTH,
      transparent,
    });
    if (!result.ok) {
      failed += 1;
      console.log(`  ❌ ${id}: ${result.reason}`);
      continue;
    }
    writeFile(join(DIR.styleTestCaps, `${built.id}.png`), result.bytes);

    try {
      const report = checkCap({ id: built.id, image: decodePng(result.bytes), known: [...known] });
      reports.push(report);
      known.push(report.hash);
      const bad = report.checks.filter((check) => check.level === 'FAIL');
      const warn = report.checks.filter((check) => check.level === 'WARN');
      console.log(
        `  ${report.accepted ? '✅' : '❌'} ${built.id}: ${report.width}x${report.height} / ` +
          `${(result.bytes.length / 1024).toFixed(0)}KB` +
          (bad.length > 0 ? ` / FAIL ${bad.length}` : '') +
          (warn.length > 0 ? ` / WARN ${warn.length}` : ''),
      );
      for (const check of bad) console.log(`       ✗ ${check.label}: ${check.detail}`);
      for (const check of warn) console.log(`       ! ${check.label}: ${check.detail}`);
    } catch (error) {
      console.log(`  ⚠️ ${id}: 検査できませんでした（${(error as Error).message}）`);
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  const accepted = reports.filter((report) => report.accepted);
  console.log('\n── 帽子の報告（§27）──');
  console.log(`  生成枚数        ${reports.length + failed}`);
  console.log(`  採用枚数        ${accepted.length}`);
  console.log(`  Reject枚数      ${reports.length - accepted.length}`);
  console.log(`  API使用回数     ${apiCalls}`);
  console.log(`  平均生成時間    ${apiCalls === 0 ? '-' : (elapsed / apiCalls).toFixed(1)}秒`);
  console.log(`  素材容量        ${(readDirSize(DIR.styleTestCaps) / 1024 / 1024).toFixed(1)}MB`);
  const bgOk = reports.filter((report) =>
    report.checks.some((check) => check.id === 'cap-background' && check.level === 'PASS'),
  ).length;
  console.log(
    `  背景の処理可否  ${reports.length === 0 ? '-' : ((bgOk / reports.length) * 100).toFixed(0)}%`,
  );
  console.log('\n  帽子に頭や顔が写り込んでいないかは、目で見て確かめてください。');
  console.log('\n=== ここで止まります。量産はしません（§26）===');
}

/** 組み合わせの偏りを表にする（§18・§23） */
function printDiversity(specs: CharacterSpec[]): void {
  console.log('── 組み合わせの偏り ──');
  for (const key of ['body', 'hair', 'eyes', 'age', 'facialHair'] as Array<keyof CharacterSpec>) {
    const count = countDiversity(specs, key);
    if (count.counts.length === 0) continue;
    console.log(
      `  ${String(key).padEnd(11)} ${String(count.counts.length).padStart(2)}種類 / ` +
        `いちばん多いもの ${(count.topShare * 100).toFixed(0)}%`,
    );
  }
}

/** §23 の報告 */
function printStyleTestReport(
  specs: CharacterSpec[],
  reports: CharacterReport[],
  totals: { apiCalls: number; failed: number; elapsed: number },
): void {
  const accepted = reports.filter((report) => report.accepted);
  const rejected = reports.filter((report) => !report.accepted);
  const bytes = readDirSize(DIR.styleTestPlayers);

  console.log('\n── 報告（§23）──');
  console.log(`  生成枚数        ${reports.length + totals.failed}`);
  console.log(`  採用枚数        ${accepted.length}`);
  console.log(`  Reject枚数      ${rejected.length}`);
  console.log(`  生成失敗        ${totals.failed}`);
  console.log(`  API使用回数     ${totals.apiCalls}`);
  console.log(
    `  平均生成時間    ${totals.apiCalls === 0 ? '-' : (totals.elapsed / totals.apiCalls).toFixed(1)}秒`,
  );
  console.log(`  素材容量        ${(bytes / 1024 / 1024).toFixed(1)}MB`);

  const transparentOk = reports.filter((report) =>
    report.checks.some((check) => check.id === 'background-removable' && check.level === 'PASS'),
  ).length;
  console.log(
    `  背景の処理可否  ${reports.length === 0 ? '-' : ((transparentOk / reports.length) * 100).toFixed(0)}%`,
  );

  const duplicates = reports.filter((report) =>
    report.checks.some((check) => check.id === 'duplicate' && check.level === 'FAIL'),
  ).length;
  console.log(`  顔の重複        ${duplicates}件`);

  const heads = reports.map((report) => report.metrics?.headsTall ?? 0).filter((value) => value > 0);
  if (heads.length > 0) {
    const min = Math.min(...heads);
    const max = Math.max(...heads);
    const avg = heads.reduce((a, b) => a + b, 0) / heads.length;
    console.log(`  頭身            平均 ${avg.toFixed(1)} / ${min.toFixed(1)}〜${max.toFixed(1)}`);
  }

  printDiversity(specs);

  console.log('\n── 目で見ないと分からないこと ──');
  for (const item of NEEDS_EYE) console.log(`  ・${item}`);
  console.log(`\n  ${DIR.styleTestPlayers} を開いて確かめてください。`);
  console.log('  10枚のうち3枚以上が別ゲームの絵柄に見えたら、');
  console.log('  MASTER PROMPT（scripts/assets/character.ts）を直してやり直します（§17）。');
  console.log('\n=== ここで止まります。量産はしません（§24）===');
}

/** そのフォルダの中身の合計サイズ */
function readDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isFile()) total += stat.size;
  }
  return total;
}

/* ================================================================
 * 入口
 * ============================================================== */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'dry-run':
      commandDryRun(args);
      return;
    case 'generate':
      await commandGenerate(args);
      return;
    case 'regenerate':
      await commandRegenerate(args);
      return;
    case 'process':
      commandProcess(args);
      return;
    case 'check':
      commandCheck(args);
      return;
    case 'prompts':
      commandPrompts(args);
      return;
    case 'style-test':
      await commandStyleTest(args);
      return;
    default:
      console.error(`知らない命令です: ${args.command}`);
      console.error(
      '使えるのは: dry-run / generate / regenerate / process / check / prompts / style-test',
    );
      process.exit(2);
  }
}

void main();
