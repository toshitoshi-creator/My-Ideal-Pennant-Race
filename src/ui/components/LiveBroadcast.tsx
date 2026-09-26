/**
 * 試合中継（演出専用）。
 *
 * 試合そのものは engine が一括で計算済みで、ここでやっているのは
 * 「すでに決まっている結果を、中継のように順番に見せる」ことだけ。
 * スキップしても、途中で閉じても、リロードしても結果は 1 ミリも変わらない。
 * ゲームの状態・乱数には一切触れない（紙吹雪の散らばりは index から決める）。
 *
 * 流れ:
 *   PLAY BALL（両球団の入場） → 1回表 … 最終回（得点の回は打球と歓声）
 *   → GAME SET → 勝敗のスタンプ（勝てば紙吹雪）→ 結果の資料へ
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameResult, GameState, Team } from '../../domain/types';
import { teamVisual } from '../../domain/visuals';
import { formatDateJa } from '../../domain/dates';
import { TeamMark } from './visuals/TeamVisuals';
import { useReducedMotion } from '../anim';
import { sfx, buzz } from '../sfx';
import gameWinArt from '../../assets/ui/game-win.webp';
import gameLossArt from '../../assets/ui/game-loss.webp';

/** 一度中継した試合。スコアブック側はこれを見て再生を省く */
const broadcasted = new Set<string>();
export function wasBroadcast(resultId: string): boolean {
  return broadcasted.has(resultId);
}

type HalfKind = 'quiet' | 'score' | 'homer' | 'walkoff';

interface Half {
  inning: number;
  top: boolean;
  runs: number;
  kind: HalfKind;
  lines: string[];
}

/** 実況の行を「何回表／裏」ごとに分ける */
function splitCommentary(lines: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const head = /^(\d+)回(表|裏)/.exec(line);
    if (head) {
      current = [];
      map.set(`${head[1]}${head[2]}`, current);
      continue;
    }
    if (current && line.startsWith('　')) current.push(line.trim());
    else current = null;
  }
  return map;
}

/** 最終回の裏を攻撃せずに勝った（スコアブックでいう X） */
function skipsLastBottom(result: GameResult, inningIdx: number): boolean {
  return (
    inningIdx === result.innings - 1 &&
    result.home.inningRuns.length === result.innings &&
    result.home.inningRuns[inningIdx] === 0 &&
    result.home.runs > result.away.runs
  );
}

function buildHalves(result: GameResult): Half[] {
  const byHalf = splitCommentary(result.commentary);
  const halves: Half[] = [];
  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length);
  for (let i = 0; i < innings; i++) {
    for (const top of [true, false]) {
      const runsList = top ? result.away.inningRuns : result.home.inningRuns;
      if (i >= runsList.length) continue;
      if (!top && skipsLastBottom(result, i)) continue;
      const runs = runsList[i];
      const lines = (byHalf.get(`${i + 1}${top ? '表' : '裏'}`) ?? []).filter(
        (l) => !l.startsWith('この回'),
      );
      const text = lines.join(' ');
      const kind: HalfKind =
        runs === 0
          ? 'quiet'
          : text.includes('サヨナラ')
            ? 'walkoff'
            : text.includes('ホームラン')
              ? 'homer'
              : 'score';
      halves.push({ inning: i + 1, top, runs, kind, lines });
    }
  }
  return halves;
}

/** 実況から、見せる価値のある行だけを最大3行選ぶ */
function pickLines(half: Half): string[] {
  if (half.lines.length === 0) return ['三者凡退'];
  const scoring = half.lines.filter((l) => /点|ホームラン|サヨナラ/.test(l));
  const rest = half.lines.filter((l) => !scoring.includes(l));
  const picked = scoring.length > 0 ? scoring : rest.slice(-2);
  return picked.slice(-3);
}

const HALF_MS: Record<HalfKind, number> = {
  quiet: 520,
  score: 1500,
  homer: 1900,
  walkoff: 2100,
};
const INTRO_MS = 1900;
const GAMESET_MS = 1100;

type Phase = 'intro' | 'play' | 'gameset' | 'final';

