/**
 * 歴史・記録（PHASE 3.7）。
 *
 * ゲームの意思決定には関わらない「結果の記録」だけを扱う層。
 *
 *   シーズン終了
 *     → 選手のシーズン成績を球団別に確定
 *     → 球団のシーズン成績・順位を確定
 *     → タイトル・表彰を決める
 *     → 球団記録・リーグ記録を更新
 *     → （引退時）殿堂入りの判定
 *
 * 設計上の約束：
 *  - 同じ年を二度確定しても成績が二重にならない（year で重複チェック）。
 *  - 成績は試合結果から積み上げた値をそのまま使い、推測で作らない。
 *  - 引退した選手の成績は以後変化しない。
 */
import type {
  BattingStats,
  GameState,
  HistoryState,
  LeaderKey,
  LeagueSeasonHistory,
  PitchingStats,
  Player,
  PlayerAward,
  PlayerHistory,
  PlayerSeasonHistoryEntry,
  PlayerSeasonStats,
  RecordBook,
  RecordEvent,
  RecordHolder,
  SeasonHistory,
  SeasonLeader,
  TeamSeasonHistory,
  AwardKind,
  HallOfFameEntry,
} from './types';
import {
  addBatting,
  addPitching,
  average,
  emptyBatting,
  emptyPitching,
  era,
  packBatting,
  packPitching,
  unpackBatting,
  unpackPitching,
} from './stats';
import { standingsForLeague } from './standings';
import { judgeHallOfFame } from './hallOfFame';
import { generateAwardNews, generateRecordNews } from './news';

/* ---------------- 初期状態 ---------------- */

export function createHistoryState(): HistoryState {
  return {
    seasons: [],
    players: {},
    teamRecords: {},
    leagueRecords: {},
    events: [],
    hallOfFame: [],
  };
}

/** 保存データに歴史が無い（PHASE 3.6 以前のセーブ）場合に備える */
export function ensureHistory(state: GameState): HistoryState {
  if (!state.history) state.history = createHistoryState();
  const h = state.history;
  if (!Array.isArray(h.seasons)) h.seasons = [];
  if (!h.players) h.players = {};
  if (!h.teamRecords) h.teamRecords = {};
  if (!h.leagueRecords) h.leagueRecords = {};
  if (!Array.isArray(h.events)) h.events = [];
  if (!Array.isArray(h.hallOfFame)) h.hallOfFame = [];
  return h;
}

/* ---------------- 成績の小道具 ---------------- */

export const isEmptyBatting = (b: BattingStats) => b.games === 0 && b.plateAppearances === 0;
export const isEmptyPitching = (p: PitchingStats) => p.games === 0 && p.outs === 0;

export function emptyCareer(): { batting: BattingStats; pitching: PitchingStats } {
  return { batting: emptyBatting(), pitching: emptyPitching() };
}

/** 出塁率（犠飛・死球は扱っていないので (安打+四球)/(打数+四球)） */
export function onBasePercentage(b: BattingStats): number {
  const denom = b.atBats + b.walks;
  return denom === 0 ? 0 : (b.hits + b.walks) / denom;
}

/** 長打率 */
export function sluggingPercentage(b: BattingStats): number {
  if (b.atBats === 0) return 0;
  const singles = b.hits - b.doubles - b.triples - b.homeRuns;
  const bases = singles + b.doubles * 2 + b.triples * 3 + b.homeRuns * 4;
  return bases / b.atBats;
}

/** WHIP（1イニングあたりの被安打+与四球） */
export function whip(p: PitchingStats): number {
  if (p.outs === 0) return 0;
  return (p.hitsAllowed + p.walks) / (p.outs / 3);
}

/* ---------------- 選手の歴史 ---------------- */

export function birthYearOf(player: Player, year: number): number {
  return year - player.age;
}

export function newPlayerHistory(player: Player, year: number): PlayerHistory {
  return {
    playerId: player.id,
    name: player.name,
    mainPosition: player.mainPosition,
    isPitcher: player.isPitcher,
    birthYear: birthYearOf(player, year),
    debutYear: player.ext.debutYear ?? year,
    retiredAt: null,
    seasons: [],
    career: emptyCareer(),
    awards: [],
    records: 0,
    championships: 0,
    finalOverall: null,
  };
}

