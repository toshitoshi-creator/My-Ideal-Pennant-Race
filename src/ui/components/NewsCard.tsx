import { useGame } from '../store';
import { CATEGORY_LABELS } from '../../domain/news';
import { formatDateJa } from '../../domain/dates';
import type { NewsCategory, NewsItem } from '../../domain/types';
import { staggerDelay, useFirstVisit, useReducedMotion } from '../anim';

/** 少しだけ強調してよいニュース（§20） */
const EMPHASISED = new Set<NewsCategory>([
  'CHAMPIONSHIP',
  'RECORD',
  'TRADE',
  'DRAFT',
  'RETIREMENT',
  'FA',
]);

const PRIORITY_COLOR: Record<string, string> = {
  BREAKING: 'var(--accent)',
  HIGH: 'var(--accent-2)',
  NORMAL: 'var(--line)',
  LOW: 'var(--line)',
};

/**
 * ニュース1件のカード（PHASE 3.9）。
 * 重要なものは大きく、通常のものはコンパクトに見せる。
 */
export function NewsCard({
  item,
  onSelectPlayer,
  index = 0,
}: {
  item: NewsItem;
  onSelectPlayer?: (playerId: string) => void;
  /** 上から順に現れさせるための並び順（PHASE 4.1） */
  index?: number;
}) {
  const { state } = useGame();
  const big = item.priority === 'BREAKING' || item.priority === 'HIGH';
  const team = state.teams.find((t) => t.id === item.teamId);
  const reduced = useReducedMotion();
  // PHASE 4.1: 今日届いたニュースだけ NEW を付ける（ゲーム状態は見るだけ）
  const isNew = item.date === state.date;
  // 優勝・記録更新・大型移籍などは少しだけ強調する
  const emphasise = EMPHASISED.has(item.category) && item.priority === 'BREAKING';
  const first = useFirstVisit(`news:${item.id}`);
  const animate = first && !reduced;

  return (
    <div
      className={animate ? (emphasise ? 'pop-in' : 'card-in') : undefined}
      style={{
        animationDelay: animate ? `${staggerDelay(index, reduced)}ms` : undefined,
        borderLeft: `3px solid ${PRIORITY_COLOR[item.priority]}`,
        padding: big ? '10px 0 10px 10px' : '7px 0 7px 10px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div className="spread" style={{ marginBottom: 3 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isNew && <span className="news-new">NEW</span>}
          <span className={item.priority === 'BREAKING' ? 'chip on' : 'chip'}>
            {item.priority === 'BREAKING' ? '速報' : CATEGORY_LABELS[item.category]}
          </span>
          {team && (
            <span className="muted" style={{ fontSize: 12 }}>
              {team.shortName}
            </span>
          )}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {item.year}年 {formatDateJa(item.date)}
        </span>
      </div>
      <div style={{ fontWeight: big ? 800 : 700, fontSize: big ? 16 : 14 }}>
        {item.playerId && onSelectPlayer ? (
          <button className="linky" onClick={() => onSelectPlayer(item.playerId!)}>
            {item.title}
          </button>
        ) : (
          item.title
        )}
      </div>
      {big && (
        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
          {item.body}
        </div>
      )}
    </div>
  );
}
