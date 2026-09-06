/**
 * PHASE 4.3 資料の欄見出し。
 *
 *   ▬▬
 *   CLUB REPORT     ← 欄名（ラテン語）
 *   球団レポート      ← 実際の名前（日本語）
 *
 * 赤い短い罫は初回だけ左から伸びる。2回目以降と reduced-motion では伸ばさない。
 * 英語だけにはしない（§3）。日本語が読めれば意味が通ることを優先する。
 */
import { useFirstVisit, useReducedMotion } from '../anim';

export function Sec({
  en,
  ja,
  size = 'normal',
  note,
}: {
  /** 欄名（ラテン語） */
  en: string;
  /** 実際の見出し（日本語）。省略すると欄名だけ出す */
  ja?: string;
  /** 資料の中での重みづけ（§25） */
  size?: 'lead' | 'normal' | 'sub';
  /** 見出しの右に添える短い補足 */
  note?: string;
}) {
  const reduced = useReducedMotion();
  const first = useFirstVisit(`sec:${en}`);
  const grow = first && !reduced;

  return (
    <div className={`sec sec-${size}`}>
      <span className={`sec-rule${grow ? ' grow' : ''}`} />
      <div className="sec-line">
        <span className="sec-en">{en}</span>
        {note && <span className="sec-note">{note}</span>}
      </div>
      {/*
        日本語のほうを本当の見出し（h2）にする。
        スクリーンリーダーや目次にとっての節の名前はこちら。
      */}
      {ja && <h2 className="sec-ja">{ja}</h2>}
    </div>
  );
}
