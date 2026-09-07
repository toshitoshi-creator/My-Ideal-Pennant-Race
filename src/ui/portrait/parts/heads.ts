/**
 * PHASE 4.5 頭の形（10種類）。
 *
 * 拡大縮小で数を増やすのではなく、
 * 「こめかみの張り」「頬の位置」「あごの角」「あご先の形」を別々に変える。
 * 横から見れば同じでも、正面のシルエットははっきり違う。
 *
 * 顔パーツはここが返す HeadGeometry を見て位置を決めるので、
 * どの輪郭と組み合わせても輪郭の内側に収まる。
 */
import type { HeadGeometry, HeadId } from '../types';
import { CENTER_X, EYE_Y } from '../types';

type ChinStyle = 'round' | 'square' | 'point' | 'soft' | 'cleft';

interface HeadSpec {
  id: HeadId;
  /** 頭頂 */
  topY: number;
  /** あご先 */
  chinY: number;
  /** こめかみ（額の横） */
  templeHalf: number;
  /** 目の高さの半幅 */
  halfWidth: number;
  /** 頬の半幅 */
  cheekHalf: number;
  /** あごの角の半幅 */
  jawHalf: number;
  /** あご先の半幅 */
  chinHalf: number;
  chin: ChinStyle;
  eyeGap: number;
}

const SPECS: HeadSpec[] = [
  // 丸顔：頬が横に張り、あごは丸い
  { id: 'head_01_round', topY: 50, chinY: 202, templeHalf: 62, halfWidth: 66, cheekHalf: 64, jawHalf: 50, chinHalf: 25, chin: 'round', eyeGap: 26 },
  // 卵型：上が広く下へすぼまる
  { id: 'head_02_oval', topY: 48, chinY: 206, templeHalf: 60, halfWidth: 62, cheekHalf: 56, jawHalf: 40, chinHalf: 19, chin: 'soft', eyeGap: 25 },
  // 四角：あごの角が立ち、下端が平ら
  { id: 'head_03_square', topY: 52, chinY: 200, templeHalf: 64, halfWidth: 66, cheekHalf: 65, jawHalf: 60, chinHalf: 36, chin: 'square', eyeGap: 27 },
  // 面長：縦に長い
  { id: 'head_04_long', topY: 42, chinY: 214, templeHalf: 55, halfWidth: 58, cheekHalf: 54, jawHalf: 43, chinHalf: 21, chin: 'round', eyeGap: 24 },
  // 横広：短くて広い
  { id: 'head_05_wide', topY: 56, chinY: 196, templeHalf: 68, halfWidth: 72, cheekHalf: 70, jawHalf: 56, chinHalf: 30, chin: 'round', eyeGap: 29 },
  // 細面：狭い
  { id: 'head_06_narrow', topY: 48, chinY: 206, templeHalf: 52, halfWidth: 54, cheekHalf: 50, jawHalf: 38, chinHalf: 18, chin: 'point', eyeGap: 23 },
  // エラ張り：あごの角がいちばん広い
  { id: 'head_07_jaw', topY: 52, chinY: 202, templeHalf: 58, halfWidth: 63, cheekHalf: 66, jawHalf: 64, chinHalf: 32, chin: 'square', eyeGap: 26 },
  // やわらかい輪郭：頬がふっくらし、あご先が小さい
  { id: 'head_08_soft', topY: 52, chinY: 200, templeHalf: 60, halfWidth: 65, cheekHalf: 66, jawHalf: 48, chinHalf: 22, chin: 'soft', eyeGap: 26 },
  // 骨っぽい：頬骨が出て、あごが尖る
  { id: 'head_09_angular', topY: 48, chinY: 208, templeHalf: 56, halfWidth: 66, cheekHalf: 58, jawHalf: 42, chinHalf: 17, chin: 'point', eyeGap: 26 },
  // 重量級：下半分が重い
  { id: 'head_10_heavy', topY: 54, chinY: 204, templeHalf: 60, halfWidth: 68, cheekHalf: 72, jawHalf: 62, chinHalf: 34, chin: 'cleft', eyeGap: 27 },
];

/** あご先の描き方。輪郭の性格がいちばん出るところ */
function chinCurve(spec: HeadSpec, side: 1 | -1): string {
  const cx = CENTER_X;
  const { chinY, jawHalf, chinHalf, chin } = spec;
  const jx = cx + side * jawHalf;
  const chx = cx + side * chinHalf;
  switch (chin) {
    case 'square':
      // 角を立て、下端をほぼ平らにする
      return `L ${jx - side * 4} ${chinY - 10} L ${chx} ${chinY} L ${cx} ${chinY}`;
    case 'point':
      // すっと尖る
      return `C ${jx} ${chinY - 26} ${chx} ${chinY - 4} ${cx} ${chinY}`;
    case 'soft':
      // 丸みを残しつつ小さく収まる
      return `C ${jx} ${chinY - 12} ${chx + side * 8} ${chinY} ${cx} ${chinY}`;
    case 'cleft':
      // 重いあご。下端の手前でいったん膨らむ
      return `C ${jx} ${chinY - 14} ${chx + side * 12} ${chinY + 2} ${cx} ${chinY - (side === 1 ? 2 : 2)}`;
    default:
      return `C ${jx} ${chinY - 16} ${chx + side * 4} ${chinY} ${cx} ${chinY}`;
  }
}

