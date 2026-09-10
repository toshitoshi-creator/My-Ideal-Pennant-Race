/**
 * 選手のビジュアル（表示側の唯一の入口）。
 *
 * PHASE 4.8-A から、描き方は3段階になった（§29）。
 *
 *   1. 自作SVG（CharacterRenderer）… ふだんはここ
 *   2. PHASE 4.5 の SVG           … 1 が落ちたとき
 *   3. 名前だけの安全な代替        … 2 も落ちたとき
 *
 * PHASE 4.7 の画像素材（外部AIで作ったPNG）は使わなくなった。
 * 帽子のずれとキャラクターのブレを消しきれなかったため、
 * パーツを自分で描いて決定論的に組み合わせる方式へ移った。
 * 画像を読む道（PlayerPortraitImage）は残してあるが、
 * ゲームの通常の描画からは呼ばれない。
 *
 * どの段でも、選手の表示そのものは絶対に壊れない。
 * 「画像がありません」も、壊れた画像アイコンも画面に出さない。
 */
import { memo, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Player } from '../../domain/types';
import type { Expression, Pose } from '../../domain/playerAppearance';
import type { VisualStance } from '../../domain/visualProfile';
import { characterProfileAtAge, type CharacterProfile } from '../../domain/characterProfile';
import { CharacterRenderer, partCount } from '../character';
import type { CharacterExpression } from '../character';
import { PlayerPortrait, PlayerPortraitById } from './PlayerPortrait';
import { PlayerPortraitFallback } from './PlayerPortraitFallback';
import type { PortraitSize } from '../portrait';

/** 表示サイズ。SVG 側と同じ呼び名にそろえる */
export type VisualSize = PortraitSize;

/** サイズごとの表示幅（px）。§18 の範囲に収める */
const WIDTH: Record<VisualSize, number> = {
  small: 48,
  medium: 88,
  large: 168,
  hero: 260,
};

/**
 * 表情の対応。
 *
 * ゲーム側の表情（PHASE 4.5）と、自作SVGの表情（PHASE 4.8-A）は
 * 種類が違うので、ここで橋渡しする。無い表情は neutral に落とす。
 */
const EXPRESSION_MAP: Record<string, CharacterExpression> = {
  neutral: 'neutral',
  happy: 'smile',
  confident: 'smile',
  focused: 'serious',
  determined: 'serious',
  angry: 'serious',
  tired: 'neutral',
  sad: 'neutral',
  disappointed: 'neutral',
  surprised: 'surprised',
  celebrating: 'grin',
  injured: 'open',
};

function toCharacterExpression(expression: Expression | 'auto' | undefined): CharacterExpression {
  if (!expression || expression === 'auto') return 'neutral';
  return EXPRESSION_MAP[expression] ?? 'neutral';
}

/**
 * 実際に作ってあるパーツの数を、設計図づくりに渡す。
 *
 * ドメイン側は既定値を持っているが、パーツを増やしたときに
 * 設計図がその数を知らないと、新しいパーツが選ばれない。
 */
function partCounts() {
  return {
    head: partCount('head'),
    body: partCount('body'),
    hair: partCount('hairFront'),
    eyes: partCount('eye'),
    eyebrow: partCount('eyebrow'),
    nose: partCount('nose'),
    mouth: partCount('mouth'),
    ears: partCount('ear'),
    cap: partCount('cap'),
  };
}

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
  // stance は PHASE 4.5 の SVG 側の引数。自作SVGでは姿勢をまだ扱わない（§35）
  stance: _stance = 'auto',
  pose,
  showCap = true,
  showUniform = true,
  animate = false,
  teamColor,
  className,
}: PlayerVisualProps) {
  const character = useMemo(
    () => characterProfileAtAge(player.id, player.age, partCounts()),
    [player.id, player.age],
  );

  return (
    <VisualLayers
      character={character}
      name={player.name}
      size={size}
      expression={toCharacterExpression(expression)}
      showCap={showCap}
      teamColor={teamColor}
      className={className}
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
  const character = useMemo(
    () => characterProfileAtAge(playerId, age, partCounts()),
    [playerId, age],
  );

  return (
    <VisualLayers
      character={character}
      name={name}
      size={size}
      expression={toCharacterExpression(expression)}
      showCap={showCap}
      teamColor={teamColor}
      className={className}
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
  /** 自作SVGの設計図（PHASE 4.8-A） */
  character: CharacterProfile;
  name: string;
  size: VisualSize;
  expression: CharacterExpression;
  showCap: boolean;
  teamColor?: string | undefined;
  className?: string | undefined;
  /** 自作SVGが描けないときに描くもの（PHASE 4.5 の SVG） */
  renderSvg: () => ReactElement;
}

/**
 * 3段階の選び分けだけを受け持つ（§29）。
 *   0 = 自作SVG / 1 = PHASE 4.5 の SVG / 2 = 名前だけの代替
 *
 * 段を落とすのは「描けなかったとき」だけ。
 * 自作SVGは外部に何も頼らないので、ふつうは段0のまま。
 */
function VisualLayers({
  character,
  name,
  size,
  expression,
  showCap,
  teamColor,
  className,
  renderSvg,
}: VisualLayersProps) {
  const [tier, setTier] = useState(0);

  if (tier === 0) {
    try {
      return (
        <CharacterRenderer
          profile={character}
          width={WIDTH[size]}
          expression={expression}
          showCap={showCap}
          teamColor={teamColor}
          /*
           * PHASE 4.5 の肖像と同じ印を付ける。
           *
           * 画面の CSS（大きさ・並び）も E2E も `portrait` を目印にしている。
           * 中身を自作SVGへ入れ替えても、外から見た名前は変えない。
           */
          className={['portrait', `portrait-${size}`, `portrait-x-${expression}`, className ?? '']
            .filter(Boolean)
            .join(' ')}
          title={`${name}の肖像`}
        />
      );
    } catch {
      // 組み立てで落ちても、選手の行そのものは残す
      setTier(1);
    }
  }

  if (tier <= 1) {
    try {
      return renderSvg();
    } catch {
      // ここも落ちたら、最後の砦へ
    }
  }

  // 名前の頭文字だけを出す
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