export function playerHistoryOf(history: HistoryState, playerId: string): PlayerHistory | undefined {
  return history.players[playerId];
}

/** 在籍した球団を「2025〜2028 東京」の形にまとめる（成績のある年から作る） */
export function careerTeamSpans(
  history: PlayerHistory,
): Array<{ teamId: string; from: number; to: number }> {
  const spans: Array<{ teamId: string; from: number; to: number }> = [];
  for (const entry of history.seasons) {
    const last = spans[spans.length - 1];
    if (last && last.teamId === entry.teamId && entry.year <= last.to + 1) {
      last.to = Math.max(last.to, entry.year);
      continue;
    }
    spans.push({ teamId: entry.teamId, from: entry.year, to: entry.year });
  }
  return spans;
}

/** その年・その選手の成績（複数球団に分かれていれば合算） */
export function seasonTotalOf(
  history: PlayerHistory,
  year: number,
): { batting: BattingStats; pitching: PitchingStats } {
  const total = emptyCareer();
  for (const entry of history.seasons) {
    if (entry.year !== year) continue;
    addBatting(total.batting, unpackBatting(entry.b));
    addPitching(total.pitching, unpackPitching(entry.p));
  }
  return total;
}

/** 履歴の1行を読める形に戻す */
export function statsOfEntry(entry: PlayerSeasonHistoryEntry): {
  batting: BattingStats;
  pitching: PitchingStats;
} {
  return { batting: unpackBatting(entry.b), pitching: unpackPitching(entry.p) };
}

/* ---------------- タイトル・表彰 ---------------- */

/** 規定打席・規定投球回（シーズンの試合数に比例させる） */
export function qualifiedAtBats(games: number): number {
  return Math.max(1, Math.round(games * 2.4));
}
export function qualifiedOuts(games: number): number {
  return Math.max(1, Math.round(games * 3));
}

export interface LeaguePlayerStats {
  playerId: string;
  name: string;
  teamId: string;
  isPitcher: boolean;
  debutYear: number;
  batting: BattingStats;
  pitching: PitchingStats;
}

/** そのタイトルは「大きいほど良い」か */
export function higherIsBetter(key: LeaderKey): boolean {
  return key !== 'era';
}

export function valueOf(entry: LeaguePlayerStats, key: LeaderKey, games: number): number | null {
  switch (key) {
    case 'average':
      return entry.batting.atBats >= qualifiedAtBats(games) ? average(entry.batting) : null;
    case 'homeRuns':
      return entry.batting.homeRuns > 0 ? entry.batting.homeRuns : null;
    case 'hits':
      return entry.batting.hits > 0 ? entry.batting.hits : null;
    case 'rbi':
      return entry.batting.rbi > 0 ? entry.batting.rbi : null;
    case 'steals':
      return entry.batting.steals > 0 ? entry.batting.steals : null;
    case 'wins':
      return entry.pitching.wins > 0 ? entry.pitching.wins : null;
    case 'strikeouts':
      return entry.pitching.strikeouts > 0 ? entry.pitching.strikeouts : null;
    case 'era':
      return entry.pitching.outs >= qualifiedOuts(games) ? era(entry.pitching) : null;
    case 'saves':
      return entry.pitching.saves > 0 ? entry.pitching.saves : null;
  }
}

export const LEADER_KEYS: LeaderKey[] = [
  'average',
  'homeRuns',
  'hits',
  'rbi',
  'steals',
  'wins',
  'strikeouts',
  'era',
  'saves',
];

export const LEADER_LABELS: Record<LeaderKey, string> = {
  average: '打率',
  homeRuns: '本塁打',
  hits: '安打',
  rbi: '打点',
  steals: '盗塁',
  wins: '勝利',
  strikeouts: '奪三振',
  era: '防御率',
  saves: 'セーブ',
};

