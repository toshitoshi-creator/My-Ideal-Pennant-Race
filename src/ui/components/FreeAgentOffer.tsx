/**
 * 未所属（自由契約）の選手の一覧と、直接オファー。
 * FA市場が開いていないとき（シーズン中・契約更改中）は、ここから直接条件を提示して契約できる。
 * FA市場が開いている間は、市場で他球団と競って提示する。
 */
import { useState } from 'react';
import type { Player } from '../../domain/types';
import { useGame } from '../store';
import { Sec } from './Sec';
import { PlayerLink } from './PlayerLink';
import { PositionBadge, RankBadge, Sheet } from './common';
import { PlayerVisual } from './PlayerVisual';
import { RoleGrades, positionText } from './PitcherRole';
import { overallRating } from '../../domain/rating';
import {
  MAX_SALARY,
  MIN_SALARY,
  formatMoney,
  formatSalary,
  maxContractYears,
  remainingBudget,
} from '../../domain/contract';
import { canSignDirectly, directAcceptable, directAsking } from '../../domain/rosterMoves';

export function FreeAgentTable() {
  const { state } = useGame();
  const [target, setTarget] = useState<string | null>(null);
  const pool = [...state.freeAgents].sort((a, b) => overallRating(b) - overallRating(a));
  if (pool.length === 0) return null;
  const open = canSignDirectly(state);
  const player = target ? state.freeAgents.find((p) => p.id === target) : undefined;
  return (
    <div className="card">
      <Sec en="FREE AGENTS" ja="FA（未所属）の選手" size="sub" />
      <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
        どの球団にも所属していない選手です（{pool.length}人）。
        {open
          ? '「オファー」から直接条件を提示して契約できます。'
          : 'いまはFA市場が開いているので、FA市場で条件を提示してください。'}
      </div>
      <div className="fa-free-list">
        {pool.slice(0, 40).map((p) => (
          <div key={p.id} className="player-card fa-free-row">
            <PositionBadge player={p} />
            <span className="grow">
              <span className="row" style={{ gap: 6 }}>
                <PlayerLink playerId={p.id}>{p.name}</PlayerLink>
                <span className="meta">{p.age}歳</span>
              </span>
              <span className="meta">
                {positionText(p)} / 希望 {formatSalary(directAsking(state, p).asking)}
              </span>
            </span>
            <RankBadge value={overallRating(p)} />
            <button
              type="button"
              className="chip fa-free-offer"
              disabled={!open}
              onClick={() => setTarget(p.id)}
            >
              オファー
            </button>
          </div>
        ))}
      </div>
      {player && <DirectOfferSheet player={player} onClose={() => setTarget(null)} />}
    </div>
  );
}

function DirectOfferSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const { state, signFreeAgent } = useGame();
  const { asking, years: preferred } = directAsking(state, player);
  const maxYears = maxContractYears(player.age);
  const [salary, setSalary] = useState(asking);
  const [years, setYears] = useState(Math.min(preferred, maxYears));
  const step = salary >= 200 ? 20 : salary >= 100 ? 10 : 5;
  const likely = directAcceptable(state, player, salary);
  const remaining = remainingBudget(state, state.playerTeamId);

  return (
    <Sheet title={`${player.name} へのオファー`} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div className="row" style={{ gap: 10 }}>
            <PlayerVisual player={player} size="medium" expression="focused" />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{player.name}</div>
              <div className="muted">
                {player.age}歳 / {positionText(player)} <RoleGrades player={player} />
              </div>
            </div>
          </div>
          <RankBadge value={overallRating(player)} />
        </div>
        <div className="spread" style={{ padding: '6px 0' }}>
          <span className="muted">希望年俸</span>
          <strong>{formatSalary(asking)}</strong>
        </div>
        <div className="spread" style={{ padding: '6px 0' }}>
          <span className="muted">予算残り</span>
          <strong style={{ color: remaining < salary ? 'var(--bad)' : undefined }}>
            {formatMoney(remaining)}
          </strong>
        </div>
      </div>

      <div className="card">
        <h2>提示条件</h2>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="muted">年俸</span>
          <span className="row" style={{ gap: 8 }}>
            <button
              className="chip"
              style={{ padding: '10px 14px' }}
              aria-label="年俸を下げる"
              onClick={() => setSalary((v) => Math.max(MIN_SALARY, v - step))}
            >
              －
            </button>
            <strong style={{ fontSize: 17, minWidth: 92, textAlign: 'center' }}>
              {formatSalary(salary)}
            </strong>
            <button
              className="chip"
              style={{ padding: '10px 14px' }}
              aria-label="年俸を上げる"
              onClick={() => setSalary((v) => Math.min(MAX_SALARY, v + step))}
            >
              ＋
            </button>
          </span>
        </div>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="muted">契約年数</span>
          <span className="row" style={{ gap: 6 }}>
            {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
              <button
                key={y}
                className="chip"
                aria-pressed={years === y}
                style={{
                  padding: '9px 12px',
                  background: years === y ? 'var(--accent)' : '#2b3646',
                  color: years === y ? '#241a00' : undefined,
                }}
                onClick={() => setYears(y)}
              >
                {y}年
              </button>
            ))}
          </span>
        </div>
        <div style={{ marginTop: 6, fontWeight: 700, color: likely ? 'var(--good)' : 'var(--bad)' }}>
          {likely ? '◎ 受け入れられそうです' : '× この条件では断られそうです（希望の9割以上が目安）'}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          未所属の選手は他球団と競わないので、条件が合えばその場で契約できます（2軍から合流）。
        </div>
      </div>

      <button
        type="button"
        className="btn primary"
        onClick={() => {
          if (signFreeAgent(player.id, salary, years)) onClose();
        }}
      >
        この条件でオファーする
      </button>
    </Sheet>
  );
}
