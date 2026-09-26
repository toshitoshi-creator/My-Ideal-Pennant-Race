import { useEffect, useMemo, useRef, useState } from 'react';
import { Sec } from '../components/Sec';
import { useGame } from '../store';
import type { GameResult } from '../../domain/types';
import { formatDateJa } from '../../domain/dates';
import { nextGameForTeam } from '../../domain/schedule';
import { Sheet } from '../components/common';
import { PlayerLink } from '../components/PlayerLink';
import { PictureButton } from '../components/PictureButton';
import { ScreenBackground } from '../components/ScreenBackground';
import gameBg from '../../assets/backgrounds/bg-game.webp';
import gameStartArt from '../../assets/ui/game-start.webp';
import skipArt from '../../assets/ui/game-skip.webp';
import gameWinArt from '../../assets/ui/game-win.webp';
import gameLossArt from '../../assets/ui/game-loss.webp';
import { useCountUp, usePlayback } from '../anim';
import { buildPreGameBrief, buildPostGameReport } from '../../domain/gameBrief';
import {
  teamVisual,
  stadiumMoodForDate,
  gameVisualEvents,
  EVENT_LABELS,
  EVENT_RANK,
} from '../../domain/visuals';
import { StadiumScene, TeamMark } from '../components/visuals/TeamVisuals';
import { EventScene } from '../components/visuals/EventScene';
import { PlayerVisual } from '../components/PlayerVisual';
import { wasBroadcast } from '../components/LiveBroadcast';
import { useFirstVisit, useReducedMotion } from '../anim';

