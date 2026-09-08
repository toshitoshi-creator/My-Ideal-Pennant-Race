/**
 * PHASE 4.7 選手のビジュアル（表示側の唯一の入口）。
 *
 * 4段階で描く（PHASE 4.7 §35）：
 *
 *   1. 画像素材（外部の画像生成AIで作ったパーツを重ねる）
 *   2. 画像素材の別バリエーション（低い解像度・別サイズ）
 *   3. PHASE 4.5 の SVG
 *   4. 名前だけの安全な代替（SVG も描けないとき）
 *
 * 素材が1枚も無くても、素材の読み込みに失敗しても、
 * 選手の表示そのものは絶対に壊れない。
 * 「画像がありません」も、壊れた画像アイコンも画面に出さない。
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Player } from '../../domain/types';
import type { Expression, Pose } from '../../domain/playerAppearance';
import {
  buildVisualProfile,
  buildVisualProfileFromId,
  missingCategories,
  type VisualProfile,
  type VisualStance,
} from '../../domain/visualProfile';
import { assetCounts, hasAsset, imageModeAvailable } from '../visual/assetRegistry';
import type { AssetSize } from '../visual/assetRegistry';
import { PlayerPortraitImage } from './PlayerPortraitImage';
import { PlayerPortrait, PlayerPortraitById } from './PlayerPortrait';
import { PlayerPortraitFallback } from './PlayerPortraitFallback';
import type { PortraitSize } from '../portrait';
import { useOptionalGameState } from '../store';

/** 表示サイズ。SVG 側と同じ呼び名にそろえる */
export type VisualSize = PortraitSize;

/** サイズごとの表示幅（px）。§18 の範囲に収める */
const WIDTH: Record<VisualSize, number> = {
  small: 48,
  medium: 88,
  large: 168,
  hero: 260,
};

/** 表示サイズ → 読み込む素材の解像度（一覧で巨大画像を読まないため。§49） */
const ASSET_SIZE: Record<VisualSize, AssetSize> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  hero: 'hero',
};

/** 段階が落ちるときの次の解像度（§21 の「別バリエーション」） */
const NEXT_ASSET_SIZE: Record<AssetSize, AssetSize | null> = {
  hero: 'large',
  large: 'medium',
  medium: 'small',
  small: null,
};

export interface PlayerVisualProps {
  player: Player;
  size?: VisualSize;
  /** 'auto' なら選手の状態から決める */
  expression?: Expression | 'auto';
  /** 'auto' なら守備位置から決める */
  stance?: VisualStance | 'auto';
  /** SVG で描くときの姿勢。画像素材では stance が姿勢を決める */
  pose?: Pose;
  showCap?: boolean;
  showUniform?: boolean;
  animate?: boolean;
  teamColor?: string;
  className?: string;
}

/**
 * 選手1人ぶんのビジュアル。
 * 使う側は Player を渡すだけでよい。画像があれば画像、無ければ SVG が出る。
 */
export const PlayerVisual = memo(function PlayerVisual({
  player,
  size = 'medium',
  expression = 'auto',
  stance = 'auto',
  pose,
  showCap = true,
  showUniform = true,
  animate = false,
  teamColor,
  className,
}: PlayerVisualProps) {
  const state = useOptionalGameState();

  const profile = useMemo(
    () =>
      buildVisualProfile(
        {
          player,
          state: state ?? undefined,
          expression: expression === 'auto' ? undefined : expression,
          stance: stance === 'auto' ? undefined : stance,
        },
        assetCounts(),
      ),
    [player, state, expression, stance],
  );

  return (
    <VisualLayers
      profile={profile}
      name={player.name}
      size={size}
      teamColor={teamColor}
      className={className}
      animate={animate}
      renderSvg={() => (
        <PlayerPortrait
          player={player}
          size={size}
          expression={expression === 'auto' ? undefined : expression}
          pose={pose}
          showCap={showCap}
          showUniform={showUniform}
          animate={animate}
          teamColor={teamColor}
          className={className}
        />
      )}
    />
  );
});