export const AWARD_LABELS: Record<AwardKind, string> = {
  MVP: 'MVP',
  BEST_PITCHER: '最優秀投手',
  ROOKIE: '新人王',
  BATTING_TITLE: '首位打者',
  HOME_RUN_KING: '本塁打王',
  RBI_KING: '打点王',
  STEAL_KING: '盗塁王',
  WINS_TITLE: '最多勝',
  ERA_TITLE: '最優秀防御率',
  STRIKEOUT_TITLE: '最多奪三振',
  SAVES_TITLE: '最多セーブ',
  CS_MVP: 'CS MVP',
  JAPAN_SERIES_MVP: '日本シリーズMVP',
};

export const TITLE_OF_LEADER: Record<LeaderKey, AwardKind> = {
  average: 'BATTING_TITLE',
  homeRuns: 'HOME_RUN_KING',
  hits: 'BATTING_TITLE',
  rbi: 'RBI_KING',
  steals: 'STEAL_KING',
  wins: 'WINS_TITLE',
  strikeouts: 'STRIKEOUT_TITLE',
  era: 'ERA_TITLE',
  saves: 'SAVES_TITLE',
};

/** 打者としての貢献度（MVP選考の素点） */
export function battingScore(b: BattingStats): number {
  return (
    b.hits * 1 +
    b.doubles * 0.8 +
    b.triples * 1.4 +
    b.homeRuns * 2.6 +
    b.rbi * 0.9 +
    b.runs * 0.6 +
    b.walks * 0.35 +
    b.steals * 0.5 -
    b.strikeouts * 0.12
  );
}

/** 投手としての貢献度（MVP選考の素点） */
export function pitchingScore(p: PitchingStats): number {
  const innings = p.outs / 3;
  const quality = p.outs === 0 ? 0 : Math.max(0, 5.2 - era(p)) * innings * 0.5;
  return p.wins * 5 + p.saves * 3.2 + p.holds * 1.6 + p.strikeouts * 0.24 + quality - p.losses * 1.6;
}

/* ---------------- シーズンの確定 ---------------- */

/** その年をすでに記録しているか（二重実行の防止） */
export function hasSeason(history: HistoryState, year: number): boolean {
  return history.seasons.some((s) => s.year === year);
}

export function teamStatsOf(state: GameState, teamId: string): {
  batting: BattingStats;
  pitching: PitchingStats;
} {
  const total = emptyCareer();
  for (const byTeam of Object.values(state.teamStats ?? {})) {
    const stats = byTeam[teamId];
    if (!stats) continue;
    addBatting(total.batting, stats.batting);
    addPitching(total.pitching, stats.pitching);
  }
  return total;
}

export function collectLeaguePlayers(state: GameState, leagueId: string): LeaguePlayerStats[] {
  const teamIds = new Set(state.teams.filter((t) => t.leagueId === leagueId).map((t) => t.id));
  const list: LeaguePlayerStats[] = [];
  for (const player of state.players) {
    if (!teamIds.has(player.teamId)) continue;
    // リーグのタイトルは「そのリーグの球団で挙げた成績」で決める
    const byTeam = state.teamStats?.[player.id] ?? {};
    const batting = emptyBatting();
    const pitching = emptyPitching();
    for (const [teamId, stats] of Object.entries(byTeam)) {
      if (!teamIds.has(teamId)) continue;
      addBatting(batting, stats.batting);
      addPitching(pitching, stats.pitching);
    }
    if (isEmptyBatting(batting) && isEmptyPitching(pitching)) continue;
    list.push({
      playerId: player.id,
      name: player.name,
      teamId: player.teamId,
      isPitcher: player.isPitcher,
      debutYear: player.ext.debutYear ?? state.year,
      batting,
      pitching,
    });
  }
  return list;
}

