/**
 * PHASE 4.7 PNG の読み書き（外部ライブラリなし）。
 *
 * 後処理（背景除去・切り抜き・位置合わせ・色替え・縮小）をするには、
 * 画素そのものに触れる必要がある。そのためだけの最小の実装。
 *
 * 依存を足さない理由：
 *   - このパイプラインはゲーム本体には入らない
 *   - 画像1枚も無い状態でも動くこと・壊れないことのほうが大事
 *   - node の zlib は使えるなら使う（書き出しのとき外から渡す）が、
 *     無くても「無圧縮の deflate」で正しい PNG を書ける
 *
 * 扱うのは 8bit の RGBA だけに正規化する。読むときは
 * グレースケール・パレット・16bit も RGBA8 に直す。
 */

/** 画素をそのまま持つ画像。data は RGBA が横方向に並ぶ */
export interface RgbaImage {
  width: number;
  height: number;
  /** 長さは width * height * 4 */
  data: Uint8Array;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/* ================================================================
 * CRC32 / Adler32
 * ============================================================== */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ================================================================
 * inflate（deflate の展開）
 * ============================================================== */

class BitReader {
  private readonly bytes: Uint8Array;
  private pos: number;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(bytes: Uint8Array, start = 0) {
    this.bytes = bytes;
    this.pos = start;
  }

