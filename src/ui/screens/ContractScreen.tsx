import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { Player } from '../../domain/types';
import { POSITION_LABELS, POSITION_SHORT } from '../../domain/positions';
import { overallRating } from '../../domain/rating';
import {
  expectedSalary,
  formatMoney,
  formatSalary,
  marketValue,
  maxContractYears,
  remainingBudget,
  teamPayroll,
  yearsDiscount,
  MIN_SALARY,
  MAX_SALARY,
} from '../../domain/contract';
import { RankBadge, Sheet } from '../components/common';

/**
 * 契約更改（PHASE 3.3）。
 * 契約満了選手に年俸と年数を提示する。予算内で誰を残すかを決める画面。
 */
export function ContractScreen() {
  const { state, autoContracts, startFA } = useGame();
  const phase = state.contractPhase!;
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const finance = state.finances[state.playerTeamId];
  const [negotiating, setNegotiating] = useState<string | null>(null);

  const pending = useMemo(
    () =>
      phase.pending
        .map((id) => state.players.find((p) => p.id === id))
        .filter((p): p is Player => !!p)
        .sort((a, b) => overallRating(b) - overallRating(a)),
    [phase.pending, state.players],
  );

  const payroll = teamPayroll(state, state.playerTeamId);
  const remaining = remainingBudget(state, state.playerTeamId);
  const target = negotiating ? state.players.find((p) => p.id === negotiating) : null;

  return (
    <div className="app" style={{ paddingBottom: 20 }}>
      <div className="appbar">
        <div>
          <h1>{phase.year}年 契約更改</h1>
          <div className="sub">{team.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 11 }}>
            予算残り
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: remaining < 0 ? 'var(--bad)' : 'var(--accent)',
            }}
          >
            {formatMoney(remaining)}
          </div>
        </div>
      </div>

      <div className="screen">
        <div className="card">
          <h2>球団の資金</h2>
          <FinanceRows
            cash={finance.cash}
            budget={finance.budget}
            payroll={payroll}
            lastResult={finance.lastResult}
          />
          {remaining < 0 && (
            <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 8, fontSize: 13 }}>
              ⚠ 年間予算を超えています。資金が減り続けると経営が苦しくなります。
            </div>
          )}
        </div>

        {pending.length > 0 ? (
          <div className="card">
            <h2>契約満了（残り{pending.length}人）</h2>
            <div className="muted">
              条件を提示してください。選手は年俸・年数・実績から判断します。
            </div>
          </div>
        ) : (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>契約更改が終わりました</div>
            <div className="muted" style={{ marginTop: 4, marginBottom: 10 }}>
              契約が成立しなかった選手は球団を去り、FA市場へ移ります。
              FA市場に進むと契約更改には戻れません。
            </div>
            <button className="btn primary" onClick={() => startFA()}>
              FA市場へ
            </button>
          </div>
        )}

        {pending.map((player) => (
          <ContractCard
            key={player.id}
            player={player}
            onOpen={() => setNegotiating(player.id)}
          />
        ))}

        {pending.length > 0 && (
          <button className="btn secondary" onClick={() => autoContracts()}>
            残り{pending.length}人をおまかせで交渉する
          </button>
        )}

        {phase.resolved.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <h2>交渉結果</h2>
            {phase.resolved.map((entry, i) => (
              <div key={i} className="spread" style={{ padding: '6px 0' }}>
                <span>{entry.name}</span>
                <span
                  style={{
                    fontWeight: 700,
                    color: entry.accepted ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  {entry.accepted
                    ? `${formatSalary(entry.salary)} / ${entry.years}年`
                    : '交渉決裂'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {target && <NegotiationSheet player={target} onClose={() => setNegotiating(null)} />}
    </div>
  );
}

export function FinanceRows({
  cash,
  budget,
  payroll,
  lastResult,
}: {
  cash: number;
  budget: number;
  payroll: number;
  lastResult?: number;
}) {
  const remaining = budget - payroll;
  return (
    <>
      <Row label="球団資金" value={formatMoney(cash)} danger={cash < 0} />
      <Row label="年間予算" value={formatMoney(budget)} />
      <Row label="総年俸" value={formatMoney(payroll)} />
      <Row label="予算残り" value={formatMoney(remaining)} danger={remaining < 0} />
      {lastResult !== undefined && (
        <Row
          label="前年度の収支"
          value={`${lastResult >= 0 ? '+' : ''}${formatMoney(lastResult)}`}
          danger={lastResult < 0}
        />
      )}
    </>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 700, color: danger ? 'var(--bad)' : undefined }}>{value}</span>
    </div>
  );
}

function ContractCard({ player, onOpen }: { player: Player; onOpen: () => void }) {
  const { state } = useGame();
  const stats = state.stats[player.id];
  const expected = expectedSalary(player, stats, state.year);
  const current = player.ext.contract?.salary ?? 0;

  return (
    <button className="player-card" onClick={onOpen}>
      <span className="pos">{POSITION_SHORT[player.mainPosition]}</span>
      <span className="grow">
        <span className="row" style={{ gap: 6 }}>
          <span className="name">{player.name}</span>
          <span className="meta">{player.age}歳</span>
        </span>
        <span className="meta">
          現在 {formatSalary(current)} → 希望 {formatSalary(expected)}
        </span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        <RankBadge value={overallRating(player)} />
      </span>
    </button>
  );
}

function NegotiationSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const { state, offerContract } = useGame();
  const stats = state.stats[player.id];
  const expected = expectedSalary(player, stats, state.year);
  const market = marketValue(player, stats, state.year);
  const current = player.ext.contract?.salary ?? 0;
  const maxYears = maxContractYears(player.age);

  const [salary, setSalary] = useState(expected);
  const [years, setYears] = useState(Math.min(2, maxYears));

  const required = Math.round(expected * yearsDiscount(years));
  const likely = salary >= required;
  const step = salary >= 200 ? 20 : salary >= 100 ? 10 : 5;

  return (
    <Sheet title={`${player.name} との交渉`} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{player.name}</div>
            <div className="muted">
              {player.age}歳 / {POSITION_LABELS[player.mainPosition]}
            </div>
          </div>
          <RankBadge value={overallRating(player)} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Row label="現在の年俸" value={formatSalary(current)} />
          <Row label="市場価値" value={formatSalary(market)} />
          <Row label="選手の希望" value={formatSalary(expected)} />
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

        <Row label="総額" value={formatMoney(salary * years)} />
        <div
          style={{
            marginTop: 10,
            fontWeight: 700,
            color: likely ? 'var(--good)' : 'var(--bad)',
          }}
        >
          {likely ? '◎ 受け入れられそうです' : '× この条件では拒否されそうです'}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          長期契約は年俸をやや抑えられますが、能力が落ちても契約は残ります。
        </div>
      </div>

      <button
        className="btn primary"
        onClick={() => {
          offerContract(player.id, salary, years);
          onClose();
        }}
      >
        この条件で契約する
      </button>
    </Sheet>
  );
}
