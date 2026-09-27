/**
 * ゼロからの球団づくり：最初の選手契約。
 *
 * 選手0人・限られた資金から、契約金の安い（＝能力の低い）選手を選んで契約する。
 * 野手9人・投手5人以上そろえば開幕できる（目安は野手15人・投手6人）。
 */
import { useMemo, useState } from 'react';
import type { ExpansionCandidate } from '../../domain/types';
import { useGame } from '../store';
import { Sec } from '../components/Sec';
import { PositionBadge } from '../components/common';
import { AbilitySummary } from '../components/PlayerCard';
import { PlayerVisualSmall } from '../components/PlayerVisual';
import { CountUp } from '../components/Reveal';
import {
  EXPANSION_MAX_SIGNINGS,
  TARGET_FIELDERS,
  TARGET_PITCHERS,
  canFinishExpansion,
  signedCounts,
} from '../../domain/expansion';
import { formatSalary } from '../../domain/contract';
import { overallRating } from '../../domain/rating';
import { POSITION_LABELS } from '../../domain/positions';
import { potentialLabel } from '../../domain/growth';

type Tab = 'fielder' | 'pitcher' | 'signed';
type Sort = 'price' | 'ability' | 'young';

export function ExpansionScreen() {
  const { state, expansionSign, expansionRelease, expansionAuto, expansionFinish } = useGame();
  const exp = state.expansion!;
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const cash = state.finances[state.playerTeamId].cash;
  const [tab, setTab] = useState<Tab>('fielder');
  const [sort, setSort] = useState<Sort>('price');
  const counts = signedCounts(state);
  const ready = canFinishExpansion(state);
  const signedSet = new Set(exp.signed);
  const spent = exp.startCash - cash;
  const payroll = exp.pool.filter((c) => signedSet.has(c.id)).reduce((a, c) => a + c.salary, 0);

  const list = useMemo(() => {
    const base =
      tab === 'signed'
        ? exp.pool.filter((c) => signedSet.has(c.id))
        : exp.pool.filter((c) => c.player.isPitcher === (tab === 'pitcher'));
    const sorted = [...base];
    if (sort === 'price') sorted.sort((a, b) => a.bonus - b.bonus);
    else if (sort === 'ability') sorted.sort((a, b) => overallRating(b.player) - overallRating(a.player));
    else sorted.sort((a, b) => a.player.age - b.player.age);
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp.pool, exp.signed, tab, sort]);

  return (
    <div className="app expansion-app">
      <div className="appbar">
        <div>
          <h1>{team.name}</h1>
          <div className="sub">{state.year}年 球団づくり・最初の選手契約</div>
        </div>
      </div>

      <div className="screen">
        <div className="card exp-hero">
          <Sec en="FOUNDING ROSTER" ja="最初の選手契約" size="lead" />
          <p className="muted" style={{ marginTop: 0 }}>
            選手は0人です。球団資金から契約金を払って選手と契約します。
            契約金が安い選手ほど能力は低めですが、若い選手には伸びしろがあります。
          </p>
          <div className="exp-cash">
            <span className="label">球団資金</span>
            <span className={`exp-cash-value${cash < 30 ? ' low' : ''}`}>
              <CountUp value={cash} durationMs={500} format={(v) => formatSalary(v)} />
            </span>
            <span className="exp-cash-sub">
              契約金 {formatSalary(spent)} ／ 年俸の合計 {formatSalary(payroll)}（決算で支払い）
            </span>
          </div>
          <div className="exp-meters">
            <Meter label="野手" have={counts.fielders} target={TARGET_FIELDERS} min={9} />
            <Meter label="投手" have={counts.pitchers} target={TARGET_PITCHERS} min={5} />
          </div>
        </div>

        <div className="tabs exp-tabs">
          {(
            [
              { id: 'fielder', label: `野手` },
              { id: 'pitcher', label: `投手` },
              { id: 'signed', label: `契約済み ${exp.signed.length}` },
            ] as Array<{ id: Tab; label: string }>
          ).map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="list-toolbar" style={{ marginTop: 8 }}>
          <span className="muted">{list.length}人</span>
          <div className="seg" role="group" aria-label="並べ替え">
            {(
              [
                ['price', '契約金'],
                ['ability', '能力'],
                ['young', '若い順'],
              ] as Array<[Sort, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={sort === id ? 'on' : ''}
                aria-pressed={sort === id}
                onClick={() => setSort(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 && <div className="muted">まだ契約した選手はいません。</div>}
        {list.map((c) => (
          <CandidateRow
            key={c.id}
            candidate={c}
            signed={signedSet.has(c.id)}
            affordable={cash >= c.bonus && exp.signed.length < EXPANSION_MAX_SIGNINGS}
            onSign={() => expansionSign(c.id)}
            onRelease={() => expansionRelease(c.id)}
          />
        ))}
      </div>

      <div className="exp-footer">
        <div className="exp-footer-status">
          {ready.ok
            ? counts.fielders < TARGET_FIELDERS || counts.pitchers < TARGET_PITCHERS
              ? '開幕できます（目安の人数まであと少し）'
              : '開幕の準備ができました'
            : ready.reason}
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button type="button" className="btn secondary" onClick={expansionAuto}>
            おまかせで契約
          </button>
          <button type="button" className="btn primary" disabled={!ready.ok} onClick={expansionFinish}>
            この選手たちで開幕する
          </button>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, have, target, min }: { label: string; have: number; target: number; min: number }) {
  const pct = Math.min(100, (have / target) * 100);
  const state = have >= target ? 'full' : have >= min ? 'ok' : 'short';
  return (
    <div className={`exp-meter ${state}`}>
      <div className="exp-meter-head">
        <span>{label}</span>
        <strong key={have}>{have}</strong>
        <span className="muted">/ 目安{target}人（最低{min}人）</span>
      </div>
      <div className="exp-meter-bar">
        <span style={{ width: `${pct}%` }} />
        <i style={{ left: `${(min / target) * 100}%` }} />
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  signed,
  affordable,
  onSign,
  onRelease,
}: {
  candidate: ExpansionCandidate;
  signed: boolean;
  affordable: boolean;
  onSign: () => void;
  onRelease: () => void;
}) {
  const p = candidate.player;
  return (
    <div className={`player-card exp-row${signed ? ' signed' : ''}`}>
      <PlayerVisualSmall player={p} className="portrait-row" />
      <PositionBadge player={p} />
      <div className="exp-row-main">
        <div className="exp-row-name">
          <strong>{p.name}</strong>
          <span className="meta">
            {p.age}歳・{POSITION_LABELS[p.mainPosition]}
          </span>
          <span className="exp-pot">将来性 {potentialLabel(p.ext.potential)}</span>
        </div>
        <span className="pc-chips">
          <AbilitySummary player={p} />
        </span>
        <div className="exp-row-money">
          契約金 <b>{formatSalary(candidate.bonus)}</b>・年俸 {formatSalary(candidate.salary)}・{candidate.years}年
        </div>
      </div>
      {signed ? (
        <button type="button" className="btn secondary exp-btn" onClick={onRelease}>
          取消
        </button>
      ) : (
        <button type="button" className="btn primary exp-btn" disabled={!affordable} onClick={onSign}>
          契約
        </button>
      )}
    </div>
  );
}