export function pickLeaders(
  players: LeaguePlayerStats[],
  games: number,
): Partial<Record<LeaderKey, SeasonLeader>> {
  const leaders: Partial<Record<LeaderKey, SeasonLeader>> = {};
  for (const key of LEADER_KEYS) {
    let best: { entry: LeaguePlayerStats; value: number } | null = null;
    for (const entry of players) {
      const value = valueOf(entry, key, games);
      if (value === null) continue;
      if (
        best === null ||
        (higherIsBetter(key) ? value > best.value : value < best.value) ||
        // 同じ値なら選手IDで決めて、実行するたびに変わらないようにする
        (value === best.value && entry.playerId < best.entry.playerId)
      ) {
        best = { entry, value };
      }
    }
    if (best) {
      leaders[key] = {
        playerId: best.entry.playerId,
        name: best.entry.name,
        teamId: best.entry.teamId,
        value: best.value,
      };
    }
  }
  return leaders;
}

export function pickAwards(
  players: LeaguePlayerStats[],
  championTeamId: string,
  year: number,
): { mvp: string | null; bestPitcher: string | null; rookie: string | null } {
  const teamBonus = (teamId: string) => (teamId === championTeamId ? 1.15 : 1);
  let mvp: { id: string; score: number } | null = null;
  let bestPitcher: { id: string; score: number } | null = null;
  let rookie: { id: string; score: number } | null = null;

  for (const entry of players) {
    const raw = battingScore(entry.batting) + pitchingScore(entry.pitching);
    const score = raw * teamBonus(entry.teamId);
    if (raw <= 0) continue;
    if (mvp === null || score > mvp.score || (score === mvp.score && entry.playerId < mvp.id)) {
      mvp = { id: entry.playerId, score };
    }
    if (entry.pitching.outs > 0) {
      const ps = pitchingScore(entry.pitching) * teamBonus(entry.teamId);
      if (
        ps > 0 &&
        (bestPitcher === null ||
          ps > bestPitcher.score ||
          (ps === bestPitcher.score && entry.playerId < bestPitcher.id))
      ) {
        bestPitcher = { id: entry.playerId, score: ps };
      }
    }
    if (entry.debutYear === year) {
      if (
        rookie === null ||
        score > rookie.score ||
        (score === rookie.score && entry.playerId < rookie.id)
      ) {
        rookie = { id: entry.playerId, score };
      }
    }
  }
  return {
    mvp: mvp?.id ?? null,
    bestPitcher: bestPitcher?.id ?? null,
    rookie: rookie?.id ?? null,
  };
}

/* ---------------- 記録の更新 ---------------- */

export function emptyRecordBook(): RecordBook {
  return { season: {}, career: {} };
}

export function bookFor(map: Record<string, RecordBook>, id: string): RecordBook {
  let book = map[id];
  if (!book) {
    book = emptyRecordBook();
    map[id] = book;
  }
  return book;
}

export function beats(key: LeaderKey, value: number, previous: number | undefined): boolean {
  if (previous === undefined) return true;
  return higherIsBetter(key) ? value > previous : value < previous;
}

/**
 * シーズン記録を更新する。更新できたら RecordEvent を返す。
 */
export function updateSeasonRecord(
  book: RecordBook,
  key: LeaderKey,
  holder: RecordHolder,
  scope: 'league' | 'team',
  ownerId: string,
): RecordEvent | null {
  const current = book.season[key];
  if (!beats(key, holder.value, current?.value)) return null;
  book.season[key] = holder;
  // 初めて記録が載っただけのときは「更新」ではないので出来事にしない
  if (!current) return null;
  return {
    year: holder.year,
    scope,
    ownerId,
    kind: 'season',
    key,
    playerId: holder.playerId,
    name: holder.name,
    value: holder.value,
    previous: current?.value ?? null,
  };
}


/** 通算記録のキーと、その値の取り出し方 */
const CAREER_RECORD_SOURCES: Array<{
  key: import('./types').CareerRecordKey;
  of: (career: { batting: BattingStats; pitching: PitchingStats }) => number;
}> = [
  { key: 'hits', of: (c) => c.batting.hits },
  { key: 'homeRuns', of: (c) => c.batting.homeRuns },
  { key: 'rbi', of: (c) => c.batting.rbi },
  { key: 'steals', of: (c) => c.batting.steals },
  { key: 'wins', of: (c) => c.pitching.wins },
  { key: 'strikeouts', of: (c) => c.pitching.strikeouts },
  { key: 'saves', of: (c) => c.pitching.saves },
];

