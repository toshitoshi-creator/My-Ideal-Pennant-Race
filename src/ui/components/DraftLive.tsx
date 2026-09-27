/**
 * ドラフト会議の見せ方（NPB のドラフト会議にならう）。
 *
 *  - DraftBoard        12球団を縦4×横3に並べた指名ボード。どの球団が誰を指名したかが一目で分かる
 *  - NominationReveal  1巡目の入札を1球団ずつ読み上げる。重なった候補は「競合」
 *  - LotteryOverlay    くじ引き。箱の中の紙を1枚選び、開いて交渉権かどうかを確かめる
 *
 * ここは表示だけ。入札・抽選の結果は domain/draftLottery.ts が決める。
 * くじの当たりは入札の時点で決まっていて、プレイヤーが選んだ紙がそのまま結果になる。
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DraftFirstRoundAttempt, DraftLottery, DraftState, GameState, Team } from '../../domain/types';
import { attemptLabel, remainingPapers } from '../../domain/draftLottery';
import { POSITION_SHORT } from '../../domain/positions';
import { teamVisual } from '../../domain/visuals';
import { TeamMark } from './visuals/TeamVisuals';
import { usePlayback, useReducedMotion } from '../anim';
import { sfx, buzz } from '../sfx';
import { Sheet } from './common';

/* ================= 指名ボード ================= */

interface BoardEntry {
  round: number;
  name: string;
  pos: string;
  /** 1巡目で何回目の入札で決まったか（1 = 1位） */
  attempt?: number;
  /** 抽選で得たか */
  lottery?: boolean;
}

