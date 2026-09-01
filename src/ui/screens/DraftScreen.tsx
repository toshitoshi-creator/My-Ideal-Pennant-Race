import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { DraftProspect } from '../../domain/types';
import { availableProspects, currentPick } from '../../domain/draft';
import { POSITION_LABELS, POSITION_SHORT } from '../../domain/positions';
import { overallRating } from '../../domain/rating';
import { personalityDef } from '../../domain/personality';
import { specialAbilityDef } from '../../domain/specialAbilities';
import { RankBadge, Sheet } from '../components/common';

type Filter = 'all' | 'pitcher' | 'fielder';

/**
 * ドラフト会議（PHASE 3.1）。
 * 潜在能力の実数値は表示せず「将来性」ラベルだけを見せる。
 * （PHASE 3.2 でスカウト精度によって精度を変える予定）
 */
export function DraftScreen() {
  const { state, draftPick, finishOffseason } = useGame();
  const draft = state.draft!;
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState<DraftProspect | null>(null);

  const slot = currentPick(draft);
  const myTurn = slot?.teamId === state.playerTeamId;
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const myPicks = draft.picks.filter((p) => p.teamId === state.playerTeamId);

  const prospects = useMemo(() => {
    const list = availableProspects(draft);
    const filtered =
      filter === 'pitcher'
        ? list.filter((p) => p.player.isPitcher)
        : filter === 'fielder'
          ? list.filter((p) => !p.player.isPitcher)
          : list;
    return filtered.sort((a, b) => a.draftRank - b.draftRank).slice(0, 60);
  }, [draft, filter]);

  const draftLog = state.notices.filter((n) => n.kind === 'draft').slice(-8).reverse();

  return (
    <div className="app" style={{ paddingBottom: 20 }}>
      <div className="appbar">
        <div>
          <h1>{draft.year}年 ドラフト会議</h1>
          <div className="sub">
            全{draft.rounds}巡 / {team.name}
          </div>
        </div>
      </div>

      <div className="screen">
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
                  候補を選んで指名してください。残り候補 {availableProspects(draft).length}人
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 800 }}>ドラフト終了</div>
              <div className="muted" style={{ marginTop: 4, marginBottom: 10 }}>
                指名した選手は2軍からのスタートです。
              </div>
              <button className="btn primary" onClick={() => finishOffseason()}>
                新シーズンへ
              </button>
            </>
          )}
        </div>

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

        {slot && (
          <>
            <div className="tabs" style={{ padding: '0 0 10px' }}>
              {(
                [
                  { id: 'all', label: '全候補' },
                  { id: 'pitcher', label: '投手' },
                  { id: 'fielder', label: '野手' },
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

            {prospects.map((prospect) => (
              <ProspectCard
                key={prospect.id}
                prospect={prospect}
                onPick={myTurn ? () => setConfirming(prospect) : undefined}
              />
            ))}
          </>
        )}
      </div>

      {confirming && (
        <Sheet title="指名の確認" onClose={() => setConfirming(null)}>
          <div className="card">
            <ProspectCard prospect={confirming} />
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

function ProspectCard({
  prospect,
  onPick,
}: {
  prospect: DraftProspect;
  onPick?: () => void;
}) {
  const player = prospect.player;
  const personality = personalityDef(player.ext.personality);
  const abilities = player.ext.specialAbilities
    .map((entry) => specialAbilityDef(entry.id))
    .filter((def): def is NonNullable<typeof def> => !!def);

  return (
    <div className="player-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row">
        <span className="pos">{POSITION_SHORT[player.mainPosition]}</span>
        <span className="grow">
          <span className="row" style={{ gap: 6 }}>
            <span className="name">{player.name}</span>
            <span className="meta">{player.age}歳</span>
            <span className="chip" style={{ fontSize: 11 }}>
              評価{prospect.draftRank}位
            </span>
          </span>
          <span className="meta">
            {POSITION_LABELS[player.mainPosition]} / {personality.name} /{' '}
            {player.throws === 'R' ? '右' : '左'}投{player.bats === 'R' ? '右' : '左'}打
          </span>
        </span>
        <span style={{ textAlign: 'center' }}>
          <span className="meta" style={{ display: 'block', fontSize: 10 }}>
            現在
          </span>
          <RankBadge value={overallRating(player)} />
        </span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="chip" style={{ fontSize: 11, color: 'var(--accent)' }}>
          将来性 {prospect.projectedPotential}
        </span>
        {abilities.map((def) => (
          <span
            key={def.id}
            className="chip"
            style={{
              fontSize: 11,
              color: def.polarity === 'positive' ? 'var(--good)' : 'var(--bad)',
            }}
          >
            {def.name}
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
