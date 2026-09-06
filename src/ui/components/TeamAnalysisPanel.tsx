/**
 * PHASE 4.1 球団画面の「チーム戦力分析」。
 * 分析そのものは domain/teamAnalysis.ts が決める。ここは並べるだけ。
 */
import { useMemo, useState } from 'react';
import { Sec } from './Sec';
import { TEAM_STATUS_LABELS, type TeamStatus } from '../../domain/teamAnalysis';
import { buildTeamReport, type ReinforcementPlan } from '../../domain/teamReport';
import type { GmDeskLink } from '../../domain/gmDesk';
import type { DepthSlot } from '../../domain/rosterAnalysis';
import { useGame } from '../store';
import { AxisBar, RadarChart, Stars } from './charts';
import type { RadarAxis } from '../../domain/playerAnalysis';

/*
 * 状態の色。design.md のトークンだけを使う（生の16進数は書かない）。
 * 色だけで良し悪しを表さないよう、必ずラベルの文字と一緒に出す（§22）。
 */
const STATUS_COLORS: Record<TeamStatus, string> = {
  GOOD: 'var(--grass)',
  STABLE: 'var(--ink-2)',
  CAUTION: 'var(--brass)',
  RISK: 'var(--accent)',
};

const SLOT_LABELS: Record<DepthSlot, string> = {
  STARTER: '1軍主力',
  BACKUP: '1軍候補',
  DEPTH: '2軍',
  PROSPECT: '育成',
};

