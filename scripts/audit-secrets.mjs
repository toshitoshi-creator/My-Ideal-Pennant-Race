/**
 * リポジトリに鍵が入っていないかを見る（コミット前の最後の砦）。
 *
 *   npm run audit:secrets
 *
 * dist だけを見る audit:security と違い、こちらは
 * **git が追跡しているファイルすべて** を見る。
 * 鍵をソースへ書いてしまう事故は、ここで止める。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  { name: 'OpenAI 風の鍵', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'Replicate 風の鍵', re: /\br8_[A-Za-z0-9_-]{20,}/ },
  { name: 'fal.ai の鍵', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}/ },
  { name: 'AWS のアクセスキー', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub のトークン', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Google の鍵', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Slack のトークン', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Bearer トークン', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
];

/** 鍵の見本を載せてよいファイル（テストと資料。値は作り物） */
const ALLOW = [/^src\/domain\/phase4\d\.test\.ts$/, /^assets\/prompts\/.*\.md$/];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let failures = 0;
let scanned = 0;

for (const path of files) {
  if (ALLOW.some((allowed) => allowed.test(path))) continue;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 4_000_000) continue;

  let body;
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    continue; // 画像などは読み飛ばす
  }
  if (body.includes('\0')) continue;
  scanned += 1;

  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(body);
    if (!match) continue;
    const line = body.slice(0, match.index).split('\n').length;
    // 値そのものは表示しない。場所だけを知らせる
    console.error(`❌ ${path}:${line} に ${pattern.name} らしき文字があります`);
    failures += 1;
  }
}

console.log(`\ngit が追跡する ${scanned}件のテキストを調べました。`);
if (failures > 0) {
  console.error(`=== FAIL（${failures}件）===`);
  console.error('鍵はソースに書かず、.env に置いてください（.env は git に入りません）。');
  console.error('すでに push してしまった鍵は、必ず発行元で無効化してください。');
  process.exit(1);
}
console.log('=== PASS（鍵の混入なし）===');
