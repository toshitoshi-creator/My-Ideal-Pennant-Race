import { useGame } from '../store';
import { CATEGORY_LABELS } from '../../domain/news';
import { formatDateJa } from '../../domain/dates';
import type { NewsCategory, NewsItem } from '../../domain/types';
import { staggerDelay, useFirstVisit, useReducedMotion } from '../anim';
import { NewsVisual } from './visuals/NewsVisual';

/** 少しだけ強調してよいニュース（§20） */
const EMPHASISED = new Set<NewsCategory>([
  'CHAMPIONSHIP',
  'RECORD',
  'TRADE',
  'DRAFT',
  'RETIREMENT',
  'FA',
]);


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

  /*
   * PHASE 4.3: 新聞の紙面として組む（§13・§25）。
   * 三段の扱いにして、同じ大きさで並べない。
   *   lead   速報 — 大きな見出しと本文、上下に太い罫
   *   normal 重要 — 見出しだけ大きめ
   *   brief  通常 — 一行の短信
   */
  const tier = item.priority === 'BREAKING' ? 'lead' : big ? 'normal' : 'brief';

  return (
    <article
      className={`news-item news-${tier}${animate ? (emphasise ? ' pop-in' : ' card-in') : ''}`}
      style={{ animationDelay: animate ? `${staggerDelay(index, reduced)}ms` : undefined }}
    >
      <div className="news-head">
        <span className="news-date">
          {item.year}年 {formatDateJa(item.date)}
        </span>
        <span className={`news-kind${item.priority === 'BREAKING' ? ' breaking' : ''}`}>
          {item.priority === 'BREAKING' ? '速報' : CATEGORY_LABELS[item.category]}
        </span>
        {team && <span className="news-team">{team.shortName}</span>}
        {isNew && <span className="news-new">NEW</span>}
      </div>
      <NewsVisual item={item} tier={tier} />
      <h3 className="news-title">
        {item.playerId && onSelectPlayer ? (
          <button className="linky" onClick={() => onSelectPlayer(item.playerId!)}>
            {item.title}
          </button>
        ) : (
          item.title
        )}
      </h3>
      {tier !== 'brief' && <p className="news-body">{item.body}</p>}
    </article>
  );
}
