/**
 * PHASE 4.7 §47 ビルド結果に秘密が混ざっていないかを見る。
 *
 *   npm run audit:security
 *
 * 見るのは dist/ の中身だけ。ソースの見た目ではなく、
 * 「実際に配られるもの」に何が入っているかを確かめる。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
let failures = 0;
const fail = (message) => {
  console.error('❌ ' + message);
  failures += 1;
};
const ok = (message) => console.log('✅ ' + message);

if (!existsSync(DIST)) {
  console.error('dist/ がありません。先に npm run build:single を実行してください。');
  process.exit(1);
}

/** dist の中のテキストファイルを全部集める */
const texts = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(html|js|css|json|map|txt)$/i.test(name)) continue;
    texts.push({ path: full, body: readFileSync(full, 'utf8') });
  }
};
walk(DIST);
console.log(`dist/ のテキスト ${texts.length}件を調べます。\n`);

/* ---- 1. 鍵らしき文字 ---- */
const SECRET_PATTERNS = [
  { name: 'OpenAI 風の鍵', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'Replicate 風の鍵', re: /\br8_[A-Za-z0-9_-]{16,}/ },
  { name: 'Bearer トークン', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/ },
  { name: 'AWS のアクセスキー', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub のトークン', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'Google の鍵', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
for (const pattern of SECRET_PATTERNS) {
  const hit = texts.find((file) => pattern.re.test(file.body));
  if (hit) fail(`${pattern.name} が ${hit.path} に入っています`);
}
if (failures === 0) ok('鍵らしき文字は見つかりませんでした');

/* ---- 2. 環境変数の名前 ---- */
const ENV_NAMES = [
  'IMAGE_API_KEY',
  'IMAGE_PROVIDER',
  'IMAGE_MODEL',
  'IMAGE_BASE_URL',
  'OPENAI_API_KEY',
  'REPLICATE_API_TOKEN',
  'FAL_KEY',
  'STABILITY_API_KEY',
];
const envHits = [];
for (const name of ENV_NAMES) {
  for (const file of texts) {
    if (file.body.includes(name)) envHits.push(`${name} @ ${file.path}`);
  }
}
if (envHits.length > 0) fail(`環境変数の名前が残っています: ${envHits.slice(0, 3).join(', ')}`);
else ok('画像生成まわりの環境変数の名前は入っていません');

/* ---- 3. 画像生成サービスの宛先 ---- */
const SERVICES = [
  'api.openai.com',
  'api.replicate.com',
  'fal.run',
  'fal.ai',
  'api.stability.ai',
  'huggingface.co',
  'generativelanguage.googleapis.com',
];
const serviceHits = [];
for (const service of SERVICES) {
  for (const file of texts) {
    if (file.body.includes(service)) serviceHits.push(`${service} @ ${file.path}`);
  }
}
if (serviceHits.length > 0) fail(`画像生成サービスの宛先が残っています: ${serviceHits.slice(0, 3).join(', ')}`);
else ok('画像生成サービスの宛先は入っていません');

/* ---- 4. 開発用のコードが混ざっていないか ---- */
// 開発時のパイプラインのコードが1つでも混ざっていたら、ビルドの設定がおかしい
const DEV_ONLY = [
  'ImageGenerationProvider',
  'generateBatch',
  'masterStyleSheetPrompt',
  'resolveProvider',
  // PHASE 4.7 追補: 背景除去はゲームに入ってはいけない
  'removeFlatBackground',
  'defringe',
  'despill',
  'MATTE_BACKGROUND',
  'checkTransparency',
];
const devHits = [];
for (const word of DEV_ONLY) {
  for (const file of texts) {
    if (file.body.includes(word)) devHits.push(`${word} @ ${file.path}`);
  }
}
if (devHits.length > 0) fail(`開発用のコードが混ざっています: ${devHits.slice(0, 3).join(', ')}`);
else ok('開発用の画像生成コードは入っていません');

/* ---- 4b. 下地の色（開発時だけのもの）---- */
{
  const hits = texts.filter((file) => file.body.includes('00B140') || file.body.includes('#00b140'));
  if (hits.length > 0) fail(`抜くための下地の色がゲームに入っています: ${hits[0].path}`);
  else ok('抜くための下地の色は入っていません（背景除去は開発時だけ）');
}

/* ---- 5. 外部の宛先そのもの ---- */
{
  const single = texts.find((file) => file.path.endsWith('my-ideal-pennant-race.html'));
  if (single) {
    const urls = [...single.body.matchAll(/https?:\/\/[A-Za-z0-9._-]+/g)].map((match) => match[0]);
    /*
     * 通信をしない、文字列としてだけ存在する宛先。
     *   w3.org      … SVG の名前空間。属性の値であって、取りに行かない
     *   reactjs.org … React が投げる例外の文言に入っている説明ページのURL。
     *                 例外が起きたときに人が読むためのもので、コードは取りに行かない
     * どちらも PHASE 1 から入っており、PHASE 4.7 で足したものではない。
     */
    const TEXT_ONLY = ['www.w3.org', 'reactjs.org'];
    const real = urls.filter((url) => !TEXT_ONLY.some((host) => url.endsWith(host)));
    // reactjs.org は「例外の説明ページ」としてだけ現れる。取りに行くコードが無いことも確かめる
    if (single.body.includes('reactjs.org') && !single.body.includes('error-decoder')) {
      fail('reactjs.org が例外の文言以外の場所で使われています');
    }
    if (real.length > 0) {
      fail(`単一HTMLに外部の宛先が ${real.length}件あります: ${[...new Set(real)].slice(0, 3).join(', ')}`);
    } else {
      ok('単一HTMLに通信する宛先はありません（SVGの名前空間と React の例外文言を除く）');
    }
    const kb = (single.body.length / 1024).toFixed(0);
    console.log(`   単一HTML: ${kb} KB`);
  }
}

/* ---- 6. .env が配られていないか ---- */
{
  const leaked = [];
  const walkAll = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkAll(full);
      else if (name === '.env' || name.startsWith('.env.')) leaked.push(full);
    }
  };
  walkAll(DIST);
  if (leaked.length > 0) fail(`.env が dist に入っています: ${leaked.join(', ')}`);
  else ok('.env は dist に入っていません');
}

console.log();
console.log(failures === 0 ? '=== PASS（秘密の混入なし）===' : `=== FAIL（${failures}件）===`);
process.exit(failures === 0 ? 0 : 1);