export function LiveBroadcast({
  state,
  result,
  onClose,
  onNext,
}: {
  state: GameState;
  result: GameResult;
  onClose: () => void;
  /** 次の試合がある（シーズン中）ときだけ渡す */
  onNext?: () => void;
}) {
  const reduced = useReducedMotion();
  const halves = useMemo(() => buildHalves(result), [result]);
  const home = state.teams.find((t) => t.id === result.homeTeamId)!;
  const away = state.teams.find((t) => t.id === result.awayTeamId)!;
  const mineId = state.playerTeamId;
  const outcome: 'win' | 'loss' | 'draw' = !result.winnerTeamId
    ? 'draw'
    : result.winnerTeamId === mineId
      ? 'win'
      : 'loss';

  const [phase, setPhase] = useState<Phase>(reduced ? 'final' : 'intro');
  const [halfIndex, setHalfIndex] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    broadcasted.add(result.id);
  }, [result.id]);

  // 中継中は後ろの画面をスクロールさせない
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // 進行の本体。phase と halfIndex から次の一手を決める
  useEffect(() => {
    clear();
    if (phase === 'intro') {
      sfx.siren();
      timer.current = setTimeout(() => {
        setPhase('play');
        setHalfIndex(0);
      }, INTRO_MS);
    } else if (phase === 'play') {
      const half = halves[halfIndex];
      if (!half) {
        setPhase('gameset');
        return;
      }
      if (half.kind === 'quiet') {
        sfx.pitch();
      } else {
        sfx.pitch();
        timer.current = setTimeout(() => {
          sfx.hit();
          buzz(18);
          timer.current = setTimeout(() => {
            sfx.run(half.kind !== 'score');
            if (half.kind !== 'score') buzz([30, 40, 30]);
            timer.current = setTimeout(next, HALF_MS[half.kind] - 700);
          }, 380);
        }, 320);
        return clear;
      }
      timer.current = setTimeout(next, HALF_MS[half.kind]);
    } else if (phase === 'gameset') {
      sfx.drumroll(0.8);
      timer.current = setTimeout(() => setPhase('final'), GAMESET_MS);
    } else if (phase === 'final') {
      sfx.slam();
      buzz(outcome === 'win' ? [40, 60, 40, 60, 90] : 60);
      const t = setTimeout(() => {
        if (outcome === 'win') sfx.fanfare();
        else if (outcome === 'loss') sfx.lose();
        else sfx.draw();
      }, 180);
      return () => clearTimeout(t);
    }
    return clear;

    function next() {
      setHalfIndex((i) => i + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, halfIndex]);

  const skip = useCallback(() => {
    if (phase === 'final') return;
    clear();
    setHalfIndex(halves.length);
    setPhase('final');
  }, [phase, halves.length]);

  // 表示用の得点（ここまでに終わった回 + いまの回の得点は打球のあと）
  const current = phase === 'play' ? halves[halfIndex] : undefined;
  const playedCount = phase === 'play' ? Math.max(0, halfIndex) : phase === 'intro' ? 0 : halves.length;
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    setLanded(false);
    if (!current || current.runs === 0) return;
    const t = setTimeout(() => setLanded(true), 700);
    return () => clearTimeout(t);
  }, [current]);

  const runsOf = (top: boolean) =>
    halves
      .slice(0, playedCount)
      .filter((h) => h.top === top)
      .reduce((a, h) => a + h.runs, 0) + (current && current.top === top && landed ? current.runs : 0);
  const awayScore = phase === 'final' ? result.away.runs : runsOf(true);
  const homeScore = phase === 'final' ? result.home.runs : runsOf(false);

  const cellShown = (top: boolean, inningIdx: number) => {
    const idx = halves.findIndex((h) => h.inning === inningIdx + 1 && h.top === top);
    if (idx < 0) return false;
    if (idx < playedCount) return true;
    return idx === halfIndex && phase === 'play' && (current!.runs === 0 || landed);
  };

  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length, 9);
  const winP = state.players.find((p) => p.id === result.winningPitcherId);
  const loseP = state.players.find((p) => p.id === result.losingPitcherId);
  const record = state.records[mineId];
  const hostVisual = teamVisual(home);

  return (
    <div
      className={`live-bc phase-${phase} outcome-${outcome}${reduced ? ' reduced' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="試合中継"
      onClick={phase === 'final' ? undefined : skip}
    >
      <StadiumBackdrop />

      <div className="live-top">
        <span className="live-dot" aria-hidden="true" />
        <span className="live-on">{phase === 'final' ? 'FINAL' : 'LIVE'}</span>
        <span className="live-where">
          {formatDateJa(result.date)}　{hostVisual.stadiumName}
        </span>
      </div>

      {/* ── スコアボード ── */}
      <div className="live-board">
        <BoardRow team={away} score={awayScore} batting={current?.top === true} mine={away.id === mineId} />
        <BoardRow team={home} score={homeScore} batting={current?.top === false} mine={home.id === mineId} />
        <div className="live-lines" aria-hidden="true">
          {[true, false].map((top) => (
            <div key={String(top)} className="live-lines-row">
              {Array.from({ length: innings }, (_, i) => {
                const runs = (top ? result.away.inningRuns : result.home.inningRuns)[i];
                const shown = cellShown(top, i);
                const now =
                  phase === 'play' && current && current.top === top && current.inning === i + 1;
                return (
                  <span
                    key={i}
                    className={`live-cell${shown ? ' on' : ''}${now ? ' now' : ''}${shown && runs > 0 ? ' scored' : ''}`}
                  >
                    {!top && phase === 'final' && skipsLastBottom(result, i)
                      ? 'X'
                      : shown
                        ? runs
                        : ''}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── グラウンド ── */}
      {phase !== 'final' && (
        <div className="live-field-wrap">
          <Field half={current} halfKey={`${halfIndex}`} />
          {current && (
            <div className="live-inning" key={`inn-${halfIndex}`}>
              <strong>{current.inning}</strong>回{current.top ? '表' : '裏'}
              <span className="live-inning-team">
                {(current.top ? away : home).shortName}の攻撃
              </span>
            </div>
          )}
          {current && current.runs > 0 && (
            <div className={`live-callout kind-${current.kind}`} key={`co-${halfIndex}`}>
              <span className="live-callout-main">
                {current.kind === 'walkoff'
                  ? 'サヨナラ!!'
                  : current.kind === 'homer'
                    ? 'HOME RUN!!'
                    : 'タイムリー!'}
              </span>
              <span className="live-callout-sub">+{current.runs}点</span>
            </div>
          )}
          {phase === 'intro' && (
            <div className="live-intro">
              <div className="live-intro-team left">
                <TeamMark visual={teamVisual(away)} name={away.name} size={64} />
                <span>{away.shortName}</span>
              </div>
              <div className="live-intro-vs">VS</div>
              <div className="live-intro-team right">
                <TeamMark visual={teamVisual(home)} name={home.name} size={64} />
                <span>{home.shortName}</span>
              </div>
              <div className="live-playball">PLAY BALL!</div>
            </div>
          )}
          {phase === 'gameset' && <div className="live-gameset">GAME SET</div>}
        </div>
      )}

      {/* ── 実況 ── */}
      {phase === 'play' && current && (
        <div className="live-ticker" key={`tk-${halfIndex}`}>
          {pickLines(current).map((line, i) => (
            <div key={i} className="live-ticker-line" style={{ animationDelay: `${120 + i * 180}ms` }}>
              {line}
            </div>
          ))}
        </div>
      )}

      {/* ── 結果 ── */}
      {phase === 'final' && (
        <div className="live-final">
          {outcome === 'win' && !reduced && <Confetti />}
          <div className="live-flash" aria-hidden="true" />
          <div className="live-stamp">
            {outcome === 'win' ? '勝利' : outcome === 'loss' ? '敗戦' : '引分'}
          </div>
          <div className="live-final-score">
            <span>{away.shortName}</span>
            <strong>
              {result.away.runs}
              <em>-</em>
              {result.home.runs}
            </strong>
            <span>{home.shortName}</span>
          </div>
          {outcome !== 'draw' && (
            <img
              className="live-final-banner"
              src={outcome === 'win' ? gameWinArt : gameLossArt}
              alt={outcome === 'win' ? '勝利' : '敗北'}
            />
          )}
          <div className="live-final-meta">
            {result.innings > 9 && <span>延長{result.innings}回</span>}
            <span>
              勝 {winP?.name ?? '－'}　負 {loseP?.name ?? '－'}
            </span>
            {record && (
              <span className="live-final-record">
                今季 {record.wins}勝{record.losses}敗{record.draws}分
              </span>
            )}
          </div>
          <button
            type="button"
            className="live-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            試合の資料を見る
          </button>
          {onNext && (
            <button
              type="button"
              className="live-next"
              onClick={(e) => {
                e.stopPropagation();
                onNext();
              }}
            >
              次の試合へ ▶
            </button>
          )}
        </div>
      )}

      {phase !== 'final' && (
        <button
          type="button"
          className="live-skip"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
        >
          SKIP ▶▶
        </button>
      )}
    </div>
  );
}

function BoardRow({
  team,
  score,
  batting,
  mine,
}: {
  team: Team;
  score: number;
  batting: boolean;
  mine: boolean;
}) {
  const visual = useMemo(() => teamVisual(team), [team]);
  return (
    <div className={`live-row${batting ? ' batting' : ''}${mine ? ' mine' : ''}`}>
      <span className="live-row-bar" style={{ background: team.color }} />
      <TeamMark visual={visual} name={team.name} size={28} />
      <span className="live-row-name">{team.shortName}</span>
      {batting && <span className="live-row-bat" aria-label="攻撃中">●</span>}
      {/* key に得点を入れて、点が入るたびに数字を弾ませる */}
      <span className="live-row-score" key={score}>
        {score}
      </span>
    </div>
  );
}

/** 夜の球場。照明の光が首を振る */
function StadiumBackdrop() {
  return (
    <div className="live-bg" aria-hidden="true">
      <div className="live-sky" />
      <div className="live-beam b1" />
      <div className="live-beam b2" />
      <div className="live-crowd" />
      <div className="live-light l1" />
      <div className="live-light l2" />
    </div>
  );
}

/** 上から見下ろした内野。投球 → 打球 → 走者の順に動く */
function Field({ half, halfKey }: { half: Half | undefined; halfKey: string }) {
  const kind = half?.kind ?? 'idle';
  const runners = half ? Math.min(3, half.runs) : 0;
  return (
    <svg className={`live-field kind-${kind}`} viewBox="0 0 320 210" key={halfKey}>
      <defs>
        <radialGradient id="lb-grass" cx="50%" cy="100%" r="95%">
          <stop offset="0%" stopColor="#3fa34d" />
          <stop offset="100%" stopColor="#1f6b31" />
        </radialGradient>
      </defs>
      {/* 外野と内野 */}
      <path d="M160 206 L6 60 Q160 -40 314 60 Z" fill="url(#lb-grass)" />
      <path d="M160 206 L6 60 Q160 -40 314 60 Z" fill="none" stroke="#fff" strokeOpacity=".35" />
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          d={`M160 206 L${6 + i * 51.3} ${60 - Math.sin((i / 6) * Math.PI) * 36} L${6 + (i + 1) * 51.3} ${60 - Math.sin(((i + 1) / 6) * Math.PI) * 36} Z`}
          fill="#fff"
          opacity={i % 2 ? 0.04 : 0}
        />
      ))}
      <path d="M160 200 L96 138 L160 76 L224 138 Z" fill="#c9905a" />
      <path d="M160 190 L106 138 L160 88 L214 138 Z" fill="#3a9447" />
      <circle cx="160" cy="140" r="9" fill="#c9905a" />
      {/* 塁 */}
      <rect x="156" y="194" width="8" height="8" fill="#fff" transform="rotate(45 160 198)" />
      <rect x="219" y="134" width="9" height="9" fill="#fff" transform="rotate(45 223.5 138.5)" />
      <rect x="156" y="78" width="9" height="9" fill="#fff" transform="rotate(45 160.5 82.5)" />
      <rect x="92" y="134" width="9" height="9" fill="#fff" transform="rotate(45 96.5 138.5)" />
      {/* 走者（得点の回だけ、本塁に駆け込む） */}
      {Array.from({ length: runners }, (_, i) => (
        <circle key={i} className={`lb-runner r${i}`} r="5" cx="160" cy="198" />
      ))}
      {/* 投手と打者 */}
      <circle cx="160" cy="138" r="4.5" fill="#f4f1ea" stroke="#0b1a33" strokeWidth="1.5" />
      <circle className="lb-batter" cx="172" cy="196" r="4.5" fill="#f4f1ea" stroke="#0b1a33" strokeWidth="1.5" />
      {/* ボールと影 */}
      <ellipse className="lb-shadow" cx="160" cy="140" rx="4" ry="1.6" fill="#000" opacity=".35" />
      <circle className="lb-ball" cx="160" cy="140" r="3.4" fill="#fff" />
      {kind !== 'quiet' && kind !== 'idle' && <circle className="lb-impact" cx="160" cy="194" r="6" />}
    </svg>
  );
}

/** 勝った日の紙吹雪。配置は index から決める（乱数は使わない） */
function Confetti() {
  const colors = ['#ffcf3f', '#e63946', '#2a9df4', '#ffffff', '#3fbf6a', '#ff8fb1'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 72 }, (_, i) => {
        const x = (i * 37) % 100;
        const delay = ((i * 53) % 90) / 100;
        const dur = 2.2 + ((i * 29) % 16) / 10;
        const drift = ((i * 71) % 60) - 30;
        const rot = (i * 97) % 360;
        return (
          <span
            key={i}
            style={
              {
                left: `${x}%`,
                background: colors[i % colors.length],
                animationDelay: `${delay}s`,
                animationDuration: `${dur}s`,
                '--drift': `${drift}vw`,
                '--rot': `${rot}deg`,
                width: i % 3 === 0 ? 6 : 9,
                height: i % 3 === 0 ? 12 : 6,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
