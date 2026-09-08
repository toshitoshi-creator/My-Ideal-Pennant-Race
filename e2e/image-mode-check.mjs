/**
 * PHASE 4.7 画像素材が入っているときの確認（§37）。
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node e2e/image-mode-check.mjs
 *
 * 素材が1枚も無いときは「確認することがない」として正常終了する。
 * 素材があるときだけ、実際に画像で描かれているかを実ブラウザで確かめる。
 *
 * 見るのはこの5つ：
 *   ・画像で描かれているか（SVG に落ちていないか）
 *   ・壊れた画像が出ていないか
 *   ・外部へ1件も取りに行っていないか
 *   ・外部の画像URLを使っていないか
 *   ・選手ごとに違う組み合わせになっているか
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const fail = (message) => {
  console.error('❌ ' + message);
  process.exitCode = 1;
};
const ok = (message) => console.log('✅ ' + message);

/* ---- 素材があるかどうかを先に見る ---- */
const MANIFEST = 'src/assets/players/manifest.json';
let assetCount = 0;
if (existsSync(MANIFEST)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const entries of Object.values(manifest.parts ?? {})) assetCount += entries.length;
}
if (assetCount === 0) {
  console.log('画像素材が1枚もありません。確認することはありません（正常）。');
  console.log('ゲームは PHASE 4.5 の SVG で選手を描きます。');
  process.exit(0);
}
console.log(`画像素材 ${assetCount}点で確認します。\n`);

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const requests = [];
page.on('request', (request) => requests.push(request.url()));
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('requestfailed', (request) => {
  if (request.resourceType() === 'image') fail(`画像の読み込みに失敗: ${request.url()}`);
});

await page.goto(BASE);
await page.getByRole('heading', { name: 'My Ideal Pennant Race' }).waitFor();
await page.getByRole('button', { name: /はじめから|新規/ }).first().click().catch(() => {});
await page.waitForTimeout(400);
for (const label of [/フェニックス|Phoenix/, /決定|次へ|開始|この球団/]) {
  const button = page.getByRole('button', { name: label }).first();
  if (await button.count()) {
    await button.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}
const start = page.getByRole('button', { name: /開始|スタート/ }).last();
if (await start.count()) await start.click().catch(() => {});
await page.waitForTimeout(1200);

await page.getByRole('button', { name: /選手/ }).last().click().catch(() => {});
await page.locator('.player-card').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600);

/* ---- 画像で描かれているか ---- */
const imageFigures = await page.locator('.player-card .portrait-image').count();
const layers = await page.locator('.player-card .pt-img').count();
if (imageFigures === 0) fail('素材があるのに画像で描かれていません（SVG に落ちています）');
else ok(`画像で描かれた肖像 ${imageFigures}件 / 重ねた画像 ${layers}枚`);

/* ---- 壊れた画像 ---- */
const broken = await page
  .locator('img')
  .evaluateAll((els) => els.filter((el) => el.complete && el.naturalWidth === 0).length);
if (broken > 0) fail(`読み込めていない画像が ${broken}枚あります`);
else ok('壊れた画像は0枚');

/* ---- 外部へ出ていないか ---- */
const origin = new URL(BASE).origin;
const external = requests.filter(
  (url) =>
    !url.startsWith(origin) &&
    !url.startsWith('data:') &&
    !url.startsWith('blob:') &&
    !url.startsWith('about:'),
);
if (external.length > 0) fail(`外部へのリクエストが ${external.length}件（${external[0]}）`);
else ok(`外部へのリクエストは0件（${requests.length}件すべて同一オリジン）`);

const srcs = await page
  .locator('.pt-img')
  .evaluateAll((els) => els.map((el) => el.currentSrc || el.src));
const externalSrc = srcs.filter((src) => !src.startsWith('data:') && !src.startsWith(origin));
if (externalSrc.length > 0) fail(`外部の画像URLが ${externalSrc.length}件`);
else ok(`外部の画像URLは0件（img ${srcs.length}件）`);

/* ---- 選手ごとに違うか ---- */
const combos = await page
  .locator('.player-card .portrait-image')
  .evaluateAll((els) =>
    els
      .slice(0, 14)
      .map((el) => [...el.querySelectorAll('img')].map((i) => (i.currentSrc || i.src).slice(-24)).join('|')),
  );
const unique = new Set(combos).size;
if (combos.length > 0 && unique < combos.length * 0.8) {
  fail(`選手の見た目が似すぎています（${combos.length}人中 ${unique}種類）`);
} else {
  ok(`選手ごとに違う組み合わせ（${combos.length}人中 ${unique}種類）`);
}

/* ---- 横スクロール ---- */
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 0) fail(`横スクロールが出ています（${overflow}px）`);
else ok('横スクロールは0（390px）');

if (errors.length > 0) fail(`JSエラー ${errors.length}件: ${errors[0]}`);
else ok('JSエラーは0件');

await page.screenshot({ path: 'e2e/shots/image-mode.png' });
await browser.close();
console.log(process.exitCode ? '\n=== 失敗 ===' : '\n=== すべて成功 ===');
