import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { DraftProspect, ScoutCategory, ScoutReport } from '../../domain/types';
import { availableProspects, currentPick } from '../../domain/draft';
import { RevealRows } from '../components/Reveal';
import { POSITION_LABELS, POSITION_SHORT } from '../../domain/positions';
import {
  SCOUT_CATEGORIES,
  SCOUT_CATEGORY_LABELS,
  SCOUT_COST,
  abilityRangeText,
  confidenceLabel,
  overallProgress,
  viewReport,
  scoutAbilitySummary,
  SCOUT_ABILITY_LABELS,
} from '../../domain/scouting';
import { Sheet } from '../components/common';

type Filter = 'all' | 'pitcher' | 'fielder' | 'scouted';

/**
 * ドラフト会議（PHASE 3.1）＋スカウト（PHASE 3.2）。
 *
 * 表示するのはすべて「その球団が調査して得た推定情報」であり、
 * 選手の真の能力値・潜在能力・性格・特殊能力は一切表示しない。
 */
export function DraftScreen() {
  const { state, draftPick, startContracts, startDraftPicks } = useGame();
  const draft = state.draft!;
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DraftProspect | null>(null);

  const slot = currentPick(draft);
  const scoutingPhase = draft.phase === 'scouting';
  const myTurn = !scoutingPhase && slot?.teamId === state.playerTeamId;
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const scouting = state.scouting.teams[state.playerTeamId];
  const myPicks = draft.picks.filter((p) => p.teamId === state.playerTeamId);
  const latestPick = myPicks.length > 0 ? myPicks[myPicks.length - 1] : null;
  const latestProspect = latestPick
    ? (draft.prospects.find((p) => p.id === latestPick.prospectId) ?? null)
    : null;

  // 表示用の調査結果（未調査でも初期状態のレポートを作る）
  const reports = useMemo(() => {
    const map = new Map<string, ScoutReport>();
    for (const prospect of draft.prospects) {
      map.set(prospect.id, viewReport(state.scouting, state.playerTeamId, prospect));
    }
    return map;
  }, [draft.prospects, state.scouting, state.playerTeamId]);

  const prospects = useMemo(() => {
    const list = availableProspects(draft);
    const filtered =
      filter === 'pitcher'
        ? list.filter((p) => p.player.isPitcher)
        : filter === 'fielder'
          ? list.filter((p) => !p.player.isPitcher)
          : filter === 'scouted'
            ? list.filter((p) => overallProgress(reports.get(p.id)!) > 5)
            : list;
    return filtered.sort((a, b) => a.draftRank - b.draftRank).slice(0, 60);
  }, [draft, filter, reports]);

  const draftLog = state.notices.filter((n) => n.kind === 'draft').slice(-8).reverse();
  const detailProspect = detail ? draft.prospects.find((p) => p.id === detail) : null;

  return (
    <div className="app" style={{ paddingBottom: 20 }}>
      <div className="appbar">
        <div>
          <h1>{draft.year}年 ドラフト会議</h1>
          <div className="sub">
            {scoutingPhase ? 'スカウト期間' : `全${draft.rounds}巡`} / {team.name}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 11 }}>
            調査ポイント
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--accent)' }}>
            {scouting.points}
          </div>
        </div>
      </div>

      <div className="screen">
        {scoutingPhase ? (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>スカウト期間</h2>
            <div className="muted" style={{ marginBottom: 10 }}>
              候補をタップして調査します。ポイントは有限なので、誰を重点的に調べるかが勝負です。
              調査を終えたらドラフト会議を始めてください。
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {(Object.keys(SCOUT_ABILITY_LABELS) as Array<keyof typeof SCOUT_ABILITY_LABELS>).map(
                (key) => (
                  <span key={key} className="chip" style={{ fontSize: 11 }}>
                    {SCOUT_ABILITY_LABELS[key]} {scouting.ability[key]}
                  </span>
                ),
              )}
              <span className="chip" style={{ fontSize: 11, color: 'var(--accent)' }}>
                スカウト総合 {scoutAbilitySummary(scouting.ability)}
              </span>
            </div>
            <button className="btn primary" onClick={() => startDraftPicks()}>
              ドラフト会議を始める
            </button>
          </div>
        ) : (
          <div className="card" style={{ borderColor: myTurn ? 'var(--accent)' : undefined }}>
            {slot ? (
              <>
                <div className="muted">
                  第{slot.round}巡 {slot.pick}番目
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                  {myTurn
                    ? 'あなたの球団の指名です'
                    : `${state.teams.find((t) => t.id === slot.teamId)?.name} が指名中…`}
                </div>
                {myTurn && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    残り候補 {availableProspects(draft).length}人
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 800 }}>ドラフト終了</div>
                <div className="muted" style={{ marginTop: 4, marginBottom: 10 }}>
                  指名した選手は新人契約を結び、2軍からのスタートになります。
                </div>
                <button className="btn primary" onClick={() => startContracts()}>
                  契約更改へ
                </button>
              </>
            )}
          </div>
        )}

        {/* PHASE 4.1: 直近の指名を球団→巡目→選手→評価の順に見せる（スキップ可） */}
        {latestPick && latestProspect && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>指名</h2>
            <RevealRows
              animationKey={`${latestPick.round}-${latestPick.pick}-${latestPick.prospectId}`}
              intervalMs={240}
              rows={[
                { label: '球団', value: team.name },
                { label: '指名順', value: `${latestPick.round}巡 ${latestPick.pick}番目` },
                { label: '選手', value: latestProspect.player.name },
                {
                  label: 'ポジション',
                  value: `${POSITION_LABELS[latestProspect.player.mainPosition]} / ${latestProspect.player.age}歳`,
                },
                {
                  label: 'スカウト評価',
                  value: (() => {
                    // 調査済みの推定だけを見せる。真の潜在能力は使わない
                    const report = scouting?.reports[latestProspect.id];
                    if (!report) return '未調査';
                    return `現在 ${report.estimate.abilityLow}〜${report.estimate.abilityHigh} / 将来 ${report.estimate.potential ?? '未調査'}`;
                  })(),
                },
                { label: '', value: '指名決定', emphasis: true },
              ]}
            />
          </div>
        )}

        {myPicks.length > 0 && (
          <div className="card">
            <h2>{team.name}の指名</h2>
            {myPicks.map((pick) => {
              const prospect = draft.prospects.find((p) => p.id === pick.prospectId);
              if (!prospect) return null;
              return (
                <div key={`${pick.round}-${pick.pick}`} className="spread" style={{ padding: '6px 0' }}>
                  <span>
                    <strong style={{ color: 'var(--accent)' }}>{pick.round}巡目</strong>{' '}
                    {prospect.player.name}
                  </span>
                  <span className="muted">
                    {POSITION_LABELS[prospect.player.mainPosition]} / {prospect.player.age}歳
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {draftLog.length > 0 && (
          <div className="card">
            <h2>指名の経過</h2>
            {draftLog.map((notice, i) => (
              <div key={i} style={{ padding: '4px 0', fontSize: 14 }}>
                {notice.message}
              </div>
            ))}
          </div>
        )}

        {(scoutingPhase || slot) && (
          <>
            <div className="tabs" style={{ padding: '0 0 10px' }}>
              {(
                [
                  { id: 'all', label: '全候補' },
                  { id: 'pitcher', label: '投手' },
                  { id: 'fielder', label: '野手' },
                  { id: 'scouted', label: '調査済み' },
                ] as Array<{ id: Filter; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  className={filter === tab.id ? 'on' : ''}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {prospects.length === 0 && (
              <div className="muted">該当する候補がいません。</div>
            )}
            {prospects.map((prospect) => (
              <ProspectCard
                key={prospect.id}
                prospect={prospect}
                report={reports.get(prospect.id)!}
                onOpen={() => setDetail(prospect.id)}
                onPick={myTurn ? () => setConfirming(prospect) : undefined}
              />
            ))}
          </>
        )}
      </div>

      {detailProspect && (
        <ProspectDetail
          prospect={detailProspect}
          report={reports.get(detailProspect.id)!}
          canPick={myTurn}
          onPick={() => {
            setDetail(null);
            setConfirming(detailProspect);
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {confirming && (
        <Sheet title="指名の確認" onClose={() => setConfirming(null)}>
          <div className="card">
            <div style={{ fontSize: 17, fontWeight: 800 }}>{confirming.player.name}</div>
            <div className="muted">
              {POSITION_LABELS[confirming.player.mainPosition]} / {confirming.player.age}歳 /{' '}
              推定能力 {abilityRangeText(reports.get(confirming.id)!)}
            </div>
            <div style={{ marginTop: 10, fontSize: 15 }}>
              {confirming.player.name}選手を指名しますか？
            </div>
          </div>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setConfirming(null)}>
              やめる
            </button>
            <button
              className="btn primary"
              onClick={() => {
                draftPick(confirming.id);
                setConfirming(null);
              }}
            >
              指名する
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 44,
        height: 6,
        borderRadius: 3,
        background: '#202a37',
        overflow: 'hidden',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'block',
          height: '100%',
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: value >= 100 ? 'var(--good)' : 'var(--accent-2)',
        }}
      />
    </span>
  );
}

function ProspectCard({
  prospect,
  report,
  onOpen,
  onPick,
}: {
  prospect: DraftProspect;
  report: ScoutReport;
  onOpen: () => void;
  onPick?: () => void;
}) {
  const player = prospect.player;
  const progress = overallProgress(report);

  return (
    <div className="player-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <button
        className="row"
        style={{ textAlign: 'left', width: '100%', gap: 10 }}
        onClick={onOpen}
      >
        <span className="pos">{POSITION_SHORT[player.mainPosition]}</span>
        <span className="grow">
          <span className="row" style={{ gap: 6 }}>
            <span className="name">{player.name}</span>
            <span className="meta">{player.age}歳</span>
            <span className="chip" style={{ fontSize: 11 }}>
              下馬評{prospect.draftRank}位
            </span>
          </span>
          <span className="meta">
            {POSITION_LABELS[player.mainPosition]} / 推定能力 {abilityRangeText(report)}
          </span>
        </span>
        <span style={{ textAlign: 'right' }}>
          <span className="meta" style={{ display: 'block', fontSize: 10 }}>
            将来性
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: report.estimate.potential ? 'var(--accent)' : 'var(--text-dim)',
            }}
          >
            {report.estimate.potential ?? '未調査'}
          </span>
        </span>
      </button>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 11 }}>
          調査 {progress}%
        </span>
        <ProgressBar value={progress} />
        {report.estimate.skills.slice(0, 2).map((skill, i) => (
          <span
            key={i}
            className="chip"
            style={{
              fontSize: 11,
              color: skill.polarity === 'positive' ? 'var(--good)' : 'var(--bad)',
            }}
          >
            {skill.text}
          </span>
        ))}
      </div>

      {onPick && (
        <button className="btn primary" style={{ padding: '11px 12px' }} onClick={onPick}>
          この選手を指名
        </button>
      )}
    </div>
  );
}

function ProspectDetail({
  prospect,
  report,
  canPick,
  onPick,
  onClose,
}: {
  prospect: DraftProspect;
  report: ScoutReport;
  canPick: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const { state, scout } = useGame();
  const scouting = state.scouting.teams[state.playerTeamId];
  const player = prospect.player;
  const positives = report.estimate.skills.filter((s) => s.polarity === 'positive');
  const negatives = report.estimate.skills.filter((s) => s.polarity === 'negative');

  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{player.name}</div>
            <div className="muted">
              {player.age}歳 / {POSITION_LABELS[player.mainPosition]} /{' '}
              {player.throws === 'R' ? '右' : '左'}投{player.bats === 'R' ? '右' : '左'}打
            </div>
          </div>
          <span className="chip">下馬評 {prospect.draftRank}位</span>
        </div>
      </div>

      <div className="card">
        <h2>調査結果</h2>
        <ReportRow
          label="現在能力"
          value={abilityRangeText(report)}
          confidence={report.accuracy.currentAbility}
        />
        <ReportRow
          label="将来性"
          value={report.estimate.potential ?? '未調査'}
          confidence={report.accuracy.potential}
          unknown={!report.estimate.potential}
          highlight
        />
        <ReportRow
          label="成長タイプ"
          value={report.estimate.growthType ?? '未調査'}
          confidence={report.accuracy.personality}
          unknown={!report.estimate.growthType}
        />
        <ReportRow
          label="性格"
          value={report.estimate.personality ?? '未調査'}
          confidence={report.accuracy.personality}
          unknown={!report.estimate.personality}
        />
      </div>

      <div className="card">
        <h2>素質・弱点</h2>
        {report.estimate.skills.length === 0 && (
          <div className="muted">
            {report.progress.skills > 0
              ? '目立った特徴は見つかっていません。'
              : 'まだ調査していません。'}
          </div>
        )}
        {positives.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              素質
            </div>
            {positives.map((skill, i) => (
              <div key={i} style={{ color: 'var(--good)', fontWeight: 700, fontSize: 14 }}>
                ・{skill.text}
              </div>
            ))}
          </div>
        )}
        {negatives.length > 0 && (
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              不安要素
            </div>
            {negatives.map((skill, i) => (
              <div key={i} style={{ color: 'var(--bad)', fontWeight: 700, fontSize: 14 }}>
                ・{skill.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>調査する</h2>
          <span className="muted">残り {scouting.points} ポイント</span>
        </div>
        {SCOUT_CATEGORIES.map((category) => {
          const progress = report.progress[category];
          const cost = SCOUT_COST[category];
          const done = progress >= 100;
          const affordable = scouting.points >= cost;
          return (
            <div key={category} className="spread" style={{ padding: '7px 0' }}>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {SCOUT_CATEGORY_LABELS[category]}
                </span>
                <span className="row" style={{ gap: 6, marginTop: 2 }}>
                  <ProgressBar value={progress} />
                  <span className="muted" style={{ fontSize: 11 }}>
                    {progress}%
                  </span>
                </span>
              </span>
              <button
                className="chip"
                style={{
                  padding: '10px 12px',
                  background: done || !affordable ? '#2b3646' : 'var(--accent)',
                  color: done || !affordable ? 'var(--text-dim)' : '#241a00',
                }}
                disabled={done || !affordable}
                onClick={() => scout(prospect.id, category as ScoutCategory)}
              >
                {done ? '完了' : `調査 ${cost}pt`}
              </button>
            </div>
          );
        })}
        {scouting.points <= 0 && (
          <div style={{ color: 'var(--bad)', fontSize: 13, marginTop: 8, fontWeight: 700 }}>
            今季の調査ポイントを使い切りました
          </div>
        )}
      </div>

      {canPick && (
        <button className="btn primary" onClick={onPick}>
          この選手を指名する
        </button>
      )}
    </Sheet>
  );
}

function ReportRow({
  label,
  value,
  confidence,
  unknown,
  highlight,
}: {
  label: string;
  value: string;
  confidence: number;
  unknown?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span
          style={{
            fontWeight: 700,
            color: unknown
              ? 'var(--text-dim)'
              : highlight
                ? 'var(--accent)'
                : 'var(--text)',
          }}
        >
          {value}
        </span>
        {!unknown && (
          <span className="muted" style={{ display: 'block', fontSize: 11 }}>
            信頼度 {confidenceLabel(confidence)}
          </span>
        )}
      </span>
    </div>
  );
}
