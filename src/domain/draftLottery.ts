/**
 * ドラフト1巡目の入札と抽選（NPB 方式）。
 *
 *   1. まだ1巡目が決まっていない全球団が、同時に1人ずつ入札する
 *   2. 1球団だけの入札はそのまま交渉権確定
 *   3. 重なった候補は、入札した球団がくじを引く（当たりは1枚）
 *   4. 外れた球団だけで、残りの候補から再び入札する（外れ1位、外れ外れ1位…）
 *   5. 全球団が決まったら、2巡目以降は従来どおり順番に指名する
 *
 * プレイヤー球団が加わるくじは、プレイヤーが紙を選ぶまで止めておく。
 * くじを引く順は指名順（前年の成績が悪い球団から）。自分より前の球団は先に引き、
 * 残った紙からプレイヤーが1枚選ぶ。当たりの紙は入札の時点で乱数で決まっているので、
 * 画面で紙を選ぶことが本当に結果を決める。
 */
import type {
  DraftFirstRoundAttempt,
  DraftLottery,
  DraftProspect,
  DraftState,
  GameState,
} from './types';
import type { Rng } from './rng';
import { availableProspects, evaluateProspectScouted, pushDraftNotice, runCpuPicks } from './draft';

/** 入札の回数の呼び名 */
export function attemptLabel(attempt: number): string {
  if (attempt <= 1) return '1位';
  return `${'外れ'.repeat(attempt - 1)}1位`;
}

/** 1巡目の入札をしている最中か */
export function inFirstRound(draft: DraftState | null | undefined): boolean {
  return !!draft?.firstRound && !draft.firstRound.done;
}

/** プレイヤー球団がいま入札できるか */
export function canNominate(state: GameState): boolean {
  const draft = state.draft;
  if (!draft || draft.phase !== 'picking' || !inFirstRound(draft)) return false;
  const fr = draft.firstRound!;
  return fr.awaitingLottery === null && fr.pending.includes(state.playerTeamId);
}

/** いまプレイヤーが引くのを待っているくじ */
export function awaitingLottery(state: GameState): DraftLottery | null {
  const fr = state.draft?.firstRound;
  if (!fr || fr.awaitingLottery === null) return null;
  const attempt = fr.attempts[fr.attempts.length - 1];
  return attempt?.lotteries[fr.awaitingLottery] ?? null;
}

/**
 * 指名を始める（1巡目は入札方式）。
 * プレイヤー球団が指名に加わらない年は、1巡目をすべて自動で進める。
 */
export function beginLotteryDraft(state: GameState, rng: Rng): void {
  const draft = state.draft;
  if (!draft || draft.phase === 'picking') return;
  draft.phase = 'picking';
  draft.firstRound = {
    done: false,
    pending: [...draft.order],
    attempts: [],
    awaitingLottery: null,
  };
  if (!draft.order.includes(state.playerTeamId)) {
    autoFinishFirstRound(state, rng);
  }
}

/** CPU 球団の入札先。候補の評価は従来の順番指名と同じ基準 */
function cpuNomination(state: GameState, draft: DraftState, teamId: string, rng: Rng): DraftProspect | null {
  const available = availableProspects(draft);
  if (available.length === 0) return null;
  const roster = state.players.filter((p) => p.teamId === teamId);
  const reports = state.scouting?.teams[teamId]?.reports ?? {};
  const plan = state.teamPlans?.[teamId];
  let best = available[0];
  let bestScore = -Infinity;
  for (const prospect of available) {
    const score = evaluateProspectScouted(prospect, roster, reports[prospect.id], rng, plan);
    if (score > bestScore) {
      bestScore = score;
      best = prospect;
    }
  }
  return best;
}

/** 1巡目の交渉権を確定させる */
function award(state: GameState, draft: DraftState, prospectId: string, teamId: string, attempt: number): void {
  const prospect = draft.prospects.find((p) => p.id === prospectId);
  if (!prospect || prospect.selectedBy) return;
  const pick = draft.order.indexOf(teamId) + 1;
  prospect.selectedBy = teamId;
  prospect.selectedRound = 1;
  prospect.selectedPick = pick;
  draft.picks.push({ round: 1, pick, teamId, prospectId });
  draft.needs[teamId] = Math.max(0, (draft.needs[teamId] ?? 0) - 1);
  const plan = state.teamPlans?.[teamId];
  if (plan && teamId !== state.playerTeamId) plan.log.draftPicks += 1;
  const team = state.teams.find((t) => t.id === teamId);
  pushDraftNotice(
    state,
    `${team?.name ?? teamId}が${prospect.player.name}（${prospect.player.age}歳）の交渉権を獲得（${attemptLabel(attempt)}）`,
  );
}

/** くじの紙を、指定した球団より前の球団のぶんだけ引かせる（未指定なら全員） */
function drawForCpu(lottery: DraftLottery, rng: Rng, until: string | null): void {
  for (const teamId of lottery.teams) {
    if (teamId === until) return;
    if (lottery.drawn[teamId] !== undefined) continue;
    const left = remainingPapers(lottery);
    lottery.drawn[teamId] = left[rng.int(0, left.length - 1)];
  }
}

/** まだ誰も引いていない紙の番号 */
export function remainingPapers(lottery: DraftLottery): number[] {
  const taken = new Set(Object.values(lottery.drawn));
  return lottery.teams.map((_, i) => i).filter((i) => !taken.has(i));
}

function settle(lottery: DraftLottery): string {
  const winner = lottery.teams.find((t) => lottery.drawn[t] === lottery.winningPaper) ?? lottery.teams[0];
  lottery.winner = winner;
  return winner;
}

