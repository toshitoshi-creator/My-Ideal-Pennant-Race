/**
 * PHASE 4.5 眉（10種類）。
 *
 * 太さ・長さ・角度・濃さを別々に持つ。
 * 表情では眉の「内側の上下」だけを動かす（怒りは内下がり、驚きは全体が上がる）。
 */
import type { EyebrowId, PartContext } from '../types';
import { CENTER_X, EYE_Y } from '../types';

interface BrowSpec {
  /** 長さ（片眉） */
  len: number;
  /** 太さ */
  weight: number;
  /** 目からの高さ */
  lift: number;
  /** 外側の上がり（正で上がり眉） */
  tilt: number;
  /** 弧の深さ（正でアーチ） */
  arch: number;
  /** 濃さ */
  opacity: number;
}

const SPECS: Record<EyebrowId, BrowSpec> = {
  brow_01_thick: { len: 15, weight: 5.4, lift: 17, tilt: 1, arch: 1.6, opacity: 1 },
  brow_02_thin: { len: 14, weight: 2.4, lift: 18, tilt: 1, arch: 1.8, opacity: 0.9 },
  brow_03_straight: { len: 15, weight: 4, lift: 17, tilt: 0, arch: 0, opacity: 1 },
  brow_04_raised: { len: 14, weight: 3.8, lift: 20, tilt: 3.6, arch: 1.2, opacity: 1 },
  brow_05_drooping: { len: 14.5, weight: 3.6, lift: 16, tilt: -3.4, arch: 0.6, opacity: 0.95 },
  brow_06_arched: { len: 14, weight: 3.4, lift: 19, tilt: 1.2, arch: 4.4, opacity: 1 },
  brow_07_dense: { len: 16, weight: 6.2, lift: 16, tilt: 0.6, arch: 1, opacity: 1 },
  brow_08_light: { len: 13.5, weight: 2.8, lift: 18, tilt: 0.8, arch: 1.4, opacity: 0.62 },
  brow_09_short: { len: 10.5, weight: 4.4, lift: 17, tilt: 1.4, arch: 1.2, opacity: 1 },
  brow_10_long: { len: 18, weight: 3.6, lift: 17, tilt: 0.8, arch: 1.6, opacity: 1 },
};

/** 表情による眉の動き。inner = 内側の上下、outer = 外側の上下、lift = 全体 */
const EXPRESSION_BROW: Record<string, { inner: number; outer: number; lift: number }> = {
  neutral: { inner: 0, outer: 0, lift: 0 },
  focused: { inner: -1.6, outer: 0.4, lift: -1 },
  confident: { inner: 0.6, outer: 1.8, lift: 0.6 },
  happy: { inner: 1.2, outer: 1, lift: 1.4 },
  disappointed: { inner: 3.2, outer: -2.2, lift: -0.6 },
  tired: { inner: 2.4, outer: -2.6, lift: -1.4 },
  angry: { inner: -4.2, outer: 1.6, lift: -1.8 },
  surprised: { inner: 2, outer: 2.4, lift: 5 },
  injured: { inner: 3.4, outer: -1.6, lift: -0.4 },
  celebrating: { inner: 1.6, outer: 1.4, lift: 2.6 },
};

function specOf(id: EyebrowId): BrowSpec {
  return SPECS[id] ?? SPECS.brow_03_straight;
}

function OneBrow({
  spec,
  side,
  ctx,
  mod,
}: {
  spec: BrowSpec;
  side: 1 | -1;
  ctx: PartContext;
  mod: { inner: number; outer: number; lift: number };
}) {
  const cx = CENTER_X + side * ctx.geo.eyeGap;
  const baseY = EYE_Y - spec.lift - mod.lift;
  const innerX = cx - side * spec.len * 0.85;
  const outerX = cx + side * spec.len;
  const innerY = baseY + mod.inner;
  const outerY = baseY - spec.tilt - mod.outer;
  const midY = baseY - spec.arch - (mod.inner + mod.outer) * 0.2;
  const half = spec.weight / 2;
  return (
    <path
      d={`M ${innerX} ${innerY - half * 0.6}
          Q ${cx} ${midY - half} ${outerX} ${outerY - half * 0.3}
          Q ${cx} ${midY + half} ${innerX} ${innerY + half * 0.9} Z`}
      fill={ctx.hair}
      opacity={spec.opacity}
    />
  );
}

export function Eyebrows({ id, ctx }: { id: EyebrowId; ctx: PartContext }) {
  const spec = specOf(id);
  const mod = EXPRESSION_BROW[ctx.expression] ?? EXPRESSION_BROW.neutral;
  return (
    <g className="pt-brows">
      <OneBrow spec={spec} side={-1} ctx={ctx} mod={mod} />
      <OneBrow spec={spec} side={1} ctx={ctx} mod={mod} />
    </g>
  );
}