  bits(count: number): number {
    while (this.bitCount < count) {
      if (this.pos >= this.bytes.length) throw new Error('圧縮データが途中で終わっています');
      this.bitBuffer |= this.bytes[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  readBytes(count: number): Uint8Array {
    if (this.pos + count > this.bytes.length) {
      throw new Error('圧縮データが途中で終わっています');
    }
    const out = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }
}

/** 符号長の並びから、復号に使う表を作る */
interface HuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array): HuffmanTable {
  const maxBits = 15;
  const counts = new Int32Array(maxBits + 1);
  for (const length of lengths) counts[length] += 1;
  counts[0] = 0;

  const offsets = new Int32Array(maxBits + 2);
  for (let i = 1; i <= maxBits; i++) offsets[i + 1] = offsets[i] + counts[i];

  const symbols = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    if (lengths[symbol] !== 0) symbols[offsets[lengths[symbol]]++] = symbol;
  }
  return { counts, symbols };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length <= 15; length++) {
    code |= reader.bits(1);
    const count = table.counts[length];
    if (code - first < count) return table.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('壊れた符号が含まれています');
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let FIXED_LITERALS: HuffmanTable | null = null;
let FIXED_DISTANCES: HuffmanTable | null = null;

function fixedTables(): { literals: HuffmanTable; distances: HuffmanTable } {
  if (!FIXED_LITERALS || !FIXED_DISTANCES) {
    const literalLengths = new Uint8Array(288);
    for (let i = 0; i < 144; i++) literalLengths[i] = 8;
    for (let i = 144; i < 256; i++) literalLengths[i] = 9;
    for (let i = 256; i < 280; i++) literalLengths[i] = 7;
    for (let i = 280; i < 288; i++) literalLengths[i] = 8;
    FIXED_LITERALS = buildHuffman(literalLengths);
    FIXED_DISTANCES = buildHuffman(new Uint8Array(30).fill(5));
  }
  return { literals: FIXED_LITERALS, distances: FIXED_DISTANCES };
}

/** raw deflate を展開する（zlib のヘッダは含まない） */
export function inflateRaw(bytes: Uint8Array, start = 0): Uint8Array {
  const reader = new BitReader(bytes, start);
  const chunks: Uint8Array[] = [];
  let out = new Uint8Array(1 << 16);
  let length = 0;

  const push = (byte: number) => {
    if (length === out.length) {
      chunks.push(out);
      out = new Uint8Array(out.length * 2);
      length = 0;
    }
    out[length++] = byte;
  };
  const at = (back: number): number => {
    // 直前の出力から back バイト戻ったところ
    if (back <= length) return out[length - back];
    let remaining = back - length;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      if (remaining <= chunk.length) return chunk[chunk.length - remaining];
      remaining -= chunk.length;
    }
    throw new Error('参照先が出力の外を指しています');
  };

  for (;;) {
    const final = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) {
      reader.alignToByte();
      const header = reader.readBytes(4);
      const len = header[0] | (header[1] << 8);
      const nlen = header[2] | (header[3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('無圧縮ブロックの長さが壊れています');
      const raw = reader.readBytes(len);
      for (let i = 0; i < len; i++) push(raw[i]);
    } else if (type === 1 || type === 2) {
      let literals: HuffmanTable;
      let distances: HuffmanTable;
      if (type === 1) {
        ({ literals, distances } = fixedTables());
      } else {
        const hlit = reader.bits(5) + 257;
        const hdist = reader.bits(5) + 1;
        const hclen = reader.bits(4) + 4;
        const codeLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
        const codeTable = buildHuffman(codeLengths);

        const lengths = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < lengths.length) {
          const symbol = decodeSymbol(reader, codeTable);
          if (symbol < 16) {
            lengths[i++] = symbol;
          } else if (symbol === 16) {
            if (i === 0) throw new Error('繰り返す対象がありません');
            const previous = lengths[i - 1];
            const repeat = 3 + reader.bits(2);
            for (let n = 0; n < repeat; n++) lengths[i++] = previous;
          } else if (symbol === 17) {
            const repeat = 3 + reader.bits(3);
            for (let n = 0; n < repeat; n++) lengths[i++] = 0;
          } else {
            const repeat = 11 + reader.bits(7);
            for (let n = 0; n < repeat; n++) lengths[i++] = 0;
          }
        }
        literals = buildHuffman(lengths.subarray(0, hlit));
        distances = buildHuffman(lengths.subarray(hlit));
      }

      for (;;) {
        const symbol = decodeSymbol(reader, literals);
        if (symbol === 256) break;
        if (symbol < 256) {
          push(symbol);
        } else {
          const index = symbol - 257;
          if (index >= LENGTH_BASE.length) throw new Error('長さの符号が範囲外です');
          const runLength = LENGTH_BASE[index] + reader.bits(LENGTH_EXTRA[index]);
          const distSymbol = decodeSymbol(reader, distances);
          const distance = DIST_BASE[distSymbol] + reader.bits(DIST_EXTRA[distSymbol]);
          for (let n = 0; n < runLength; n++) push(at(distance));
        }
      }
    } else {
      throw new Error('知らないブロック種別です');
    }

    if (final) break;
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) + length;
  const result = new Uint8Array(total);
  let at2 = 0;
  for (const chunk of chunks) {
    result.set(chunk, at2);
    at2 += chunk.length;
  }
  result.set(out.subarray(0, length), at2);
  return result;
}

/** zlib（2バイトのヘッダ + raw deflate + Adler32）を展開する */
export function inflate(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2) throw new Error('圧縮データが短すぎます');
  const cmf = bytes[0];
  if ((cmf & 0x0f) !== 8) throw new Error('deflate ではない圧縮方式です');
  if ((bytes[1] & 0x20) !== 0) throw new Error('辞書つきの圧縮には対応していません');
  return inflateRaw(bytes, 2);
}

/**
 * 無圧縮の zlib ストリームを作る。
 * 正しい PNG にはなるが大きい。node の zlib が使えるなら
 * encodePng の deflate 引数にそれを渡す。
 */
export function deflateStored(bytes: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks = Math.max(1, Math.ceil(bytes.length / maxBlock));
  const out = new Uint8Array(2 + blocks * 5 + bytes.length + 4);
  let at = 0;
  out[at++] = 0x78;
  out[at++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * maxBlock;
    const len = Math.min(maxBlock, bytes.length - start);
    out[at++] = i === blocks - 1 ? 1 : 0;
    out[at++] = len & 0xff;
    out[at++] = (len >> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >> 8) & 0xff;
    out.set(bytes.subarray(start, start + len), at);
    at += len;
  }
  const checksum = adler32(bytes);
  out[at++] = (checksum >>> 24) & 0xff;
  out[at++] = (checksum >>> 16) & 0xff;
  out[at++] = (checksum >>> 8) & 0xff;
  out[at++] = checksum & 0xff;
  return out.subarray(0, at);
}

/* ================================================================
 * PNG を読む
 * ============================================================== */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/** ヘッダだけを読む（大きさの検査だけしたいとき） */
export function readPngHeader(bytes: Uint8Array): PngHeader {
  if (!isPng(bytes)) throw new Error('PNG ではありません');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    interlace: bytes[28],
  };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** PNG を RGBA8 の画素に直す */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const header = readPngHeader(bytes);
  if (header.interlace !== 0) throw new Error('インターレースPNGには対応していません');
  if (header.bitDepth !== 8 && header.bitDepth !== 16) {
    throw new Error(`${header.bitDepth}bit のPNGには対応していません（8か16にしてください）`);
  }
  const channels = CHANNELS[header.colorType];
  if (channels === undefined) throw new Error('知らない色の種類です');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;

  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const start = at + 8;
    if (type === 'IDAT') idat.push(bytes.subarray(start, start + length));
    else if (type === 'PLTE') palette = bytes.subarray(start, start + length);
    else if (type === 'tRNS') paletteAlpha = bytes.subarray(start, start + length);
    else if (type === 'IEND') break;
    at = start + length + 4;
  }
  if (idat.length === 0) throw new Error('画素のデータ（IDAT）がありません');

  const compressed = concat(idat);
  const raw = inflate(compressed);

  const sampleBytes = header.bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = channels * sampleBytes;
  const stride = header.width * bytesPerPixel;
  const out = createImage(header.width, header.height);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);

  let readAt = 0;
  for (let y = 0; y < header.height; y++) {
    if (readAt >= raw.length) throw new Error('画素のデータが足りません');
    const filter = raw[readAt++];
    line.set(raw.subarray(readAt, readAt + stride));
    readAt += stride;
    unfilter(filter, line, previous, bytesPerPixel);

    for (let x = 0; x < header.width; x++) {
      const from = x * bytesPerPixel;
      const to = (y * header.width + x) * 4;
      writePixel(out.data, to, line, from, header, sampleBytes, palette, paletteAlpha);
    }
    previous.set(line);
  }
  return out;
}

