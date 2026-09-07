/**
 * 配布形（単一HTML）が iframe の中でも壊れていないかを確かめる。
 *
 * このゲームは単一HTMLとして sandbox 付きの iframe に埋め込まれて配布される。
 * sandbox に allow-modals が無いと、ブラウザは window.confirm() / alert() / prompt() を
 * 黙って無視して false を返す。開発サーバーやプレビューでは普通に動いてしまうため、
 * 「押しても何も起きないボタン」は通常の E2E では見つからない。
 *
 *   npm run build:single してから
 *   node e2e/sandbox-check.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fail = (msg) => {
  console.error('❌ ' + msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log('✅ ' + msg);

const SINGLE = process.env.SINGLE_HTML ?? 'dist/my-ideal-pennant-race.html';
const dir = mkdtempSync(join(tmpdir(), 'mipr-sandbox-'));
copyFileSync(SINGLE, join(dir, 'game.html'));
// 配布先と同じ条件：allow-modals を与えない
writeFileSync(
  join(dir, 'host.html'),
  `<!doctype html><meta charset="utf-8"><title>sandbox host</title>
<style>html,body{margin:0}iframe{width:390px;height:844px;border:0}</style>
<iframe id="f" sandbox="allow-scripts allow-same-origin allow-forms" src="game.html"></iframe>`,
);

const server = createServer((req, res) => {
  const name = req.url === '/' ? '/host.html' : req.url.split('?')[0];
  try {
    const body = readFileSync(join(dir, name.replace(/^\//, '')));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(4188, '127.0.0.1', resolve));

const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('pageerror', (e) => fail('ページ内エラー: ' + e.message));
page.on('console', (m) => {
  const text = m.text();
  // これが出たら「押しても何も起きないボタン」がある
  if (/Ignored call to '(confirm|alert|prompt)\(\)'/.test(text)) {
    fail('sandbox でダイアログが無視された: ' + text);
  }
});

await page.goto('http://127.0.0.1:4188/host.html');
const f = page.frameLocator('#f');
await f.getByRole('heading', { name: 'My Ideal Pennant Race' }).waitFor();
ok('sandbox 付き iframe の中でタイトル画面が出る');

// セーブを作ってタイトルに戻る
await f.getByRole('button', { name: '新規ゲーム' }).click();
await f.getByText('東都フェニックス').first().click();
await f.getByRole('button', { name: '次へ' }).click();
await f.getByText('10試合').click();
await f.getByRole('button', { name: 'この設定で開始' }).click();
await f.locator('.appbar h1').waitFor();
ok('iframe の中でも新規ゲームを開始できる');
await f.getByRole('button', { name: '保存して終了' }).click();
await f.getByRole('button', { name: '続きから' }).waitFor();
ok('セーブがある状態のタイトルに戻れる');

// 新規ゲーム → 画面内の確認 → やめる
await f.getByRole('button', { name: '新規ゲーム' }).click();
try {
  await f.getByRole('button', { name: 'やめる' }).waitFor({ timeout: 3000 });
  ok('セーブがある状態で「新規ゲーム」を押すと画面内に確認が出る');
} catch {
  fail('「新規ゲーム」を押しても何も起きない（ブラウザのダイアログに頼っていないか）');
}
await f.getByRole('button', { name: 'やめる' }).click();
await page.waitForTimeout(200);
if ((await f.getByRole('button', { name: '続きから' }).count()) === 0) {
  fail('「やめる」でタイトルに戻らない');
} else ok('「やめる」を選ぶとセーブは残る');

// 新規ゲーム → 新しく始める
await f.getByRole('button', { name: '新規ゲーム' }).click();
await f.getByRole('button', { name: '新しく始める' }).click();
try {
  await f.getByRole('heading', { name: '球団を選択' }).waitFor({ timeout: 3000 });
  ok('「新しく始める」を選ぶと球団選択に進む');
} catch {
  fail('「新しく始める」を選んでも先に進まない');
}
await f.getByRole('button', { name: '戻る' }).click();
await f.getByRole('button', { name: '続きから' }).waitFor();

// セーブデータの削除
await f.getByRole('button', { name: 'セーブデータを削除' }).click();
try {
  await f.getByRole('button', { name: '削除する' }).waitFor({ timeout: 3000 });
  ok('「セーブデータを削除」を押すと画面内に確認が出る');
} catch {
  fail('「セーブデータを削除」を押しても何も起きない');
}
await f.getByRole('button', { name: '削除する' }).click();
await page.waitForTimeout(400);
if ((await f.getByRole('button', { name: '続きから' }).count()) !== 0) {
  fail('削除してもセーブが残っている');
} else ok('セーブデータを削除できる');
const stored = await page.evaluate(
  () => document.getElementById('f').contentWindow.localStorage.getItem('mipr:save:v1'),
);
if (stored !== null) fail('localStorage にセーブが残っている');
else ok('localStorage からも消えている');

await browser.close();
server.close();
console.log(process.exitCode ? '\n=== 失敗あり ===' : '\n=== すべて成功 ===');
