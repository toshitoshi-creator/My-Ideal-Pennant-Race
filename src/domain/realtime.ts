/**
 * 現実の時間で進む仕組み。
 *
 *   自動試合 … 現実の1時間ごとに、自球団の試合を1試合ずつ自動で消化する。
 *              ゲームを閉じていたあいだのぶんは、次に開いたときにまとめて消化する。
 *              レギュラーシーズン（とポストシーズン）が終わったらそこで止まり、
 *              ドラフトなどオフシーズンの手続きは自分で進める。
 *   手動試合 … 自分で試合を進められる回数。最大20回で、1時間ごとに1回回復する。
 *              回復は購入でもできる（いまは試作。実際の請求はしない）。
 *
 * 時刻はすべて引数の now（Date.now() のミリ秒）で受け取る。テストで時間を動かせるように、
 * この中では Date.now() を呼ばない。
 */
import type {
  AutoGameLine,
  AutoPlayerChange,
  AutoReport,
  GameResult,
  GameState,
  RealtimeState,
} from './types';
import { advanceToNextPlayerGame, cloneState } from './engine';
import { isPostseasonComplete, playNextPostseasonGame } from './postseason';
import { offseasonStarted } from './season';
import { standingsForLeague } from './standings';
import { effectiveMultiplier } from './effective';
import { CONDITION_LABELS } from './condition';

export const HOUR_MS = 60 * 60 * 1000;
/** 手動試合の回数の上限（時間での回復はここまで） */
export const MANUAL_MAX = 20;
/** 1回に消化する自動試合の上限（何か月も放っておいたときに固まらないように） */
const AUTO_GUARD = 400;
/** まとめに出す選手の数 */
const MAX_PLAYER_CHANGES = 12;

/** 購入できる回復（試作。値段は表示用で、実際の請求はしない） */
export interface ChargePack {
  id: string;
  charges: number;
  priceYen: number;
  label: string;
}

export const CHARGE_PACKS: ChargePack[] = [
  { id: 'small', charges: 5, priceYen: 120, label: '5回ぶん回復' },
  { id: 'full', charges: MANUAL_MAX, priceYen: 400, label: '20回ぶん回復' },
  { id: 'big', charges: 50, priceYen: 800, label: '50回ぶん回復' },
];

/** 無ければ作る（作った時点から数え始める） */
export function ensureRealtime(state: GameState, now: number): RealtimeState {
  if (!state.realtime) {
    state.realtime = {
      autoAt: now,
      manualCharges: MANUAL_MAX,
      chargeAt: now,
      purchases: 0,
      pendingReport: null,
    };
  }
  const rt = state.realtime;
  // 端末の時計が戻されたときは、そこから数え直す（未来の時刻に貯金させない）
  if (rt.autoAt > now) rt.autoAt = now;
  if (rt.chargeAt > now) rt.chargeAt = now;
  return rt;
}

/** 手動試合の回数を、経過時間ぶん回復する */
export function recoverCharges(state: GameState, now: number): void {
  const rt = ensureRealtime(state, now);
  if (rt.manualCharges >= MANUAL_MAX) {
    // 満タンのあいだは時間を貯めない
    rt.chargeAt = now;
    return;
  }
  const hours = Math.floor((now - rt.chargeAt) / HOUR_MS);
  if (hours <= 0) return;
  rt.manualCharges = Math.min(MANUAL_MAX, rt.manualCharges + hours);
  rt.chargeAt = rt.manualCharges >= MANUAL_MAX ? now : rt.chargeAt + hours * HOUR_MS;
}

/** 次の1回が回復するまでのミリ秒（満タンなら null） */
export function msUntilNextCharge(state: GameState, now: number): number | null {
  const rt = state.realtime;
  if (!rt || rt.manualCharges >= MANUAL_MAX) return null;
  return Math.max(0, HOUR_MS - (now - rt.chargeAt));
}

/** 次の自動試合までのミリ秒（いまは自動で進まない時期なら null） */
export function msUntilNextAuto(state: GameState, now: number): number | null {
  const rt = state.realtime;
  if (!rt || !canAutoPlay(state)) return null;
  return Math.max(0, HOUR_MS - (now - rt.autoAt));
}

/**
 * 手動試合を1回使う。残りが無ければ false（何も変えない）。
 * 満タンから使ったときは、そこから回復の時間を数え始める。
 */
export function consumeManualCharge(state: GameState, now: number): boolean {
  recoverCharges(state, now);
  const rt = state.realtime!;
  if (rt.manualCharges <= 0) return false;
  if (rt.manualCharges >= MANUAL_MAX) rt.chargeAt = now;
  rt.manualCharges -= 1;
  return true;
}

/** 回復を購入する（試作：実際の請求はしない）。上限を超えて持てる */
export function purchaseCharges(state: GameState, packId: string, now: number): boolean {
  const pack = CHARGE_PACKS.find((p) => p.id === packId);
  if (!pack) return false;
  recoverCharges(state, now);
  const rt = state.realtime!;
  rt.manualCharges += pack.charges;
  rt.purchases += 1;
  return true;
}

/** いま自動で試合を進めてよい時期か */
export function canAutoPlay(state: GameState): boolean {
  if (state.expansion || state.draft || state.contractPhase || state.fa) return false;
  if (offseasonStarted(state)) return false;
  if (!state.seasonFinished) return true;
  return !!state.postseason && !isPostseasonComplete(state);
}

export interface AutoRunResult {
  state: GameState;
  /** 今回消化した自球団の試合 */
  played: AutoGameLine[];
}

/**
 * 経過時間ぶんの自動試合を消化し、手動試合の回数も回復する。
 * 入ってきた state は変更しない（変化があれば新しい state を返す）。
 */
