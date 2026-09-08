/**
 * PHASE 4.6 最後の受け皿。
 *
 * 画像素材も、SVGの部品も用意できない場合に出す統一されたシルエット。
 * 「画像がありません」「missing」「undefined」のような文字は絶対に出さない（§50）。
 */
import { memo } from 'react';
import { PortraitFallbackSvg } from '../portrait';
import type { PortraitSize } from '../portrait';

export const PlayerPortraitFallback = memo(function PlayerPortraitFallback({
  name,
  size = 'medium',
  className,
}: {
  name: string;
  size?: PortraitSize;
  className?: string;
}) {
  return <PortraitFallbackSvg name={name} size={size} className={className} />;
});
