/**
 * PHASE 4.5 ひげ（8種類）。
 *
 * 年齢が上がるほど出やすいが、出る／出ないは playerAppearance が決める。
 * ここは与えられた種類を、輪郭の内側に収まるように描くだけ。
 */
import type { FacialHairId, PartContext } from '../types';
import { CENTER_X, EYE_Y, MOUTH_Y } from '../types';

export function FacialHair({ id, ctx }: { id: FacialHairId; ctx: PartContext }) {
  if (id === 'face_01_none') return null;
  const { geo } = ctx;
  const cx = CENTER_X;
  const jawY = geo.chinY - (geo.chinY - EYE_Y) * 0.26;
  const w = geo.jawHalf * 0.92;

  /** あご全体を覆う面（口の下からあご先まで） */
  const beardArea = (top: number, opacity: number, extend: number) => (
    <path
      d={`M ${cx - w - extend} ${top}
          C ${cx - w - extend} ${jawY + 8} ${cx - w * 0.5} ${geo.chinY + 2} ${cx} ${geo.chinY + 2}
          C ${cx + w * 0.5} ${geo.chinY + 2} ${cx + w + extend} ${jawY + 8} ${cx + w + extend} ${top}
          C ${cx + w * 0.4} ${top + 12} ${cx - w * 0.4} ${top + 12} ${cx - w - extend} ${top} Z`}
      fill={ctx.hair}
      opacity={opacity}
      stroke="none"
    />
  );

  const moustache = (
    <path
      d={`M ${cx - 15} ${MOUTH_Y - 9}
          Q ${cx - 6} ${MOUTH_Y - 13} ${cx} ${MOUTH_Y - 10}
          Q ${cx + 6} ${MOUTH_Y - 13} ${cx + 15} ${MOUTH_Y - 9}
          Q ${cx + 7} ${MOUTH_Y - 3} ${cx} ${MOUTH_Y - 5}
          Q ${cx - 7} ${MOUTH_Y - 3} ${cx - 15} ${MOUTH_Y - 9} Z`}
      fill={ctx.hair}
      stroke="none"
    />
  );

  switch (id) {
    case 'face_02_light_stubble':
      return <g className="pt-facial">{beardArea(MOUTH_Y - 16, 0.18, -2)}</g>;
    case 'face_03_stubble':
      return <g className="pt-facial">{beardArea(MOUTH_Y - 18, 0.3, 0)}</g>;
    case 'face_04_moustache':
      return <g className="pt-facial">{moustache}</g>;
    case 'face_05_beard_short':
      return <g className="pt-facial">{beardArea(MOUTH_Y - 4, 0.85, -3)}</g>;
    case 'face_06_beard_full':
      return (
        <g className="pt-facial">
          {beardArea(MOUTH_Y - 20, 0.92, 2)}
          {/* 口の形は残す */}
          <path
            d={`M ${cx - 13} ${MOUTH_Y} Q ${cx} ${MOUTH_Y + 5} ${cx + 13} ${MOUTH_Y}`}
            fill={ctx.skinShade}
            opacity="0.5"
            stroke="none"
          />
        </g>
      );
    case 'face_07_moustache_beard':
      return (
        <g className="pt-facial">
          {beardArea(MOUTH_Y + 2, 0.9, -4)}
          {moustache}
        </g>
      );
    default:
      // あごひげだけ（口の下に細く）
      return (
        <g className="pt-facial">
          <path
            d={`M ${cx - 9} ${MOUTH_Y + 8} q 9 -4 18 0 q -2 ${geo.chinY - MOUTH_Y - 14} -9 ${geo.chinY - MOUTH_Y - 12} q -7 2 -9 -${geo.chinY - MOUTH_Y - 14} z`}
            fill={ctx.hair}
            stroke="none"
          />
        </g>
      );
  }
}
