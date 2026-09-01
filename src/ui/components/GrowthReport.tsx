import type { GrowthReport } from '../../domain/types';
import { Sheet } from './common';
import { rankOf } from '../../domain/rank';

/**
 * シーズン終了時の成長・衰退の演出（PHASE 2）。
 * 能力が変化した選手だけを、変化の大きい順に表示する。
 */
export function GrowthReportSheet({
  report,
  onClose,
}: {
  report: GrowthReport;
  onClose: () => void;
}) {
  const changed = report.players.filter((p) => p.changes.length > 0);
  const grown = changed.filter((p) => p.total > 0);
  const declined = changed.filter((p) => p.total <= 0);

  return (
    <Sheet title={`${report.year}年 シーズンを終えて`} onClose={onClose}>
      {changed.length === 0 && <div className="muted">能力が変化した選手はいませんでした。</div>}

      {grown.length > 0 && (
        <div className="card">
          <h2>成長した選手</h2>
          {grown.map((entry) => (
            <PlayerGrowth key={entry.playerId} entry={entry} />
          ))}
        </div>
      )}

      {declined.length > 0 && (
        <div className="card">
          <h2>能力が下がった選手</h2>
          {declined.map((entry) => (
            <PlayerGrowth key={entry.playerId} entry={entry} declining />
          ))}
        </div>
      )}
    </Sheet>
  );
}

function PlayerGrowth({
  entry,
  declining,
}: {
  entry: GrowthReport['players'][number];
  declining?: boolean;
}) {
  const maxGain = entry.changes.reduce(
    (max, c) => Math.max(max, c.after - c.before),
    0,
  );
  const big = entry.awakened || maxGain >= 5 || entry.total >= 16;
  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div className="spread">
        <strong style={{ fontSize: 16 }}>
          {entry.name}
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
            {' '}
            {entry.ageBefore}歳 → {entry.ageAfter}歳
          </span>
        </strong>
        {entry.awakened && (
          <span className="chip" style={{ background: 'var(--accent)', color: '#241a00' }}>
            覚醒！
          </span>
        )}
      </div>

      {big && !declining && (
        <div style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 14, margin: '4px 0' }}>
          大きく成長しました！
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
        {entry.changes.map((change) => {
          const up = change.after > change.before;
          const rankBefore = rankOf(change.before);
          const rankAfter = rankOf(change.after);
          return (
            <span key={change.label} style={{ fontSize: 13 }}>
              <span className="muted">{change.label} </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {change.before} → {change.after}
              </span>
              <span style={{ color: up ? 'var(--good)' : 'var(--bad)', fontWeight: 800 }}>
                {' '}
                {up ? '↑' : '↓'}
              </span>
              {rankBefore !== rankAfter && (
                <span style={{ color: up ? 'var(--good)' : 'var(--bad)', fontWeight: 800 }}>
                  {' '}
                  {rankBefore}→{rankAfter}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {declining && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {entry.name}選手の能力が低下しました。
        </div>
      )}
    </div>
  );
}
