/**
 * 総合評価が上がった（B 以上になった）選手の演出。
 *
 * 選手カードがくるくる回り、止まると新しいランクが刻まれる。
 * 複数いれば1人ずつ見せる。画面のどこを押しても回転を飛ばせる。
 * 成長そのものはオフシーズンで確定していて、ここは見せ方だけ。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { GameState, RankUpEntry } from '../../domain/types';
import { PlayerVisual } from './PlayerVisual';
import { positionText } from './PitcherRole';
import { teamVisual } from '../../domain/visuals';
import { TeamMark } from './visuals/TeamVisuals';
import { useReducedMotion } from '../anim';
import { sfx, buzz } from '../sfx';

const SPIN_MS = 1900;

export function RankUpShow({
  state,
  entries,
  onDone,
}: {
  state: GameState;
  entries: RankUpEntry[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const entry = entries[index];
  if (!entry) return null;
  const next = () => {
    if (index + 1 < entries.length) setIndex(index + 1);
    else onDone();
  };
  // 画面の切り替え演出（transform）の内側に置くと固定表示が崩れるので、body 直下に出す
  return createPortal(
    <RankUpCard
      key={entry.playerId}
      state={state}
      entry={entry}
      position={`${index + 1} / ${entries.length}`}
      last={index + 1 >= entries.length}
      onNext={next}
    />,
    document.body,
  );
}

function RankUpCard({
  state,
  entry,
  position,
  last,
  onNext,
}: {
  state: GameState;
  entry: RankUpEntry;
  position: string;
  last: boolean;
  onNext: () => void;
}) {
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<'spin' | 'reveal'>(reduced ? 'reveal' : 'spin');
  const player = state.players.find((p) => p.id === entry.playerId);
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;

  useEffect(() => {
    if (stage === 'spin') {
      sfx.drumroll(SPIN_MS / 1000 - 0.2);
      const t = setTimeout(() => setStage('reveal'), SPIN_MS);
      return () => clearTimeout(t);
    }
    sfx.slam();
    buzz([40, 60, 40, 60, 90]);
    const t = setTimeout(() => sfx.fanfare(), 180);
    return () => clearTimeout(t);
  }, [stage]);

  const rank = stage === 'reveal' ? entry.rankAfter : entry.rankBefore;

  return (
    <div
      className={`rankup stage-${stage} rank-${entry.rankAfter}`}
      role="dialog"
      aria-modal="true"
      aria-label="総合評価アップ"
      onClick={() => stage === 'spin' && setStage('reveal')}
    >
      <div className="rankup-rays" aria-hidden="true" />
      <div className="rankup-head">
        <span className="rankup-kicker">{position}</span>
        <h2 className="rankup-title">RANK UP!</h2>
        <p className="rankup-sub">総合評価が上がりました</p>
      </div>

      <div className="rankup-stage">
        <div className="rankup-card">
          <div className={`rankup-face rankup-front rank-${rank}`}>
            <div className="rankup-card-top">
              <TeamMark visual={teamVisual(team)} name={team.name} size={22} />
              <span>{team.shortName}</span>
              <span className="rankup-card-no">{player?.uniformNumber ?? ''}</span>
            </div>
            <div className="rankup-card-photo">
              {player && <PlayerVisual player={player} size="large" expression="confident" />}
            </div>
            <div className="rankup-card-name">{entry.name}</div>
            <div className="rankup-card-pos">{player ? positionText(player) : ''}</div>
            <div className="rankup-card-rank" key={rank}>
              {rank}
            </div>
          </div>
          <div className="rankup-face rankup-back" aria-hidden="true">
            <TeamMark visual={teamVisual(team)} name={team.name} size={72} />
          </div>
        </div>
        {stage === 'reveal' && !reduced && <Sparkles />}
      </div>

      {stage === 'reveal' && (
        <div className="rankup-info">
          <div className="rankup-change">
            <span className={`rk rank-${entry.rankBefore}`}>{entry.rankBefore}</span>
            <span className="rankup-arrow">▶</span>
            <span className={`rk rank-${entry.rankAfter}`}>{entry.rankAfter}</span>
          </div>
          <div className="rankup-overall">
            総合 {entry.overallBefore} → <strong>{entry.overallAfter}</strong>
          </div>
          <button
            type="button"
            className="btn primary rankup-next"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
          >
            {last ? '成長レポートを見る' : '次の選手へ'}
          </button>
        </div>
      )}
      {stage === 'spin' && <p className="rankup-tap">タップで飛ばす</p>}
    </div>
  );
}

/** カードのまわりに散る光の粒（配置は index から決める） */
function Sparkles() {
  return (
    <div className="rankup-sparkles" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * 360;
        const dist = 110 + ((i * 37) % 60);
        return (
          <span
            key={i}
            style={
              {
                '--a': `${angle}deg`,
                '--d': `${dist}px`,
                animationDelay: `${(i % 5) * 40}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
