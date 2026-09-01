import type { ReactNode } from 'react';
import { rankOf, RANK_COLORS } from '../../domain/rank';

export function RankBadge({ value }: { value: number }) {
  const rank = rankOf(value);
  return (
    <span className="rank" style={{ background: RANK_COLORS[rank] }}>
      {rank}
    </span>
  );
}

export function AbilityBar({
  label,
  value,
  display,
  showRank = true,
}: {
  label: string;
  value: number;
  display?: string;
  /** 弾道のようにランク表示になじまない能力では false */
  showRank?: boolean;
}) {
  const rank = rankOf(value);
  const color = showRank ? RANK_COLORS[rank] : 'var(--accent-2)';
  return (
    <div className="ability">
      <span className="label">{label}</span>
      <span className="bar">
        <span style={{ width: `${Math.max(3, Math.min(100, value))}%`, background: color }} />
      </span>
      <span className="val">{display ?? Math.round(value)}</span>
      {showRank ? <RankBadge value={value} /> : <span className="rank" style={{ opacity: 0 }} />}
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
          <button
            className="chip"
            style={{ padding: '7px 14px', fontSize: 14 }}
            onClick={onClose}
          >
            閉じる
          </button>
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