export const CAREER_RECORD_LABELS: Record<import('./types').CareerRecordKey, string> = {
  hits: '通算安打',
  homeRuns: '通算本塁打',
  rbi: '通算打点',
  steals: '通算盗塁',
  wins: '通算勝利',
  strikeouts: '通算奪三振',
  saves: '通算セーブ',
};

function updateCareerRecord(
  book: RecordBook,
  key: import('./types').CareerRecordKey,
  holder: RecordHolder,
  scope: 'league' | 'team',
  ownerId: string,
): RecordEvent | null {
  const current = book.career[key];
  if (holder.value <= 0) return null;
  if (current && holder.value <= current.value) return null;
  // 同じ選手が記録を伸ばし続けるだけのときは出来事にしない
  const isSameHolder = current?.playerId === holder.playerId;
  book.career[key] = holder;
  if (isSameHolder || !current) return null;
  return {
    year: holder.year,
    scope,
    ownerId,
    kind: 'career',
    key,
    playerId: holder.playerId,
    name: holder.name,
    value: holder.value,
    previous: current?.value ?? null,
  };
}

/**
 * 今季を歴史に確定する（PHASE 3.7 の入口）。
 *
 * シーズン終了直後、成長・引退でデータが変わる前に呼ぶ。
 * 同じ年に二度呼んでも二重に加算しない。
 */
