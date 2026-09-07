/**
 * PHASE 4.5 耳（6種類）。
 *
 * 顔のシルエットに効くので独立して持つ。
 * 輪郭の横幅に合わせて位置が決まるので、細面でも横広でも自然につく。
 */
import type { EarId, PartContext } from '../types';
import { CENTER_X, EYE_Y } from '../types';

interface EarSpec {
  h: number;
  w: number;
  /** 上下の位置（目の高さからのずれ） */
  offsetY: number;
  /** 外に張り出す量 */
  out: number;
  /** 耳たぶを描くか */
  lobe: boolean;
  /** 上が尖るか */
  pointed: boolean;
}

const SPECS: Record<EarId, EarSpec> = {
  ear_01_standard: { h: 24, w: 9, offsetY: 6, out: 3, lobe: true, pointed: false },
  ear_02_small: { h: 18, w: 7, offsetY: 7, out: 2, lobe: false, pointed: false },
  ear_03_large: { h: 30, w: 11, offsetY: 5, out: 5.5, lobe: true, pointed: false },
  ear_04_pointed: { h: 25, w: 8.5, offsetY: 5, out: 4, lobe: false, pointed: true },
  ear_05_flat: { h: 22, w: 6, offsetY: 6, out: 1, lobe: false, pointed: false },
  ear_06_lobed: { h: 26, w: 9.5, offsetY: 6, out: 3.5, lobe: true, pointed: false },
};

function specOf(id: EarId): EarSpec {
  return SPECS[id] ?? SPECS.ear_01_standard;
}

function OneEar({ spec, side, ctx }: { spec: EarSpec; side: 1 | -1; ctx: PartContext }) {
  // 輪郭のすぐ内側から生やす。飛び出しは out だけ
  const x = CENTER_X + side * (ctx.geo.halfWidth - 1);
  const y = EYE_Y + spec.offsetY;
  const w = spec.w + spec.out;
  const top = y - spec.h / 2;
  const bottom = y + spec.h / 2;
  return (
    <g>
      <path
        d={`M ${x} ${top}
            C ${x + side * w} ${top - (spec.pointed ? 4 : 1)} ${x + side * w} ${bottom - 4} ${x + side * (spec.lobe ? w * 0.6 : w * 0.4)} ${bottom}
            L ${x} ${bottom - 2} Z`}
        fill={ctx.skin}
        className="pt-line"
      />
      {/* 耳の内側の線 */}
      <path
        d={`M ${x + side * 1.6} ${top + 3} C ${x + side * (w - 1.4)} ${top + 4} ${x + side * (w - 1.6)} ${bottom - 6} ${x + side * 2.4} ${bottom - 3.5}`}
        className="pt-ear-inner"
      />
    </g>
  );
}

export function Ears({ id, ctx }: { id: EarId; ctx: PartContext }) {
  const spec = specOf(id);
  return (
    <g className="pt-ears">
      <OneEar spec={spec} side={-1} ctx={ctx} />
      <OneEar spec={spec} side={1} ctx={ctx} />
    </g>
  );
}
