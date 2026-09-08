/**
 * PHASE 4.6 画像素材で描く選手の肖像。
 *
 * 外部の画像生成AIで作ったパーツを、共通キャンバスの上に重ねて1人を作る。
 * 実行時に外部へ取りに行くことは一切しない。ビルド時に同梱されたものだけを使う。
 *
 * 1枚でも読み込みに失敗したら onFail を呼び、呼び出し側が
 * 「別バリエーション → SVG」へ落とす（§1・§50）。
 * 壊れた画像アイコンは絶対に画面へ出さない。
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { VisualCategory, VisualProfile } from '../../domain/visualProfile';
import { resolveAsset, type AssetSize } from '../visual/assetRegistry';
import { manifest } from '../visual/assetRegistry';

/** 重ねる順番（下から上）。config/visual-assets.json の layer と合わせる */
const LAYER_ORDER: VisualCategory[] = [
  'pose',
  'body',
  'uniform',
  'neck',
  'ears',
  'head',
  'hairBack',
  'jaw',
  'eyebrows',
  'eyes',
  'nose',
  'mouth',
  'beard',
  'hair',
  'cap',
  'glasses',
  'equipment',
  'expression',
];

export interface PortraitImageProps {
  profile: VisualProfile;
  name: string;
  size: AssetSize;
  /** 表示幅（px） */
  width: number;
  className?: string;
  /** 球団色。ユニフォームの上に薄く重ねる */
  teamColor?: string;
  /** 1枚でも欠けたときに呼ぶ */
  onFail: () => void;
  animate?: boolean;
}

/**
 * 素材を重ねて1人を描く。
 * すべてのパーツが同じキャンバス（config の canvas）に描かれている前提なので、
 * 単純に同じ大きさで重ねれば位置が合う。
 */
export const PlayerPortraitImage = memo(function PlayerPortraitImage({
  profile,
  name,
  size,
  width,
  className,
  teamColor,
  onFail,
  animate = false,
}: PortraitImageProps) {
  const [failed, setFailed] = useState(false);

  const layers = useMemo(() => {
    const found: Array<{ category: VisualCategory; url: string }> = [];
    for (const category of LAYER_ORDER) {
      const id = profile.parts[category];
      if (!id) continue;
      const url = resolveAsset(category, id, size);
      if (url) found.push({ category, url });
    }
    return found;
  }, [profile, size]);

  const handleError = useCallback(() => {
    if (failed) return;
    setFailed(true);
    onFail();
  }, [failed, onFail]);

  if (failed || layers.length === 0) return null;

  const canvas = manifest.canvas ?? { width: 1024, height: 1280 };
  const height = Math.round((width * canvas.height) / canvas.width);

  return (
    <figure
      className={['portrait', 'portrait-image', animate ? 'portrait-reveal' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ width, height }}
      role="img"
      aria-label={`${name}の肖像`}
    >
      {layers.map((layer) => (
        <img
          key={layer.category}
          className={`pt-img pt-img-${layer.category}`}
          src={layer.url}
          alt=""
          aria-hidden="true"
          width={width}
          height={height}
          loading={size === 'small' ? 'lazy' : 'eager'}
          decoding="async"
          draggable={false}
          onError={handleError}
        />
      ))}
      {/* 球団色は面ではなく細い線として重ねる（背景を球団色で塗らない。§20・§23） */}
      {teamColor && <span className="pt-img-accent" style={{ background: teamColor }} aria-hidden="true" />}
    </figure>
  );
});
