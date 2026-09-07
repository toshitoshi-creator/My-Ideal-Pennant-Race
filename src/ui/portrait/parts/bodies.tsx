/**
 * PHASE 4.5 体型（10種類）とユニフォーム。
 *
 * 体型は「見た目だけ」。能力値・成績・守備位置には一切影響しない。
 * 肩幅・首の太さ・胸の厚みを別々に持たせ、同じ顔でも印象が変わるようにする。
 */
import type { BodyId, PartContext, PlayerAppearance, Pose } from '../types';
import { CENTER_X, NECK_Y, SHOULDER_Y, VIEW_H } from '../types';

interface BodySpec {
  /** 肩の半幅 */
  shoulder: number;
  /** 首の半幅 */
  neck: number;
  /** 肩の傾き（大きいほどなで肩） */
  slope: number;
  /** 胸の厚み（襟の下がり） */
  chest: number;
  /** 首の長さ */
  neckLen: number;
}

const SPECS: Record<BodyId, BodySpec> = {
  body_01_slim: { shoulder: 58, neck: 17, slope: 16, chest: 4, neckLen: 30 },
  body_02_average: { shoulder: 66, neck: 19, slope: 13, chest: 6, neckLen: 28 },
  body_03_athletic: { shoulder: 76, neck: 21, slope: 9, chest: 8, neckLen: 26 },
  body_04_power: { shoulder: 84, neck: 25, slope: 6, chest: 10, neckLen: 22 },
  body_05_broad: { shoulder: 82, neck: 23, slope: 8, chest: 9, neckLen: 24 },
  body_06_tall: { shoulder: 70, neck: 19, slope: 11, chest: 5, neckLen: 34 },
  body_07_short: { shoulder: 64, neck: 20, slope: 15, chest: 7, neckLen: 20 },
  body_08_stocky: { shoulder: 78, neck: 24, slope: 12, chest: 9, neckLen: 20 },
  body_09_pitcher: { shoulder: 68, neck: 19, slope: 12, chest: 6, neckLen: 30 },
  body_10_heavy: { shoulder: 88, neck: 27, slope: 14, chest: 12, neckLen: 18 },
};

function specOf(id: BodyId): BodySpec {
  return SPECS[id] ?? SPECS.body_02_average;
}

/** 首。頭とユニフォームのあいだ */
export function Neck({ id, ctx }: { id: BodyId; ctx: PartContext }) {
  const spec = specOf(id);
  const cx = CENTER_X;
  const top = ctx.geo.chinY - 12;
  const bottom = NECK_Y + spec.neckLen * 0.3;
  return (
    <g className="pt-neck">
      <path
        d={`M ${cx - spec.neck} ${top} L ${cx - spec.neck} ${bottom} L ${cx + spec.neck} ${bottom} L ${cx + spec.neck} ${top} Z`}
        fill={ctx.skin}
      />
      {/* あごの下の影 */}
      <path
        d={`M ${cx - spec.neck} ${top} Q ${cx} ${top + 14} ${cx + spec.neck} ${top} L ${cx + spec.neck} ${top - 2} L ${cx - spec.neck} ${top - 2} Z`}
        fill={ctx.skinShade}
        opacity="0.5"
        stroke="none"
      />
    </g>
  );
}

/**
 * ユニフォームを着た上半身。
 * 球団色は襟とラインだけに使い、面を塗りつぶさない（§22）。
 */
export function Body({
  appearance,
  teamColor,
  pose,
}: {
  appearance: PlayerAppearance;
  teamColor?: string;
  pose: Pose;
}) {
  const spec = specOf(appearance.body);
  const cx = CENTER_X;
  const neckBottom = NECK_Y + spec.neckLen * 0.3;
  const shoulderY = SHOULDER_Y;
  const accent = teamColor ?? 'var(--ink-2)';
  const stripe = appearance.uniform === 'uni_home_stripe';
  const dark = appearance.uniform === 'uni_visitor' || appearance.uniform === 'uni_third';
  // 腕組みは肩の位置を少し内側にする
  const shoulder = pose === 'pose_crossed_arm' ? spec.shoulder * 0.94 : spec.shoulder;
  const lift = pose === 'pose_celebrate' ? 8 : pose === 'pose_disappointed' ? -5 : 0;

  return (
    <g className="pt-body">
      <path
        className={dark ? 'pt-jersey pt-jersey-dark' : 'pt-jersey'}
        d={`M ${cx - spec.neck - 4} ${neckBottom - 2}
            C ${cx - shoulder * 0.6} ${neckBottom + spec.slope - lift * 0.3} ${cx - shoulder} ${shoulderY - spec.slope - lift} ${cx - shoulder} ${shoulderY + 6 - lift}
            L ${cx - shoulder - 4} ${VIEW_H}
            L ${cx + shoulder + 4} ${VIEW_H}
            L ${cx + shoulder} ${shoulderY + 6 - lift}
            C ${cx + shoulder} ${shoulderY - spec.slope - lift} ${cx + shoulder * 0.6} ${neckBottom + spec.slope - lift * 0.3} ${cx + spec.neck + 4} ${neckBottom - 2}
            Z`}
      />
      {/* 縦縞 */}
      {stripe && (
        <g opacity="0.3">
          {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={cx + i * 18}
              y1={shoulderY + 2}
              x2={cx + i * 18}
              y2={VIEW_H}
              stroke={accent}
              strokeWidth="2.4"
            />
          ))}
        </g>
      )}
      {/* 襟。球団色は線として入れる（面を塗りつぶさない） */}
      <path
        d={`M ${cx - spec.neck - 5} ${neckBottom - 4}
            Q ${cx} ${neckBottom + spec.chest + 16} ${cx + spec.neck + 5} ${neckBottom - 4}`}
        fill="none"
        stroke={accent}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* 前立て */}
      <line
        x1={cx}
        y1={neckBottom + spec.chest + 14}
        x2={cx}
        y2={VIEW_H}
        stroke={accent}
        strokeWidth="2.2"
        opacity="0.5"
      />
    </g>
  );
}

