/**
 * PHASE 4.5 肖像の共通型と座標系。
 *
 * すべての部品はこの1つの座標系の上に描く。
 * 座標系がずれると、目だけ顔の外に出るような組み合わせが生まれてしまう。
 *
 *   viewBox: 0 0 256 320
 *
 *   y=  20  帽子の頂点
 *   y=  52  頭頂
 *   y= 124  目の高さ（EYE_Y）
 *   y= 150  鼻の下（NOSE_Y）
 *   y= 178  口の高さ（MOUTH_Y）
 *   y= 200  あご先（頭の形で前後する）
 *   y= 214  首の付け根
 *   y= 244  肩
 *   y= 320  下端
 *
 * 顔の中心は常に x=128。
 */
import type {
  BodyId,
  EarId,
  EyeId,
  EyebrowId,
  Expression,
  FacialHairId,
  HairId,
  HeadId,
  JawId,
  MouthId,
  NoseId,
  PlayerAppearance,
  Pose,
} from '../../domain/playerAppearance';

export const VIEW_W = 256;
export const VIEW_H = 320;
export const CENTER_X = 128;
export const EYE_Y = 124;
export const NOSE_Y = 150;
export const MOUTH_Y = 178;
export const NECK_Y = 214;
/** 帽子のつばの高さ。ここから下に前髪が覗く */
export const CAP_BRIM_Y = 76;
export const SHOULDER_Y = 246;

/**
 * 頭の形。すべての顔パーツはこの寸法を見て位置と大きさを決めるので、
 * どの輪郭にどのパーツを載せても輪郭からはみ出さない。
 */
export interface HeadGeometry {
  id: HeadId;
  /** 目の高さでの顔の半幅 */
  halfWidth: number;
  /** 頭頂の y */
  topY: number;
  /** あご先の y */
  chinY: number;
  /** こめかみ（額の横）の半幅 */
  templeHalf: number;
  /** 頬（いちばん張り出す高さ）の半幅 */
  cheekHalf: number;
  /** あごの角の半幅 */
  jawHalf: number;
  /** 輪郭のパス */
  path: string;
  /** 目と目のあいだ（中心からの距離） */
  eyeGap: number;
}

/** 部品を描くときに渡す情報 */
export interface PartContext {
  geo: HeadGeometry;
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  ink: string;
  expression: Expression;
  /** 帽子をかぶっているか。髪の描き方が変わる */
  capped: boolean;
}

export type PortraitSize = 'small' | 'medium' | 'large' | 'hero';

/** 表示サイズ（px）。§18 の範囲に収める */
export const SIZE_PX: Record<PortraitSize, number> = {
  small: 48,
  medium: 88,
  large: 168,
  hero: 260,
};

/** どこまで描くか。小さいカードでは胸から上だけにする */
export const SIZE_CROP: Record<PortraitSize, 'bust' | 'full'> = {
  small: 'bust',
  medium: 'bust',
  large: 'full',
  hero: 'full',
};

export interface PortraitOptions {
  size?: PortraitSize;
  expression?: Expression;
  pose?: Pose;
  showCap?: boolean;
  showUniform?: boolean;
  ageAdjusted?: boolean;
  animate?: boolean;
  /** 帽子・襟に入れる球団色。未所属なら渡さない */
  teamColor?: string;
  className?: string;
}

export type {
  BodyId,
  EarId,
  EyeId,
  EyebrowId,
  Expression,
  FacialHairId,
  HairId,
  HeadId,
  JawId,
  MouthId,
  NoseId,
  PlayerAppearance,
  Pose,
};
