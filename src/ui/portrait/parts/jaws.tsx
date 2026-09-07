/**
 * PHASE 4.5 あご・頬の作り（6種類）。
 *
 * 輪郭そのものは頭の形が決めるので、ここでは
 * 「頬の影」「あごの線」「あご先の割れ」だけを足して骨格を変える。
 * 線を1〜2本足すだけで、同じ輪郭でも受ける印象が変わる。
 */
import type { JawId, PartContext } from '../types';
import { CENTER_X, EYE_Y } from '../types';

export function Jaw({ id, ctx }: { id: JawId; ctx: PartContext }) {
  const { geo } = ctx;
  const cx = CENTER_X;
  const cheekY = EYE_Y + (geo.chinY - EYE_Y) * 0.34;
  const jawY = geo.chinY - (geo.chinY - EYE_Y) * 0.26;
  const shade = ctx.skinShade;

  switch (id) {
    case 'jaw_01_soft':
      // やわらかい頬。丸い影を薄く置くだけ
      return (
        <g className="pt-jaw" stroke="none" fill={shade} opacity="0.2">
          <path d={`M ${cx - geo.cheekHalf} ${cheekY - 10} q 10 20 4 34 q -12 -12 -12 -32 z`} />
          <path d={`M ${cx + geo.cheekHalf} ${cheekY - 10} q -10 20 -4 34 q 12 -12 12 -32 z`} />
        </g>
      );
    case 'jaw_03_square':
      // 角ばったあご。あごのラインをはっきり見せる
      return (
        <g className="pt-jaw">
          <path
            d={`M ${cx - geo.jawHalf + 3} ${jawY - 4} L ${cx - geo.jawHalf + 7} ${geo.chinY - 11}`}
            className="pt-jaw-line"
          />
          <path
            d={`M ${cx + geo.jawHalf - 3} ${jawY - 4} L ${cx + geo.jawHalf - 7} ${geo.chinY - 11}`}
            className="pt-jaw-line"
          />
        </g>
      );
    case 'jaw_04_narrow':
      // 細いあご。頬がこけて縦の影が入る
      return (
        <g className="pt-jaw" stroke="none" fill={shade} opacity="0.34">
          <path d={`M ${cx - geo.cheekHalf * 0.8} ${cheekY - 12} q 5 14 2 26 q -7 -8 -8 -24 z`} />
          <path d={`M ${cx + geo.cheekHalf * 0.8} ${cheekY - 12} q -5 14 -2 26 q 7 -8 8 -24 z`} />
        </g>
      );
    case 'jaw_05_heavy':
      // 重いあご。下半分に広く影を敷く
      return (
        <g className="pt-jaw" stroke="none">
          <path
            d={`M ${cx - geo.jawHalf} ${jawY} Q ${cx} ${geo.chinY + 6} ${cx + geo.jawHalf} ${jawY}
                Q ${cx} ${geo.chinY - 4} ${cx - geo.jawHalf} ${jawY} z`}
            fill={shade}
            opacity="0.32"
          />
        </g>
      );
    case 'jaw_06_cleft':
      // あご先が割れている
      return (
        <g className="pt-jaw">
          <path d={`M ${cx} ${geo.chinY - 13} v 7`} className="pt-jaw-line" />
          <ellipse cx={cx} cy={geo.chinY - 8} rx="7" ry="5" fill={shade} opacity="0.24" stroke="none" />
        </g>
      );
    default:
      // 標準。あごの下にごく薄い影
      return (
        <g className="pt-jaw" stroke="none">
          <path
            d={`M ${cx - geo.jawHalf * 0.8} ${jawY + 2} Q ${cx} ${geo.chinY + 1} ${cx + geo.jawHalf * 0.8} ${jawY + 2}
                Q ${cx} ${geo.chinY - 8} ${cx - geo.jawHalf * 0.8} ${jawY + 2} z`}
            fill={shade}
            opacity="0.22"
          />
        </g>
      );
  }
}