export function finalizeSeason(state: GameState): SeasonHistory | null {
  const history = ensureHistory(state);
  const year = state.year;
  if (hasSeason(history, year)) return history.seasons.find((s) => s.year === year) ?? null;

  const teamStats = state.teamStats ?? {};
  const events: RecordEvent[] = [];

  // ---- 球団のシーズン成績・順位 ----
  const teamRows: TeamSeasonHistory[] = [];
  const championByLeague = new Map<string, string>();
  for (const league of state.leagues) {
    const table = standingsForLeague(state, league.id);
    championByLeague.set(league.id, table[0]?.teamId ?? '');
    for (const row of table) {
      const totals = teamStatsOf(state, row.teamId);
      teamRows.push({
        teamId: row.teamId,
        leagueId: league.id,
        rank: row.rank,
        games: row.games,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        winPct: row.winPct,
        runsScored: row.runsScored,
        runsAllowed: row.runsAllowed,
        champion: row.rank === 1,
        b: packBatting(totals.batting),
        p: packPitching(totals.pitching),
      });
    }
  }

  // ---- 選手のシーズン成績（球団別）を歴史に足す ----
  const awardsByPlayer = new Map<string, PlayerAward[]>();
  const leagueRows: LeagueSeasonHistory[] = [];
  const gamesPlayed = Math.max(
    1,
    Math.max(0, ...state.teams.map((t) => state.records[t.id]?.games ?? 0)),
  );

  for (const league of state.leagues) {
    const players = collectLeaguePlayers(state, league.id);
    const championTeamId = championByLeague.get(league.id) ?? '';
    const leaders = pickLeaders(players, gamesPlayed);
    const awards = pickAwards(players, championTeamId, year);

    const push = (playerId: string | null, kind: AwardKind) => {
      if (!playerId) return;
      const list = awardsByPlayer.get(playerId) ?? [];
      if (!list.some((a) => a.kind === kind)) list.push({ year, kind, leagueId: league.id });
      awardsByPlayer.set(playerId, list);
    };
    push(awards.mvp, 'MVP');
    push(awards.bestPitcher, 'BEST_PITCHER');
    push(awards.rookie, 'ROOKIE');
    for (const key of LEADER_KEYS) {
      const leader = leaders[key];
      if (leader) push(leader.playerId, TITLE_OF_LEADER[key]);
    }

    leagueRows.push({
      leagueId: league.id,
      championTeamId,
      leaders,
      mvpPlayerId: awards.mvp,
      bestPitcherPlayerId: awards.bestPitcher,
      rookiePlayerId: awards.rookie,
    });

    // ---- リーグ記録 ----
    const leagueBook = bookFor(history.leagueRecords, league.id);
    for (const key of LEADER_KEYS) {
      const leader = leaders[key];
      if (!leader) continue;
      const event = updateSeasonRecord(
        leagueBook,
        key,
        { ...leader, year },
        'league',
        league.id,
      );
      if (event) events.push(event);
    }
  }

  const championTeams = new Set([...championByLeague.values()]);

  // ---- PHASE 3.8: ポストシーズンの結果 ----
  const postseason = state.postseason?.year === year ? state.postseason : null;
  const participantIds = new Set(
    postseason ? Object.values(postseason.participants).flat() : [],
  );
  const leagueChampionIds = new Set(
    postseason ? Object.values(postseason.leagueChampions) : [],
  );
  const japanChampionId = postseason?.championTeamId ?? null;
  if (postseason) {
    for (const row of teamRows) {
      row.postseason = participantIds.has(row.teamId);
      row.leagueChampion = leagueChampionIds.has(row.teamId);
      row.japanChampion = row.teamId === japanChampionId;
    }
    for (const row of leagueRows) {
      const champion = postseason.leagueChampions[row.leagueId];
      if (champion) row.leagueChampionTeamId = champion;
      const mvp = postseason.csMvp[row.leagueId];
      if (mvp) {
        row.csMvpPlayerId = mvp;
        const list = awardsByPlayer.get(mvp) ?? [];
        if (!list.some((a) => a.kind === 'CS_MVP')) {
          list.push({ year, kind: 'CS_MVP', leagueId: row.leagueId });
        }
        awardsByPlayer.set(mvp, list);
      }
    }
    const jsMvp = postseason.japanSeriesMvpPlayerId;
    if (jsMvp) {
      const player = state.players.find((p) => p.id === jsMvp);
      const list = awardsByPlayer.get(jsMvp) ?? [];
      if (!list.some((a) => a.kind === 'JAPAN_SERIES_MVP')) {
        list.push({
          year,
          kind: 'JAPAN_SERIES_MVP',
          leagueId: state.teams.find((t) => t.id === player?.teamId)?.leagueId ?? '',
        });
      }
      awardsByPlayer.set(jsMvp, list);
    }
  }

  for (const player of state.players) {
    let entry = history.players[player.id];
    if (!entry) {
      entry = newPlayerHistory(player, year);
      history.players[player.id] = entry;
    }
    // 名前・守備位置は最新のものに合わせる（改名はしないが将来のため）
    entry.name = player.name;

    const byTeam = teamStats[player.id] ?? {};
    const teamIds = Object.keys(byTeam).sort();
    const rows: PlayerSeasonHistoryEntry[] =
      teamIds.length > 0
        ? teamIds.map((teamId) => ({ year, teamId, ...splitStats(byTeam[teamId]) }))
        : // 出場が無くても在籍していた記録として1行残す
          [{ year, teamId: player.teamId }];

    for (const row of rows) {
      entry.seasons.push(row);
      addBatting(entry.career.batting, unpackBatting(row.b));
      addPitching(entry.career.pitching, unpackPitching(row.p));
    }
    if (championTeams.has(player.teamId)) entry.championships += 1;

    // PHASE 3.8: ポストシーズンの進出・優勝・成績
    if (postseason) {
      if (participantIds.has(player.teamId)) {
        entry.postseasonAppearances = (entry.postseasonAppearances ?? 0) + 1;
      }
      if (leagueChampionIds.has(player.teamId)) {
        entry.leagueChampionships = (entry.leagueChampionships ?? 0) + 1;
      }
      if (player.teamId === japanChampionId) {
        entry.japanChampionships = (entry.japanChampionships ?? 0) + 1;
      }
      const line = postseason.stats[player.id];
      if (line) {
        if (!entry.postseasonCareer) entry.postseasonCareer = emptyCareer();
        addBatting(entry.postseasonCareer.batting, line.batting);
        addPitching(entry.postseasonCareer.pitching, line.pitching);
      }
    }

    const awards = awardsByPlayer.get(player.id);
    if (awards) entry.awards.push(...awards);
  }

  // ---- 球団記録（そのシーズンにその球団で挙げた成績で判定） ----
  for (const team of state.teams) {
    const book = bookFor(history.teamRecords, team.id);
    const members: LeaguePlayerStats[] = [];
    for (const player of state.players) {
      const stats = teamStats[player.id]?.[team.id];
      if (!stats) continue;
      members.push({
        playerId: player.id,
        name: player.name,
        teamId: team.id,
        isPitcher: player.isPitcher,
        debutYear: player.ext.debutYear ?? year,
        batting: stats.batting,
        pitching: stats.pitching,
      });
    }
    const leaders = pickLeaders(members, gamesPlayed);
    for (const key of LEADER_KEYS) {
      const leader = leaders[key];
      if (!leader) continue;
      const event = updateSeasonRecord(book, key, { ...leader, year }, 'team', team.id);
      if (event) events.push(event);
    }
  }

  // ---- 通算記録（リーグ全体・球団は「現在の所属」で見る） ----
  for (const player of state.players) {
    const entry = history.players[player.id];
    if (!entry) continue;
    const league = state.teams.find((t) => t.id === player.teamId)?.leagueId;
    for (const source of CAREER_RECORD_SOURCES) {
      const value = source.of(entry.career);
      const holder: RecordHolder = {
        playerId: player.id,
        name: player.name,
        teamId: player.teamId,
        year,
        value,
      };
      if (league) {
        const event = updateCareerRecord(
          bookFor(history.leagueRecords, league),
          source.key,
          holder,
          'league',
          league,
        );
        if (event) events.push(event);
      }
      const teamEvent = updateCareerRecord(
        bookFor(history.teamRecords, player.teamId),
        source.key,
        holder,
        'team',
        player.teamId,
      );
      if (teamEvent) events.push(teamEvent);
    }
  }

  for (const event of events) {
    const entry = history.players[event.playerId];
    if (entry) entry.records += 1;
    // PHASE 3.9: 記録更新をニュースにする（判定はやり直さない）
    const label =
      LEADER_LABELS[event.key as LeaderKey] ??
      CAREER_RECORD_LABELS[event.key as import('./types').CareerRecordKey] ??
      event.key;
    generateRecordNews(state, event, label.replace(/^通算/, ''));
  }
  history.events.push(...events);

  // PHASE 3.9: 表彰をニュースにする
  for (const row of leagueRows) {
    const leagueName = state.leagues.find((l) => l.id === row.leagueId)?.name ?? '';
    if (row.mvpPlayerId) {
      generateAwardNews(state, row.mvpPlayerId, 'MVP', leagueName, 'HIGH');
    }
    if (row.bestPitcherPlayerId) {
      generateAwardNews(state, row.bestPitcherPlayerId, '最優秀投手', leagueName);
    }
    if (row.rookiePlayerId) {
      generateAwardNews(state, row.rookiePlayerId, '新人王', leagueName, 'HIGH');
    }
    if (row.csMvpPlayerId) {
      generateAwardNews(state, row.csMvpPlayerId, 'クライマックスシリーズMVP', leagueName);
    }
  }
  if (postseason?.japanSeriesMvpPlayerId) {
    generateAwardNews(state, postseason.japanSeriesMvpPlayerId, '日本シリーズMVP', '', 'HIGH');
  }

  const season: SeasonHistory = {
    year,
    seasonLength: state.seasonLength,
    teams: teamRows,
    leagues: leagueRows,
  };
  if (postseason) {
    season.postseason = {
      participants: structuredClone(postseason.participants),
      series: postseason.series.map((s) => ({
        stage: s.stage,
        leagueId: s.leagueId,
        teamAId: s.teamAId,
        teamBId: s.teamBId,
        teamAWins: s.teamAWins,
        teamBWins: s.teamBWins,
        advantageA: s.advantageA,
        winnerTeamId: s.winnerTeamId,
        games: s.games.length,
      })),
      japanSeriesChampionTeamId: postseason.championTeamId,
      japanSeriesMvpPlayerId: postseason.japanSeriesMvpPlayerId,
    };
  }
  history.seasons.push(season);
  history.seasons.sort((a, b) => a.year - b.year);
  return season;
}