export function GameScreen() {
  const { state, lastResult, playNextGame } = useGame();
  const [detail, setDetail] = useState<GameResult | null>(null);
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const next = nextGameForTeam(state.schedule, team.id, state.date);
  const opponent = next
    ? state.teams.find(
        (t) => t.id === (next.homeTeamId === team.id ? next.awayTeamId : next.homeTeamId),
      )!
    : null;
  const brief = useMemo(() => buildPreGameBrief(state), [state]);

  const playerResults = state.results
    .filter((r) => r.homeTeamId === team.id || r.awayTeamId === team.id)
    .slice()
    .reverse();

  /*
   * スコアブックの左右スワイプ。index 0 が最新の試合結果で、
   * 数字が大きいほど過去にさかのぼる。新しい試合を消化したら
   * 必ず最新（0）に戻す。
   */
  const [viewIndex, setViewIndex] = useState(0);
  useEffect(() => {
    setViewIndex(0);
  }, [lastResult?.id]);
  const clampedIndex =
    playerResults.length === 0 ? 0 : Math.min(viewIndex, playerResults.length - 1);
  const viewedResult = playerResults[clampedIndex] ?? null;
  const canViewOlder = clampedIndex + 1 < playerResults.length;
  const canViewNewer = clampedIndex > 0;

  const [confirmNext, setConfirmNext] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const viewOlder = () => {
    if (canViewOlder) setViewIndex(clampedIndex + 1);
  };
  // 最新の試合を見ている状態でさらに左へスワイプしたら、次の試合に進むかどうかを尋ねる
  const viewNewerOrNext = () => {
    if (canViewNewer) {
      setViewIndex(clampedIndex - 1);
    } else if (next) {
      setConfirmNext(true);
    }
  };
  const onScorebookPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onScorebookPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // 横の動きが十分大きく、縦スクロールより明らかに横向きのときだけスワイプとみなす
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // 左へスワイプ → 過去の試合、右へスワイプ → 新しい試合（最新なら次の試合の確認）
    if (dx < 0) viewOlder();
    else viewNewerOrNext();
  };
  const onScorebookPointerCancel = () => {
    swipeStart.current = null;
  };

  const sameDayResults = viewedResult
    ? state.results.filter((r) => r.date === viewedResult.date && r.id !== viewedResult.id)
    : [];

  return (
    <div className="screen">
      <ScreenBackground src={gameBg} alt="" />
      <div className="screen-content">
      {/* ── 試合前資料（§14）。今日の試合に関係する情報だけを短く ── */}
      <div className="card">
        <Sec en="PRE-GAME BRIEF" ja="試合前資料" size="lead" />
        {next && opponent && brief ? (
          <>
            {/* PHASE 4.5: 球場 → 球団 → 対戦 の順に見せてから資料に入る（§14） */}
            <PreGameStage opponentId={opponent.id} homeAway={brief.homeAway} date={next.date} />
            <div className="brief-line">
              <span className="label">TODAY</span>
              <span>{brief.dateLabel}</span>
            </div>
            <div className="brief-line">
              <span className="label">OPPONENT</span>
              <span>
                {brief.opponentName}
                <span className="muted"> {brief.opponentRecord}</span>
              </span>
            </div>
            <div className="brief-line">
              <span className="label">STARTING PITCHER</span>
              <span className="row" style={{ gap: 8 }}>
                {/* PHASE 4.6 今日の先発の顔（§22） */}
                <BriefFace playerId={brief.starterId} />
                <span>
                  {brief.starterName}
                  <span className="muted"> {brief.starterNote}</span>
                </span>
              </span>
            </div>
            <div className="brief-line">
              <span className="label">TEAM FORM</span>
              <span>{brief.teamForm}</span>
            </div>
            {brief.watch.length > 0 && (
              <div className="brief-watch">
                <span className="label">WATCH</span>
                <span className="brief-watch-ja">今日の見どころ</span>
                <ul className="brief-watch-list">
                  {brief.watch.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <PictureButton src={gameStartArt} alt="試合開始" onClick={() => playNextGame()} />
          </>
        ) : (
          <div className="muted">予定されている試合はありません。</div>
        )}
      </div>

      {viewedResult && (
        <>
          <div
            className="card swipe-card"
            onPointerDown={onScorebookPointerDown}
            onPointerUp={onScorebookPointerUp}
            onPointerCancel={onScorebookPointerCancel}
          >
            <Sec
              en="SCOREBOOK"
              ja="試合結果"
              size="lead"
              note={`${formatDateJa(viewedResult.date)}${clampedIndex === 0 ? '' : '（過去）'}`}
            />
            <div className="muted swipe-hint">
              <span>{canViewOlder ? '◀ 左スワイプで前の試合' : ''}</span>
              <span>
                {canViewNewer ? '右スワイプで新しい試合 ▶' : next ? '右スワイプで次の試合へ ▶' : ''}
              </span>
            </div>
            <GameResultView key={viewedResult.id} state={state} result={viewedResult} />
            <div className="scorebook-nav">
              <button
                type="button"
                className="btn secondary"
                disabled={!canViewOlder}
                onClick={viewOlder}
              >
                ◀ 前の試合
              </button>
              {canViewNewer ? (
                <button type="button" className="btn secondary" onClick={() => setViewIndex(0)}>
                  最新の結果へ
                </button>
              ) : null}
              {next && (
                <button type="button" className="btn primary next-game-cta" onClick={() => playNextGame()}>
                  次の試合へ ▶
                </button>
              )}
            </div>
          </div>
          <PostGameSection result={viewedResult} />
          <div className="card">
            <Sec en="PLAY BY PLAY" ja="簡易実況" size="sub" />
            <div className="commentary">
              {viewedResult.commentary.map((line, i) => (
                <div key={i} className={line.startsWith('　') ? '' : 'head'}>
                  {line}
                </div>
              ))}
            </div>
          </div>
          {sameDayResults.length > 0 && (
            <div className="card">
              <Sec en="AROUND THE LEAGUE" ja="同日の他球団" size="sub" />
              {sameDayResults.map((r) => (
                <ResultRow key={r.id} state={state} result={r} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="card">
        <Sec en="GAME LOG" ja="これまでの試合" size="sub" />
        {playerResults.length === 0 && <div className="muted">まだ試合を行っていません。</div>}
        {playerResults.slice(0, 20).map((r) => (
          <button
            key={r.id}
            className="player-card"
            onClick={() => setDetail(r)}
            style={{ padding: '10px 12px' }}
          >
            <span className="grow">
              <ResultRow state={state} result={r} inline />
            </span>
            <span className="muted">{r.commentary.length > 0 ? '詳細 ›' : ''}</span>
          </button>
        ))}
      </div>

      {detail && (
        <Sheet title={`${formatDateJa(detail.date)} の試合`} onClose={() => setDetail(null)}>
          <div className="card">
            <GameResultView key={detail.id} state={state} result={detail} />
          </div>
          {detail.commentary.length > 0 && (
            <div className="card">
              <Sec en="PLAY BY PLAY" ja="簡易実況" size="sub" />
              <div className="commentary" style={{ maxHeight: 'none' }}>
                {detail.commentary.map((line, i) => (
                  <div key={i} className={line.startsWith('　') ? '' : 'head'}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Sheet>
      )}

      {/* スコアブックを左スワイプで最新まで進めたときの、次の試合へ進む確認 */}
      {confirmNext && (
        <Sheet title="確認" onClose={() => setConfirmNext(false)}>
          <div className="card">
            <p style={{ fontSize: 15 }}>次の試合に進みます。よろしいですか？</p>
          </div>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setConfirmNext(false)}>
              いいえ
            </button>
            <button
              className="btn"
              onClick={() => {
                setConfirmNext(false);
                playNextGame();
              }}
            >
              はい
            </button>
          </div>
        </Sheet>
      )}
      </div>
    </div>
  );
}

function ResultRow({
  state,
  result,
  inline,
}: {
  state: ReturnType<typeof useGame>['state'];
  result: GameResult;
  inline?: boolean;
}) {
  const home = state.teams.find((t) => t.id === result.homeTeamId)!;
  const away = state.teams.find((t) => t.id === result.awayTeamId)!;
  const playerTeam = state.playerTeamId;
  const isPlayerGame = result.homeTeamId === playerTeam || result.awayTeamId === playerTeam;
  let mark = '△';
  if (isPlayerGame && result.winnerTeamId) {
    mark = result.winnerTeamId === playerTeam ? '○' : '●';
  }
  return (
    <div
      className="spread"
      style={{ padding: inline ? 0 : '6px 0', borderBottom: inline ? 'none' : '1px solid var(--line)' }}
    >
      <span style={{ fontSize: 14 }}>
        {isPlayerGame && (
          <strong style={{ color: mark === '○' ? 'var(--good)' : mark === '●' ? 'var(--bad)' : 'var(--text-dim)' }}>
            {mark}{' '}
          </strong>
        )}
        {formatDateJa(result.date)} {away.shortName} {result.away.runs} - {result.home.runs}{' '}
        {home.shortName}
      </span>
      {result.innings > 9 && <span className="muted">延{result.innings}回</span>}
    </div>
  );
}

export function GameResultView({
  state,
  result,
}: {
  state: ReturnType<typeof useGame>['state'];
  result: GameResult;
}) {
  const home = state.teams.find((t) => t.id === result.homeTeamId)!;
  const away = state.teams.find((t) => t.id === result.awayTeamId)!;
  const winner = result.winnerTeamId
    ? state.teams.find((t) => t.id === result.winnerTeamId)!
    : null;
  const winPitcher = state.players.find((p) => p.id === result.winningPitcherId);
  const losePitcher = state.players.find((p) => p.id === result.losingPitcherId);

  /*
   * PHASE 4.1: 試合の結果を回ごとに再生する。
   * 試合そのものは engine が一括で計算済みで、ここでやっているのは
   * 「すでに決まっている結果を順番に見せる」だけ。
   * 途中でスキップしても、リロードしても、結果は 1 ミリも変わらない。
   */
  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length);
  // 中継で一度見せた試合は、スコアブックでは繰り返さない
  const play = usePlayback(innings + 1, 190, !wasBroadcast(result.id));
  // step 回まで進んだ時点の得点（表示専用）
  const shownInnings = Math.min(innings, play.step);
  const partial = (runs: number[]) =>
    runs.slice(0, shownInnings).reduce((a, b) => a + b, 0);
  const awayRuns = play.done ? result.away.runs : partial(result.away.inningRuns);
  const homeRuns = play.done ? result.home.runs : partial(result.home.inningRuns);
  const awayShown = useCountUp(awayRuns, 240);
  const homeShown = useCountUp(homeRuns, 240);

  return (
    <>
      <div className="big-score">
        <span className="t">{away.shortName}</span>
        <span className="s">
          <span className="score-digit" key={`a${awayRuns}`}>{awayShown}</span> -{' '}
          <span className="score-digit" key={`h${homeRuns}`}>{homeShown}</span>
        </span>
        <span className="t">{home.shortName}</span>
      </div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {play.done ? '試合終了' : `${shownInnings}回まで`}
        </span>
        {!play.done && (
          <PictureButton src={skipArt} alt="スキップ" className="skip-img" onClick={play.skip} />
        )}
      </div>
      {/*
        PHASE 4.3: 試合が終わったら、まず FINAL を出し、少し遅れて勝敗を出す（§6）。
        紙吹雪などの大きな演出は中継（LiveBroadcast）側が受け持つ。
      */}
      <div className="final-line">
        {play.done && (
          <>
            <span className="label final-mark">FINAL</span>
            <span
              className={`final-result${
                winner ? (winner.id === state.playerTeamId ? ' win' : ' loss') : ' draw'
              }`}
            >
              {winner
                ? winner.id === state.playerTeamId
                  ? 'WIN'
                  : 'LOSS'
                : 'DRAW'}
            </span>
            <span className="final-team">
              {winner ? `勝利球団：${winner.name}` : '引き分け'}
            </span>
          </>
        )}
      </div>
      {play.done && winner && (
        <img
          src={winner.id === state.playerTeamId ? gameWinArt : gameLossArt}
          alt={winner.id === state.playerTeamId ? '勝利' : '敗北'}
          className="game-result-banner"
        />
      )}
      <div className="scroll-x">
        <table className="linescore">
          <thead>
            <tr>
              <th />
              {result.away.inningRuns.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th>R</th>
              <th>H</th>
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="team">{away.shortName}</td>
              {result.away.inningRuns.map((r, i) => (
                <td key={i} className={i < shownInnings ? `ls-on${r > 0 ? ' ls-run' : ''}` : undefined}>
                  {i < shownInnings ? r : ''}
                </td>
              ))}
              <td className="total">{awayRuns}</td>
              <td>{play.done ? result.away.hits : ''}</td>
              <td>{play.done ? result.away.errors : ''}</td>
            </tr>
            <tr>
              <td className="team">{home.shortName}</td>
              {result.home.inningRuns.map((r, i) => (
                <td key={i} className={i < shownInnings ? `ls-on${r > 0 ? ' ls-run' : ''}` : undefined}>
                  {i >= shownInnings
                    ? ''
                    : i === result.innings - 1 &&
                        result.home.inningRuns.length === result.innings &&
                        r === 0 &&
                        result.home.runs > result.away.runs
                      ? 'X'
                      : r}
                </td>
              ))}
              <td className="total">{homeRuns}</td>
              <td>{play.done ? result.home.hits : ''}</td>
              <td>{play.done ? result.home.errors : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {play.done && (winPitcher || losePitcher) && (
        <div className="muted" style={{ marginTop: 8 }}>
          勝：{winPitcher?.name ?? '－'} ／ 敗：{losePitcher?.name ?? '－'}
        </div>
      )}
    </>
  );
}

/**
 * PHASE 4.4 試合後の講評（§16・§17）。
 *
 * 新聞の試合評のように、決まった場面 → 個人 → チーム の3段に分ける。
 * 「これで復活した」のような断定はしない。
 */
function PostGameSection({ result }: { result: GameResult }) {
  const { state } = useGame();
  const report = useMemo(() => buildPostGameReport(state, result), [state, result]);
  return (
    <div className="card">
      <Sec en="POST GAME" ja="試合の講評" size="lead" note={report.score} />
      {/* PHASE 4.5: 勝敗で空気を変える（§19・§48）。色ではなく絵と余白で表す */}
      <PostGameStage result={result} resultLabel={report.resultLabel} />
      <GameEventPlates result={result} />
      {report.keyMoments.length > 0 && (
        <div className="post-block">
          <span className="label">KEY MOMENTS</span>
          <span className="post-ja">試合の流れ</span>
          <ul className="post-moments">
            {report.keyMoments.map((moment, i) => (
              <li key={i}>
                <span className="post-inning">{moment.inning}回</span>
                <span className="post-moment-label">{moment.label}</span>
                <span className="post-moment-text">{moment.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.playerNotes.length > 0 && (
        <div className="post-block">
          <span className="label">PLAYER NOTE</span>
          <span className="post-ja">個人の記録</span>
          {report.playerNotes.map((note) => (
            <div key={note.playerId} className="post-player">
              <div className="post-player-head">
                <span className="post-player-name">
                  <PlayerLink playerId={note.playerId}>{note.name}</PlayerLink>
                </span>
                <span className="post-player-today">{note.today}</span>
              </div>
              {note.before && (
                <div className="post-player-before">
                  <span className="label">BEFORE</span>
                  <span>{note.before}</span>
                </div>
              )}
              <p className="post-player-note">{note.note}</p>
            </div>
          ))}
        </div>
      )}
      <div className="post-block">
        <span className="label">TEAM NOTE</span>
        <span className="post-ja">チームの状況</span>
        <p className="post-team">{report.teamNote}</p>
      </div>
    </div>
  );
}


/**
 * PHASE 4.5 試合前の舞台（§14）。
 * 球場 → 球団 → 対戦 の順に置く。一気に出さない。
 */
/** 試合前資料に出す小さな顔。選手が見つからなければ何も出さない */
function BriefFace({ playerId }: { playerId: string | null }) {
  const { state } = useGame();
  const player = playerId ? state.players.find((p) => p.id === playerId) : undefined;
  if (!player) return null;
  return <PlayerVisual player={player} size="small" className="portrait-row" />;
}

function PreGameStage({
  opponentId,
  homeAway,
  date,
}: {
  opponentId: string;
  homeAway: 'HOME' | 'AWAY';
  date: string;
}) {
  const { state } = useGame();
  const reduced = useReducedMotion();
  const first = useFirstVisit(`pregame:${date}`);
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const opponent = state.teams.find((t) => t.id === opponentId)!;
  // 本拠地は「ホームの球団」のもの
  const hostId = homeAway === 'HOME' ? team.id : opponent.id;
  const host = state.teams.find((t) => t.id === hostId)!;
  const visual = useMemo(() => teamVisual(host), [host]);
  const mine = useMemo(() => teamVisual(team), [team]);
  const theirs = useMemo(() => teamVisual(opponent), [opponent]);
  const mood = stadiumMoodForDate(date);

  return (
    <div className={first && !reduced ? 'photo-in' : undefined}>
      <StadiumScene visual={visual} name={visual.stadiumName} mood={mood} height={104} />
      <div className="stadium-caption">
        <span className="label">{homeAway === 'HOME' ? 'HOME' : 'AWAY'}</span>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {visual.stadiumName}
        </span>
      </div>
      <div className={`matchup${first && !reduced ? ' photo-in-late' : ''}`}>
        <div className="matchup-side">
          <TeamMark visual={mine} name={team.name} size={30} />
          <span>{team.shortName}</span>
        </div>
        <span className="matchup-vs">vs</span>
        <div className="matchup-side">
          <TeamMark visual={theirs} name={opponent.name} size={30} />
          <span>{opponent.shortName}</span>
        </div>
      </div>
    </div>
  );
}

/** 試合後の一枚。勝てば球場、負ければスコアブックの静けさ（§19・§48） */
function PostGameStage({
  result,
  resultLabel,
}: {
  result: GameResult;
  resultLabel: 'WIN' | 'LOSS' | 'DRAW';
}) {
  const { state } = useGame();
  const reduced = useReducedMotion();
  const first = useFirstVisit(`postgame:${result.id}`);
  const teamId = state.playerTeamId;
  const hostId = result.homeTeamId;
  const host = state.teams.find((t) => t.id === hostId);
  const visual = useMemo(() => (host ? teamVisual(host) : null), [host]);
  if (!visual || !host) return null;
  // 勝った日は満員、負けた日は静かな球場。天候ではなく空気の描き分け
  const mood = resultLabel === 'WIN' ? 'PACKED' : resultLabel === 'LOSS' ? 'QUIET' : 'DAY';

  return (
    <div className={first && !reduced ? 'photo-in' : undefined}>
      <StadiumScene visual={visual} name={visual.stadiumName} mood={mood} height={92} />
      <div className="stadium-caption">
        <span className="label">
          {resultLabel === 'WIN' ? 'AFTER THE WIN' : resultLabel === 'LOSS' ? 'AFTER THE LOSS' : 'DRAWN GAME'}
        </span>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {teamId === result.winnerTeamId
            ? '勝った日の球場'
            : result.winnerTeamId
              ? '負けた日の球場'
              : '引き分けた日の球場'}
        </span>
      </div>
    </div>
  );
}

/**
 * PHASE 4.5 試合の出来事を紙面にする（§15・§17・§18）。
 * 実際に記録された出来事だけを、重い順に最大2つ。通常の試合では何も出ない。
 */
function GameEventPlates({ result }: { result: GameResult }) {
  const { state } = useGame();
  const reduced = useReducedMotion();
  const events = useMemo(() => gameVisualEvents(state, result), [state, result]);
  const team = state.teams.find((t) => t.id === state.playerTeamId);
  const shown = events.filter((e) => EVENT_RANK[e.kind] !== 'B').slice(0, 2);
  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((event) => {
        const player = event.playerId
          ? state.players.find((p) => p.id === event.playerId)
          : undefined;
        const label = EVENT_LABELS[event.kind];
        return (
          <EventPlate
            key={`${result.id}:${event.kind}`}
            id={`${result.id}:${event.kind}`}
            reduced={reduced}
            rank={EVENT_RANK[event.kind]}
            en={label.en}
            ja={label.ja}
            inning={event.inning}
            text={event.text}
            teamColor={team?.color}
            kind={event.kind}
            player={player}
          />
        );
      })}
    </>
  );
}

function EventPlate({
  id,
  reduced,
  rank,
  en,
  ja,
  inning,
  text,
  teamColor,
  kind,
  player,
}: {
  id: string;
  reduced: boolean;
  rank: 'S' | 'A' | 'B';
  en: string;
  ja: string;
  inning: number | null;
  text: string;
  teamColor?: string;
  kind: Parameters<typeof EventScene>[0]['kind'];
  player?: import('../../domain/types').Player;
}) {
  const first = useFirstVisit(`plate:${id}`);
  return (
    <section className={`event-plate rank-${rank.toLowerCase()}${first && !reduced ? ' photo-in' : ''}`}>
      <div className="event-plate-head">
        <span className="label">{en}</span>
        <span className="event-plate-ja">{ja}</span>
        {inning !== null && <span className="event-plate-inning">{inning}回</span>}
      </div>
      <EventScene kind={kind} teamColor={teamColor} height={rank === 'S' ? 104 : 84} />
      <div className="event-plate-figure">
        {player && <PlayerVisual player={player} size="small" teamColor={teamColor} />}
        <p className="event-plate-text">{text}</p>
      </div>
    </section>
  );
}