/**
 * 1回ぶんの入札をまとめて処理する。
 * playerChoice はプレイヤー球団の入札先（プレイヤーが入札しない回は null）。
 */
function runAttempt(state: GameState, rng: Rng, playerChoice: string | null): void {
  const draft = state.draft!;
  const fr = draft.firstRound!;
  const attempt: DraftFirstRoundAttempt = {
    attempt: fr.attempts.length + 1,
    nominations: {},
    lotteries: [],
  };
  for (const teamId of fr.pending) {
    if (teamId === state.playerTeamId && playerChoice) {
      attempt.nominations[teamId] = playerChoice;
      continue;
    }
    const choice = cpuNomination(state, draft, teamId, rng);
    if (choice) attempt.nominations[teamId] = choice.id;
  }
  fr.attempts.push(attempt);

  // 候補ごとに入札した球団をまとめる（指名順のまま）
  const byProspect = new Map<string, string[]>();
  for (const teamId of fr.pending) {
    const prospectId = attempt.nominations[teamId];
    if (!prospectId) continue;
    byProspect.set(prospectId, [...(byProspect.get(prospectId) ?? []), teamId]);
  }

  for (const [prospectId, teams] of byProspect) {
    if (teams.length === 1) {
      award(state, draft, prospectId, teams[0], attempt.attempt);
      continue;
    }
    const lottery: DraftLottery = {
      prospectId,
      teams,
      winningPaper: rng.int(0, teams.length - 1),
      drawn: {},
      winner: null,
    };
    attempt.lotteries.push(lottery);
    const prospect = draft.prospects.find((p) => p.id === prospectId);
    pushDraftNotice(state, `${prospect?.player.name ?? ''}に${teams.length}球団が競合、抽選へ`);
    if (teams.includes(state.playerTeamId)) {
      // プレイヤーより前の球団だけ先に引いて、プレイヤーを待つ
      drawForCpu(lottery, rng, state.playerTeamId);
      fr.awaitingLottery = attempt.lotteries.length - 1;
    } else {
      drawForCpu(lottery, rng, null);
      award(state, draft, prospectId, settle(lottery), attempt.attempt);
    }
  }

  if (fr.awaitingLottery === null) closeAttempt(state, rng);
}

/** 入札1回の後片付け。外れた球団で次の入札へ。プレイヤーが決まっていれば自動で進める */
function closeAttempt(state: GameState, rng: Rng): void {
  const draft = state.draft!;
  const fr = draft.firstRound!;
  const decided = new Set(draft.picks.filter((p) => p.round === 1).map((p) => p.teamId));
  fr.pending = fr.pending.filter((teamId) => !decided.has(teamId));

  if (fr.pending.length === 0 || availableProspects(draft).length === 0) {
    finishFirstRound(state, rng);
    return;
  }
  // プレイヤー球団がもう決まっていれば、残りの CPU 球団の外れ1位は自動で進める
  if (!fr.pending.includes(state.playerTeamId)) runAttempt(state, rng, null);
}

function finishFirstRound(state: GameState, rng: Rng): void {
  const draft = state.draft!;
  const fr = draft.firstRound!;
  fr.done = true;
  fr.pending = [];
  fr.awaitingLottery = null;
  // 2巡目の先頭から順番の指名を再開する
  draft.cursor = draft.order.length;
  runCpuPicks(state, rng);
}

/** プレイヤー球団が1巡目の入札をする */
export function nominateFirstRound(state: GameState, prospectId: string, rng: Rng): boolean {
  if (!canNominate(state)) return false;
  const prospect = state.draft!.prospects.find((p) => p.id === prospectId);
  if (!prospect || prospect.selectedBy) return false;
  runAttempt(state, rng, prospectId);
  return true;
}

/** プレイヤー球団がくじの紙を1枚選ぶ */
export function drawLotteryPaper(state: GameState, paper: number, rng: Rng): boolean {
  const lottery = awaitingLottery(state);
  if (!lottery) return false;
  if (!remainingPapers(lottery).includes(paper)) return false;
  lottery.drawn[state.playerTeamId] = paper;
  drawForCpu(lottery, rng, null);
  const draft = state.draft!;
  const fr = draft.firstRound!;
  const attempt = fr.attempts[fr.attempts.length - 1];
  award(state, draft, lottery.prospectId, settle(lottery), attempt.attempt);
  fr.awaitingLottery = null;
  closeAttempt(state, rng);
  return true;
}

/**
 * 1巡目を最後まで自動で進める（プレイヤーの入札・くじも自動）。
 * ドラフトを飛ばすとき、プレイヤーが指名に加わらない年に使う。
 */
export function autoFinishFirstRound(state: GameState, rng: Rng): void {
  const draft = state.draft;
  if (!draft?.firstRound) return;
  let guard = 0;
  while (!draft.firstRound.done && guard++ < 100) {
    const fr = draft.firstRound;
    if (fr.awaitingLottery !== null) {
      const lottery = awaitingLottery(state)!;
      const left = remainingPapers(lottery);
      drawLotteryPaper(state, left[rng.int(0, left.length - 1)], rng);
      continue;
    }
    if (fr.pending.includes(state.playerTeamId)) {
      const choice = cpuNomination(state, draft, state.playerTeamId, rng);
      if (!choice) {
        finishFirstRound(state, rng);
        break;
      }
      runAttempt(state, rng, choice.id);
    } else {
      runAttempt(state, rng, null);
    }
  }
}
