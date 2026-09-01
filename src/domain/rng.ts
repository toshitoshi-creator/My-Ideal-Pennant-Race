/**
 * 決定論的な擬似乱数生成器（mulberry32）。
 * シードを保存できるので、セーブ／ロード後もリーグの進行が再現可能。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 0 <= x < 1 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min <= x <= max の整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 確率 p で true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 平均 mean・標準偏差 sd の正規乱数（Box-Muller） */
  normal(mean: number, sd: number): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  getState(): number {
    return this.state;
  }
}

/** 文字列から安定したシードを作る */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
