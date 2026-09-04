/**
 * PHASE 4.1 の「順番に見せる」共通部品。
 *
 * ここは表示だけを扱う。ゲームの状態はすでに確定していて、
 * 演出を飛ばしても・途中で画面を離れても・リロードしても結果は変わらない。
 */
import type { ReactNode } from 'react';
import { usePlayback, useCountUp, useReducedMotion, staggerDelay } from '../anim';

export interface RevealRow {
  label: string;
  value: ReactNode;
  /** 最後の1行を強調する（「指名決定」など） */
  emphasis?: boolean;
}

/**
 * 行を上から順に見せる。スキップボタンで即座に最後まで飛ぶ。
 * 連打しても二重には進まない（usePlayback 側で止めている）。
 */
export function RevealRows({
  rows,
  intervalMs = 260,
  animationKey,
  title,
}: {
  rows: RevealRow[];
  intervalMs?: number;
  animationKey: string;
  title?: string;
}) {
  const reduced = useReducedMotion();
  const play = usePlayback(rows.length, intervalMs, true);
  const shown = rows.slice(0, Math.max(1, play.step));

  return (
    <div key={animationKey}>
      {(title || !play.done) && (
        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {title ?? ''}
          </span>
          {!play.done && (
            <button className="skip-btn" onClick={play.skip}>
              スキップ
            </button>
          )}
        </div>
      )}
      {shown.map((row, i) => (
        <div
          key={row.label}
          className={reduced ? undefined : row.emphasis ? 'pop-in' : 'card-in'}
          style={{
            animationDelay: `${staggerDelay(0, reduced)}ms`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '6px 0',
            borderBottom: i === shown.length - 1 ? 'none' : '1px solid var(--line)',
          }}
        >
          <span className="muted">{row.label}</span>
          <span style={{ fontWeight: row.emphasis ? 800 : 700, textAlign: 'right' }}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 意味のある数字だけを軽くカウントアップする（§26） */
export function CountUp({
  value,
  format,
  durationMs = 420,
  decimals = 0,
}: {
  value: number;
  format?: (v: number) => string;
  durationMs?: number;
  decimals?: number;
}) {
  const shown = useCountUp(value, durationMs, decimals);
  return <>{format ? format(shown) : shown}</>;
}
