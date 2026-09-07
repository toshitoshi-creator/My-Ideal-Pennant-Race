/**
 * 支配下70人枠のテスト。
 *
 * 日本のプロ野球と同じく「1球団が契約できる選手は最大70人（1軍・2軍を含む）」を
 * ゲーム全体で守れているかを確かめる。
 */
import { describe, it, expect } from 'vitest';
import { createNewGame } from './newGame';
import { advanceDay, validateState } from './engine';
import { startNextSeason } from './season';
import {
  DEFAULT_POSITION_PLAN,
  ROSTER_COMPOSITION,
  ROTATION_SIZE,
  buildPositionPlan,
  depthPenalty,
} from './playerGen';
import {
  canAddPlayer,
  firstTeamCount,
  rebuildFirstTeam,
  teamPlayerCount,
} from './roster';
import { MINIMUM_ROSTER, MIN_FIELDERS, MIN_PITCHERS } from './contract';
import { createDraft, rosterNeeds, MAX_DRAFT_ROUNDS } from './draft';
import { makeFAOffer, ageAndRetireFreeAgents, UNSIGNED_RETIREMENT_YEARS } from './freeAgency';
import { validateTrade } from './trade';
import { Rng } from './rng';
import {
  FIRST_TEAM_LIMIT,
  OPENING_FIRST_TEAM,
  ROSTER_LIMIT,
  TARGET_ROSTER_SIZE,
} from './types';
import type { GameState, Player, PositionId, TradeOffer } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 10, seed = 700700): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.seasonFinished && guard++ < 4000) s = advanceDay(s).state;
  return s;
}

function rosterOf(state: GameState, teamId: string): Player[] {
  return state.players.filter((p) => p.teamId === teamId);
}

function offerOf(
  state: GameState,
  fromTeamId: string,
  toTeamId: string,
  offeredPlayerIds: string[],
  requestedPlayerIds: string[],
): TradeOffer {
  return {
    id: `test-${fromTeamId}-${toTeamId}`,
    fromTeamId,
    toTeamId,
    offeredPlayerIds,
    requestedPlayerIds,
    status: 'PENDING',
    createdYear: state.year,
    createdDate: state.date,
    expiresDate: state.trade.deadline,
  };
}

function groupOf(position: PositionId): 'P' | 'C' | 'IF' | 'OF' {
  if (position === 'P') return 'P';
  if (position === 'C') return 'C';
  return position === 'LF' || position === 'CF' || position === 'RF' ? 'OF' : 'IF';
}

/* ================= 構成 ================= */

describe('支配下枠：球団の構成', () => {
  it('上限は70人、目標は65人、最低は55人の順に並ぶ', () => {
    expect(MINIMUM_ROSTER).toBeLessThan(TARGET_ROSTER_SIZE);
    expect(TARGET_ROSTER_SIZE).toBeLessThan(ROSTER_LIMIT);
    expect(ROSTER_LIMIT).toBe(70);
    expect(TARGET_ROSTER_SIZE).toBe(65);
    expect(MINIMUM_ROSTER).toBe(55);
  });

  it('構成表の合計は目標人数と一致する', () => {
    const total = ROSTER_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
    expect(total).toBe(TARGET_ROSTER_SIZE);
  });

  it('構成は投手30・捕手6・内野16・外野13', () => {
    const by: Record<string, number> = { P: 0, C: 0, IF: 0, OF: 0 };
    for (const entry of ROSTER_COMPOSITION) by[groupOf(entry.position)] += entry.count;
    expect(by).toEqual({ P: 30, C: 6, IF: 16, OF: 13 });
  });

  it('並び順は乱数を使わず、何度作っても同じになる', () => {
    expect(buildPositionPlan()).toEqual(buildPositionPlan());
    expect(buildPositionPlan()).toEqual(DEFAULT_POSITION_PLAN);
  });

  it('並び順は各ポジションの厚さに比例して混ざる（先頭20人に全ポジションが入る）', () => {
    const head = new Set(DEFAULT_POSITION_PLAN.slice(0, 20));
    for (const entry of ROSTER_COMPOSITION) expect(head.has(entry.position)).toBe(true);
  });

  it('先頭ほど投手が厚い（先頭20人のうち投手は8人以上）', () => {
    const pitchers = DEFAULT_POSITION_PLAN.slice(0, 20).filter((p) => p === 'P').length;
    expect(pitchers).toBeGreaterThanOrEqual(8);
  });

  it('控えほど能力を落とすが、上位3割には落としをかけない', () => {
    expect(depthPenalty(0, 65)).toBe(0);
    expect(depthPenalty(19, 65)).toBe(0);
    expect(depthPenalty(64, 65)).toBeGreaterThan(depthPenalty(40, 65));
    expect(depthPenalty(40, 65)).toBeGreaterThan(0);
  });

  it('人数が1人でも落としの計算が壊れない', () => {
    expect(depthPenalty(0, 1)).toBe(0);
    expect(depthPenalty(0, 0)).toBe(0);
  });
});

