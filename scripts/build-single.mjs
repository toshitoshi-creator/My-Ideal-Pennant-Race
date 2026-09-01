/**
 * dist/ のビルド結果を 1 枚の HTML にまとめる。
 * 出力ファイルはこれ単体で動くので、スマートフォンに転送したり
 * 静的ホスティングに置いたりするだけで遊べる。
 *
 *   npm run build && node scripts/build-single.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const files = readdirSync(ASSETS);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));

if (!jsFile || !cssFile) {
  console.error('dist/assets にビルド結果が見つかりません。先に npm run build を実行してください。');
  process.exit(1);
}

const js = readFileSync(join(ASSETS, jsFile), 'utf8');
const css = readFileSync(join(ASSETS, cssFile), 'utf8');

// インライン化した JS/CSS が </script> や </style> でタグを閉じてしまわないようにする
const safe = (code) => code.replace(/<\/(script|style)/gi, '<\\/$1');

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
${safe(js)}
    </script>
  </body>
</html>
`;

const out = join(DIST, 'my-ideal-pennant-race.html');
writeFileSync(out, html);
console.log(`${out} を作成しました（${(html.length / 1024).toFixed(0)} KB）`);
