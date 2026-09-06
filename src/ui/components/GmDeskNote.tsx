/**
 * PHASE 4.4 GMの案件票（§4）。
 *
 * 角丸のカードを並べない。左に太い罫を引いた「回覧資料」の形にして、
 *   状況 → 数字 → 見方 → 短期と長期 → どこで決めるか
 * の順に読ませる（§19 判断→根拠→データ の並びを、机の上の資料に当てはめたもの）。
 *
 * ここは表示だけで、押しても画面が変わるだけ。判断は自動実行しない（§2）。
 */
import type { GmDeskItem, GmDeskLink } from '../../domain/gmDesk';
import { useFirstVisit, useReducedMotion } from '../anim';

export function GmDeskNote({
  item,
  index,
  dateLabel,
  onOpen,
}: {
  item: GmDeskItem;
  /** 上から何枚目か。1枚目だけ大きく扱う（§25） */
  index: number;
  dateLabel: string;
  onOpen: (link: GmDeskLink) => void;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`gm:${item.id}`);
  const lead = index === 0;

  return (
    <article
      className={`gm-note${lead ? ' gm-lead' : ''}${first && !reduced ? ' card-in' : ''}`}
      style={{ animationDelay: first && !reduced ? `${Math.min(index, 3) * 70}ms` : undefined }}
    >
      <div className="gm-note-head">
        <span className="label">{item.en}</span>
        <span className="gm-note-date">{dateLabel}</span>
      </div>
      <h3 className="gm-note-title">{item.headline}</h3>

      {item.situation.length > 0 && (
        <div className="gm-block">
          <span className="label">CURRENT SITUATION</span>
          <span className="gm-block-ja">いまの状況</span>
          {item.situation.map((line, i) => (
            <p key={i} className="gm-text">
              {line}
            </p>
          ))}
        </div>
      )}

      {item.data.length > 0 && (
        <div className="gm-block">
          <span className="label">DATA</span>
          <span className="gm-block-ja">数字</span>
          <dl className="gm-data">
            {item.data.map((datum, i) => (
              <div key={i} className="gm-data-row">
                <dt>{datum.label}</dt>
                <dd>{datum.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="gm-block">
        <span className="label">SCOUT NOTE</span>
        <span className="gm-block-ja">見方</span>
        <p className="gm-text">{item.scoutNote}</p>
      </div>

      {lead && (item.shortTerm.length > 0 || item.longTerm.length > 0) && (
        <div className="gm-terms">
          <div className="gm-term">
            <span className="label">SHORT TERM</span>
            <span className="gm-block-ja">短期</span>
            {item.shortTerm.map((line, i) => (
              <p key={i} className="gm-text">
                {line}
              </p>
            ))}
          </div>
          <div className="gm-term">
            <span className="label">LONG TERM</span>
            <span className="gm-block-ja">長期</span>
            {item.longTerm.map((line, i) => (
              <p key={i} className="gm-text">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {item.options.length > 0 && (
        <div className="gm-block">
          <span className="label">OPTIONS</span>
          <span className="gm-block-ja">決められる場所</span>
          <div className="gm-options">
            {item.options.map((option) => (
              <button
                key={option.id}
                className="gm-option"
                onClick={() => onOpen(option.link)}
              >
                <span className="gm-option-label">［{option.label}］</span>
                <span className="gm-option-note">{option.note}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