export function TeamAnalysisPanel() {
  const { state, setScreen, showFA } = useGame();
  const teamId = state.playerTeamId;
  const report = useMemo(() => buildTeamReport(state, teamId), [state, teamId]);
  const analysis = report.analysis;
  const [openPosition, setOpenPosition] = useState<string | null>(null);

  /** 補強の選択肢から、実際に手を打てる画面へ移る。移るだけで何も決めない */
  const openLink = (link: GmDeskLink) => {
    if (link === 'fa') showFA();
    else setScreen(link);
  };

  // チームの軸をレーダーチャートに載せる（将来予測レンジは使わない）
  const radar: RadarAxis[] = analysis.axes.map((axis) => ({
    key: axis.key,
    label: axis.label,
    value: axis.value,
    projected: null,
  }));

  return (
    <>
      <div className="card">
        <Sec en="CLUB REPORT" ja="球団レポート" size="lead" />
        <div className="spread">
          <span
            className="chip on"
            style={{
              background: STATUS_COLORS[analysis.status],
              borderColor: STATUS_COLORS[analysis.status],
              color: 'var(--accent-ink)',
            }}
          >
            {TEAM_STATUS_LABELS[analysis.status]}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {analysis.counts.total}人（1軍 {analysis.counts.firstTeam}人）
          </span>
        </div>
        <p className="analysis-reason">{analysis.statusReason}</p>
      </div>

      <div className="card">
        <Sec en="TEAM STRENGTH" ja="チーム戦力" />
        <RadarChart axes={radar} animationKey={`team:${teamId}`} showProjection={false} />
        {analysis.axes.map((axis) => (
          <AxisBar
            key={axis.key}
            label={axis.label}
            value={axis.value}
            vsLeague={axis.vsLeague}
            animationKey={`team:${teamId}`}
          />
        ))}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          右の数字はリーグ平均との差です。
        </div>
      </div>

      {/* ── 現在の課題（§12）。番号を振り、なぜ課題なのかまで書く ── */}
      <div className="card">
        <Sec en="TEAM REPORT" ja="現在の課題" size="lead" />
        {report.issues.length === 0 ? (
          <p className="muted">目立った課題はありません。</p>
        ) : (
          <ol className="issue-details">
            {report.issues.map((issue) => (
              <li key={issue.id} className={`issue-detail sev-${issue.severity}`}>
                <div className="issue-detail-head">
                  <span className="issue-detail-no">{issue.no}</span>
                  <div className="issue-detail-name">
                    <span className="label">{issue.en}</span>
                    <span className="issue-detail-ja">{issue.ja}</span>
                  </div>
                </div>
                <div className="issue-part">
                  <span className="label">WHY</span>
                  <span className="issue-part-ja">なぜ課題なのか</span>
                  <p className="issue-text">{issue.why}</p>
                </div>
                {issue.data.length > 0 && (
                  <dl className="issue-data">
                    {issue.data.map((datum, i) => (
                      <div key={i} className="issue-data-row">
                        <dt>{datum.label}</dt>
                        <dd>{datum.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── 補強の道すじ（§13）。正解は出さない ── */}
      {report.plans.length > 0 && (
        <div className="card">
          <Sec en="CONSIDER" ja="検討できること" />
          <p className="consider-lead">
            どれを選んでも失うものがあります。ここでは決まりません。
          </p>
          {report.plans.map((plan) => (
            <PlanBlock key={plan.id} plan={plan} onOpen={openLink} />
          ))}
        </div>
      )}

      <div className="card">
        <Sec en="DEPTH CHART" ja="ポジション別の層" />
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          上から順に能力が高い選手です。タップすると全員を表示します。
        </div>
        {analysis.depth.map((column) => {
          const open = openPosition === column.key;
          const shown = open ? column.entries : column.entries.slice(0, 3);
          return (
            <div key={column.key} className="depth-col">
              <button
                className="depth-head"
                onClick={() => setOpenPosition(open ? null : column.key)}
              >
                <span className="depth-key">{column.label}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {column.entries.length}人 / 必要{column.required}人
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {open ? '閉じる' : '詳しく'}
                </span>
              </button>
              {shown.length === 0 && <div className="muted">該当する選手がいません。</div>}
              {shown.map((entry) => (
                <div key={entry.playerId} className="depth-row">
                  <span className={`depth-slot slot-${entry.slot.toLowerCase()}`}>
                    {SLOT_LABELS[entry.slot]}
                  </span>
                  <span className="depth-name">
                    {entry.name}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      {entry.age}歳
                    </span>
                  </span>
                  <Stars value={entry.overall / 20} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="card">
        <Sec en="ROSTER BREAKDOWN" ja="選手層の内訳" size="sub" />
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">先発</span>
          <span style={{ fontWeight: 700 }}>{analysis.counts.starters}人</span>
        </div>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">リリーフ</span>
          <span style={{ fontWeight: 700 }}>{analysis.counts.relievers}人</span>
        </div>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">野手</span>
          <span style={{ fontWeight: 700 }}>{analysis.counts.fielders}人</span>
        </div>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">25歳以下 / 31歳以上</span>
          <span style={{ fontWeight: 700 }}>
            {analysis.counts.young}人 / {analysis.counts.veteran}人
          </span>
        </div>
      </div>
    </>
  );
}

/** 補強ポイントひとつ（§13：WHY / DATA / OPTIONS / COST / RISK） */
function PlanBlock({
  plan,
  onOpen,
}: {
  plan: ReinforcementPlan;
  onOpen: (link: GmDeskLink) => void;
}) {
  return (
    <section className="plan">
      <div className="plan-head">
        <span className="label">{plan.en}</span>
        <span className="plan-ja">{plan.ja}</span>
      </div>
      <div className="issue-part">
        <span className="label">WHY</span>
        <span className="issue-part-ja">なぜ必要なのか</span>
        <p className="issue-text">{plan.why}</p>
      </div>
      <dl className="issue-data">
        {plan.data.map((datum, i) => (
          <div key={i} className="issue-data-row">
            <dt>{datum.label}</dt>
            <dd>{datum.value}</dd>
          </div>
        ))}
      </dl>
      <div className="issue-part">
        <span className="label">OPTIONS</span>
        <span className="issue-part-ja">手だて</span>
      </div>
      {plan.options.map((option) => (
        <div key={option.route} className="plan-option">
          <div className="plan-option-head">
            <span className="label">{option.en}</span>
            <span className="plan-option-ja">{option.ja}</span>
          </div>
          <p className="plan-option-text">{option.merit}</p>
          <div className="plan-tradeoff">
            <div>
              <span className="label">COST</span>
              <span className="plan-tradeoff-text">{option.cost}</span>
            </div>
            <div>
              <span className="label">RISK</span>
              <span className="plan-tradeoff-text">{option.risk}</span>
            </div>
          </div>
          {option.link && (
            <button className="linky" onClick={() => onOpen(option.link!)}>
              {option.ja}画面へ
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
