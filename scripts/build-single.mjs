/**
 * dist/ のビルド結果を 1 枚の HTML にまとめる。
 * 出力ファイルはこれ単体で動くので、スマートフォンに転送したり
 * 静的ホスティングに置いたりするだけで遊べる。
 *
 *   npm run build && node scripts/build-single.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const files = readdirSync(ASSETS);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));

/** PHASE 4.7 §42 単一HTMLには外部ファイルを置けないので、画像は data: に埋め込む */
const IMAGE_EXT = { '.png': 'image/png', '.webp': 'image/webp' };
const MIME = (name) => IMAGE_EXT[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? null;

if (!jsFile || !cssFile) {
  console.error('dist/assets にビルド結果が見つかりません。先に npm run build を実行してください。');
  process.exit(1);
}

const js = readFileSync(join(ASSETS, jsFile), 'utf8');
const css = readFileSync(join(ASSETS, cssFile), 'utf8');

// インライン化した JS/CSS が </script> や </style> でタグを閉じてしまわないようにする
const safe = (code) => code.replace(/<\/(script|style)/gi, '<\\/$1');

/**
 * ビルド結果の中に残っている画像への参照を data: に置き換える（§42）。
 * 単一HTMLは1枚で完結しないといけないので、外部ファイルは1つも残せない。
 */
function inlineImages(code) {
  let out = code;
  let inlined = 0;
  let bytes = 0;
  for (const name of files) {
    const mime = MIME(name);
    if (!mime) continue;
    const raw = readFileSync(join(ASSETS, name));
    const uri = `data:${mime};base64,${raw.toString('base64')}`;
    let hit = false;
    // Vite は `new URL("xxx.png",import.meta.url).href` の形で参照する。
    // 単一HTMLでは import.meta.url が HTML 自身になってしまうので、丸ごと差し替える。
    for (const quote of ['"', "'"]) {
      const expression = `new URL(${quote}${name}${quote},import.meta.url).href`;
      if (out.includes(expression)) {
        out = out.split(expression).join(`${quote}${uri}${quote}`);
        hit = true;
      }
    }
    // 素の文字列で参照している場合にも備える
    for (const prefix of ['./assets/', '/assets/', '']) {
      for (const quote of ['"', "'"]) {
        const literal = `${quote}${prefix}${name}${quote}`;
        if (prefix === '' && !hit) continue;
        if (!out.includes(literal)) continue;
        out = out.split(literal).join(`${quote}${uri}${quote}`);
        hit = true;
      }
    }
    if (hit) {
      inlined += 1;
      bytes += raw.length;
    }
  }
  return { code: out, inlined, bytes };
}

const imageFiles = files.filter((name) => MIME(name) !== null);
const imageBytes = imageFiles.reduce((sum, name) => sum + statSync(join(ASSETS, name)).size, 0);

const withImages = inlineImages(js);
const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <meta name="theme-color" content="#0d1117" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%9A%BE%3C/text%3E%3C/svg%3E"
    />
    <title>My Ideal Pennant Race</title>
    <style>
${safe(css)}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
${safe(withImages.code)}
    </script>
  </body>
</html>
`;

const out = join(DIST, 'my-ideal-pennant-race.html');
writeFileSync(out, html);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${out} を作成しました（${kb(html.length)}）`);
if (imageFiles.length > 0) {
  console.log(`  画像 ${imageFiles.length}件（${kb(imageBytes)}）のうち ${withImages.inlined}件を埋め込みました`);
}
// 外部ファイルへの参照が残っていたら、単一HTMLとして成立しない
const leftover = [
  ...html.matchAll(/["'`](?:\.?\/)?(?:assets\/)?[A-Za-z0-9_.@-]+\.(?:png|webp|jpg|jpeg|woff2?)["'`]/g),
].filter((match) => !match[0].includes('data:'));
if (leftover.length > 0) {
  console.error(`  ❌ 外部ファイルへの参照が ${leftover.length}件 残っています: ${leftover.slice(0, 3).map((m) => m[0]).join(', ')}`);
  process.exit(1);
}
if (html.length > 16 * 1024 * 1024) {
  console.error(`  ❌ 単一HTMLが 16MB を超えました（${kb(html.length)}）。素材を減らすか解像度を下げてください。`);
  process.exit(1);
}
console.log('  外部ファイルへの参照: 0件');
