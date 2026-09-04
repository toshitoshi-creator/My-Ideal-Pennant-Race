import { useState } from 'react';
import { useGame } from '../store';
import { TeamAnalysisPanel } from '../components/TeamAnalysisPanel';
import { Tabs } from '../components/common';
import {
  DIRECTIONS,
  DIRECTION_DESCRIPTIONS,
  DIRECTION_LABELS,
  FACILITY_DESCRIPTIONS,
  FACILITY_KINDS,
  FACILITY_LABELS,
  IDENTITY_LABELS,
  MAX_FACILITY_LEVEL,
  USAGE_LABELS,
  USAGE_ROLES,
  canUpgradeFacility,
  clubRating,
  objectiveText,
  pendingEvents,
  resolveEvent,
  setDirection,
  setUsageRole,
  upgradeFacility,
  usageRoleOf,
} from '../../domain/club';
import { formatSalary } from '../../domain/contract';
import { overallRating } from '../../domain/rating';
import type { ClubDirection, FacilityKind, UsageRole } from '../../domain/types';

type Tab = 'overview' | 'analysis' | 'facility' | 'usage';

/** 球団経営の画面（PHASE 4.0） */
export function ClubScreen() {
  const { state } = useGame();
  const [tab, setTab] = useState<Tab>('overview');
  const club = state.clubs?.[state.playerTeamId];
  if (!club) return null;

  return (
    <>
      <Tabs
        tabs={[
          { id: 'overview', label: '球団' },
          { id: 'analysis', label: '分析' },
          { id: 'facility', label: '施設' },
          { id: 'usage', label: '起用' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen">
        {tab === 'overview' && <Overview />}
        {tab === 'analysis' && <TeamAnalysisPanel />}
        {tab === 'facility' && <Facilities />}
        {tab === 'usage' && <Usage />}
      </div>
    </>
  );
}

function Overview() {
  const { state, mutate, showToast } = useGame();
  const teamId = state.playerTeamId;
  const club = state.clubs[teamId];
  const rating = clubRating(state, teamId);
  const events = pendingEvents(state);

  const choose = (direction: ClubDirection) => {
    mutate((draft) => setDirection(draft, teamId, direction));
    showToast(`今季の方針を「${DIRECTION_LABELS[direction]}」にしました`);
  };

  return (
    <>
      <div className="card">
        <h2>今季の方針</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              className={d === club.direction ? 'btn primary' : 'btn'}
              style={{ textAlign: 'left', padding: '10px 12px' }}
              onClick={() => choose(d)}
            >
              <div style={{ fontWeight: 800 }}>{DIRECTION_LABELS[d]}</div>
              <div
                className={d === club.direction ? '' : 'muted'}
                style={{ fontSize: 12, fontWeight: 400 }}
              >
                {DIRECTION_DESCRIPTIONS[d]}
              </div>
            </button>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          方針は起用の優先度・補強の動き・若手の成長環境に効きます。能力そのものは変わりません。
        </div>
      </div>

      <div className="card">
        <h2>球団評価</h2>
        <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 6 }}>
          {rating.total}
          <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> / 100</span>
        </div>
        <Bar label="戦力" value={rating.strength} />
        <Bar label="将来性" value={rating.future} />
        <Bar label="財務" value={rating.finance} />
        <Bar label="育成" value={rating.development} />
        <Bar label="経営" value={rating.management} />
        <div className="spread" style={{ marginTop: 8 }}>
          <span className="muted">球団の色</span>
          <span className="chip">{IDENTITY_LABELS[club.identity]}</span>
        </div>
        <div className="spread">
          <span className="muted">チーム士気</span>
          <span style={{ fontWeight: 700 }}>{Math.round(state.teamMorale[teamId] ?? 50)}</span>
        </div>
      </div>

      <div className="card">
        <h2>今季の経営目標</h2>
        {club.objectives.length === 0 ? (
          <p className="muted">まだ目標はありません。オフシーズンに立てられます。</p>
        ) : (
          club.objectives.map((o, i) => (
            <div key={i} className="spread" style={{ padding: '5px 0' }}>
              <span>{objectiveText(o)}</span>
              <span className="chip">
                {o.achieved === null ? '挑戦中' : o.achieved ? '達成' : '未達'}
              </span>
            </div>
          ))
        )}
        <div className="spread" style={{ marginTop: 6 }}>
          <span className="muted">これまでの達成</span>
          <span style={{ fontWeight: 700 }}>{club.achieved}件</span>
        </div>
      </div>

      {events.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>判断が必要です</h2>
          {events.map((event) => (
            <div key={event.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 800 }}>{event.title}</div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                {event.body}
              </div>
              {event.choices.length === 0 ? (
                <button
                  className="btn secondary"
                  onClick={() =>
                    mutate((draft) => void resolveEvent(draft, event.id, 'ok'))
                  }
                >
                  確認した
                </button>
              ) : (
                event.choices.map((choice) => (
                  <button
                    key={choice.id}
                    className="btn secondary"
                    style={{ marginBottom: 6, textAlign: 'left', padding: '9px 12px' }}
                    onClick={() => {
                      mutate((draft) => void resolveEvent(draft, event.id, choice.id));
                      showToast(`「${choice.label}」を選びました`);
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{choice.label}</div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      {choice.description}
                    </div>
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="ability">
      <span className="label">{label}</span>
      <span className="bar">
        <span
          style={{
            width: `${Math.max(3, Math.min(100, value))}%`,
            background: value >= 70 ? 'var(--good)' : value >= 45 ? 'var(--accent)' : 'var(--bad)',
          }}
        />
      </span>
      <span className="val">{value}</span>
    </div>
  );
}

function Facilities() {
  const { state, mutate, showToast } = useGame();
  const teamId = state.playerTeamId;
  const club = state.clubs[teamId];
  const cash = state.finances[teamId]?.cash ?? 0;

  const buy = (kind: FacilityKind) => {
    const check = canUpgradeFacility(state, teamId, kind);
    if (!check.ok) {
      showToast(check.reason ?? '投資できません');
      return;
    }
    mutate((draft) => {
      if (upgradeFacility(draft, teamId, kind)) {
        showToast(`${FACILITY_LABELS[kind]}を強化しました`);
      }
    });
  };

  return (
    <>
      <div className="card">
        <div className="spread">
          <span className="muted">球団資金</span>
          <span style={{ fontSize: 18, fontWeight: 800 }}>{formatSalary(cash)}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          補強に使うか、施設に投資するか。施設は長い目で効いてきます。
        </div>
      </div>
      {FACILITY_KINDS.map((kind) => {
        const level = club.facilities[kind];
        const check = canUpgradeFacility(state, teamId, kind);
        return (
          <div className="card" key={kind}>
            <div className="spread" style={{ marginBottom: 6 }}>
              <strong>{FACILITY_LABELS[kind]}</strong>
              <span className="chip">Lv {level}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {Array.from({ length: MAX_FACILITY_LEVEL }, (_unused, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    background: i < level ? 'var(--accent)' : 'var(--card-2)',
                  }}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {FACILITY_DESCRIPTIONS[kind]}
            </div>
            <button
              className={check.ok ? 'btn primary' : 'btn'}
              disabled={!check.ok}
              onClick={() => buy(kind)}
            >
              {level >= MAX_FACILITY_LEVEL
                ? '最高段階です'
                : `Lv${level + 1}へ強化（${formatSalary(check.cost)}）`}
            </button>
            {!check.ok && check.reason && level < MAX_FACILITY_LEVEL && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {check.reason}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Usage() {
  const { state, mutate } = useGame();
  const teamId = state.playerTeamId;
  const roster = state.players
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => overallRating(b) - overallRating(a));

  return (
    <div className="card">
      <h2>選手の起用方針</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        出場機会の優先度が変わります。指定しても能力そのものは変わりません。
        怪我をしている選手は自動的に外れます。
      </div>
      {roster.map((player) => {
        const role = usageRoleOf(state, player);
        return (
          <div
            key={player.id}
            style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}
          >
            <div className="spread" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 700 }}>
                {player.name}
                <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  {' '}
                  {player.age}歳 総合{overallRating(player)}
                </span>
              </span>
              {player.ext.injury && <span className="chip">離脱中</span>}
            </div>
            <div className="scroll-x">
              <div style={{ display: 'flex', gap: 5 }}>
                {USAGE_ROLES.map((r) => (
                  <button
                    key={r}
                    className={r === role ? 'chip on' : 'chip'}
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() =>
                      mutate((draft) => setUsageRole(draft, player.id, r as UsageRole))
                    }
                  >
                    {USAGE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
