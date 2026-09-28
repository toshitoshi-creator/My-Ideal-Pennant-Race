/**
 * 自球団の選手を「自由契約」にするか「引退」させるかを選ぶ。
 * どちらも取り消せないので、押したあとにもう一度確かめる。
 */
import { useState } from 'react';
import type { Player } from '../../domain/types';
import { useGame } from '../store';

type Choice = 'release' | 'retire';

const COPY: Record<Choice, { label: string; confirm: string; note: string }> = {
  release: {
    label: '自由契約にする',
    confirm: '自由契約にする（確定）',
    note: '球団を離れて未所属になります。他球団が獲得することもあり、あとで自分から再びオファーもできます。',
  },
  retire: {
    label: '引退させる',
    confirm: '引退させる（確定）',
    note: '現役を退きます。成績は歴史に残り、実績しだいで殿堂入りします。もう復帰はできません。',
  },
};

export function ReleaseRetirePanel({ player, onDone }: { player: Player; onDone?: () => void }) {
  const { releasePlayer, retirePlayer } = useGame();
  const [choice, setChoice] = useState<Choice | null>(null);
  return (
    <div className="card release-panel">
      <div style={{ fontWeight: 800 }}>契約しない場合</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {player.name}（{player.age}歳）を自由契約にするか、引退させるかを選べます。
      </div>
      <div className="release-choices">
        {(['release', 'retire'] as Choice[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`chip release-choice ${c}${choice === c ? ' on' : ''}`}
            onClick={() => setChoice(choice === c ? null : c)}
          >
            {COPY[c].label}
          </button>
        ))}
      </div>
      {choice && (
        <div className="release-confirm">
          <div className="muted" style={{ fontSize: 12 }}>
            {COPY[choice].note}
          </div>
          <button
            type="button"
            className={`btn ${choice === 'retire' ? 'danger' : 'secondary'}`}
            onClick={() => {
              if (choice === 'release') releasePlayer(player.id);
              else retirePlayer(player.id);
              onDone?.();
            }}
          >
            {COPY[choice].confirm}
          </button>
        </div>
      )}
    </div>
  );
}
