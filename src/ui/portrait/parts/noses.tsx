/**
 * PHASE 4.5 鼻（10種類）。
 *
 * 線だけで描くが、鼻梁・小鼻・鼻先の3つを別々に持たせて形を変える。
 * 表情では動かさない（鼻は表情で変わらない）。
 */
import type { NoseId, PartContext } from '../types';
import { CENTER_X, EYE_Y, NOSE_Y } from '../types';

interface NoseSpec {
  /** 鼻筋の長さ */
  len: number;
  /** 小鼻の広がり */
  wing: number;
  /** 鼻先の丸み */
  tip: number;
  /** 鼻筋の線を描くか */
  bridge: boolean;
  /** 鼻筋の曲がり（正で鷲鼻） */
  curve: number;
  /** 鼻先の下がり */
  droop: number;
}

const SPECS: Record<NoseId, NoseSpec> = {
  nose_01_small: { len: 20, wing: 6.5, tip: 3, bridge: false, curve: 0, droop: 0 },
  nose_02_high: { len: 30, wing: 7.5, tip: 3.6, bridge: true, curve: -1, droop: 0 },
  nose_03_broad: { len: 24, wing: 11.5, tip: 5, bridge: false, curve: 0, droop: 0.5 },
  nose_04_long: { len: 34, wing: 7, tip: 3.4, bridge: true, curve: 0, droop: 1.5 },
  nose_05_short: { len: 17, wing: 8, tip: 3.8, bridge: false, curve: 0, droop: 0 },
  nose_06_round: { len: 23, wing: 9, tip: 6, bridge: false, curve: 0, droop: 0 },
  nose_07_straight: { len: 27, wing: 7.5, tip: 3.2, bridge: true, curve: 0, droop: 0 },
  nose_08_downward: { len: 28, wing: 8, tip: 4, bridge: true, curve: 0.5, droop: 3.2 },
  nose_09_strong: { len: 29, wing: 10, tip: 4.6, bridge: true, curve: -1.6, droop: 0.8 },
  nose_10_hooked: { len: 30, wing: 8.5, tip: 4.2, bridge: true, curve: 3.4, droop: 2.6 },
};

function specOf(id: NoseId): NoseSpec {
  return SPECS[id] ?? SPECS.nose_07_straight;
}

export function Nose({ id, ctx }: { id: NoseId; ctx: PartContext }) {
  const spec = specOf(id);
  const topY = EYE_Y - 2;
  const tipY = Math.min(NOSE_Y + spec.droop, topY + spec.len);
  const cx = CENTER_X;
  return (
    <g className="pt-nose">
      {/* 鼻筋。片側だけに線を入れて陰にする */}
      {spec.bridge && (
        <path
          d={`M ${cx - 4} ${topY + 6} Q ${cx - 5 - spec.curve} ${(topY + tipY) / 2} ${cx - 3} ${tipY - spec.tip}`}
          className="pt-nose-bridge"
        />
      )}
      {/* 鼻先 */}
      <path
        d={`M ${cx - spec.tip} ${tipY - spec.tip * 0.4}
            Q ${cx} ${tipY + spec.tip * 0.9} ${cx + spec.tip} ${tipY - spec.tip * 0.4}`}
        className="pt-nose-tip"
      />
      {/* 小鼻 */}
      <path
        d={`M ${cx - spec.wing} ${tipY - 1}
            Q ${cx - spec.wing + 1.5} ${tipY + 2.6} ${cx - spec.tip - 0.5} ${tipY + 1.6}`}
        className="pt-nose-wing"
      />
      <path
        d={`M ${cx + spec.wing} ${tipY - 1}
            Q ${cx + spec.wing - 1.5} ${tipY + 2.6} ${cx + spec.tip + 0.5} ${tipY + 1.6}`}
        className="pt-nose-wing"
      />
      {/* 影。頬側にごく薄く */}
      <path
        d={`M ${cx - spec.wing - 1} ${tipY - 2} Q ${cx} ${tipY + 5} ${cx + spec.wing + 1} ${tipY - 2}`}
        fill={ctx.skinShade}
        opacity="0.22"
        stroke="none"
      />
    </g>
  );
}
