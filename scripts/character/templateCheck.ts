/**
 * SVG1枚の検査（§21・§22）。
 *
 * **ここには node の機能を入れません。**
 * テストからも CLI からも同じものを呼びたいためです。
 * 検査が2つに分かれると「CLIは通るのにテストは落ちる」が起きます。
 */
import { HEIGHT, VIEW_BOX, WIDTH } from './templateSpec';

interface Finding {
  level: 'error' | 'warn';
  message: string;
}

/** 検査の1項目。テスト側からも同じものを呼ぶ */
export function checkSvg(source: string, options: { isGuide?: boolean } = {}): Finding[] {
  const out: Finding[] = [];
  const body = source.replace(/<!--[\s\S]*?-->/g, '');

  const svg = /<svg\b([^>]*)>/.exec(body);
  if (!svg) return [{ level: 'error', message: '<svg> が見つかりません' }];
  const attrs = svg[1];

  const attr = (name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
    return m ? m[1] : null;
  };

  // 1. 256x320 か
  if (attr('width') !== String(WIDTH) || attr('height') !== String(HEIGHT)) {
    out.push({
      level: 'error',
      message: `width/height が ${WIDTH}x${HEIGHT} ではありません（${attr('width')}x${attr('height')}）`,
    });
  }

  // 2. viewBox が固定値か
  const viewBox = attr('viewBox');
  if (viewBox === null) out.push({ level: 'error', message: 'viewBox がありません' });
  else if (viewBox.trim().replace(/[\s,]+/g, ' ') !== VIEW_BOX) {
    out.push({ level: 'error', message: `viewBox が "${VIEW_BOX}" ではありません（${viewBox}）` });
  }

  // 3. 背景を描いていないか（§7）
  const bgRect = new RegExp(
    `<rect\\b[^>]*\\bwidth\\s*=\\s*"${WIDTH}"[^>]*\\bheight\\s*=\\s*"${HEIGHT}"[^>]*>`,
  );
  if (bgRect.test(body)) {
    const m = bgRect.exec(body)!;
    if (!/fill\s*=\s*"none"/.test(m[0])) {
      out.push({ level: 'error', message: '全面の rect（背景）が入っています。背景は透明にしてください' });
    }
  }
  if (/<svg\b[^>]*\bstyle\s*=\s*"[^"]*background/.test(body)) {
    out.push({ level: 'error', message: '<svg> に background が指定されています' });
  }

  // 4. 外部URL / 5. raster画像 / 6. base64
  if (/<image\b/i.test(body)) out.push({ level: 'error', message: '<image>（画像の埋め込み）が入っています' });
  if (/data:image\//i.test(body)) out.push({ level: 'error', message: 'base64画像が入っています' });
  const withoutNs = body.replace(/\sxmlns(:[A-Za-z][\w.-]*)?\s*=\s*"https?:\/\/www\.w3\.org\/[^"]*"/g, ' ');
  if (/https?:\/\//i.test(withoutNs)) out.push({ level: 'error', message: '外部URLが入っています' });
  if (/\bhref\s*=/i.test(withoutNs)) out.push({ level: 'error', message: '外部参照（href）が入っています' });
  if (/<script/i.test(body)) out.push({ level: 'error', message: 'script が入っています' });
  if (/\bon[a-z]+\s*=/i.test(body)) out.push({ level: 'error', message: 'イベント属性が入っています' });

  // 7/8. 勝手な縮尺・位置補正が入っていないか（§13）
  const rootGroup = /<g\b([^>]*)>/.exec(body);
  if (rootGroup && /\btransform\s*=\s*"[^"]*(scale|matrix)/.test(rootGroup[1])) {
    out.push({
      level: 'error',
      message: '一番外の <g> に scale / matrix が付いています。座標はそのまま描いてください（§13）',
    });
  }
  if (rootGroup && /\btransform\s*=\s*"[^"]*translate/.test(rootGroup[1])) {
    out.push({
      level: 'warn',
      message: '一番外の <g> に translate が付いています。ずらさずに描いたほうが後で困りません',
    });
  }

  /*
   * 線が細すぎないか（§16）。
   *
   * GUIDE は目印なので細くて正しい。ここで注意を出すと、
   * 「毎回出る注意」になって読まれなくなるので、外す。
   */
  if (options.isGuide) return out;

  const thin: number[] = [];
  const re = /stroke-width\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > 0 && v < 1.5) thin.push(v);
  }
  if (thin.length > 0) {
    out.push({
      level: 'warn',
      message: `線が細すぎます（${[...new Set(thin)].join(', ')}）。スマホで潰れます。1.5以上を目安に`,
    });
  }

  return out;
}

/** その g の中に絵があるか */
export function hasDrawing(source: string): boolean {
  const body = source.replace(/<!--[\s\S]*?-->/g, '');
  const group = /<g\b[^>]*>([\s\S]*)<\/g>/.exec(body);
  return group ? group[1].trim().length > 0 : false;
}