/** 成績を配列にして、空の側は省く（保存量を抑えるため） */
function splitStats(stats: PlayerSeasonStats): { b?: number[]; p?: number[] } {
  const out: { b?: number[]; p?: number[] } = {};
  if (!isEmptyBatting(stats.batting)) out.b = packBatting(stats.batting);
  if (!isEmptyPitching(stats.pitching)) out.p = packPitching(stats.pitching);
  return out;
}

/**
 * 引退した選手の歴史を確定する（PHASE 3.7）。
 * ロスターからは消えるが、ここで残した記録は以後変化しない。
 */
export function recordRetirements(
  state: GameState,
  retirements: Array<{ playerId: string; finalOverall: number }>,
): HallOfFameEntry[] {
  const history = ensureHistory(state);
  const inducted: HallOfFameEntry[] = [];
  for (const record of retirements) {
    const entry = history.players[record.playerId];
    if (!entry) continue;
    // 二度目の引退は起きないが、起きても成績を変えない
    if (entry.retiredAt !== null) continue;
    entry.retiredAt = state.year;
    entry.finalOverall = record.finalOverall;
    const hof = judgeHallOfFame(entry, state.year, state.seasonLength);
    if (hof && !history.hallOfFame.some((e) => e.playerId === hof.playerId)) {
      history.hallOfFame.push(hof);
      inducted.push(hof);
    }
  }
  return inducted;
}

