/**
 * PHASE 4.5 選手の肖像（表示側の入口）。
 *
 * 使う側は Player を渡すだけでよい。どの部品で組み立てるかは
 * playerId から決まるので、画面が違っても同じ人物が出る。
 *
 * 再描画を抑えるため、Appearance Profile は memo 化し、
 * コンポーネント自体も React.memo で包む（§32）。
 */
import { memo, useMemo } from 'react';
import type { Player } from '../../domain/types';
import type { Expression, PlayerAppearance, Pose } from '../../domain/playerAppearance';
import {
  appearanceFromId,
  appearanceOf,
  expressionOf,
  poseOf,
} from '../../domain/playerAppearance';
import { PortraitFallbackSvg, PortraitSvg } from '../portrait';
import type { PortraitOptions, PortraitSize } from '../portrait';
import { useOptionalGameState } from '../store';

export type { PortraitSize };

interface Props {
  player: Player;
  size?: PortraitSize;
  expression?: Expression;
  pose?: Pose;
  showCap?: boolean;
  showUniform?: boolean;
  animate?: boolean;
  /** 帽子と襟に入れる球団色。渡さなければ墨色になる */
  teamColor?: string;
  className?: string;
}

/**
 * 選手1人の肖像。
 * 表情を渡さなければ、いまの状態（怪我・調子・スランプ・疲労）から決まる。
 */
export const PlayerPortrait = memo(function PlayerPortrait({
  player,
  size = 'medium',
  expression,
  pose,
  showCap = true,
  showUniform = true,
  animate = false,
  teamColor,
  className,
}: Props) {
  const state = useOptionalGameState();
  const appearance = useMemo(() => appearanceOf(player), [player]);
  const mood = useMemo<Expression>(
    () => expression ?? (state ? expressionOf(state, player) : 'neutral'),
    [expression, state, player],
  );
  const options: PortraitOptions = {
    size,
    expression: mood,
    pose: pose ?? poseOf(player),
    showCap,
    showUniform,
    animate,
    teamColor,
    className,
  };
  return <PortraitSvg appearance={appearance} name={player.name} options={options} />;
});

/** 一覧・名鑑・ニュースで使う小さな肖像 */
export const PlayerPortraitSmall = memo(function PlayerPortraitSmall(
  props: Omit<Props, 'size'>,
) {
  return <PlayerPortrait {...props} size="small" />;
});

/** 選手詳細で使う大きな肖像 */
export const PlayerPortraitLarge = memo(function PlayerPortraitLarge(
  props: Omit<Props, 'size'>,
) {
  return <PlayerPortrait {...props} size="large" />;
});

/** ドラフト・FA・トレードなどの見せ場で使う特大の肖像 */
export const PlayerPortraitHero = memo(function PlayerPortraitHero(
  props: Omit<Props, 'size'>,
) {
  return <PlayerPortrait {...props} size="hero" />;
});

/**
 * Player が手元にない場面（引退記録・成長レポート）のための肖像。
 * 顔は playerId だけで決まるので、現役のときと同じ人物になる。
 */
export const PlayerPortraitById = memo(function PlayerPortraitById({
  playerId,
  name,
  age,
  isPitcher = false,
  size = 'medium',
  expression = 'neutral',
  pose,
  showCap = true,
  showUniform = true,
  teamColor,
  className,
}: {
  playerId: string;
  name: string;
  age: number;
  isPitcher?: boolean;
  size?: PortraitSize;
  expression?: Expression;
  pose?: Pose;
  showCap?: boolean;
  showUniform?: boolean;
  teamColor?: string;
  className?: string;
}) {
  const appearance = useMemo(
    () => appearanceFromId(playerId, age, isPitcher),
    [playerId, age, isPitcher],
  );
  return (
    <PortraitSvg
      appearance={appearance}
      name={name}
      options={{
        size,
        expression,
        pose: pose ?? (isPitcher ? 'pose_pitch' : 'pose_idle'),
        showCap,
        showUniform,
        teamColor,
        className,
      }}
    />
  );
});

/** すでに組み立て済みの見た目をそのまま描く（プレビュー・テスト用） */
export function PortraitOf({
  appearance,
  name,
  options,
}: {
  appearance: PlayerAppearance;
  name: string;
  options?: PortraitOptions;
}) {
  return <PortraitSvg appearance={appearance} name={name} options={options} />;
}

/** 用意できないときのかたち */
export function PlayerPortraitFallback({
  name,
  size = 'medium',
  className,
}: {
  name: string;
  size?: PortraitSize;
  className?: string;
}) {
  return <PortraitFallbackSvg name={name} size={size} className={className} />;
}
