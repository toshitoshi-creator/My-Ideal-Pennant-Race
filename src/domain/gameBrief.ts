/**
 * PHASE 4.4 試合前の資料と試合後の講評（§14〜§17）。
 *
 * どちらも「すでに確定していること」を読みやすく並べるだけで、
 * 試合の内容にも乱数にも一切影響しない（§41）。
 *
 * 試合前は今日の試合に関係する情報だけ。長文にしない（§14）。
 * 試合後は新聞の試合評のように、決まった場面・個人・チームの3段に分ける（§16）。
 * 「これで復活した」のような断定はしない（§17）。
 */
import type {
  BattingStats,
  GameResult,
  GameState,
  PitchingStats,
  Player,
} from './types';
import { nextGameForTeam } from './schedule';
import { nextStarterId } from './setup';
import { average, era, formatAverage, formatInnings } from './stats';
import { formatDateJa } from './dates';
import { performanceScore } from './playerAnalysis';
import { recentForm } from './gmDesk';
import { overallRating } from './rating';

/* ================= 試合前（§14） ================= */

export interface PreGameBrief {
  date: string;
  dateLabel: string;
  homeAway: 'HOME' | 'AWAY';
  opponentId: string;
  opponentName: string;
  /** 相手の公開されている成績（順位表に出ているものだけ） */
  opponentRecord: string;
  starterId: string | null;
  starterName: string;
  starterNote: string;
  /** 直近5試合 */
  teamForm: string;
  /** 今日の試合に関係することだけ。最大3件 */
  watch: string[];
}

/**
 * 次の試合の資料。試合が無ければ null。
 * 相手球団については、順位表で誰でも見られる範囲しか使わない（§31）。
 */
export function buildPreGameBrief(state: GameState): PreGameBrief | null {
  const teamId = state.playerTeamId;
  const next = nextGameForTeam(state.schedule, teamId, state.date);
  if (!next) return null;
  const opponentId = next.homeTeamId === teamId ? next.awayTeamId : next.homeTeamId;
  const opponent = state.teams.find((t) => t.id === opponentId);
  if (!opponent) return null;
  const opponentRecord = state.records[opponentId];

  const setup = state.setups[teamId];
  const starterId = setup ? nextStarterId(setup) : null;
  const starter = starterId ? state.players.find((p) => p.id === starterId) : undefined;

  const form = recentForm(state, 5);

  return {
    date: next.date,
    dateLabel: formatDateJa(next.date),
    homeAway: next.homeTeamId === teamId ? 'HOME' : 'AWAY',
    opponentId,
    opponentName: opponent.name,
    opponentRecord: opponentRecord
      ? `${opponentRecord.wins}勝${opponentRecord.losses}敗${opponentRecord.draws}分`
      : '記録なし',
    starterId: starterId ?? null,
    starterName: starter?.name ?? '未設定',
    starterNote: starter
      ? `${starter.throws === 'R' ? '右' : '左'}投・${starter.pitching?.velocity ?? '-'}km/h・疲労 ${Math.round(
          starter.ext.fatigue,
        )}`
      : 'ローテーションが設定されていません',
    teamForm:
      form.played > 0
        ? `直近${form.played}試合 ${form.wins}勝${form.losses}敗${form.draws}分`
        : 'まだ試合がありません',
    watch: buildWatch(state, teamId, starter),
  };
}

/** 今日の試合に関係することだけを3つまで（§14：長文にしない） */
function buildWatch(
  state: GameState,
  teamId: string,
  starter: Player | undefined,
): string[] {
  const watch: string[] = [];
  const mine = state.players
    .filter((p) => p.teamId === teamId && p.roster === 'first')
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  if (starter) {
    if (starter.ext.fatigue >= 62) {
      watch.push(`先発の${starter.name}は疲労 ${Math.round(starter.ext.fatigue)} で登板します`);
    } else if (starter.ext.condition === 'best' || starter.ext.condition === 'good') {
      watch.push(`先発の${starter.name}は調子が上向きです`);
    }
  }

  const tiredRelievers = mine.filter(
    (p) => p.isPitcher && (p.pitching?.stamina ?? 0) < 55 && p.ext.fatigue >= 62 && !p.ext.injury,
  );
  if (tiredRelievers.length >= 3) {
    watch.push(`中継ぎ${tiredRelievers.length}人の疲労が高い状態です`);
  }

  // 打線で今日いちばん調子が良い選手（今季の成績が出ている選手にかぎる）
  const batters = mine.filter((p) => !p.isPitcher && !p.ext.injury);
  let hot: { player: Player; score: number } | null = null;
  for (const player of batters) {
    const stats = state.stats?.[player.id];
    const score = performanceScore(player, stats);
    if (score === null) continue;
    if (!hot || score > hot.score) hot = { player, score };
  }
  if (hot && hot.score >= 58) {
    const stats = state.stats?.[hot.player.id];
    watch.push(
      `${hot.player.name}の今季打率は ${stats ? formatAverage(average(stats.batting)) : '-'} です`,
    );
  }

  const injured = mine.filter((p) => p.ext.injury).length;
  if (injured > 0 && watch.length < 3) {
    watch.push(`1軍登録のうち${injured}人が離脱中です`);
  }

  return watch.slice(0, 3);
}

