/**
 * 制作確認ページを書き出す（§9・§10・§11・§20）。
 *
 *   npm run character:preview            1回だけ
 *   npm run character:preview -- --watch 保存するたび作り直す
 *
 * `character-template/preview/index.html` をブラウザで開いてください。
 *
 * SVGの中身は書き出すときに埋め込みます。
 * file:// で開いたときにブラウザが外部ファイルの読み込みを止めるため、
 * 取りに行かせず、最初から中に入れておきます。
 * （外部から取りに行かない、という方針とも合っています）
 */
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  CENTER_X,
  GUIDES,
  HEIGHT,
  LAYERS,
  WIDTH,
  fileNameOf,
  groupIdOf,
} from './character/templateSpec';

const ROOT = fileURLToPath(new URL('../character-template', import.meta.url));
const OUT = join(ROOT, 'preview', 'index.html');

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** SVGファイルから <svg> の中身だけを取り出す（コメントは落とす） */
function innerOf(path: string): { markup: string; missing: boolean } {
  if (!existsSync(path)) return { markup: '', missing: true };
  const raw = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const match = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(raw);
  return { markup: match ? match[1] : '', missing: false };
}

function build(): void {
  const guide = innerOf(join(ROOT, 'GUIDE.svg'));

  const layers = LAYERS.map((layer) => {
    const file = fileNameOf(layer);
    const { markup, missing } = innerOf(join(ROOT, file));
    const body = markup.replace(/<!--[\s\S]*?-->/g, '').trim();
    // g の中に何か入っているか
    const inner = /<g\b[^>]*>([\s\S]*)<\/g>/.exec(body);
    const drawn = inner ? inner[1].trim().length > 0 : body.length > 0;
    return { layer, file, markup, missing, drawn };
  });

  const drawnCount = layers.filter((l) => l.drawn).length;

  const layerSvgs = layers
    .map(
      (l) =>
        `<svg class="layer" data-order="${l.layer.order}" viewBox="0 0 ${WIDTH} ${HEIGHT}" ` +
        `xmlns="http://www.w3.org/2000/svg">${l.markup}</svg>`,
    )
    .join('\n');

  const toggles = layers
    .map(
      (l) => `<label class="toggle${l.drawn ? '' : ' empty'}">
  <input type="checkbox" data-layer="${l.layer.order}" checked>
  <span class="num">${String(l.layer.order).padStart(2, '0')}</span>
  <span class="name">${esc(l.layer.label)}</span>
  <span class="state">${l.missing ? 'ファイル無し' : l.drawn ? '' : '空'}</span>
</label>`,
    )
    .join('\n');

  const stepRows = layers
    .map(
      (l) => `<tr data-row="${l.layer.order}">
  <td class="n">${String(l.layer.order).padStart(2, '0')}</td>
  <td>${esc(l.layer.label)}</td>
  <td class="mono bbox" data-bbox="${l.layer.order}">—</td>
  <td class="mono area">x ${l.layer.area.x[0]}–${l.layer.area.x[1]} / y ${l.layer.area.y[0]}–${l.layer.area.y[1]}</td>
</tr>`,
    )
    .join('\n');

  const guideRows = (Object.entries(GUIDES) as Array<[string, number]>)
    .map(([n, v]) => `<li><code>${n}</code> <b>${v}</b></li>`)
    .join('');

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHARACTER TEMPLATE PREVIEW</title>
<style>
 :root{--line:#d9d5ce;--ink:#20191a;--sub:#6b6560;--bg:#f4f4f2}
 *{box-sizing:border-box}
 body{margin:0;padding:20px;background:var(--bg);color:var(--ink);
      font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN",sans-serif}
 h1{font-size:18px;margin:0 0 4px}
 .lead{color:var(--sub);font-size:12px;margin:0 0 18px;line-height:1.8}
 .wrap{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
 .panel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px}
 .stagewrap{position:relative}
 .stage{position:relative;width:${WIDTH}px;height:${HEIGHT}px;transform-origin:top left;
        background-image:linear-gradient(45deg,#eceae6 25%,transparent 25%),
          linear-gradient(-45deg,#eceae6 25%,transparent 25%),
          linear-gradient(45deg,transparent 75%,#eceae6 75%),
          linear-gradient(-45deg,transparent 75%,#eceae6 75%);
        background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
 .stage svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
 .stage svg.hidden{display:none}
 #grid{position:absolute;inset:0;pointer-events:none}
 #grid.hidden{display:none}
 .controls{min-width:240px}
 h2{font-size:12px;margin:0 0 10px;letter-spacing:.08em;color:var(--sub)}
 h2:not(:first-child){margin-top:20px;padding-top:14px;border-top:1px solid #eeece8}
 .toggle{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer}
 .toggle.empty .name{color:#a8a29a}
 .num{font-variant-numeric:tabular-nums;color:var(--sub);width:20px}
 .name{flex:1}
 .state{font-size:10px;color:#a8a29a}
 .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
 button{font:inherit;font-size:12px;padding:5px 10px;border:1px solid var(--line);
        background:#fff;border-radius:6px;cursor:pointer}
 button:hover{background:#f7f6f4}
 button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
 table{border-collapse:collapse;font-size:11px;width:100%}
 th,td{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid #f0eeea}
 th{color:var(--sub);font-weight:600}
 td.n{color:var(--sub);font-variant-numeric:tabular-nums}
 .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--sub)}
 tr.off{opacity:.35}
 ul{margin:0;padding-left:16px;font-size:11px;line-height:1.9;color:var(--sub)}
 ul code{color:var(--ink)}
 .note{font-size:11px;color:var(--sub);line-height:1.8;margin:10px 0 0}
 .phone{width:390px;height:844px;border:1px solid var(--line);border-radius:10px;
        background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
</style></head><body>

<h1>CHARACTER TEMPLATE PREVIEW</h1>
<p class="lead">
  <code>character-template/</code> の12枚を重ねて表示しています。中身が入っているのは <b>${drawnCount} / 12</b> 枚。<br>
  絵はこのページでは作りません。あなたがSVGを描いて保存すると、ここに出ます。<br>
  自動での位置合わせ・拡大縮小は<b>していません</b>（§13）。ずれていたら、描いた側の座標を直してください。
</p>

<div class="wrap">

  <div class="panel stagewrap">
    <div class="row">
      <button id="zoom-out">−</button>
      <button id="zoom-in">＋</button>
      <span class="mono" id="zoom-label" style="align-self:center">100%</span>
      <button id="btn-guide" class="on">GUIDE</button>
      <button id="btn-grid">GRID 10px</button>
      <button id="btn-phone">390×844</button>
    </div>
    <div id="scaler" style="width:${WIDTH}px;height:${HEIGHT}px">
      <div class="stage" id="stage">
${layerSvgs}
        <svg class="layer" id="guide-layer" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${guide.markup}</svg>
        <svg id="grid" class="hidden" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    </div>
  </div>

  <div class="panel controls">
    <h2>レイヤー</h2>
    <div class="row">
      <button id="all-on">すべて表示</button>
      <button id="all-off">すべて消す</button>
      <button id="step">順に足す</button>
    </div>
${toggles}

    <h2>基準座標</h2>
    <ul><li><code>CENTER_X</code> <b>${CENTER_X}</b></li>${guideRows}</ul>
    <p class="note">
      キャンバスは <b>${WIDTH} × ${HEIGHT}</b>、viewBox は <b>0 0 ${WIDTH} ${HEIGHT}</b>。<br>
      12枚すべて同じ座標系です。
    </p>
  </div>

  <div class="panel" style="min-width:360px">
    <h2>座標の確認（bounding box）</h2>
    <table>
      <tr><th>#</th><th>レイヤー</th><th>left / top / right / bottom ・ center</th><th>目安の範囲</th></tr>
${stepRows}
    </table>
    <p class="note">
      実際に描かれている範囲を出しています。<b>頭・耳・髪・帽子</b>の接続位置は、ここの数字で見比べてください。
    </p>
  </div>

</div>

<script>
(function () {
  var stage = document.getElementById('stage');
  var layers = {};
  Array.prototype.forEach.call(stage.querySelectorAll('svg.layer[data-order]'), function (el) {
    layers[el.getAttribute('data-order')] = el;
  });

  /* --- グリッド（§10）。10px ごと --- */
  var grid = document.getElementById('grid');
  var parts = [];
  for (var x = 0; x <= ${WIDTH}; x += 10) {
    parts.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="${HEIGHT}" stroke="#9aa3ad" stroke-width="' +
      (x % 50 === 0 ? 0.8 : 0.4) + '" opacity="' + (x % 50 === 0 ? 0.85 : 0.5) + '"/>');
  }
  for (var y = 0; y <= ${HEIGHT}; y += 10) {
    parts.push('<line x1="0" y1="' + y + '" x2="${WIDTH}" y2="' + y + '" stroke="#9aa3ad" stroke-width="' +
      (y % 50 === 0 ? 0.8 : 0.4) + '" opacity="' + (y % 50 === 0 ? 0.85 : 0.5) + '"/>');
  }
  grid.innerHTML = parts.join('');

  /* --- bounding box（§11） --- */
  function refresh() {
    Object.keys(layers).forEach(function (order) {
      var svg = layers[order];
      var cell = document.querySelector('[data-bbox="' + order + '"]');
      var row = document.querySelector('[data-row="' + order + '"]');
      if (row) row.className = svg.classList.contains('hidden') ? 'off' : '';
      if (!cell) return;
      var g = svg.querySelector('g');
      var box = null;
      try { box = g ? g.getBBox() : null; } catch (e) { box = null; }
      if (!box || (box.width === 0 && box.height === 0)) { cell.textContent = '（空）'; return; }
      var r = function (n) { return Math.round(n * 10) / 10; };
      cell.textContent =
        r(box.x) + ' / ' + r(box.y) + ' / ' + r(box.x + box.width) + ' / ' + r(box.y + box.height) +
        '　・ ' + r(box.x + box.width / 2) + ', ' + r(box.y + box.height / 2);
    });
  }

  /* --- レイヤーの ON/OFF（§9） --- */
  Array.prototype.forEach.call(document.querySelectorAll('input[data-layer]'), function (input) {
    input.addEventListener('change', function () {
      var el = layers[input.getAttribute('data-layer')];
      if (el) el.classList.toggle('hidden', !input.checked);
      refresh();
    });
  });
  function setAll(on) {
    Array.prototype.forEach.call(document.querySelectorAll('input[data-layer]'), function (i) {
      i.checked = on;
      var el = layers[i.getAttribute('data-layer')];
      if (el) el.classList.toggle('hidden', !on);
    });
    refresh();
  }
  document.getElementById('all-on').addEventListener('click', function () { setAll(true); });
  document.getElementById('all-off').addEventListener('click', function () { setAll(false); });

  /* 「順に足す」… HEAD だけ → HEAD+EARS → … と重ねて見る（§9） */
  var stepTimer = null, stepAt = 0;
  document.getElementById('step').addEventListener('click', function () {
    if (stepTimer) { clearInterval(stepTimer); stepTimer = null; this.classList.remove('on'); return; }
    this.classList.add('on');
    setAll(false);
    stepAt = 0;
    var order = [4, 3, 2, 1, 5, 6, 7, 8, 9, 10, 11, 12];
    var self = this;
    stepTimer = setInterval(function () {
      if (stepAt >= order.length) { clearInterval(stepTimer); stepTimer = null; self.classList.remove('on'); return; }
      var n = String(order[stepAt++]);
      var input = document.querySelector('input[data-layer="' + n + '"]');
      if (input) { input.checked = true; }
      if (layers[n]) layers[n].classList.remove('hidden');
      refresh();
    }, 550);
  });

  /* --- GUIDE / GRID / 390x844（§8・§10・§21-10） --- */
  var guideLayer = document.getElementById('guide-layer');
  var btnGuide = document.getElementById('btn-guide');
  btnGuide.addEventListener('click', function () {
    var on = guideLayer.classList.toggle('hidden');
    btnGuide.classList.toggle('on', !on);
  });
  var btnGrid = document.getElementById('btn-grid');
  btnGrid.addEventListener('click', function () {
    var on = grid.classList.toggle('hidden');
    btnGrid.classList.toggle('on', !on);
  });

  /* --- 拡大縮小（表示だけ。SVGの座標は触らない） --- */
  var scaler = document.getElementById('scaler');
  var zoom = 1;
  function applyZoom() {
    stage.style.transform = 'scale(' + zoom + ')';
    scaler.style.width = (${WIDTH} * zoom) + 'px';
    scaler.style.height = (${HEIGHT} * zoom) + 'px';
    document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%';
  }
  document.getElementById('zoom-in').addEventListener('click', function () {
    zoom = Math.min(4, zoom + 0.25); applyZoom();
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    zoom = Math.max(0.25, zoom - 0.25); applyZoom();
  });

  var phone = false;
  document.getElementById('btn-phone').addEventListener('click', function () {
    phone = !phone;
    this.classList.toggle('on', phone);
    zoom = phone ? 0.35 : 1;
    applyZoom();
    scaler.parentElement.style.width = phone ? '390px' : '';
  });

  applyZoom();
  refresh();
})();
</script>
</body></html>
`;

  writeFileSync(OUT, html, 'utf8');
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`  [${stamp}] 12レイヤー中 ${drawnCount}枚に中身あり → character-template/preview/index.html`);
}

console.log('\n=== 制作確認ページ ===\n');
build();

if (process.argv.includes('--watch')) {
  console.log(`\n  監視中: ${ROOT}`);
  console.log('  preview/index.html を開いたまま、SVGを保存してください');
  console.log('  （ページは自分では更新しないので、保存後にブラウザを再読み込みしてください）');
  console.log('  止めるには Ctrl+C\n');
  let timer: NodeJS.Timeout | null = null;
  watch(ROOT, { recursive: true }, (_event, name) => {
    if (!name || !name.endsWith('.svg')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, 250);
  });
} else {
  console.log('\n  開く: character-template/preview/index.html\n');
}
