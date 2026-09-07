/**
 * PHASE 4.5 髪型（15種類）。
 *
 * 帽子をかぶるときは「つばの下から覗く前髪」と「もみあげ・襟足」だけを描く。
 * ここを帽子より先に描いてしまうと、キャップの選手が全員同じ顔に見えてしまう。
 *
 * 年齢による変化（生え際が上がる・薄くなる）は playerAppearance が髪型IDを
 * 差し替えることで表す。ここでは与えられたIDをそのまま描く。
 */
import type { HairId, PartContext } from '../types';
import { CAP_BRIM_Y, CENTER_X } from '../types';

type FringeStyle = 'straight' | 'diagonal' | 'round' | 'spiky' | 'swept' | 'wave' | 'curl' | 'none';

interface HairSpec {
  /** こめかみより外へ張り出す量 */
  spread: number;
  /** 頭頂より上に盛る高さ */
  lift: number;
  /** 前髪が額に下りる深さ（0 なら上げている） */
  fringe: number;
  fringeStyle: FringeStyle;
  /** もみあげの長さ */
  sideburn: number;
  /** 襟足・耳の後ろまで落ちるか */
  back: number;
  /** 生え際の後退（M字） */
  recede: number;
  /** 薄さ（0=ふつう、1=かなり薄い） */
  thin: number;
}

const SPECS: Record<HairId, HairSpec> = {
  hair_01_crop: { spread: 1, lift: 6, fringe: 5, fringeStyle: 'straight', sideburn: 12, back: 2, recede: 2, thin: 0 },
  hair_02_short: { spread: 3, lift: 12, fringe: 9, fringeStyle: 'round', sideburn: 15, back: 4, recede: 0, thin: 0 },
  hair_03_side_part: { spread: 4, lift: 15, fringe: 13, fringeStyle: 'diagonal', sideburn: 16, back: 5, recede: 4, thin: 0 },
  hair_04_medium: { spread: 7, lift: 17, fringe: 15, fringeStyle: 'round', sideburn: 22, back: 12, recede: 0, thin: 0 },
  hair_05_swept: { spread: 5, lift: 26, fringe: 2, fringeStyle: 'swept', sideburn: 16, back: 8, recede: 3, thin: 0 },
  hair_06_spiky: { spread: 5, lift: 32, fringe: 7, fringeStyle: 'spiky', sideburn: 12, back: 3, recede: 0, thin: 0 },
  hair_07_bowl: { spread: 9, lift: 14, fringe: 21, fringeStyle: 'straight', sideburn: 19, back: 10, recede: 0, thin: 0 },
  hair_08_long: { spread: 10, lift: 18, fringe: 17, fringeStyle: 'wave', sideburn: 26, back: 40, recede: 0, thin: 0 },
  hair_09_curly: { spread: 14, lift: 28, fringe: 11, fringeStyle: 'curl', sideburn: 17, back: 16, recede: 0, thin: 0 },
  hair_10_wave: { spread: 6, lift: 18, fringe: 10, fringeStyle: 'wave', sideburn: 15, back: 9, recede: 1, thin: 0 },
  hair_11_buzz: { spread: 0, lift: 3, fringe: 2, fringeStyle: 'straight', sideburn: 8, back: 1, recede: 3, thin: 0.35 },
  hair_12_undercut: { spread: -3, lift: 22, fringe: 8, fringeStyle: 'swept', sideburn: 4, back: 2, recede: 0, thin: 0 },
  hair_13_receding: { spread: 2, lift: 8, fringe: 3, fringeStyle: 'none', sideburn: 13, back: 4, recede: 16, thin: 0.2 },
  hair_14_thin: { spread: 1, lift: 4, fringe: 0, fringeStyle: 'none', sideburn: 11, back: 3, recede: 26, thin: 0.6 },
  hair_15_volume: { spread: 12, lift: 34, fringe: 13, fringeStyle: 'round', sideburn: 18, back: 11, recede: 0, thin: 0 },
};

function specOf(id: HairId): HairSpec {
  return SPECS[id] ?? SPECS.hair_02_short;
}

/** 額の生え際の y（頭頂からの割合で決める） */
function hairlineY(ctx: PartContext, spec: HairSpec): number {
  const faceH = ctx.geo.chinY - ctx.geo.topY;
  return ctx.geo.topY + faceH * 0.12 + spec.recede;
}