/* ================= 試合後（§16・§17） ================= */

export interface KeyMoment {
  inning: number;
  /** 同点・勝ち越し・逃げ切り など */
  label: string;
  text: string;
}

export interface PostPlayerNote {
  playerId: string;
  name: string;
  /** 今日の成績 */
  today: string;
  /** 試合前までの成績（§17 BEFORE）。出場が少なければ null */
  before: string | null;
  /** 断定しない読み方 */
  note: string;
}

export interface PostGameReport {
  resultLabel: 'WIN' | 'LOSS' | 'DRAW';
  score: string;
  keyMoments: KeyMoment[];
  playerNotes: PostPlayerNote[];
  teamNote: string;
}

/**
 * 試合の流れ（§15・§16）。全打席は要らない。
 * inningRuns から読める「同点・勝ち越し・逃げ切り」だけを最大3つ。
 */
export function keyMoments(result: GameResult): KeyMoment[] {
  const moments: KeyMoment[] = [];
  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length);
  let away = 0;
  let home = 0;
  let lead = 0; // 1: home 優勢, -1: away 優勢, 0: 同点

  for (let i = 0; i < innings; i++) {
    const a = result.away.inningRuns[i] ?? 0;
    const h = result.home.inningRuns[i] ?? 0;
    if (a === 0 && h === 0) continue;
    away += a;
    home += h;
    const next = home > away ? 1 : home < away ? -1 : 0;
    const inning = i + 1;
    if (next !== lead) {
      if (next === 0) {
        moments.push({ inning, label: '同点', text: `${inning}回に同点（${away} - ${home}）` });
      } else if (lead === 0) {
        moments.push({
          inning,
          label: '先制',
          text: `${inning}回に先制（${away} - ${home}）`,
        });
      } else {
        moments.push({
          inning,
          label: '逆転',
          text: `${inning}回に逆転（${away} - ${home}）`,
        });
      }
      lead = next;
    } else if (next !== 0) {
      moments.push({
        inning,
        label: '追加点',
        text: `${inning}回に追加点（${away} - ${home}）`,
      });
    }
  }

  // 最後の場面は必ず残す。それ以外は前から詰めて3件まで
  const last = moments[moments.length - 1];
  const picked = moments.slice(0, 3);
  if (last && !picked.includes(last)) {
    picked[picked.length - 1] = last;
  }
  if (result.winnerTeamId && picked.length > 0) {
    const finalInning = result.innings;
    if (!picked.some((m) => m.inning === finalInning)) {
      picked.push({
        inning: finalInning,
        label: '決着',
        text: `${finalInning}回で決着（${result.away.runs} - ${result.home.runs}）`,
      });
    }
  }
  return picked.slice(0, 3);
}

/** 試合前までの成績を出すために、今日のぶんを引く */
function subtractBatting(season: BattingStats, today: BattingStats | null): BattingStats {
  if (!today) return season;
  const sub = (a: number, b: number) => Math.max(0, a - b);
  return {
    games: sub(season.games, today.games),
    plateAppearances: sub(season.plateAppearances, today.plateAppearances),
    atBats: sub(season.atBats, today.atBats),
    hits: sub(season.hits, today.hits),
    doubles: sub(season.doubles, today.doubles),
    triples: sub(season.triples, today.triples),
    homeRuns: sub(season.homeRuns, today.homeRuns),
    rbi: sub(season.rbi, today.rbi),
    runs: sub(season.runs, today.runs),
    steals: sub(season.steals, today.steals),
    strikeouts: sub(season.strikeouts, today.strikeouts),
    walks: sub(season.walks, today.walks),
  };
}

function subtractPitching(season: PitchingStats, today: PitchingStats | null): PitchingStats {
  if (!today) return season;
  const sub = (a: number, b: number) => Math.max(0, a - b);
  return {
    games: sub(season.games, today.games),
    starts: sub(season.starts, today.starts),
    outs: sub(season.outs, today.outs),
    wins: sub(season.wins, today.wins),
    losses: sub(season.losses, today.losses),
    holds: sub(season.holds, today.holds),
    saves: sub(season.saves, today.saves),
    strikeouts: sub(season.strikeouts, today.strikeouts),
    walks: sub(season.walks, today.walks),
    hitsAllowed: sub(season.hitsAllowed, today.hitsAllowed),
    homeRunsAllowed: sub(season.homeRunsAllowed, today.homeRunsAllowed),
    runsAllowed: sub(season.runsAllowed, today.runsAllowed),
    earnedRuns: sub(season.earnedRuns, today.earnedRuns),
  };
}