export function DraftBoard({ state, draft }: { state: GameState; draft: DraftState }) {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const fr = draft.firstRound;
  const latest = fr && !fr.done ? fr.attempts[fr.attempts.length - 1] : undefined;

  // 球団ごとの指名一覧と、1巡目の決まり方
  const byTeam = useMemo(() => {
    const map = new Map<string, BoardEntry[]>();
    const attemptOf = new Map<string, { attempt: number; lottery: boolean }>();
    for (const at of fr?.attempts ?? []) {
      for (const lot of at.lotteries) {
        if (lot.winner) attemptOf.set(lot.winner, { attempt: at.attempt, lottery: true });
      }
    }
    for (const pick of draft.picks) {
      const prospect = draft.prospects.find((p) => p.id === pick.prospectId);
      if (!prospect) continue;
      const list = map.get(pick.teamId) ?? [];
      const entry: BoardEntry = {
        round: pick.round,
        name: prospect.player.name,
        pos: POSITION_SHORT[prospect.player.mainPosition],
      };
      if (pick.round === 1 && fr) {
        const info = attemptOf.get(pick.teamId);
        entry.lottery = info?.lottery ?? false;
        // 抽選で決まっていなければ、その候補に入札した回を探す
        entry.attempt =
          info?.attempt ??
          fr.attempts.find((a) => a.nominations[pick.teamId] === pick.prospectId)?.attempt ??
          1;
      }
      list.push(entry);
      map.set(pick.teamId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.round - b.round);
    return map;
  }, [draft.picks, draft.prospects, fr]);

  // 表示は指名順（前年の成績が悪い球団から）。指名に加わらない球団も最後に並べる
  const teams = useMemo(() => {
    const ordered = draft.order
      .map((id) => state.teams.find((t) => t.id === id))
      .filter((t): t is Team => !!t);
    for (const t of state.teams) if (!ordered.includes(t)) ordered.push(t);
    return ordered;
  }, [draft.order, state.teams]);

  const openEntries = openTeam ? (byTeam.get(openTeam) ?? []) : [];
  const openTeamObj = openTeam ? state.teams.find((t) => t.id === openTeam) : null;

  return (
    <>
      <div className="draft-board" role="list" aria-label="指名ボード">
        {teams.map((team) => {
          const entries = byTeam.get(team.id) ?? [];
          const first = entries.find((e) => e.round === 1);
          const nominatedId = latest?.nominations[team.id];
          const nominated = nominatedId ? draft.prospects.find((p) => p.id === nominatedId) : null;
          const contested = latest?.lotteries.find((l) => l.teams.includes(team.id) && !l.winner);
          const isMine = team.id === state.playerTeamId;
          return (
            <button
              key={team.id}
              type="button"
              role="listitem"
              className={`db-cell${isMine ? ' mine' : ''}`}
              style={{ '--team': team.color } as CSSProperties}
              onClick={() => setOpenTeam(team.id)}
            >
              <span className="db-head">
                <TeamMark visual={teamVisual(team)} name={team.name} size={16} />
                <span className="db-team">{team.shortName}</span>
              </span>
              {first ? (
                <span className="db-first" key={first.name}>
                  <span className="db-rank">
                    {attemptLabel(first.attempt ?? 1)}
                    {first.lottery && <em>抽選</em>}
                  </span>
                  <span className="db-name">{first.name}</span>
                </span>
              ) : nominated ? (
                <span className="db-first pending">
                  <span className="db-rank">
                    入札中{contested && <em className="hot">競合</em>}
                  </span>
                  <span className="db-name">{nominated.player.name}</span>
                </span>
              ) : (
                <span className="db-first empty">
                  <span className="db-rank">1位</span>
                  <span className="db-name">―</span>
                </span>
              )}
              <span className="db-rest">
                {entries
                  .filter((e) => e.round > 1)
                  .slice(0, 5)
                  .map((e) => (
                    <span key={e.round} className="db-line">
                      <b>{e.round}</b>
                      {e.name}
                    </span>
                  ))}
                {entries.filter((e) => e.round > 1).length > 5 && <span className="db-more">…</span>}
              </span>
            </button>
          );
        })}
      </div>

      {openTeamObj && (
        <Sheet title={`${openTeamObj.name}の指名`} onClose={() => setOpenTeam(null)}>
          <div className="card">
            {openEntries.length === 0 && <div className="muted">まだ指名していません。</div>}
            {openEntries.map((e) => (
              <div key={e.round} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span>
                  <strong style={{ color: 'var(--accent)', marginRight: 8 }}>
                    {e.round === 1 ? attemptLabel(e.attempt ?? 1) : `${e.round}位`}
                  </strong>
                  {e.name}
                </span>
                <span className="muted">
                  {e.pos}
                  {e.lottery ? '・抽選で獲得' : ''}
                </span>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ================= 入札の読み上げ ================= */

export function NominationReveal({
  state,
  draft,
  attempt,
  onDone,
}: {
  state: GameState;
  draft: DraftState;
  attempt: DraftFirstRoundAttempt;
  onDone: () => void;
}) {
  const teamIds = draft.order.filter((id) => attempt.nominations[id]);
  const play = usePlayback(teamIds.length, 420, true);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (play.step > 0 && !play.done) sfx.tap();
    if (play.done) {
      if (attempt.lotteries.length > 0) {
        sfx.drumroll(0.5);
        buzz(40);
      } else sfx.success();
    }
  }, [play.step, play.done, attempt.lotteries.length]);

  const countOf = (prospectId: string) =>
    teamIds.filter((id) => attempt.nominations[id] === prospectId).length;

  return (
    <div className="draft-overlay" role="dialog" aria-modal="true" aria-label="入札の発表">
      <div className="nr-panel">
        <div className="nr-kicker">{draft.year}年 ドラフト会議</div>
        <h2 className="nr-title">
          第{attempt.attempt}回 選択希望選手
          <span>{attemptLabel(attempt.attempt)}</span>
        </h2>
        <ol className="nr-list">
          {teamIds.slice(0, play.step).map((teamId, i) => {
            const team = state.teams.find((t) => t.id === teamId)!;
            const prospect = draft.prospects.find((p) => p.id === attempt.nominations[teamId]);
            const n = prospect ? countOf(prospect.id) : 0;
            const mine = teamId === state.playerTeamId;
            return (
              <li
                key={teamId}
                className={`nr-row${mine ? ' mine' : ''}${n > 1 ? ' clash' : ''}`}
                style={{ '--team': team.color, animationDelay: reduced ? '0ms' : undefined, zIndex: 50 - i } as CSSProperties}
              >
                <span className="nr-team">{team.shortName}</span>
                <span className="nr-name">
                  {prospect?.player.name ?? '―'}
                  <small>{prospect ? POSITION_SHORT[prospect.player.mainPosition] : ''}</small>
                </span>
                {n > 1 && play.done && <span className="nr-clash">{n}球団競合</span>}
              </li>
            );
          })}
        </ol>
        {play.done && attempt.lotteries.length > 0 && (
          <div className="nr-lotteries">
            {attempt.lotteries.map((lot) => {
              const prospect = draft.prospects.find((p) => p.id === lot.prospectId);
              const winner = lot.winner ? state.teams.find((t) => t.id === lot.winner) : null;
              return (
                <div key={lot.prospectId} className="nr-lot">
                  <strong>{prospect?.player.name}</strong>
                  <span>
                    {lot.teams.length}球団で抽選
                    {winner && !lot.teams.includes(state.playerTeamId) ? ` → ${winner.shortName}が交渉権` : ''}
                    {lot.teams.includes(state.playerTeamId) && !lot.winner ? ' → あなたの球団もくじを引きます' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="nr-actions">
          {!play.done ? (
            <button type="button" className="btn secondary" onClick={play.skip}>
              SKIP ▶▶
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={onDone}>
              {attempt.lotteries.some((l) => l.teams.includes(state.playerTeamId) && !l.winner)
                ? '抽選へ進む'
                : '続ける'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= くじ引き ================= */

type LotteryStage = 'choose' | 'opening' | 'result';

export function LotteryOverlay({
  state,
  draft,
  lottery,
  onDraw,
  onClose,
}: {
  state: GameState;
  draft: DraftState;
  lottery: DraftLottery;
  onDraw: (paper: number) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const me = state.playerTeamId;
  const myPaper = lottery.drawn[me];
  const [stage, setStage] = useState<LotteryStage>(myPaper === undefined ? 'choose' : 'result');
  const [chosen, setChosen] = useState<number | null>(myPaper ?? null);
  const prospect = draft.prospects.find((p) => p.id === lottery.prospectId);
  const won = lottery.winner === me;
  const winnerTeam = lottery.winner ? state.teams.find((t) => t.id === lottery.winner) : null;
  const left = remainingPapers(lottery);

  // 紙を選んだら、少し間を置いて開く
  useEffect(() => {
    if (stage !== 'opening' || lottery.winner === null) return;
    sfx.drumroll(reduced ? 0.1 : 1.1);
    const t = setTimeout(
      () => {
        setStage('result');
        sfx.slam();
        if (lottery.winner === me) {
          setTimeout(() => sfx.fanfare(), 160);
          buzz([40, 60, 40, 60, 90]);
        } else {
          setTimeout(() => sfx.lose(), 160);
          buzz(60);
        }
      },
      reduced ? 50 : 1300,
    );
    return () => clearTimeout(t);
  }, [stage, lottery.winner, me, reduced]);

  const pick = (paper: number) => {
    if (stage !== 'choose' || !left.includes(paper)) return;
    setChosen(paper);
    setStage('opening');
    sfx.open();
    onDraw(paper);
  };

  const ownerOf = (paper: number) => Object.entries(lottery.drawn).find(([, p]) => p === paper)?.[0];

  return (
    <div
      className={`draft-overlay lottery stage-${stage}${stage === 'result' ? (won ? ' won' : ' lost') : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="くじ引き"
    >
      <div className="lot-panel">
        <div className="nr-kicker">1巡目 抽選</div>
        <h2 className="lot-title">
          {prospect?.player.name}
          <span>{lottery.teams.length}球団競合</span>
        </h2>
        <div className="lot-teams">
          {lottery.teams.map((teamId) => {
            const team = state.teams.find((t) => t.id === teamId)!;
            const drew = lottery.drawn[teamId] !== undefined;
            return (
              <span
                key={teamId}
                className={`lot-team${teamId === me ? ' mine' : ''}${
                  stage === 'result' && teamId === lottery.winner ? ' winner' : ''
                }`}
                style={{ '--team': team.color } as CSSProperties}
              >
                {team.shortName}
                <small>{teamId === me ? 'あなた' : drew ? '引いた' : 'これから'}</small>
              </span>
            );
          })}
        </div>

        <p className="lot-guide">
          {stage === 'choose'
            ? '箱の中の紙を1枚選んでください。「交渉権確定」と書かれた紙が1枚だけ入っています。'
            : stage === 'opening'
              ? '紙を開いています…'
              : won
                ? '交渉権を獲得しました！'
                : `${winnerTeam?.shortName ?? ''}が交渉権を獲得しました`}
        </p>

        <div className="lot-box">
          {lottery.teams.map((_, paper) => {
            const owner = ownerOf(paper);
            const isChosen = paper === chosen;
            const taken = owner !== undefined && owner !== me && stage === 'choose';
            const open = stage === 'result';
            const hit = open && paper === lottery.winningPaper;
            const ownerTeam = owner ? state.teams.find((t) => t.id === owner) : null;
            return (
              <button
                key={paper}
                type="button"
                className={`lot-paper${taken ? ' taken' : ''}${isChosen ? ' chosen' : ''}${open ? ' open' : ''}${hit ? ' hit' : ''}`}
                style={{ '--i': paper } as CSSProperties}
                disabled={stage !== 'choose' || taken}
                onClick={() => pick(paper)}
                aria-label={taken ? `${ownerTeam?.shortName}が引いた紙` : `紙${paper + 1}`}
              >
                <span className="lot-fold">
                  <span className="lot-front">
                    {taken ? ownerTeam?.shortName : '？'}
                  </span>
                  <span className="lot-inside">
                    {hit ? (
                      <>
                        <b>
                          交渉権
                          <br />
                          確定
                        </b>
                        <i className="lot-seal" aria-hidden="true">
                          印
                        </i>
                        <small>{ownerTeam?.shortName}</small>
                      </>
                    ) : (
                      <small>{ownerTeam?.shortName}</small>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {stage === 'result' && (
          <div className={`lot-verdict${won ? ' won' : ''}`}>
            {won ? '交渉権確定！' : '外れ…'}
            {!won && <small>もう一度、残った候補から入札します</small>}
          </div>
        )}

        {stage === 'result' && (
          <div className="nr-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              続ける
            </button>
          </div>
        )}
      </div>
      {stage === 'result' && won && !reduced && <PaperConfetti />}
    </div>
  );
}

function PaperConfetti() {
  const colors = ['#ffcf3f', '#e63946', '#2a9df4', '#ffffff', '#3fbf6a'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 56 }, (_, i) => (
        <span
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              background: colors[i % colors.length],
              animationDelay: `${((i * 53) % 80) / 100}s`,
              animationDuration: `${2.2 + ((i * 29) % 14) / 10}s`,
              '--drift': `${((i * 71) % 60) - 30}vw`,
              '--rot': `${(i * 97) % 360}deg`,
              width: i % 3 === 0 ? 6 : 9,
              height: i % 3 === 0 ? 12 : 6,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