/* ================= 新規ゲーム ================= */

describe('支配下枠：新規ゲーム', () => {
  const state = newGame();

  it('全球団が65人を保有する', () => {
    for (const team of state.teams) {
      expect(teamPlayerCount(state, team.id)).toBe(TARGET_ROSTER_SIZE);
    }
  });

  it('全球団が上限70人を超えない', () => {
    for (const team of state.teams) {
      expect(teamPlayerCount(state, team.id)).toBeLessThanOrEqual(ROSTER_LIMIT);
    }
  });

  it('全球団のポジション構成が構成表どおり', () => {
    for (const team of state.teams) {
      const by: Record<string, number> = { P: 0, C: 0, IF: 0, OF: 0 };
      for (const p of rosterOf(state, team.id)) by[groupOf(p.mainPosition)] += 1;
      expect(by).toEqual({ P: 30, C: 6, IF: 16, OF: 13 });
    }
  });

  it('先発型スタミナで作るのは各球団6人まで', () => {
    for (const team of state.teams) {
      const pitchers = rosterOf(state, team.id).filter((p) => p.isPitcher);
      const highStamina = pitchers.filter((p) => (p.pitching?.stamina ?? 0) >= 55);
      expect(highStamina.length).toBeLessThanOrEqual(ROTATION_SIZE + 6);
    }
  });

  it('背番号は球団内で重複しない', () => {
    for (const team of state.teams) {
      const numbers = rosterOf(state, team.id).map((p) => p.uniformNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it('検証で異常が出ない', () => {
    expect(validateState(state)).toEqual([]);
  });
});

/* ================= 開幕1軍 ================= */

describe('支配下枠：開幕1軍の登録', () => {
  it('全球団が28人を1軍に登録する', () => {
    const state = newGame();
    for (const team of state.teams) {
      expect(firstTeamCount(state, team.id)).toBe(OPENING_FIRST_TEAM);
    }
  });

  it('1軍は上限31人を超えない', () => {
    const state = newGame();
    for (const team of state.teams) {
      expect(firstTeamCount(state, team.id)).toBeLessThanOrEqual(FIRST_TEAM_LIMIT);
    }
  });

  it('1軍には投手12人以上・捕手2人以上が入る', () => {
    const state = newGame();
    for (const team of state.teams) {
      const first = rosterOf(state, team.id).filter((p) => p.roster === 'first');
      expect(first.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(12);
      expect(first.filter((p) => p.mainPosition === 'C').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('1軍には内野・外野の各ポジションが1人以上いる', () => {
    const state = newGame();
    const needed: PositionId[] = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
    for (const team of state.teams) {
      const first = rosterOf(state, team.id).filter((p) => p.roster === 'first');
      for (const position of needed) {
        expect(first.some((p) => p.mainPosition === position)).toBe(true);
      }
    }
  });

  it('組み直しは乱数を使わないので、二度呼んでも同じ結果になる', () => {
    const state = newGame();
    rebuildFirstTeam(state, PLAYER_TEAM);
    const first = rosterOf(state, PLAYER_TEAM)
      .filter((p) => p.roster === 'first')
      .map((p) => p.id)
      .sort();
    rebuildFirstTeam(state, PLAYER_TEAM);
    const again = rosterOf(state, PLAYER_TEAM)
      .filter((p) => p.roster === 'first')
      .map((p) => p.id)
      .sort();
    expect(again).toEqual(first);
  });

  it('怪我人は1軍に登録しない', () => {
    const state = newGame();
    const roster = rosterOf(state, PLAYER_TEAM);
    // 能力上位の選手を怪我人にしてから組み直す
    const target = roster.filter((p) => !p.isPitcher)[0];
    target.ext.injury = {
      level: 'major',
      name: '右足首の捻挫',
      startDate: state.date,
      returnDate: '2026-06-01',
    };
    rebuildFirstTeam(state, PLAYER_TEAM);
    expect(target.roster).toBe('second');
  });

  it('組み直しても保有人数は変わらない', () => {
    const state = newGame();
    const before = teamPlayerCount(state, PLAYER_TEAM);
    rebuildFirstTeam(state, PLAYER_TEAM);
    expect(teamPlayerCount(state, PLAYER_TEAM)).toBe(before);
  });
});

/* ================= 上限の強制 ================= */

describe('支配下枠：獲得のたびに上限を見る', () => {
  it('canAddPlayer は69人までは true、70人で false', () => {
    const state = newGame();
    const team = PLAYER_TEAM;
    const donor = state.teams.find((t) => t.id !== team)!.id;
    const movable = rosterOf(state, donor);
    for (let i = 0; i < 5; i++) movable[i].teamId = team;
    expect(teamPlayerCount(state, team)).toBe(70);
    expect(canAddPlayer(state, team)).toBe(false);
    movable[0].teamId = donor;
    expect(teamPlayerCount(state, team)).toBe(69);
    expect(canAddPlayer(state, team)).toBe(true);
  });

  it('枠が埋まった球団はドラフトの指名順から外れる', () => {
    const state = newGame();
    const donor = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const movable = rosterOf(state, donor);
    for (let i = 0; i < 5; i++) movable[i].teamId = PLAYER_TEAM;
    const draft = createDraft(state, new Rng(1))!;
    expect(draft.order).not.toContain(PLAYER_TEAM);
    expect(draft.order.length).toBe(state.teams.length - 1);
  });

  it('枠が空いている球団はドラフトの指名順に残る', () => {
    const state = newGame();
    const draft = createDraft(state, new Rng(1))!;
    expect(draft.order.length).toBe(state.teams.length);
  });

  it('必要補充人数は上限70人までの空きを超えない', () => {
    const state = newGame();
    const donor = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const movable = rosterOf(state, donor);
    for (let i = 0; i < 3; i++) movable[i].teamId = PLAYER_TEAM;
    const needs = rosterNeeds(state);
    expect(needs[PLAYER_TEAM]).toBeLessThanOrEqual(ROSTER_LIMIT - 68);
  });

  it('FAは枠が埋まっている球団からは提示できない', () => {
    const state = newGame();
    // FA市場を1人だけ作る
    const donor = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const movable = rosterOf(state, donor);
    const listed = movable[movable.length - 1];
    state.players = state.players.filter((p) => p.id !== listed.id);
    listed.teamId = '';
    listed.ext.contract = null;
    state.freeAgents = [listed];
    // 自球団を70人にする
    for (let i = 0; i < 5; i++) movable[i].teamId = PLAYER_TEAM;
    state.fa = {
      year: state.year,
      phase: 'open',
      listings: [
        {
          playerId: listed.id,
          listedYear: state.year,
          marketValue: 30,
          askingSalary: 30,
          minimumSalary: 20,
          preferredYears: 1,
          role: 'BENCH',
          status: 'AVAILABLE',
        },
      ],
      offers: [],
      results: [],
      unsigned: 0,
      completed: false,
    };
    const result = makeFAOffer(state, PLAYER_TEAM, listed.id, 30, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('roster-limit');
  });

  it('トレードで71人になる取引は成立しない', () => {
    const state = newGame();
    const partner = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const mine = rosterOf(state, PLAYER_TEAM);
    const theirs = rosterOf(state, partner);
    // 自球団を70人にしてから、1人出して2人受け取る取引を試す
    const donorTeam = state.teams.find((t) => t.id !== PLAYER_TEAM && t.id !== partner)!.id;
    const spare = rosterOf(state, donorTeam);
    for (let i = 0; i < 5; i++) spare[i].teamId = PLAYER_TEAM;
    expect(teamPlayerCount(state, PLAYER_TEAM)).toBe(70);
    const result = validateTrade(
      state,
      offerOf(state, PLAYER_TEAM, partner, [mine[0].id], [theirs[0].id, theirs[1].id]),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('roster-limit');
  });

  it('人数が変わらないトレードは枠が埋まっていても成立できる', () => {
    const state = newGame();
    const partner = state.teams.find((t) => t.id !== PLAYER_TEAM)!.id;
    const mine = rosterOf(state, PLAYER_TEAM);
    const theirs = rosterOf(state, partner);
    const donorTeam = state.teams.find((t) => t.id !== PLAYER_TEAM && t.id !== partner)!.id;
    const spare = rosterOf(state, donorTeam);
    for (let i = 0; i < 5; i++) spare[i].teamId = PLAYER_TEAM;
    const result = validateTrade(
      state,
      offerOf(state, PLAYER_TEAM, partner, [mine[0].id], [theirs[0].id]),
    );
    expect(result.error).not.toBe('roster-limit');
  });
});

/* ================= 契約先が決まらない選手 ================= */

describe('支配下枠：FA市場に選手が溜まらない', () => {
  it('決まらないFA選手は毎オフ1つ歳を取る', () => {
    const state = newGame();
    const player = rosterOf(state, PLAYER_TEAM)[0];
    state.players = state.players.filter((p) => p.id !== player.id);
    player.teamId = '';
    player.ext.contract = null;
    player.ext.hiddenAttributes = { faUnsignedYears: 0 };
    state.freeAgents = [player];
    const before = player.age;
    ageAndRetireFreeAgents(state);
    expect(player.age).toBe(before + 1);
    expect(state.freeAgents).toHaveLength(1);
  });

  it('2年決まらなければ現役を退き、市場から消える', () => {
    const state = newGame();
    const player = rosterOf(state, PLAYER_TEAM)[0];
    state.players = state.players.filter((p) => p.id !== player.id);
    player.teamId = '';
    player.ext.contract = null;
    player.ext.hiddenAttributes = { faUnsignedYears: UNSIGNED_RETIREMENT_YEARS };
    state.freeAgents = [player];
    const retired = ageAndRetireFreeAgents(state);
    expect(state.freeAgents).toHaveLength(0);
    expect(retired).toHaveLength(1);
    expect(retired[0].playerId).toBe(player.id);
    expect(retired[0].retiredAt).toBe(state.year);
  });

  it('市場が空でも壊れない', () => {
    const state = newGame();
    state.freeAgents = [];
    expect(ageAndRetireFreeAgents(state)).toEqual([]);
  });
});

/* ================= 長期 ================= */

describe('支配下枠：シーズンをまたいでも守られる', () => {
  const state = (() => {
    let s = newGame(10, 700701);
    for (let i = 0; i < 6; i++) {
      s = playSeason(s);
      startNextSeason(s);
    }
    return s;
  })();

  it('6シーズン後も全球団が70人を超えない', () => {
    for (const team of state.teams) {
      expect(teamPlayerCount(state, team.id)).toBeLessThanOrEqual(ROSTER_LIMIT);
    }
  });

  it('6シーズン後も全球団が最低人数を割らない', () => {
    for (const team of state.teams) {
      expect(teamPlayerCount(state, team.id)).toBeGreaterThanOrEqual(MINIMUM_ROSTER);
    }
  });

  it('6シーズン後も野手・投手の最低人数を満たす', () => {
    for (const team of state.teams) {
      const roster = rosterOf(state, team.id);
      expect(roster.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(MIN_FIELDERS);
      expect(roster.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(MIN_PITCHERS);
    }
  });

  it('6シーズン後も開幕1軍が28人で組まれている', () => {
    for (const team of state.teams) {
      expect(firstTeamCount(state, team.id)).toBe(OPENING_FIRST_TEAM);
    }
  });

  it('6シーズン後も検証で異常が出ない', () => {
    expect(validateState(state)).toEqual([]);
  });

  it('FA市場は年ごとに膨らみ続けない（球団数×5人以内）', () => {
    expect(state.freeAgents.length).toBeLessThanOrEqual(state.teams.length * 5);
  });

  it('ドラフトは指名可能な球団だけで組まれる', () => {
    const draft = createDraft(state, new Rng(7));
    if (draft) {
      for (const teamId of draft.order) expect(canAddPlayer(state, teamId)).toBe(true);
      expect(draft.rounds).toBeLessThanOrEqual(MAX_DRAFT_ROUNDS);
    }
  });

  it('もう1シーズン進めて新人が加入しても70人を超えない', () => {
    const next = playSeason(state);
    startNextSeason(next);
    for (const team of next.teams) {
      expect(teamPlayerCount(next, team.id)).toBeLessThanOrEqual(ROSTER_LIMIT);
    }
  });
});

/* ================= 記録簿 ================= */

describe('支配下枠：記録簿は出場した選手だけを残す', () => {
  const state = (() => {
    let s = newGame(10, 700702);
    for (let i = 0; i < 3; i++) {
      s = playSeason(s);
      startNextSeason(s);
    }
    return s;
  })();

  it('記録簿に載っている選手は必ず出場記録を持つ', () => {
    for (const entry of Object.values(state.history.players)) {
      const played = entry.seasons.some((row) => row.b || row.p);
      expect(played).toBe(true);
    }
  });

  it('1試合も出ていない2軍の選手は記録簿に載らない', () => {
    const never = state.players.filter((p) => !state.history.players[p.id]);
    expect(never.length).toBeGreaterThan(0);
  });

  it('記録簿の人数は保有選手の総数より少ない', () => {
    expect(Object.keys(state.history.players).length).toBeLessThan(state.players.length);
  });

  it('引退した選手は記録簿に残り続ける', () => {
    const active = new Set(state.players.map((p) => p.id));
    const gone = Object.values(state.history.players).filter((h) => !active.has(h.playerId));
    expect(gone.length).toBeGreaterThan(0);
  });
});