export function syncRealtime(input: GameState, now: number): AutoRunResult {
  let state = cloneState(input);
  recoverCharges(state, now);
  let rt = state.realtime!;

  if (!canAutoPlay(state)) {
    // 自動で進まない時期は時間を貯めない（オフが明けたらそこから数える）
    rt.autoAt = now;
    return { state, played: [] };
  }
  const due = Math.min(AUTO_GUARD, Math.floor((now - rt.autoAt) / HOUR_MS));
  if (due <= 0) return { state, played: [] };

  const base = rt.pendingReport;
  const before = snapshot(state);
  const played: AutoGameLine[] = [];
  let stoppedEarly = false;
  for (let i = 0; i < due; i++) {
    if (!canAutoPlay(state)) {
      stoppedEarly = true;
      break;
    }
    const step = playOneAuto(state);
    state = step.state;
    if (step.line) played.push(step.line);
  }
  rt = state.realtime!;
  rt.autoAt = stoppedEarly ? now : rt.autoAt + due * HOUR_MS;
  if (played.length > 0) {
    rt.pendingReport = buildReport(state, base, before, played, due);
  }
  return { state, played };
}

/** 自動試合を1つ消化する（自球団の試合が1つ終わるまで） */
function playOneAuto(state: GameState): { state: GameState; line: AutoGameLine | null } {
  if (!state.seasonFinished) {
    const step = advanceToNextPlayerGame(state);
    // advanceDay は realtime も含めて複製するので、そのまま引き継がれる
    return {
      state: step.state,
      line: step.playerResult ? lineOf(step.state, step.playerResult, false) : null,
    };
  }
  // ポストシーズン：自球団の試合が1つ終わるまで（敗退していれば最後まで）進める
  const next = cloneState(state);
  for (let guard = 0; guard < 40; guard++) {
    if (isPostseasonComplete(next)) break;
    const before = next.postseason?.playerResults?.length ?? 0;
    playNextPostseasonGame(next);
    const results = next.postseason?.playerResults ?? [];
    if (results.length > before) {
      return { state: next, line: lineOf(next, results[results.length - 1], true) };
    }
  }
  return { state: next, line: null };
}

function lineOf(state: GameState, r: GameResult, postseason: boolean): AutoGameLine {
  const home = r.homeTeamId === state.playerTeamId;
  const runsFor = home ? r.home.runs : r.away.runs;
  const runsAgainst = home ? r.away.runs : r.home.runs;
  return {
    date: r.date,
    opponentId: home ? r.awayTeamId : r.homeTeamId,
    home,
    runsFor,
    runsAgainst,
    outcome: r.winnerTeamId === null ? 'D' : r.winnerTeamId === state.playerTeamId ? 'W' : 'L',
    postseason,
  };
}

interface Snapshot {
  date: string;
  record: { wins: number; losses: number; draws: number };
  rank: number | null;
  players: AutoReport['baseline'];
}

function snapshot(state: GameState): Snapshot {
  const team = state.teams.find((t) => t.id === state.playerTeamId);
  const row = team
    ? standingsForLeague(state, team.leagueId).find((r) => r.teamId === state.playerTeamId)
    : undefined;
  const players: AutoReport['baseline'] = {};
  for (const p of state.players) {
    if (p.teamId !== state.playerTeamId) continue;
    players[p.id] = {
      multiplier: effectiveMultiplier(p),
      condition: CONDITION_LABELS[p.ext.condition] ?? '',
      injured: !!p.ext.injury,
    };
  }
  return {
    date: state.date,
    record: { wins: row?.wins ?? 0, losses: row?.losses ?? 0, draws: row?.draws ?? 0 },
    // 1試合もしていないうちの順位は意味が無いので出さない
    rank: row && row.wins + row.losses + row.draws > 0 ? row.rank : null,
    players,
  };
}

/** 前回のまだ見ていないまとめがあれば、それに今回のぶんを重ねる */
function buildReport(
  state: GameState,
  base: AutoReport | null,
  before: Snapshot,
  played: AutoGameLine[],
  hours: number,
): AutoReport {
  const after = snapshot(state);
  const baseline = base?.baseline ?? before.players;
  const changes: AutoPlayerChange[] = [];
  for (const p of state.players) {
    if (p.teamId !== state.playerTeamId) continue;
    const was = baseline[p.id];
    const now = after.players[p.id];
    if (!was || !now) continue;
    const deltaPct = Math.round((now.multiplier - was.multiplier) * 1000) / 10;
    const injuryChanged = was.injured !== now.injured;
    if (Math.abs(deltaPct) < 1.5 && !injuryChanged) continue;
    changes.push({
      playerId: p.id,
      name: p.name,
      deltaPct,
      conditionBefore: was.condition,
      conditionAfter: now.condition,
      injuredBefore: was.injured,
      injuredAfter: now.injured,
    });
  }
  changes.sort((a, b) => {
    // ケガをした選手を先に、あとは変化の大きい順
    const ia = a.injuredAfter && !a.injuredBefore ? 1 : 0;
    const ib = b.injuredAfter && !b.injuredBefore ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
  });
  return {
    hours: (base?.hours ?? 0) + hours,
    fromDate: base?.fromDate ?? played[0]?.date ?? before.date,
    toDate: played[played.length - 1]?.date ?? state.date,
    games: [...(base?.games ?? []), ...played].slice(-200),
    recordBefore: base?.recordBefore ?? before.record,
    recordAfter: after.record,
    rankBefore: base ? base.rankBefore : before.rank,
    rankAfter: after.rank,
    playerChanges: changes.slice(0, MAX_PLAYER_CHANGES),
    baseline,
  };
}

/** まとめを見終わった */
export function dismissAutoReport(state: GameState): void {
  if (state.realtime) state.realtime.pendingReport = null;
}
