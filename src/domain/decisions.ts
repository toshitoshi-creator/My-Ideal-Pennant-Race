/**
 * PHASE 4.4 GMの判断記録。
 *
 * 「すべてのクリック」は残さない（§20）。残すのは球団の進み方が変わる判断だけで、
 * 方針・起用方針・経営イベント・契約・トレード・FA の6種類にかぎる。
 *
 * ここに書くのは「そのときGMが何をどう決めたか」という事実だけ。
 * 良し悪しの評価はしない（§21）。あとから振り返ったときに、
 * 「結果が良かったから正しかった」という書き方にならないようにする。
 *
 * 乱数も現在時刻も使わない。同じ入力からは必ず同じ記録になる。
 */
import type { DecisionKind, DecisionRecord, GameState } from './types';

/** 保存する上限。古いものから捨てる（セーブ容量のため） */
export const DECISION_LIMIT = 300;

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
  DIRECTION: '球団方針',
  USAGE: '起用方針',
  EVENT: '経営判断',
  CONTRACT: '契約',
  TRADE: 'トレード',
  FA: 'FA',
};

/** 資料の欄名（§42：英字と日本語を必ずセットにする） */
export const DECISION_KIND_TAGS: Record<DecisionKind, string> = {
  DIRECTION: 'CLUB DIRECTION',
  USAGE: 'PLAYER USAGE',
  EVENT: 'CLUB DECISION',
  CONTRACT: 'CONTRACT',
  TRADE: 'TRADE',
  FA: 'FREE AGENCY',
};

export function createDecisionLog(): DecisionRecord[] {
  return [];
}

/** 古いセーブには decisions が無い。呼んだ側が必ず配列を得られるようにする */
export function ensureDecisions(state: GameState): DecisionRecord[] {
  if (!Array.isArray(state.decisions)) state.decisions = [];
  return state.decisions;
}

/**
 * 記録のID。同じ日に同じ対象へ同じ種類の判断をしたら同じIDになる。
 * これで「連打しても二重に残らない」ことを保証する（§37）。
 */
export function decisionId(date: string, kind: DecisionKind, key: string): string {
  return `${date}:${kind}:${key}`;
}

export interface DecisionInput {
  kind: DecisionKind;
  /** 同じ日の同じ対象を見分けるためのキー */
  key: string;
  /** 何についての判断か */
  title: string;
  /** 選んだ内容 */
  choice: string;
  /** そのとき球団がどういう状況だったか（後から読み返すため） */
  situation: string;
  playerIds?: string[];
}

/**
 * 判断を記録する。すでに同じIDがあれば新しい内容で置き換える
 * （同じ日に方針を選び直したら、最後に選んだものが残る）。
 *
 * 記録はゲームの進行・能力・乱数には一切影響しない。
 */
export function recordDecision(state: GameState, input: DecisionInput): DecisionRecord {
  const log = ensureDecisions(state);
  const record: DecisionRecord = {
    id: decisionId(state.date, input.kind, input.key),
    year: state.year,
    date: state.date,
    kind: input.kind,
    title: input.title,
    choice: input.choice,
    situation: input.situation,
    playerIds: input.playerIds ? [...input.playerIds] : [],
  };
  const index = log.findIndex((r) => r.id === record.id);
  if (index >= 0) {
    log[index] = record;
  } else {
    log.push(record);
    if (log.length > DECISION_LIMIT) log.splice(0, log.length - DECISION_LIMIT);
  }
  return record;
}

/** 新しい順に取り出す */
export function recentDecisions(state: GameState, limit = 30): DecisionRecord[] {
  const log = state.decisions ?? [];
  return log.slice(-limit).reverse();
}

/** その年の判断（新しい順） */
export function decisionsOfYear(state: GameState, year: number): DecisionRecord[] {
  return (state.decisions ?? []).filter((r) => r.year === year).reverse();
}

/** その日の判断（記録された順） */
export function decisionsOfDate(state: GameState, date: string): DecisionRecord[] {
  return (state.decisions ?? []).filter((r) => r.date === date);
}

/** 記録が残っている年（新しい順） */
export function decisionYears(state: GameState): number[] {
  const years = new Set<number>();
  for (const record of state.decisions ?? []) years.add(record.year);
  return [...years].sort((a, b) => b - a);
}

/**
 * その判断のあと、球団に何が起きたか（§21）。
 *
 * 「正解だった」「失敗だった」とは書かない。判断日より後の事実だけを並べる。
 * 判断していない期間（当日より前）は見ない。
 */
export interface DecisionOutcome {
  /** 判断後に消化した試合数 */
  games: number;
  /** 判断後の勝敗 */
  record: string | null;
  /** 関係する選手のいまの状況 */
  players: Array<{ playerId: string; name: string; text: string }>;
}

export function decisionOutcome(state: GameState, record: DecisionRecord): DecisionOutcome {
  const teamId = state.playerTeamId;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const result of state.results) {
    if (result.date <= record.date) continue;
    if (result.homeTeamId !== teamId && result.awayTeamId !== teamId) continue;
    if (!result.winnerTeamId) draws += 1;
    else if (result.winnerTeamId === teamId) wins += 1;
    else losses += 1;
  }
  const games = wins + losses + draws;

  const players: DecisionOutcome['players'] = [];
  for (const playerId of record.playerIds) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) continue;
    const stats = state.stats?.[playerId];
    const parts: string[] = [player.roster === 'first' ? '1軍' : '2軍'];
    if (player.ext.injury) parts.push(`${player.ext.injury.name}で離脱中`);
    if (stats) {
      if (player.isPitcher && stats.pitching.games > 0) {
        parts.push(`${stats.pitching.games}登板 ${stats.pitching.wins}勝${stats.pitching.losses}敗`);
      } else if (stats.batting.games > 0) {
        parts.push(`${stats.batting.games}試合 ${stats.batting.hits}安打${stats.batting.homeRuns}本`);
      }
    }
    players.push({ playerId, name: player.name, text: parts.join(' / ') });
  }

  return {
    games,
    record: games > 0 ? `${wins}勝${losses}敗${draws}分` : null,
    players,
  };
}
