/**
 * FA移籍の人的補償とプロテクト（NPB にならう）。
 *
 *  - 市場評価 S・A・B の選手が、元の球団から別の球団へFA移籍したとき
 *    元の球団は、移籍先のプロテクト外の選手から1人を補償として獲得できる
 *  - 各球団は28人までプロテクト（補償で渡さない選手）を決められる
 *    自球団はプレイヤーが決め、決めていなければ総合力の高い順に28人
 *    CPU 球団は総合力の高い順に28人
 *  - そのオフにFAで獲った選手は補償の対象にしない
 *
 * 自球団が関わる移籍だけに適用する（CPU どうしの戦力は従来どおり）。
 * 乱数は使わない。
 */
import type { FACompensation, GameState, Player } from './types';
import { ROSTER_LIMIT } from './types';
import { overallRating } from './rating';

export const PROTECT_LIMIT = 28;

/** 補償の対象になる市場評価 */
export type CompensationGrade = 'S' | 'A' | 'B';
export function requiresCompensation(grade: string): grade is CompensationGrade {
  return grade === 'S' || grade === 'A' || grade === 'B';
}

function byOverall(a: Player, b: Player): number {
  return overallRating(b) - overallRating(a) || (a.id < b.id ? -1 : 1);
}

/** その球団のプロテクト（選手IDの集合） */
export function protectedIds(state: GameState, teamId: string): Set<string> {
  const roster = state.players.filter((p) => p.teamId === teamId);
  if (teamId === state.playerTeamId && Array.isArray(state.protectList)) {
    const onRoster = new Set(roster.map((p) => p.id));
    return new Set(state.protectList.filter((id) => onRoster.has(id)).slice(0, PROTECT_LIMIT));
  }
  return new Set(roster.slice().sort(byOverall).slice(0, PROTECT_LIMIT).map((p) => p.id));
}

/** 自球団のプロテクトを決める（28人まで。ロスターにいない選手は外す） */
export function setProtectList(state: GameState, ids: string[]): void {
  const onRoster = new Set(
    state.players.filter((p) => p.teamId === state.playerTeamId).map((p) => p.id),
  );
  state.protectList = [...new Set(ids)].filter((id) => onRoster.has(id)).slice(0, PROTECT_LIMIT);
}

/** プロテクト外で、補償として移れる選手（そのオフにFAで獲った選手は除く） */
export function unprotectedPlayers(state: GameState, teamId: string, signedThisMarket: Set<string>): Player[] {
  const guard = protectedIds(state, teamId);
  return state.players
    .filter((p) => p.teamId === teamId && !guard.has(p.id) && !signedThisMarket.has(p.id))
    .sort(byOverall);
}

/** 補償選手を移籍させる（契約はそのまま引き継ぐ。2軍から） */
function movePlayer(state: GameState, player: Player, toTeamId: string): void {
  player.teamId = toTeamId;
  player.roster = 'second';
  player.lastRosterChangeDate = null;
  if (!Array.isArray(player.ext.careerTeams)) player.ext.careerTeams = [];
  player.ext.careerTeams.push({ year: state.year, teamId: toTeamId });
  if (state.protectList) state.protectList = state.protectList.filter((id) => id !== player.id);
}

function teamName(state: GameState, id: string): string {
  return state.teams.find((t) => t.id === id)?.name ?? id;
}

/**
 * FA移籍が決まったときに呼ぶ。自球団が関わる移籍なら補償を作る。
 *  - 自球団が獲った → 元の球団（CPU）がすぐに補償選手を選ぶ
 *  - 自球団から出た → 自球団が補償選手を選ぶ（pending）
 */
export function registerCompensation(
  state: GameState,
  compensations: FACompensation[],
  input: {
    faPlayerId: string;
    faName: string;
    signingTeamId: string;
    formerTeamId: string | null;
    grade: string;
  },
  signedThisMarket: Set<string>,
): void {
  const { signingTeamId, formerTeamId, grade } = input;
  if (!formerTeamId || formerTeamId === signingTeamId) return;
  if (!state.teams.some((t) => t.id === formerTeamId)) return;
  if (!requiresCompensation(grade)) return;
  const me = state.playerTeamId;
  if (signingTeamId !== me && formerTeamId !== me) return;

  const entry: FACompensation = {
    id: `comp-${state.year}-${input.faPlayerId}`,
    faPlayerId: input.faPlayerId,
    faName: input.faName,
    signingTeamId,
    formerTeamId,
    grade,
    status: 'pending',
  };

  if (signingTeamId === me) {
    // CPU の元の球団が、自球団のプロテクト外から総合力のいちばん高い選手を選ぶ
    const roomy = state.players.filter((p) => p.teamId === formerTeamId).length < ROSTER_LIMIT;
    const pick = unprotectedPlayers(state, me, signedThisMarket)[0];
    if (!roomy || !pick) {
      entry.status = 'waived';
      entry.note = roomy ? 'プロテクト外に選手がいなかった' : `${teamName(state, formerTeamId)}の支配下枠が埋まっていた`;
    } else {
      movePlayer(state, pick, formerTeamId);
      entry.status = 'taken';
      entry.playerId = pick.id;
      entry.playerName = pick.name;
      state.notices.push({
        date: state.date,
        kind: 'fa',
        message: `人的補償：${pick.name}が${teamName(state, formerTeamId)}へ移籍しました（${input.faName}のFA移籍）`,
      });
    }
  } else {
    // 自球団が、移籍先（CPU）のプロテクト外から選ぶ
    entry.options = unprotectedPlayers(state, signingTeamId, signedThisMarket)
      .slice(0, 30)
      .map((p) => p.id);
    if (entry.options.length === 0) {
      entry.status = 'waived';
      entry.note = 'プロテクト外に選手がいなかった';
    }
  }
  compensations.push(entry);
}

/** 自球団が補償選手を選ぶ（null なら補償を受け取らない） */
export function chooseCompensation(state: GameState, compensationId: string, playerId: string | null): boolean {
  const entry = state.fa?.compensations?.find((c) => c.id === compensationId);
  if (!entry || entry.status !== 'pending' || entry.formerTeamId !== state.playerTeamId) return false;
  if (playerId === null) {
    entry.status = 'waived';
    entry.note = '補償を受け取らなかった';
    return true;
  }
  if (!entry.options?.includes(playerId)) return false;
  const player = state.players.find((p) => p.id === playerId && p.teamId === entry.signingTeamId);
  if (!player) return false;
  if (state.players.filter((p) => p.teamId === state.playerTeamId).length >= ROSTER_LIMIT) return false;
  movePlayer(state, player, state.playerTeamId);
  entry.status = 'taken';
  entry.playerId = player.id;
  entry.playerName = player.name;
  state.notices.push({
    date: state.date,
    kind: 'fa',
    message: `人的補償：${teamName(state, entry.signingTeamId)}から${player.name}を獲得しました（${entry.faName}のFA移籍）`,
  });
  return true;
}

/** 選ばないまま次へ進むときは、候補のうち総合力のいちばん高い選手を受け取る */
export function autoChooseCompensations(state: GameState): void {
  for (const entry of state.fa?.compensations ?? []) {
    if (entry.status !== 'pending') continue;
    const best = (entry.options ?? [])
      .map((id) => state.players.find((p) => p.id === id && p.teamId === entry.signingTeamId))
      .filter((p): p is Player => !!p)
      .sort(byOverall)[0];
    if (!best || !chooseCompensation(state, entry.id, best.id)) {
      entry.status = 'waived';
      entry.note = entry.note ?? '補償を受け取れなかった';
    }
  }
}
