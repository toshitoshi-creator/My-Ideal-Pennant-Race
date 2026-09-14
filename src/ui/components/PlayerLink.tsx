/**
 * 選手名をタップして選手詳細を開く共通の入り口（PHASE 4.9-A）。
 *
 * どの画面で使っても、渡すのは playerId だけでよい。
 * 実際にどの画面を開くか（現役選手の PlayerDetail か、引退・過去の選手の
 * 経歴シートか）は PlayerDetailHost（App.tsx から常時1つだけ描画）が
 * state から都度決める。呼び出し側が state を持ち回す必要はない。
 */
import type { ReactNode } from 'react';
import { useStore } from '../store';

export interface PlayerLinkProps {
  playerId: string;
  /** 省略すると playerId をそのまま表示する（通常は選手名を渡す） */
  children?: ReactNode;
  className?: string;
  /** 読み上げ用。省略時は表示内容から作る簡単なラベルになる */
  ariaLabel?: string;
}

/**
 * 選手名。見た目は「紙の資料の中の索引」に見えるよう、
 * 青いリンクにはせず、文字色と下線だけで示す。
 */
export function PlayerLink({ playerId, children, className, ariaLabel }: PlayerLinkProps) {
  const { openPlayer } = useStore();
  return (
    <button
      type="button"
      className={['player-link', className].filter(Boolean).join(' ')}
      onClick={(e) => {
        // 行全体がタップ領域になっている一覧の中でも使えるよう、親への伝播を止める
        e.stopPropagation();
        openPlayer(playerId);
      }}
      aria-label={ariaLabel ?? (typeof children === 'string' ? `${children}の選手詳細を開く` : undefined)}
    >
      {children ?? playerId}
    </button>
  );
}
