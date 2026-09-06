/**
 * PHASE 4.4 判断を記録したときの表示（§5）。
 *
 * 決めた瞬間に「結果」「影響」「数字」を全部出さない。
 *   1 DECISION RECORDED（判断を記録した）
 *   2 少し置いて、何を決めたか
 *   3 さらに少し置いて、次にどこを見るか
 * の順に出す。
 *
 * ゲームの状態はボタンを押した時点ですでに確定していて、
 * ここでの表示はその写しでしかない（§41）。スキップしても・リロードしても結果は変わらない。
 */
import type { DecisionRecord } from '../../domain/types';
import { DECISION_KIND_TAGS, DECISION_KIND_LABELS } from '../../domain/decisions';
import { usePlayback } from '../anim';

export function DecisionStamp({ record }: { record: DecisionRecord }) {
  // 3段階。reduced-motion のときは usePlayback が即座に最後まで進める
  const play = usePlayback(3, 260, true);

  return (
    <div className="decision-stamp" key={record.id}>
      <div className="decision-stamp-head">
        <span className="label">DECISION RECORDED</span>
        <span className="decision-stamp-ja">判断を記録しました</span>
      </div>
      {play.step >= 2 && (
        <div className="decision-stamp-body">
          <span className="decision-stamp-tag">{DECISION_KIND_TAGS[record.kind]}</span>
          <span className="decision-stamp-kind">{DECISION_KIND_LABELS[record.kind]}</span>
          <div className="decision-stamp-choice">{record.choice}</div>
        </div>
      )}
      {play.done && (
        <p className="decision-stamp-note">
          GM日誌に残しました。あとから「そのときどう決めたか」を読み返せます。
        </p>
      )}
    </div>
  );
}