/** 片側の輪郭を描く（side = -1 で左、1 で右） */
function halfOutline(spec: HeadSpec, side: 1 | -1): string {
  const cx = CENTER_X;
  const { topY, chinY, templeHalf, halfWidth, cheekHalf, jawHalf } = spec;
  const faceH = chinY - topY;
  const templeY = topY + faceH * 0.26;
  const cheekY = EYE_Y + (chinY - EYE_Y) * 0.3;
  const jawY = chinY - (chinY - EYE_Y) * 0.28;
  return [
    `C ${cx + side * templeHalf * 0.66} ${topY} ${cx + side * templeHalf} ${templeY - 22} ${cx + side * templeHalf} ${templeY}`,
    `C ${cx + side * templeHalf} ${EYE_Y - 18} ${cx + side * halfWidth} ${EYE_Y - 14} ${cx + side * halfWidth} ${EYE_Y}`,
    `C ${cx + side * halfWidth} ${cheekY - 8} ${cx + side * cheekHalf} ${cheekY - 4} ${cx + side * cheekHalf} ${cheekY}`,
    `C ${cx + side * cheekHalf} ${jawY - 6} ${cx + side * jawHalf} ${jawY - 4} ${cx + side * jawHalf} ${jawY}`,
    chinCurve(spec, side),
  ].join(' ');
}

function buildPath(spec: HeadSpec): string {
  const cx = CENTER_X;
  // 右まわりに下り、左まわりに戻る（塗りつぶしが破綻しない向き）
  const right = halfOutline(spec, 1);
  const leftSpec = halfOutline(spec, -1);
  // 左半分は逆向きに使いたいので、いったんあご先から上へ戻す形で書き直す
  return `M ${cx} ${spec.topY} ${right} ${reverseHalf(leftSpec, spec)} Z`;
}

/**
 * 左半分をあご先→頭頂の向きで書く。
 * ベジェの制御点をそのまま逆順に使うと形が崩れるので、
 * 左側は「頭頂から下る同じ形」を描いてから閉じる。
 */
function reverseHalf(_left: string, spec: HeadSpec): string {
  const cx = CENTER_X;
  const { topY, chinY, templeHalf, halfWidth, cheekHalf, jawHalf, chinHalf, chin } = spec;
  const faceH = chinY - topY;
  const templeY = topY + faceH * 0.26;
  const cheekY = EYE_Y + (chinY - EYE_Y) * 0.3;
  const jawY = chinY - (chinY - EYE_Y) * 0.28;
  const jx = cx - jawHalf;
  const chx = cx - chinHalf;
  const chinBack =
    chin === 'square'
      ? `L ${chx} ${chinY} L ${jx + 4} ${chinY - 10}`
      : chin === 'point'
        ? `C ${chx} ${chinY - 4} ${jx} ${chinY - 26} ${jx} ${jawY}`
        : chin === 'soft'
          ? `C ${chx - 8} ${chinY} ${jx} ${chinY - 12} ${jx} ${jawY}`
          : chin === 'cleft'
            ? `C ${chx - 12} ${chinY + 2} ${jx} ${chinY - 14} ${jx} ${jawY}`
            : `C ${chx - 4} ${chinY} ${jx} ${chinY - 16} ${jx} ${jawY}`;
  const tail =
    chin === 'square' || chin === 'point'
      ? `${chinBack}${chin === 'square' ? ` L ${jx} ${jawY}` : ''}`
      : chinBack;
  return [
    tail,
    `C ${cx - jawHalf} ${jawY - 4} ${cx - cheekHalf} ${jawY - 6} ${cx - cheekHalf} ${cheekY}`,
    `C ${cx - cheekHalf} ${cheekY - 4} ${cx - halfWidth} ${cheekY - 8} ${cx - halfWidth} ${EYE_Y}`,
    `C ${cx - halfWidth} ${EYE_Y - 14} ${cx - templeHalf} ${EYE_Y - 18} ${cx - templeHalf} ${templeY}`,
    `C ${cx - templeHalf} ${templeY - 22} ${cx - templeHalf * 0.66} ${topY} ${cx} ${topY}`,
  ].join(' ');
}

const GEOMETRY: Record<HeadId, HeadGeometry> = SPECS.reduce(
  (acc, spec) => {
    acc[spec.id] = {
      id: spec.id,
      halfWidth: spec.halfWidth,
      templeHalf: spec.templeHalf,
      topY: spec.topY,
      chinY: spec.chinY,
      cheekHalf: spec.cheekHalf,
      jawHalf: spec.jawHalf,
      eyeGap: spec.eyeGap,
      path: buildPath(spec),
    };
    return acc;
  },
  {} as Record<HeadId, HeadGeometry>,
);

/** その頭の形の寸法とパスを返す。未知のIDでも標準の形に落とす（§35） */
export function headGeometry(id: HeadId): HeadGeometry {
  return GEOMETRY[id] ?? GEOMETRY.head_02_oval;
}

export const HEAD_GEOMETRIES = GEOMETRY;