/**
 * 大きく見せるときの腕。ポーズごとに形を変える。
 * 胸から上の小さな表示では描かない。
 */
export function Arms({ appearance, pose }: { appearance: PlayerAppearance; pose: Pose }) {
  const spec = specOf(appearance.body);
  const cx = CENTER_X;
  const s = spec.shoulder;
  const y = SHOULDER_Y + 10;
  const side = appearance.handedness === 'L' ? -1 : 1;
  // 袖はユニフォームと同じ紙色を太い線で描き、輪郭を墨で締める
  const stroke = {
    fill: 'none',
    stroke: 'var(--ink)',
    strokeWidth: 15,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const inner = {
    fill: 'none',
    stroke: 'var(--paper)',
    strokeWidth: 9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  /** 同じ形を「墨の外形 → 紙の中身」の順で2度描く */
  const limb = (d: string, key: string) => (
    <g key={key}>
      <path d={d} {...stroke} />
      <path d={d} {...inner} />
    </g>
  );

  switch (pose) {
    case 'pose_bat':
      // バットを構える。腕は体の前で合わさる
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.82} ${y} Q ${cx - s * 0.62} ${y + 40} ${cx - side * 10} ${y + 30}`, 'a')}
          {limb(`M ${cx + s * 0.82} ${y} Q ${cx + s * 0.62} ${y + 36} ${cx + side * 4} ${y + 26}`, 'b')}
          <path
            d={`M ${cx - side * 4} ${y + 28} L ${cx + side * 52} ${y - 48}`}
            fill="none"
            stroke="var(--ink-2)"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </g>
      );
    case 'pose_pitch':
      // 投げる直前。利き腕を後ろへ引く
      return (
        <g className="pt-arms">
          {limb(`M ${cx + side * s * 0.82} ${y} Q ${cx + side * (s + 26)} ${y - 18} ${cx + side * (s + 16)} ${y - 46}`, 'a')}
          {limb(`M ${cx - side * s * 0.82} ${y} Q ${cx - side * (s + 8)} ${y + 26} ${cx - side * (s - 14)} ${y + 48}`, 'b')}
          <circle cx={cx + side * (s + 16)} cy={y - 54} r="11" fill="var(--paper)" className="pt-line" />
        </g>
      );
    case 'pose_crossed_arm':
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.85} ${y} Q ${cx - s * 0.86} ${y + 34} ${cx + s * 0.5} ${y + 38}`, 'a')}
          {limb(`M ${cx + s * 0.85} ${y} Q ${cx + s * 0.86} ${y + 26} ${cx - s * 0.5} ${y + 48}`, 'b')}
        </g>
      );
    case 'pose_celebrate':
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.8} ${y} Q ${cx - s - 20} ${y - 30} ${cx - s - 8} ${y - 58}`, 'a')}
          {limb(`M ${cx + s * 0.8} ${y} Q ${cx + s + 20} ${y - 30} ${cx + s + 8} ${y - 58}`, 'b')}
        </g>
      );
    case 'pose_disappointed':
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.85} ${y} Q ${cx - s - 8} ${y + 32} ${cx - s + 2} ${y + 58}`, 'a')}
          {limb(`M ${cx + s * 0.85} ${y} Q ${cx + s + 8} ${y + 32} ${cx + s - 2} ${y + 58}`, 'b')}
        </g>
      );
    case 'pose_ready':
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.85} ${y} Q ${cx - s - 10} ${y + 28} ${cx - s * 0.42} ${y + 50}`, 'a')}
          {limb(`M ${cx + s * 0.85} ${y} Q ${cx + s + 10} ${y + 28} ${cx + s * 0.42} ${y + 50}`, 'b')}
          <circle cx={cx - s * 0.42} cy={y + 54} r="12" fill="var(--paper)" className="pt-line" />
        </g>
      );
    case 'pose_standing':
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.88} ${y} L ${cx - s * 0.96} ${y + 58}`, 'a')}
          {limb(`M ${cx + s * 0.88} ${y} L ${cx + s * 0.96} ${y + 58}`, 'b')}
        </g>
      );
    default:
      // pose_idle。ごく自然に下ろす
      return (
        <g className="pt-arms">
          {limb(`M ${cx - s * 0.88} ${y} Q ${cx - s - 4} ${y + 30} ${cx - s * 0.92} ${y + 56}`, 'a')}
          {limb(`M ${cx + s * 0.88} ${y} Q ${cx + s + 4} ${y + 30} ${cx + s * 0.92} ${y + 56}`, 'b')}
        </g>
      );
  }
}

export const BODY_SPECS = SPECS;
