/**
 * Canvas版キャラクター（新しい見た目システム）。
 *
 * domain/character/appearance.ts が「どのパーツ・どの色か」を
 * player.id から決定論的に決め、ui/character/draw.ts がそれを
 * Canvas へ実際に描く。ここはその2つを React につなぐだけの薄い層。
 *
 * 既存の Rng クラスの乱数メソッドは next()（0以上1未満の浮動小数点数）。
 * appearance.ts が要求する RandomSource も next() を1つ持つだけなので、
 * そのまま { next: () => rng.next() } で包める。
 *
 * 選手ごとの見た目は、ゲームの乱数（rngState）を一切使わない。
 * player.id から作った専用の Rng インスタンスだけを消費するので、
 * 見た目をいつ・何回描いても試合のシミュレーションには影響しない。
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Rng, seedFrom } from '../../domain/rng';
import {
  generatePlayerAppearance,
  type PlayerAppearance,
  type RandomSource,
} from '../../domain/character/appearance';
import { renderPlayerAppearance, shade } from './draw';

/** この版の名前。生成ロジックを変えたら上げる（見た目が総入れ替えになるので慎重に） */
const APPEARANCE_VERSION = 1;

function toRandomSource(rng: Rng): RandomSource {
  return { next: () => rng.next() };
}

/**
 * player.id から見た目を決める。
 * 同じ id なら、何度呼んでも、いつ呼んでも、同じ結果になる。
 */
export function buildCanvasAppearance(
  playerId: string,
  options: { gear?: boolean; hatText?: string; number?: number | string } = {},
): PlayerAppearance {
  const seed = seedFrom(`player-canvas-appearance-v${APPEARANCE_VERSION}:${playerId}`);
  const rng = new Rng(seed);
  return generatePlayerAppearance(toRandomSource(rng), options);
}

/** 背景が「bg=1（放射線・球団色の地）」かどうか。draw.ts の bg 番号と対応する */
const TEAM_COLOR_BG = 1;

/**
 * 球団色をユニフォーム・帽子に流し込む。
 *
 * generatePlayerAppearance は自前の球団色候補から選ぶだけなので、
 * 実際にその選手が所属する球団の色（teamColor）とは一致しない。
 * ここで、ユニフォームの差し色・帽子・番号の縁取りだけを実際の球団色に
 * 上書きする。素の肌・髪・目鼻立ちなど本人の見た目は変えない。
 *
 * 背景が bg=1（球団色の放射線）のときだけ bg1Color も上書きする。
 * draw.ts はこの背景を選んだときだけ bg1Color に team[0] を入れているので、
 * ここを直さないと「背景だけ架空の球団色」というちぐはぐが起きる。
 */
export function applyTeamColor(
  appearance: PlayerAppearance,
  teamColor: string | undefined,
): PlayerAppearance {
  if (!teamColor) return appearance;
  return {
    ...appearance,
    cloth2Color: teamColor,
    hat1Color: teamColor,
    hat2Color: shade(teamColor, -0.35),
    textLineColor: shade(teamColor, -0.4),
    ...(appearance.bg === TEAM_COLOR_BG ? { bg1Color: teamColor } : {}),
  };
}

/**
 * 見た目の「指紋」を作る。
 *
 * 一覧と詳細で同じ人物が出ているか、選手ごとに絵が違うかを
 * DOM から確かめられるようにする（PHASE 4.5 の SVG が pt-eyes 等の
 * クラス名で部品構成を見せていたのと同じ役目。Canvas は innerHTML が
 * 常に空なので、そのままでは中身が何も見えない）。
 * 色や番号まで含めた全パーツ番号を並べるだけで、絵そのものではない。
 */
export function appearanceKey(appearance: PlayerAppearance): string {
  return [
    appearance.head, appearance.hair, appearance.eye, appearance.brow, appearance.nose,
    appearance.mouth, appearance.beard, appearance.body, appearance.hat, appearance.glasses,
    appearance.extra, appearance.item, appearance.bg, appearance.skinColor, appearance.hairColor,
    appearance.cloth1Color, appearance.cloth2Color, appearance.hat1Color, appearance.hat2Color,
    appearance.numberText,
  ].join('-');
}

export interface CanvasPortraitProps {
  playerId: string;
  name: string;
  /** 表示する一辺のCSSピクセル数（正方形） */
  width: number;
  /** false なら帽子・グローブ等の装備なし */
  showCap?: boolean;
  /** 球団色。渡すとユニフォームと帽子に反映される */
  teamColor?: string | undefined;
  /** 背番号 */
  numberText?: number | string | undefined;
  className?: string | undefined;
  title?: string | undefined;
}

/**
 * 1人ぶんをCanvasに描く。
 *
 * 高DPI画面でぼやけないよう、実ピクセル数は
 * devicePixelRatio ぶん大きく作り、CSS上の表示サイズだけ width に合わせる。
 */
export const CanvasPortrait = memo(function CanvasPortrait({
  playerId,
  name,
  width,
  showCap = true,
  teamColor,
  numberText,
  className,
  title,
}: CanvasPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const appearance = useMemo(
    () =>
      applyTeamColor(
        buildCanvasAppearance(playerId, { gear: showCap, number: numberText }),
        teamColor,
      ),
    [playerId, showCap, numberText, teamColor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const pixelSize = Math.max(1, Math.round(width * dpr));
    if (canvas.width !== pixelSize) canvas.width = pixelSize;
    if (canvas.height !== pixelSize) canvas.height = pixelSize;
    renderPlayerAppearance(ctx, appearance, pixelSize);
  }, [appearance, width]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={title ?? `${name}の肖像`}
      data-appearance-key={appearanceKey(appearance)}
      className={className}
      style={{ width, height: width, display: 'block' }}
    />
  );
});
