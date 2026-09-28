import { useEffect, useMemo, useState } from 'react';
import { positionText } from '../components/PitcherRole';
import { Sec } from '../components/Sec';
import { useGame } from '../store';
import type { DraftProspect, ScoutReport } from '../../domain/types';
import { availableProspects, currentPick } from '../../domain/draft';
import { attemptLabel, canNominate, inFirstRound } from '../../domain/draftLottery';
import { DraftBoard, LotteryOverlay, NominationReveal } from '../components/DraftLive';
import { PlayerVisual, PlayerVisualHero } from '../components/PlayerVisual';
import { RevealRows } from '../components/Reveal';
import {
  abilityRangeText,
  confidenceLabel,
  overallProgress,
  viewReport,
  scoutAbilitySummary,
  SCOUT_ABILITY_LABELS,
} from '../../domain/scouting';
import { Sheet, PositionBadge } from '../components/common';
import { PictureButton } from '../components/PictureButton';
import draftStartArt from '../../assets/ui/draft-start.webp';
import draftToContractArt from '../../assets/ui/draft-to-contract.webp';
import draftCancelArt from '../../assets/ui/draft-cancel.webp';
import draftPickArt from '../../assets/ui/draft-pick.webp';
import draftPickThisArt from '../../assets/ui/draft-pick-this.webp';
import draftPickThisConfirmArt from '../../assets/ui/draft-pick-this-confirm.webp';

type Filter = 'all' | 'pitcher' | 'fielder' | 'scouted';

/**
 * ドラフト会議（PHASE 3.1）＋スカウト（PHASE 3.2）。
 *
 * 表示するのはすべて「その球団が調査して得た推定情報」であり、
 * 選手の真の能力値・潜在能力・性格・特殊能力は一切表示しない。
 */