function writePixel(
  target: Uint8Array,
  to: number,
  line: Uint8Array,
  from: number,
  header: PngHeader,
  sampleBytes: number,
  palette: Uint8Array | null,
  paletteAlpha: Uint8Array | null,
): void {
  // 16bit は上位バイトだけ使う（8bit へ落とす）
  const s = (index: number) => line[from + index * sampleBytes];
  switch (header.colorType) {
    case 0: {
      const grey = s(0);
      target[to] = grey;
      target[to + 1] = grey;
      target[to + 2] = grey;
      target[to + 3] = 255;
      return;
    }
    case 2: {
      target[to] = s(0);
      target[to + 1] = s(1);
      target[to + 2] = s(2);
      target[to + 3] = 255;
      return;
    }
    case 3: {
      const index = line[from];
      if (!palette) throw new Error('パレットPNGなのに PLTE がありません');
      target[to] = palette[index * 3];
      target[to + 1] = palette[index * 3 + 1];
      target[to + 2] = palette[index * 3 + 2];
      target[to + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      return;
    }
    case 4: {
      const grey = s(0);
      target[to] = grey;
      target[to + 1] = grey;
      target[to + 2] = grey;
      target[to + 3] = s(1);
      return;
    }
    default: {
      target[to] = s(0);
      target[to + 1] = s(1);
      target[to + 2] = s(2);
      target[to + 3] = s(3);
    }
  }
}

function unfilter(filter: number, line: Uint8Array, previous: Uint8Array, bpp: number): void {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < line.length; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
      return;
    case 2:
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + previous[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < line.length; i++) {
        const left = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = previous[i];
        const c = i >= bpp ? previous[i - bpp] : 0;
        line[i] = (line[i] + paeth(a, b, c)) & 0xff;
      }
      return;
    default:
      throw new Error(`知らないフィルタ種別です: ${filter}`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* ================================================================
 * PNG を書く
 * ============================================================== */

/** 生のバイト列を縮める関数。渡さなければ無圧縮で書く */
export type Deflate = (bytes: Uint8Array) => Uint8Array;

/** RGBA8 の画素から PNG を作る（色種別6・8bit・非インターレース） */
export function encodePng(image: RgbaImage, deflate: Deflate = deflateStored): Uint8Array {
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    // フィルタは Up（2）。縦に似た画素が多いので、そこそこ縮む
    const to = y * (stride + 1);
    raw[to] = y === 0 ? 0 : 2;
    const from = y * stride;
    if (y === 0) {
      raw.set(image.data.subarray(from, from + stride), to + 1);
    } else {
      const above = from - stride;
      for (let i = 0; i < stride; i++) {
        raw[to + 1 + i] = (image.data[from + i] - image.data[above + i]) & 0xff;
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, image.width);
  ihdrView.setUint32(4, image.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = 8 + chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  out.set(SIGNATURE, 0);
  let at = 8;
  for (const part of chunks) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
