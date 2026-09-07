/**
 * PHASE 4.5 帽子と小物。
 *
 * 球団色を使うのは帽子・襟・ラインだけ。背景を球団色で塗らない（§22）。
 * 実在球団のロゴ・意匠は使わず、球団章は形だけで表す。
 */
import type { AccessoryId } from '../../../domain/playerAppearance';
import type { PartContext } from '../types';
import { CAP_BRIM_Y, CENTER_X, EYE_Y } from '../types';

/** 球団キャップ */
export function Cap({ ctx, color }: { ctx: PartContext; color: string }) {
  const { geo } = ctx;
  const cx = CENTER_X;
  const w = geo.templeHalf + 4;
  const top = geo.topY - 12;
  return (
    <g className="pt-cap">
      {/* クラウン */}
      <path
        d={`M ${cx - w} ${CAP_BRIM_Y}
            C ${cx - w - 2} ${top + 22} ${cx - w * 0.6} ${top} ${cx} ${top}
            C ${cx + w * 0.6} ${top} ${cx + w + 2} ${top + 22} ${cx + w} ${CAP_BRIM_Y} Z`}
        fill={color}
        className="pt-line"
      />
      {/* 中央の縫い目 */}
      <path d={`M ${cx} ${top + 3} V ${CAP_BRIM_Y - 4}`} stroke="var(--paper)" strokeWidth="1.6" opacity="0.35" fill="none" />
      {/* つば。左右に広く張り出させ、帽子だとひと目で分かるようにする */}
      <path
        d={`M ${cx - w - 2} ${CAP_BRIM_Y - 2}
            L ${cx + w + 2} ${CAP_BRIM_Y - 2}
            C ${cx + w + 20} ${CAP_BRIM_Y + 1} ${cx + w + 24} ${CAP_BRIM_Y + 14} ${cx + w + 2} ${CAP_BRIM_Y + 17}
            Q ${cx} ${CAP_BRIM_Y + 22} ${cx - w - 2} ${CAP_BRIM_Y + 17}
            C ${cx - w - 24} ${CAP_BRIM_Y + 14} ${cx - w - 20} ${CAP_BRIM_Y + 1} ${cx - w - 2} ${CAP_BRIM_Y - 2} Z`}
        fill={color}
        className="pt-line pt-cap-brim"
      />
      {/* つばが額に落とす影 */}
      <path
        d={`M ${cx - w + 4} ${CAP_BRIM_Y + 18} Q ${cx} ${CAP_BRIM_Y + 27} ${cx + w - 4} ${CAP_BRIM_Y + 18}
            Q ${cx} ${CAP_BRIM_Y + 22} ${cx - w + 4} ${CAP_BRIM_Y + 18} Z`}
        fill={ctx.skinShade}
        opacity="0.45"
        stroke="none"
      />
    </g>
  );
}

/** ヘルメット（打席のポーズで使う）。つばが短く、耳あてが付く */
export function Helmet({ ctx, color }: { ctx: PartContext; color: string }) {
  const { geo } = ctx;
  const cx = CENTER_X;
  const w = geo.templeHalf + 7;
  const top = geo.topY - 14;
  return (
    <g className="pt-helmet">
      <path
        d={`M ${cx - w} ${CAP_BRIM_Y + 6}
            C ${cx - w - 3} ${top + 20} ${cx - w * 0.6} ${top} ${cx} ${top}
            C ${cx + w * 0.6} ${top} ${cx + w + 3} ${top + 20} ${cx + w} ${CAP_BRIM_Y + 6} Z`}
        fill={color}
        className="pt-line"
      />
      {/* 側頭部。ヘルメットは耳の上まで深くかぶる */}
      <path
        d={`M ${cx - w - 1} ${CAP_BRIM_Y - 2} q -3 16 1 28 q 6 4 10 0 l -1 -26 z`}
        fill={color}
        className="pt-line"
      />
      <path
        d={`M ${cx + w + 1} ${CAP_BRIM_Y - 2} q 3 16 -1 28 q -6 4 -10 0 l 1 -26 z`}
        fill={color}
        className="pt-line"
      />
      <path
        d={`M ${cx - w - 1} ${CAP_BRIM_Y + 6} L ${cx + w + 1} ${CAP_BRIM_Y + 6}
            C ${cx + w + 8} ${CAP_BRIM_Y + 8} ${cx + w + 9} ${CAP_BRIM_Y + 14} ${cx + w} ${CAP_BRIM_Y + 15}
            L ${cx - w} ${CAP_BRIM_Y + 15}
            C ${cx - w - 9} ${CAP_BRIM_Y + 14} ${cx - w - 8} ${CAP_BRIM_Y + 8} ${cx - w - 1} ${CAP_BRIM_Y + 6} Z`}
        fill={color}
        className="pt-line"
      />
    </g>
  );
}

/** 小物。眼鏡・アイブラックなど、顔を隠しすぎないものだけ */
export function Accessories({ ids, ctx }: { ids: AccessoryId[]; ctx: PartContext }) {
  const cx = CENTER_X;
  const gap = ctx.geo.eyeGap;
  return (
    <g className="pt-accessories">
      {ids.includes('acc_glasses') && (
        <g className="pt-glasses">
          <rect x={cx - gap - 15} y={EYE_Y - 11} width="30" height="22" rx="6" />
          <rect x={cx + gap - 15} y={EYE_Y - 11} width="30" height="22" rx="6" />
          <path d={`M ${cx - gap + 15} ${EYE_Y - 2} H ${cx + gap - 15}`} />
          <path d={`M ${cx - gap - 15} ${EYE_Y - 4} H ${cx - ctx.geo.halfWidth + 2}`} />
          <path d={`M ${cx + gap + 15} ${EYE_Y - 4} H ${cx + ctx.geo.halfWidth - 2}`} />
        </g>
      )}
      {ids.includes('acc_eye_black') && (
        <g fill="var(--ink)" opacity="0.7" stroke="none">
          <rect x={cx - gap - 11} y={EYE_Y + 9} width="22" height="5" rx="2" />
          <rect x={cx + gap - 11} y={EYE_Y + 9} width="22" height="5" rx="2" />
        </g>
      )}
    </g>
  );
}