export function DraftScreen() {
  const { state, draftPick, drawLottery, startContracts, startDraftPicks } = useGame();
  const draft = state.draft!;
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DraftProspect | null>(null);

  const scoutingPhase = draft.phase === 'scouting';
  const firstRound = !scoutingPhase && inFirstRound(draft);
  const slot = firstRound ? null : currentPick(draft);
  // 1巡目は入札（全球団が同時に1人ずつ）、2巡目からは順番の指名
  const myTurn = firstRound ? canNominate(state) : !scoutingPhase && slot?.teamId === state.playerTeamId;
  const fr = draft.firstRound;

  /*
   * 入札の読み上げ → くじ引き の順に見せる。
   * すでに見た入札は繰り返さない（画面を開き直したときは最新の状態から）。
   */
  const [seenAttempts, setSeenAttempts] = useState(() => fr?.attempts.length ?? 0);
  const [revealIdx, setRevealIdx] = useState<number | null>(null);
  const [lotteryAt, setLotteryAt] = useState<{ a: number; l: number } | null>(null);
  useEffect(() => {
    if (!fr || revealIdx !== null || lotteryAt !== null) return;
    if (fr.attempts.length > seenAttempts) {
      setRevealIdx(seenAttempts);
      return;
    }
    // 開き直したとき、まだ引いていないくじがあればそのまま抽選へ
    if (fr.awaitingLottery !== null) {
      setLotteryAt({ a: fr.attempts.length - 1, l: fr.awaitingLottery });
    }
  }, [fr, seenAttempts, revealIdx, lotteryAt]);
  const revealAttempt = revealIdx !== null ? fr?.attempts[revealIdx] : undefined;
  const lotteryView = lotteryAt ? fr?.attempts[lotteryAt.a]?.lotteries[lotteryAt.l] : undefined;
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
      </div>

      <div className="screen">
        {scoutingPhase ? (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <h2>スカウト期間</h2>
            <div className="muted" style={{ marginBottom: 10 }}>
              候補の調査は、シーズン中の発掘（GM DESK → 発掘 → スカウト）でしかできません。
              シーズン中に見つけて調べた選手だけ、ここでも詳しい情報が分かります。
              確認が済んだらドラフト会議を始めてください。
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
            <PictureButton src={draftStartArt} alt="ドラフト会議を始める" className="label-btn" onClick={() => startDraftPicks()} />
          </div>
        ) : firstRound ? (
          <div className="card draft-status">
            <div className="muted">
              1巡目 入札（第{(fr?.attempts.length ?? 0) + (myTurn ? 1 : 0)}回・
              {attemptLabel((fr?.attempts.length ?? 0) + (myTurn ? 1 : 0))}）
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              {myTurn
                ? `${attemptLabel((fr?.attempts.length ?? 0) + 1)}で入札する選手を選んでください`
                : '抽選の結果を待っています'}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              全球団が同時に1人ずつ入札します。重なった選手はくじ引きで交渉権を決め、
              外れた球団は残りの選手から再び入札します。
            </div>
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
                <PictureButton src={draftToContractArt} alt="契約更改へ" className="label-btn" onClick={() => startContracts()} />
              </>
            )}
          </div>
        )}

        {!scoutingPhase && (
          <div className="card">
            <Sec en="DRAFT BOARD" ja="指名ボード" size="lead" note="球団をタップで全指名" />
            <DraftBoard state={state} draft={draft} />
          </div>
        )}

        {/* PHASE 4.1: 直近の指名を球団→巡目→選手→評価の順に見せる（スキップ可） */}
        {latestPick && latestProspect && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <Sec en="DRAFT ROOM" ja="指名" size="lead" />
            <RevealRows
              animationKey={`${latestPick.round}-${latestPick.pick}-${latestPick.prospectId}`}
              intervalMs={240}
              rows={[
                { label: '球団', value: team.name },
                { label: '指名順', value: `${latestPick.round}巡 ${latestPick.pick}番目` },
                { label: '選手', value: latestProspect.player.name },
                {
                  label: 'ポジション',
                  value: `${positionText(latestProspect.player)} / ${latestProspect.player.age}歳`,
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
                    <PlayerVisual
                      player={prospect.player}
                      size="small"
                      expression="focused"
                      className="portrait-row"
                    />
                    {prospect.player.name}
                  </span>
                  <span className="muted">
                    {positionText(prospect.player)} / {prospect.player.age}歳
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {draftLog.length > 0 && (
          <div className="card">
            <Sec en="DRAFT LOG" ja="指名の経過" size="sub" />
            {draftLog.map((notice, i) => (
              <div key={i} style={{ padding: '4px 0', fontSize: 14 }}>
                {notice.message}
              </div>
            ))}
          </div>
        )}

        {(scoutingPhase || slot || firstRound) && (
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

      {revealAttempt && (
        <NominationReveal
          key={revealIdx}
          state={state}
          draft={draft}
          attempt={revealAttempt}
          onDone={() => {
            const idx = revealIdx!;
            setSeenAttempts(idx + 1);
            setRevealIdx(null);
            const l = revealAttempt.lotteries.findIndex(
              (lot) => lot.teams.includes(state.playerTeamId),
            );
            if (l >= 0) setLotteryAt({ a: idx, l });
          }}
        />
      )}

      {lotteryView && (
        <LotteryOverlay
          key={`${lotteryAt!.a}-${lotteryAt!.l}`}
          state={state}
          draft={draft}
          lottery={lotteryView}
          onDraw={(paper) => drawLottery(paper)}
          onClose={() => setLotteryAt(null)}
        />
      )}

      {confirming && (
        <Sheet title={firstRound ? '入札の確認' : '指名の確認'} onClose={() => setConfirming(null)}>
          <div className="card">
            <div className="draft-confirm">
              {/* §42 指名の見せ場。ここだけ Portrait Reveal を使う */}
              <PlayerVisualHero
                player={confirming.player}
                expression="focused"
                pose="pose_standing"
                animate
              />
              <div style={{ fontSize: 17, fontWeight: 800 }}>{confirming.player.name}</div>
            </div>
            <div className="muted">
              {positionText(confirming.player)} / {confirming.player.age}歳 /{' '}
              推定能力 {abilityRangeText(reports.get(confirming.id)!)}
            </div>
            <div style={{ marginTop: 10, fontSize: 15 }}>
              {firstRound
                ? `${confirming.player.name}選手を${attemptLabel((fr?.attempts.length ?? 0) + 1)}で入札しますか？他球団と重なった場合はくじ引きになります。`
                : `${confirming.player.name}選手を指名しますか？`}
            </div>
          </div>
          <div className="btn-row">
            <PictureButton src={draftCancelArt} alt="やめる" className="label-btn" onClick={() => setConfirming(null)} />
            <PictureButton
              src={draftPickArt}
              alt="指名する"
              className="label-btn"
              onClick={() => {
                draftPick(confirming.id);
                setConfirming(null);
              }}
            />
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
        background: 'var(--paper-3)',
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
        <PositionBadge player={player} />
        <span className="grow">
          <span className="row" style={{ gap: 6 }}>
            <span className="name">{player.name}</span>
            <span className="meta">{player.age}歳</span>
            <span className="chip" style={{ fontSize: 11 }}>
              下馬評{prospect.draftRank}位
            </span>
          </span>
          <span className="meta">
            {positionText(player)} / 推定能力 {abilityRangeText(report)}
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

      {onPick && <PictureButton src={draftPickThisArt} alt="この選手を指名" className="label-btn" onClick={onPick} />}
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
              {player.age}歳 / {positionText(player)} /{' '}
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

      {canPick && <PictureButton src={draftPickThisConfirmArt} alt="この選手を指名する" className="label-btn" onClick={onPick} />}
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
