/**
 * PHASE 4.5 目（12種類）と表情。
 *
 * 目は「その人らしさ」がいちばん出る部品なので、
 * 幅・高さ・まぶたの曲がり・目尻の角度・黒目の大きさを別々に持たせる。
 * 表情は、この形はそのままに「開き具合」と「目尻の上下」だけを変える。
 * 表情で別人にはしない。
 */
import type { EyeId, PartContext } from '../types';
import { CENTER_X, EYE_Y } from '../types';

interface EyeSpec {
  /** 目の横幅（片目） */
  w: number;
  /** 上まぶたの高さ */
  h: number;
  /** 下まぶたの深さ */
  under: number;
  /** 目尻の上がり（正で吊り目、負でたれ目） */
  tilt: number;
  /** 黒目の半径 */
  iris: number;
  /** まぶたの線を濃く描くか */
  lidLine: boolean;
}

const SPECS: Record<EyeId, EyeSpec> = {
  eye_01_round: { w: 12.5, h: 8.7, under: 5.5, tilt: 0, iris: 4.73, lidLine: true },
  eye_02_narrow: { w: 14.2, h: 4.9, under: 2.6, tilt: 1.5, iris: 3.74, lidLine: true },
  eye_03_large: { w: 14.2, h: 10.2, under: 6.4, tilt: 0, iris: 5.5, lidLine: true },
  eye_04_small: { w: 9.7, h: 5.8, under: 3.4, tilt: 0.5, iris: 3.52, lidLine: false },
  eye_05_droop: { w: 13.1, h: 7.4, under: 5, tilt: -3.2, iris: 4.51, lidLine: true },
  eye_06_sharp: { w: 13.7, h: 6.3, under: 3, tilt: 3.4, iris: 4.18, lidLine: true },
  eye_07_wide: { w: 16.0, h: 7.2, under: 4.2, tilt: 0, iris: 4.4, lidLine: false },
  eye_08_deep: { w: 12.5, h: 7.0, under: 4.4, tilt: 0.8, iris: 4.62, lidLine: true },
  eye_09_athletic: { w: 13.9, h: 6.7, under: 3.6, tilt: 2, iris: 4.29, lidLine: true },
  eye_10_gentle: { w: 12.5, h: 8.1, under: 5.6, tilt: -1.8, iris: 4.84, lidLine: false },
  eye_11_keen: { w: 14.6, h: 5.6, under: 2.8, tilt: 2.6, iris: 3.96, lidLine: true },
  eye_12_calm: { w: 12.0, h: 7.0, under: 4.6, tilt: -0.6, iris: 4.4, lidLine: false },
};

/** 表情ごとの「開き具合」と「目尻の上下」 */
const EXPRESSION_EYE: Record<string, { open: number; tilt: number; iris: number }> = {
  neutral: { open: 1, tilt: 0, iris: 1.1 },
  focused: { open: 0.88, tilt: 0.6, iris: 1.1 },
  confident: { open: 0.86, tilt: 1.1, iris: 1.1 },
  happy: { open: 0.34, tilt: -1.4, iris: 0.88 },
  disappointed: { open: 0.72, tilt: -2.2, iris: 1.03 },
  tired: { open: 0.55, tilt: -1.6, iris: 0.99 },
  angry: { open: 0.78, tilt: 2.6, iris: 1.06 },
  surprised: { open: 1.35, tilt: 0, iris: 1.26 },
  injured: { open: 0.46, tilt: -1.2, iris: 0.95 },
  celebrating: { open: 0.3, tilt: -1.8, iris: 0.86 },
};

function specOf(id: EyeId): EyeSpec {
  return SPECS[id] ?? SPECS.eye_01_round;
}

/** 片目。side = -1 で左、1 で右 */
function OneEye({
  spec,
  side,
  ctx,
  open,
  tilt,
  irisScale,
}: {
  spec: EyeSpec;
  side: 1 | -1;
  ctx: PartContext;
  open: number;
  tilt: number;
  irisScale: number;
}) {
  const cx = CENTER_X + side * ctx.geo.eyeGap;
  const h = spec.h * open;
  const under = spec.under * Math.min(1, open);
  // 目尻（外側）の上下。内側は動かさない
  const outer = cx + side * spec.w;
  const inner = cx - side * spec.w;
  const outerY = EYE_Y - (spec.tilt + tilt) * side * side; // side に依らず同じ向きに傾ける
  const closed = open <= 0.36;

  if (closed) {
    // 笑って細くなった目。弧を1本だけ描く
    return (
      <path
        d={`M ${inner} ${EYE_Y + 1} Q ${cx} ${EYE_Y - spec.h * 0.95} ${outer} ${EYE_Y + 1 - (spec.tilt + tilt) * 0.5}`}
        className="pt-eye-closed"
      />
    );
  }

  return (
    <>
      {/* 白目 */}
      <path
        d={`M ${inner} ${EYE_Y}
            C ${inner + side * spec.w * 0.5} ${EYE_Y - h} ${outer - side * spec.w * 0.5} ${outerY - h} ${outer} ${outerY}
            C ${outer - side * spec.w * 0.5} ${outerY + under} ${inner + side * spec.w * 0.5} ${EYE_Y + under} ${inner} ${EYE_Y} Z`}
        className="pt-eye-white"
      />
      {/* 黒目。上まぶたに少しかかる位置に置く */}
      <circle cx={cx} cy={EYE_Y + 0.6} r={spec.iris * irisScale} className="pt-iris" />
      <circle cx={cx - side * spec.iris * 0.28} cy={EYE_Y - spec.iris * 0.3} r={spec.iris * 0.26} className="pt-iris-light" />
      {/* 上まぶたの線 */}
      {spec.lidLine && (
        <path
          d={`M ${inner} ${EYE_Y}
              C ${inner + side * spec.w * 0.5} ${EYE_Y - h} ${outer - side * spec.w * 0.5} ${outerY - h} ${outer} ${outerY}`}
          className="pt-lid"
        />
      )}
    </>
  );
}

export function Eyes({ id, ctx }: { id: EyeId; ctx: PartContext }) {
  const spec = specOf(id);
  const mod = EXPRESSION_EYE[ctx.expression] ?? EXPRESSION_EYE.neutral;
  return (
    <g className="pt-eyes">
      <OneEye spec={spec} side={-1} ctx={ctx} open={mod.open} tilt={mod.tilt} irisScale={mod.iris} />
      <OneEye spec={spec} side={1} ctx={ctx} open={mod.open} tilt={mod.tilt} irisScale={mod.iris} />
    </g>
  );
}

export const EYE_SPEC_IDS = Object.keys(SPECS) as EyeId[];