/** 現役の選手（引退していない歴史） */
export function activeHistories(history: HistoryState): PlayerHistory[] {
  return Object.values(history.players).filter((p) => p.retiredAt === null);
}

/** 引退した選手の歴史 */
export function retiredHistories(history: HistoryState): PlayerHistory[] {
  return Object.values(history.players).filter((p) => p.retiredAt !== null);
}

/** ある球団の年度別の歩み（新しい順） */
export function teamSeasons(history: HistoryState, teamId: string): Array<{
  year: number;
  row: TeamSeasonHistory;
}> {
  const rows: Array<{ year: number; row: TeamSeasonHistory }> = [];
  for (const season of history.seasons) {
    const row = season.teams.find((t) => t.teamId === teamId);
    if (row) rows.push({ year: season.year, row });
  }
  return rows.reverse();
}

/** 優勝回数 */
export function championshipCount(history: HistoryState, teamId: string): number {
  return history.seasons.filter((s) => s.teams.some((t) => t.teamId === teamId && t.champion))
    .length;
}

/** 球団のシーズン成績を読める形に戻す */
export function teamSeasonStats(row: TeamSeasonHistory): {
  batting: BattingStats;
  pitching: PitchingStats;
} {
  return { batting: unpackBatting(row.b), pitching: unpackPitching(row.p) };
}

/* ---------------- ポストシーズンの集計（PHASE 3.8） ---------------- */

/** リーグ優勝（ファイナルステージ勝者）の回数 */
export function leagueChampionshipCount(history: HistoryState, teamId: string): number {
  return history.seasons.filter((s) =>
    s.teams.some((t) => t.teamId === teamId && t.leagueChampion),
  ).length;
}

/** 日本一の回数 */
export function japanChampionshipCount(history: HistoryState, teamId: string): number {
  return history.seasons.filter((s) => s.postseason?.japanSeriesChampionTeamId === teamId)
    .length;
}

/** クライマックスシリーズ進出の回数 */
export function postseasonAppearanceCount(history: HistoryState, teamId: string): number {
  return history.seasons.filter((s) =>
    s.teams.some((t) => t.teamId === teamId && t.postseason),
  ).length;
}

/** 日本シリーズ出場の回数 */
export function japanSeriesAppearanceCount(history: HistoryState, teamId: string): number {
  return history.seasons.filter((s) =>
    s.postseason?.series.some(
      (x) => x.stage === 'JAPAN_SERIES' && (x.teamAId === teamId || x.teamBId === teamId),
    ),
  ).length;
}

/** その年の日本一（ポストシーズンが無い年度は null） */
export function japanChampionOf(history: HistoryState, year: number): string | null {
  const season = history.seasons.find((s) => s.year === year);
  return season?.postseason?.japanSeriesChampionTeamId ?? null;
}
