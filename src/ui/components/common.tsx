import type { ReactNode } from 'react';
import { rankOf, RANK_COLORS } from '../../domain/rank';
import { positionBadgeColors, POSITION_SHORT } from '../../domain/positions';
import type { Player } from '../../domain/types';
import { PictureButton } from './PictureButton';
import closeArt from '../../assets/ui/common-close.webp';

export function RankBadge({ value }: { value: number }) {
  const rank = rankOf(value);
  return (
    <span className="rank" style={{ background: RANK_COLORS[rank] }}>
      {rank}
    </span>
  );
}

/** 守備位置の色つきバッジ。複数守れる選手は、本職の色を先頭に色を分けて出す */
export function PositionBadge({ player }: { player: Player }) {
  const colors = positionBadgeColors(player);
  const step = 100 / colors.length;
  const background =
    colors.length === 1
      ? colors[0]
      : `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
  return (
    <span
      className="pos"
      style={{ background, backgroundRepeat: 'no-repeat', color: 'var(--ink)', border: 'none' }}
    >
      {POSITION_SHORT[player.mainPosition]}
    </span>
  );
}

export function AbilityBar({
  label,
  value,
  display,
}: {
  label: string;
  value: number;
  display?: string;
}) {
  const rank = rankOf(value);
  const color = RANK_COLORS[rank];
  return (
    <div className="ability">
      <span className="label">{label}</span>
      <span className="bar">
        <span style={{ width: `${Math.max(3, Math.min(100, value))}%`, background: color }} />
      </span>
      <span className="val">{display ?? Math.round(value)}</span>
      <RankBadge value={value} />
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="sheet-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="spread" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>{title}</strong>
          <PictureButton src={closeArt} alt="閉じる" className="sheet-close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === value ? 'on' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