/** 前髪の下端を描く（額の上を横切る線） */
function fringeEdge(spec: HairSpec, lx: number, rx: number, y: number): string {
  const cx = CENTER_X;
  switch (spec.fringeStyle) {
    case 'diagonal':
      // 七三。片側だけ深く下りる
      return `L ${rx} ${y - spec.fringe * 0.2} Q ${cx + 8} ${y + spec.fringe} ${cx - 14} ${y + spec.fringe * 0.7} Q ${lx + 6} ${y + spec.fringe * 0.2} ${lx} ${y - spec.fringe * 0.4}`;
    case 'spiky':
      // 立ち上げた前髪。ぎざぎざに下ろす
      return (
        `L ${rx} ${y}` +
        [0.8, 0.6, 0.4, 0.2].map((t, i) => {
          const x = cx + (rx - cx) * t;
          return `L ${x - 4} ${y + spec.fringe} L ${x - 9} ${y + (i % 2 ? 2 : 4)}`;
        }).join(' ') +
        [0.2, 0.4, 0.6, 0.8].map((t, i) => {
          const x = cx - (cx - lx) * t;
          return `L ${x + 5} ${y + spec.fringe} L ${x} ${y + (i % 2 ? 4 : 2)}`;
        }).join(' ') +
        ` L ${lx} ${y}`
      );
    case 'swept':
      // 上げた髪。生え際をそのまま見せる
      return `L ${rx} ${y + 2} Q ${cx} ${y - spec.fringe} ${lx} ${y + 2}`;
    case 'wave':
      return `L ${rx} ${y} Q ${cx + 18} ${y + spec.fringe} ${cx} ${y + spec.fringe * 0.55} Q ${cx - 18} ${y + spec.fringe * 0.1} ${lx} ${y}`;
    case 'curl':
      // くせ毛。生え際が波打つ
      return (
        `L ${rx} ${y}` +
        [0.66, 0.33, 0, -0.33, -0.66, -1].map((t) => {
          const x = cx + (rx - cx) * t;
          return ` Q ${x + (rx - cx) * 0.16} ${y + spec.fringe} ${x} ${y + spec.fringe * 0.35}`;
        }).join('')
      );
    case 'none':
      return `L ${rx} ${y} Q ${cx} ${y - spec.recede * 0.5} ${lx} ${y}`;
    case 'round':
      return `L ${rx} ${y} Q ${cx} ${y + spec.fringe} ${lx} ${y}`;
    default:
      return `L ${rx} ${y + spec.fringe * 0.35} L ${lx} ${y + spec.fringe * 0.35}`;
  }
}

/** 帽子の後ろ・首筋に落ちる髪。長い髪型だけ */
export function HairBack({ id, ctx }: { id: HairId; ctx: PartContext }) {
  const spec = specOf(id);
  if (spec.back < 6) return null;
  const { geo } = ctx;
  const cx = CENTER_X;
  const w = geo.templeHalf + spec.spread + 2;
  const bottom = geo.chinY - 26 + spec.back;
  return (
    <path
      className="pt-hair-back"
      d={`M ${cx - w} ${geo.topY + 26} Q ${cx - w - 3} ${bottom - 20} ${cx - w + 5} ${bottom}
          L ${cx + w - 5} ${bottom} Q ${cx + w + 3} ${bottom - 20} ${cx + w} ${geo.topY + 26} Z`}
      fill={ctx.hairShade}
    />
  );
}

