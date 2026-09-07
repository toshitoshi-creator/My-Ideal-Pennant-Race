/**
 * PHASE 4.5 口（10種類）と表情。
 *
 * 口の「形」は選手ごとに固定で、表情では口角と開き具合だけが変わる。
 * 表情はゲームの判断を変えない。すでに決まっている状態を映すだけ。
 */
import type { MouthId, PartContext } from '../types';
import { CENTER_X, MOUTH_Y } from '../types';

interface MouthSpec {
  /** 口の横幅（片側） */
  w: number;
  /** 唇の厚み */
  thick: number;
  /** 口角の上下（正で上向き） */
  corner: number;
  /** 中央の膨らみ */
  bow: number;
}

const SPECS: Record<MouthId, MouthSpec> = {
  mouth_01_thin: { w: 15, thick: 1.6, corner: 0, bow: 0.6 },
  mouth_02_full: { w: 15, thick: 4.4, corner: 0, bow: 2 },
  mouth_03_small: { w: 11, thick: 2.6, corner: 0, bow: 1.2 },
  mouth_04_wide: { w: 20, thick: 2.6, corner: 0, bow: 0.8 },
  mouth_05_straight: { w: 16, thick: 2, corner: 0, bow: 0 },
  mouth_06_upturn: { w: 16, thick: 2.4, corner: 2.4, bow: 1 },
  mouth_07_downturn: { w: 16, thick: 2.4, corner: -2.4, bow: 0.8 },
  mouth_08_slight_smile: { w: 17, thick: 2.2, corner: 1.4, bow: 1.4 },
  mouth_09_flat: { w: 14, thick: 1.8, corner: 0, bow: 0.2 },
  mouth_10_pressed: { w: 15, thick: 3.2, corner: -0.8, bow: 0.4 },
};

/** 表情ごとの口の動き */
const EXPRESSION_MOUTH: Record<string, { corner: number; open: number; width: number }> = {
  neutral: { corner: 0, open: 0, width: 1 },
  focused: { corner: -0.6, open: 0, width: 0.96 },
  confident: { corner: 2.2, open: 0, width: 1.02 },
  happy: { corner: 5, open: 4.5, width: 1.08 },
  disappointed: { corner: -4, open: 0, width: 0.94 },
  tired: { corner: -2, open: 1.4, width: 0.96 },
  angry: { corner: -3, open: 2.6, width: 1.04 },
  surprised: { corner: 0, open: 7, width: 0.82 },
  injured: { corner: -3.4, open: 1, width: 0.92 },
  celebrating: { corner: 5.4, open: 8, width: 1.06 },
};

function specOf(id: MouthId): MouthSpec {
  return SPECS[id] ?? SPECS.mouth_05_straight;
}

export function Mouth({ id, ctx }: { id: MouthId; ctx: PartContext }) {
  const spec = specOf(id);
  const mod = EXPRESSION_MOUTH[ctx.expression] ?? EXPRESSION_MOUTH.neutral;
  const w = spec.w * mod.width;
  const corner = spec.corner + mod.corner;
  const cx = CENTER_X;
  const left = cx - w;
  const right = cx + w;
  const open = mod.open;

  if (open > 2) {
    // 開いた口。中を暗くして歯を1本の帯で表す
    const h = open;
    return (
      <g className="pt-mouth">
        <path
          d={`M ${left} ${MOUTH_Y - corner * 0.5}
              Q ${cx} ${MOUTH_Y - corner - spec.bow - 2} ${right} ${MOUTH_Y - corner * 0.5}
              Q ${cx} ${MOUTH_Y + h + spec.thick} ${left} ${MOUTH_Y - corner * 0.5} Z`}
          className="pt-mouth-open"
        />
        <path
          d={`M ${left + 2} ${MOUTH_Y - corner * 0.5}
              Q ${cx} ${MOUTH_Y - corner - spec.bow} ${right - 2} ${MOUTH_Y - corner * 0.5}
              Q ${cx} ${MOUTH_Y - corner * 0.5 + 2.4} ${left + 2} ${MOUTH_Y - corner * 0.5} Z`}
          className="pt-teeth"
        />
      </g>
    );
  }

  return (
    <g className="pt-mouth">
      {/* 唇の合わせ目 */}
      <path
        d={`M ${left} ${MOUTH_Y - corner * 0.5}
            Q ${cx} ${MOUTH_Y + spec.bow} ${right} ${MOUTH_Y - corner * 0.5}`}
        className="pt-mouth-line"
        strokeWidth={spec.thick}
      />
      {/* 下唇の陰。厚い口だけ */}
      {spec.thick >= 3 && (
        <path
          d={`M ${left + 2.5} ${MOUTH_Y + spec.thick * 0.8}
              Q ${cx} ${MOUTH_Y + spec.thick * 1.9} ${right - 2.5} ${MOUTH_Y + spec.thick * 0.8}`}
          fill="none"
          stroke={ctx.skinShade}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.55"
        />
      )}
    </g>
  );
}
