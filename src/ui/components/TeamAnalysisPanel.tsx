/**
 * PHASE 4.1 球団画面の「チーム戦力分析」。
 * 分析そのものは domain/teamAnalysis.ts が決める。ここは並べるだけ。
 */
import { useMemo, useState } from 'react';
import {
  analyzeTeamForDisplay,
  TEAM_STATUS_LABELS,
  type TeamStatus,
} from '../../domain/teamAnalysis';
import type { DepthSlot } from '../../domain/rosterAnalysis';
import { useGame } from '../store';
import { AxisBar, RadarChart, Stars } from './charts';
import type { RadarAxis } from '../../domain/playerAnalysis';

const STATUS_COLORS: Record<TeamStatus, string> = {
  GOOD: 'var(--good)',
  STABLE: 'var(--accent-2)',
  CAUTION: 'var(--accent)',
  // 危険でも赤一色にはしない（§14：過度な警告表示を避ける）
  RISK: '#e07a7a',
};

const SLOT_LABELS: Record<DepthSlot, string> = {
  STARTER: '1軍主力',
  BACKUP: '1軍候補',
  DEPTH: '2軍',
  PROSPECT: '育成',
};

export function TeamAnalysisPanel() {
  const { state } = useGame();
  const teamId = state.playerTeamId;
  const analysis = useMemo(() => analyzeTeamForDisplay(state, teamId), [state, teamId]);
  const [openPosition, setOpenPosition] = useState<string | null>(null);

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
        <h2>チーム状態</h2>
        <div className="spread">
          <span className="chip on" style={{ background: STATUS_COLORS[analysis.status], color: '#10151c' }}>
            {TEAM_STATUS_LABELS[analysis.status]}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {analysis.counts.total}人（1軍 {analysis.counts.firstTeam}人）
          </span>
        </div>
        <p className="analysis-reason">{analysis.statusReason}</p>
      </div>

      <div className="card">
        <h2>チーム戦力分析</h2>
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

      <div className="card">
        <h2>現在の課題</h2>
        {analysis.issues.length === 0 ? (
          <p className="muted">目立った課題はありません。</p>
        ) : (
          <ul className="issue-list">
            {analysis.issues.map((issue) => (
              <li key={issue.id} className={`issue sev-${issue.severity}`}>
                {issue.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>ポジション別の層</h2>
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
        <h2>選手層の内訳</h2>
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