/** その選手の今日の働きを、ひとつの数字にする（並べ替えのためだけに使う） */
function contribution(line: GameResult['playerLines'][number]): number {
  let score = 0;
  if (line.batting) {
    score += line.batting.hits * 2 + line.batting.homeRuns * 3 + line.batting.rbi * 1.5;
    score += line.batting.walks * 0.5 + line.batting.steals * 0.8;
  }
  if (line.pitching) {
    score += (line.pitching.outs / 3) * 1.4 + line.pitching.strikeouts * 0.4;
    score -= line.pitching.earnedRuns * 1.2;
    score += line.pitching.wins * 2 + line.pitching.saves * 1.5 + line.pitching.holds * 1;
  }
  return score;
}

/**
 * 試合後の講評。state は読み取りだけ。
 * state.stats には今日のぶんがすでに入っている前提で、BEFORE は引き算で出す。
 */
export function buildPostGameReport(state: GameState, result: GameResult): PostGameReport {
  const teamId = state.playerTeamId;
  const isHome = result.homeTeamId === teamId;
  const myRuns = isHome ? result.home.runs : result.away.runs;
  const theirRuns = isHome ? result.away.runs : result.home.runs;
  const resultLabel: PostGameReport['resultLabel'] = !result.winnerTeamId
    ? 'DRAW'
    : result.winnerTeamId === teamId
      ? 'WIN'
      : 'LOSS';

  const lines = result.playerLines
    .filter((line) => line.teamId === teamId)
    .sort((a, b) => {
      const diff = contribution(b) - contribution(a);
      return diff !== 0 ? diff : a.playerId < b.playerId ? -1 : 1;
    })
    .slice(0, 3);

  const playerNotes: PostPlayerNote[] = [];
  for (const line of lines) {
    const player = state.players.find((p) => p.id === line.playerId);
    if (!player) continue;
    const season = state.stats?.[player.id];
    const today = line.pitching
      ? `${formatInnings(line.pitching.outs)}回 ${line.pitching.earnedRuns}自責 ${line.pitching.strikeouts}奪三振`
      : line.batting
        ? `${line.batting.atBats}打数${line.batting.hits}安打${
            line.batting.homeRuns > 0 ? `（本塁打${line.batting.homeRuns}）` : ''
          }`
        : '記録なし';

    let before: string | null = null;
    let note = '今日の記録です。';
    if (season) {
      if (line.pitching) {
        const prior = subtractPitching(season.pitching, line.pitching);
        if (prior.games > 0) {
          before = `${prior.games}登板 防御率 ${era(prior).toFixed(2)}`;
          const priorEra = era(prior);
          const todayEra = line.pitching.outs > 0 ? (line.pitching.earnedRuns * 27) / line.pitching.outs : 0;
          note =
            todayEra < priorEra
              ? '今日の内容は、今季ここまでの平均より失点が少ない登板でした。'
              : todayEra > priorEra
                ? '今日の内容は、今季ここまでの平均より失点が多い登板でした。'
                : '今季ここまでの水準どおりの登板でした。';
        }
      } else if (line.batting) {
        const prior = subtractBatting(season.batting, line.batting);
        if (prior.atBats >= 10) {
          before = `${prior.games}試合 打率 ${formatAverage(average(prior))}`;
          const todayHits = line.batting.hits;
          note =
            todayHits >= 2
              ? '今日は複数安打でした。1試合だけで傾向が変わったとは言えません。'
              : todayHits === 0
                ? '今日は安打がありませんでした。1試合だけで傾向が変わったとは言えません。'
                : '今季ここまでの水準どおりの内容でした。';
        }
      }
    }
    playerNotes.push({ playerId: player.id, name: player.name, today, before, note });
  }

  const form = recentForm(state, 5);
  const record = state.records[teamId];
  const teamNote =
    form.played > 0
      ? `直近${form.played}試合 ${form.wins}勝${form.losses}敗${form.draws}分。今季は ${record.wins}勝${record.losses}敗${record.draws}分です。`
      : `今季は ${record.wins}勝${record.losses}敗${record.draws}分です。`;

  return {
    resultLabel,
    score: `${myRuns} - ${theirRuns}`,
    keyMoments: keyMoments(result),
    playerNotes,
    teamNote,
  };
}

/** 試合前資料で相手の先発を出さない理由：まだ公表されていないため（他球団の内部情報は使わない） */
export function opponentStrengthHint(state: GameState, opponentId: string): string {
  const record = state.records[opponentId];
  if (!record || record.games === 0) return '対戦成績はまだありません。';
  const rate = record.wins / Math.max(1, record.wins + record.losses);
  return `相手は今季 ${record.wins}勝${record.losses}敗（勝率 ${rate.toFixed(3)}）です。`;
}

/** 1軍の平均的な能力（試合前資料の目安に使う） */
export function firstTeamOverall(state: GameState, teamId: string): number {
  const players = state.players.filter((p) => p.teamId === teamId && p.roster === 'first');
  if (players.length === 0) return 0;
  return Math.round(
    players.reduce((sum, p) => sum + overallRating(p), 0) / players.length,
  );
}