/** 帽子をかぶっていないときの髪の本体 */
export function HairFull({ id, ctx }: { id: HairId; ctx: PartContext }) {
  const spec = specOf(id);
  const { geo } = ctx;
  const cx = CENTER_X;
  const w = geo.templeHalf + spec.spread;
  const top = geo.topY - spec.lift;
  const y = hairlineY(ctx, spec);
  const sideY = y + 14;

  // 頭を包む外側 → 額の生え際、で閉じる
  const outer =
    spec.fringeStyle === 'spiky'
      ? // 立てた髪。頭頂がぎざぎざに尖る
        `M ${cx - w} ${sideY}` +
        ` C ${cx - w - 2} ${top + 26} ${cx - w * 0.75} ${top + 16} ${cx - w * 0.7} ${top + 10}` +
        [0.7, 0.42, 0.14, -0.14, -0.42, -0.7]
          .map((t, i) => {
            const x = cx - w * t;
            return ` L ${x + w * 0.07} ${top - (i % 2 ? 2 : 8)} L ${x + w * 0.28} ${top + 14}`;
          })
          .join('') +
        ` C ${cx + w * 0.75} ${top + 16} ${cx + w + 2} ${top + 26} ${cx + w} ${sideY}`
      : spec.fringeStyle === 'curl'
        ? // くせ毛。外周が丸く波打つ
          `M ${cx - w} ${sideY}` +
          [0.92, 0.62, 0.24, -0.16, -0.55, -0.88]
            .map((t) => {
              const x = cx - w * t;
              const y2 = top + Math.abs(t) * 26;
              return ` Q ${x - w * 0.1} ${y2 - 16} ${x + w * 0.2} ${y2}`;
            })
            .join('') +
          ` Q ${cx + w + 4} ${top + 30} ${cx + w} ${sideY}`
        : `M ${cx - w} ${sideY}` +
          ` C ${cx - w - 2} ${top + 14} ${cx - w * 0.6} ${top} ${cx} ${top}` +
          ` C ${cx + w * 0.6} ${top} ${cx + w + 2} ${top + 14} ${cx + w} ${sideY}`;

  return (
    <g className="pt-hair" opacity={1 - spec.thin * 0.45}>
      <path d={`${outer} ${fringeEdge(spec, cx - w, cx + w, y)} Z`} fill={ctx.hair} />
      {/* 毛の流れ。1〜2本だけ入れて塗りの単調さを消す */}
      {spec.thin < 0.5 && (
        <path
          d={`M ${cx - w * 0.5} ${top + 10} Q ${cx} ${top + 3} ${cx + w * 0.55} ${top + 12}`}
          fill="none"
          stroke={ctx.hairShade}
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
      {spec.fringeStyle === 'wave' && (
        <path
          d={`M ${cx - w * 0.7} ${y - 4} Q ${cx - w * 0.2} ${y + 6} ${cx + w * 0.3} ${y - 3}`}
          fill="none"
          stroke={ctx.hairShade}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.6"
        />
      )}
    </g>
  );
}

/** 帽子のつばの下から覗く前髪 */
export function HairFringe({ id, ctx }: { id: HairId; ctx: PartContext }) {
  const spec = specOf(id);
  // 前髪の短い髪型・薄い髪型は、つばの下からは覗かない
  if (spec.thin >= 0.6 || spec.fringe < 6) return null;
  const { geo } = ctx;
  const cx = CENTER_X;
  const w = geo.templeHalf - 4;
  // つばのすぐ下から覗かせる。ここが髪型ごとに違うので、
  // 帽子をかぶっていても選手を見分けられる
  const y = CAP_BRIM_Y + 17;
  const depth = Math.max(3, spec.fringe * 0.5);
  return (
    <path
      className="pt-hair-fringe"
      d={`M ${cx - w} ${y - 6} ${fringeEdge({ ...spec, fringe: depth }, cx - w, cx + w, y)} Z`}
      fill={ctx.hair}
      opacity={1 - spec.thin * 0.5}
    />
  );
}

/** もみあげと襟足。帽子をかぶっていても見分けがつく手がかりになる */
export function HairSides({ id, ctx }: { id: HairId; ctx: PartContext }) {
  const spec = specOf(id);
  if (spec.sideburn <= 2) return null;
  const { geo } = ctx;
  const cx = CENTER_X;
  const x = geo.halfWidth - 3;
  const top = CAP_BRIM_Y + 16;
  const len = spec.sideburn;
  return (
    <g className="pt-hair-sides" fill={ctx.hair} opacity={1 - spec.thin * 0.4}>
      <path d={`M ${cx - x - 3} ${top} h 6 v ${len} q -3 4 -6 0 z`} />
      <path d={`M ${cx + x - 3} ${top} h 6 v ${len} q -3 4 -6 0 z`} />
      {spec.back >= 6 && (
        <>
          <path d={`M ${cx - x - 4} ${top + 6} q -4 ${spec.back} 2 ${spec.back + 6} q 4 -6 3 -${spec.back} z`} />
          <path d={`M ${cx + x + 4} ${top + 6} q 4 ${spec.back} -2 ${spec.back + 6} q -4 -6 -3 -${spec.back} z`} />
        </>
      )}
    </g>
  );
}