export interface PlayerVisualByIdProps {
  playerId: string;
  name: string;
  age: number;
  isPitcher?: boolean;
  size?: VisualSize;
  expression?: Expression;
  showCap?: boolean;
  showUniform?: boolean;
  teamColor?: string;
  className?: string;
}

/**
 * Player が手元に無いとき（引退記録・成長レポート・歴史）のビジュアル。
 * playerId から作るので、現役のときと同じ人物が出る。
 */
export const PlayerVisualById = memo(function PlayerVisualById({
  playerId,
  name,
  age,
  isPitcher = false,
  size = 'medium',
  expression = 'neutral',
  showCap = true,
  showUniform = true,
  teamColor,
  className,
}: PlayerVisualByIdProps) {
  const profile = useMemo(
    () => buildVisualProfileFromId({ playerId, age, isPitcher, expression }, assetCounts()),
    [playerId, age, isPitcher, expression],
  );

  return (
    <VisualLayers
      profile={profile}
      name={name}
      size={size}
      teamColor={teamColor}
      className={className}
      animate={false}
      renderSvg={() => (
        <PlayerPortraitById
          playerId={playerId}
          name={name}
          age={age}
          isPitcher={isPitcher}
          size={size}
          expression={expression}
          showCap={showCap}
          showUniform={showUniform}
          teamColor={teamColor}
          className={className}
        />
      )}
    />
  );
});

interface VisualLayersProps {
  profile: VisualProfile;
  name: string;
  size: VisualSize;
  teamColor?: string;
  className?: string;
  animate: boolean;
  /** 素材で描けないときに描くもの（PHASE 4.5 の SVG） */
  renderSvg: () => ReactElement;
}

/**
 * 4段階の選び分けだけを受け持つ（§35）。
 *   0 = 画像素材 / 1 = 画像素材の別解像度 / 2 = SVG / 3 = 名前だけの代替
 */
function VisualLayers({
  profile,
  name,
  size,
  teamColor,
  className,
  animate,
  renderSvg,
}: VisualLayersProps) {
  const [tier, setTier] = useState(0);

  // 必要な種類がひとつでも欠けていれば、最初から SVG で描く
  const complete = useMemo(
    () => imageModeAvailable() && missingCategories(profile, hasAsset).length === 0,
    [profile],
  );

  const assetSize = ASSET_SIZE[size];
  const fallbackSize = NEXT_ASSET_SIZE[assetSize];
  const dropTier = useCallback(() => setTier((t) => t + 1), []);

  if (complete && tier === 0) {
    return (
      <PlayerPortraitImage
        profile={profile}
        name={name}
        size={assetSize}
        width={WIDTH[size]}
        teamColor={teamColor}
        className={className}
        animate={animate}
        onFail={dropTier}
      />
    );
  }

  if (complete && tier === 1 && fallbackSize) {
    return (
      <PlayerPortraitImage
        profile={profile}
        name={name}
        size={fallbackSize}
        width={WIDTH[size]}
        teamColor={teamColor}
        className={className}
        animate={false}
        onFail={dropTier}
      />
    );
  }

  // ここまで来たら SVG で描く。素材が1枚も無いときはいつもここ
  if (tier <= 2) {
    try {
      return renderSvg();
    } catch {
      // SVG の組み立てで落ちても、選手の行そのものは残す
    }
  }

  // 最後の砦。名前の頭文字だけを出す（§35 safe placeholder）
  return <PlayerPortraitFallback name={name} size={size} className={className} />;
}

/** 一覧・ニュースで使う小さなビジュアル */
export const PlayerVisualSmall = memo(function PlayerVisualSmall(
  props: Omit<PlayerVisualProps, 'size'>,
) {
  return <PlayerVisual {...props} size="small" />;
});

/** 選手詳細で使う大きなビジュアル */
export const PlayerVisualLarge = memo(function PlayerVisualLarge(
  props: Omit<PlayerVisualProps, 'size'>,
) {
  return <PlayerVisual {...props} size="large" />;
});

/** ドラフト・FA・トレードの見せ場で使う特大のビジュアル */
export const PlayerVisualHero = memo(function PlayerVisualHero(
  props: Omit<PlayerVisualProps, 'size'>,
) {
  return <PlayerVisual {...props} size="hero" />;
});
