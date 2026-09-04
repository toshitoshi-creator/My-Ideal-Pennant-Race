import { describe, it, expect, beforeEach } from 'vitest';
import { createNewGame, SAVE_VERSION } from './newGame';
import { advanceDay, cloneState, validateState } from './engine';
import { startNextSeason, startOffseason } from './season';
import {
  DIRECTIONS,
  DIRECTION_DESCRIPTIONS,
  DIRECTION_LABELS,
  EVENT_LIMIT,
  FACILITY_BUDGET_RATIO,
  FACILITY_DESCRIPTIONS,
  FACILITY_KINDS,
  FACILITY_LABELS,
  FACILITY_PRIORITY,
  IDENTITIES,
  IDENTITY_LABELS,
  MAX_FACILITY_LEVEL,
  MORALE_DELTA,
  OBJECTIVE_LABELS,
  USAGE_LABELS,
  USAGE_ROLES,
  applyMoraleEvent,
  applyRankMorale,
  autoUsageRole,
  buildObjectives,
  canUpgradeFacility,
  clearUsageRole,
  clubRating,
  clubRng,
  createClubState,
  createFacilities,
  developmentModifiers,
  developmentMultiplier,
  ensureClub,
  ensureClubs,
  evaluateObjectives,
  eventId,
  facilityBonus,
  facilityCost,
  facilityLevel,
  facilitiesOf,
  fatigueRecoveryMultiplier,
  generateManagementEvents,
  identityOf,
  injurySeverityRelief,
  lineupBonus,
  objectiveText,
  pendingEvents,
  pushEvent,
  recoveryMultiplier,
  resolveEvent,
  runCpuFacilityInvestment,
  scoutPointBonus,
  setDirection,
  setUsageRole,
  syncCpuDirections,
  upgradeFacility,
  usagePriority,
  usageRoleOf,
} from './club';
import { clearSave, loadGame, migrate, saveGame } from './save';
import { overallRating } from './rating';
import { scaleToVelocity } from './growth';
import type { GameState, ManagementEvent, Player, UsageRole } from './types';

const PLAYER_TEAM = 'phoenix';

function newGame(length: 10 | 30 | 143 = 30, seed = 400400): GameState {
  return createNewGame(PLAYER_TEAM, length, seed);
}

function playSeason(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}

function afterSeasons(count: number, seed = 400400, length: 10 | 30 | 143 = 30): GameState {
  let s = newGame(length, seed);
  for (let i = 0; i < count; i++) {
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
  }
  return s;
}

/** 全選手の基本能力の指紋（変わっていないことを確かめる） */
function abilityFingerprint(state: GameState): string {
  return state.players
    .map((p) => {
      const b = p.batting;
      const t = p.pitching;
      return [
        p.id,
        b.trajectory, b.contact, b.power, b.speed, b.arm, b.fielding, b.catching,
        t ? [t.velocity, t.control, t.stamina, t.power, t.movement].join(',') : '-',
      ].join(':');
    })
    .join('|');
}

function makeEvent(overrides: Partial<ManagementEvent> = {}): ManagementEvent {
  return {
    id: 'e1',
    year: 2026,
    date: '2026-04-01',
    teamId: PLAYER_TEAM,
    kind: 'YOUNG_BREAKOUT',
    title: 'タイトル',
    body: '本文',
    playerId: null,
    choices: [],
    chosen: null,
    resolved: false,
    ...overrides,
  };
}

/* ================= 施設 ================= */

describe('PHASE4.0 施設', () => {
  it('新規ゲームでは全施設がLv1', () => {
    const s = newGame();
    for (const team of s.teams) {
      for (const kind of FACILITY_KINDS) {
        expect(s.clubs[team.id].facilities[kind]).toBe(1);
      }
    }
  });

  it('Lv1は補正なし', () => {
    expect(facilityBonus(1)).toBe(0);
    expect(developmentMultiplier(1)).toBe(1);
    expect(recoveryMultiplier(1)).toBe(1);
    expect(injurySeverityRelief(1)).toBe(0);
    expect(scoutPointBonus(1)).toBe(0);
    expect(fatigueRecoveryMultiplier(1)).toBe(1);
  });

  it('Lvが上がるほど効き目が強くなる', () => {
    expect(developmentMultiplier(5)).toBeGreaterThan(developmentMultiplier(3));
    expect(developmentMultiplier(3)).toBeGreaterThan(developmentMultiplier(1));
    expect(recoveryMultiplier(5)).toBeLessThan(recoveryMultiplier(1));
    expect(scoutPointBonus(5)).toBeGreaterThan(scoutPointBonus(2));
    expect(fatigueRecoveryMultiplier(5)).toBeGreaterThan(fatigueRecoveryMultiplier(2));
  });

  it('効き目に上限がある（青天井にならない）', () => {
    expect(developmentMultiplier(5)).toBeLessThanOrEqual(1.25);
    expect(recoveryMultiplier(5)).toBeGreaterThanOrEqual(0.8);
    expect(fatigueRecoveryMultiplier(5)).toBeLessThanOrEqual(1.3);
    expect(injurySeverityRelief(5)).toBeLessThanOrEqual(0.08);
  });

  it('Lvは1〜5に収まる', () => {
    expect(facilityBonus(0 as never)).toBe(0);
    expect(facilityBonus(9 as never)).toBe(1);
  });

  it('アップグレードのコストが段階的に上がる', () => {
    expect(facilityCost(1)).toBeLessThan(facilityCost(2));
    expect(facilityCost(2)).toBeLessThan(facilityCost(3));
    expect(facilityCost(3)).toBeLessThan(facilityCost(4));
  });

  it('資金があれば施設を上げられる', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 10000;
    expect(upgradeFacility(s, PLAYER_TEAM, 'development')).toBe(true);
    expect(s.clubs[PLAYER_TEAM].facilities.development).toBe(2);
  });

  it('上げると資金が減る', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 10000;
    const cost = facilityCost(1);
    upgradeFacility(s, PLAYER_TEAM, 'development');
    expect(s.finances[PLAYER_TEAM].cash).toBe(10000 - cost);
  });

  it('資金が足りなければ上げられない', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 0;
    expect(upgradeFacility(s, PLAYER_TEAM, 'development')).toBe(false);
    expect(s.clubs[PLAYER_TEAM].facilities.development).toBe(1);
  });

  it('資金不足の理由が返る', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 0;
    const check = canUpgradeFacility(s, PLAYER_TEAM, 'development');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('資金');
  });

  it('最高段階を超えて上げられない', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 100000;
    for (let i = 0; i < 10; i++) upgradeFacility(s, PLAYER_TEAM, 'development');
    expect(s.clubs[PLAYER_TEAM].facilities.development).toBe(MAX_FACILITY_LEVEL);
    expect(canUpgradeFacility(s, PLAYER_TEAM, 'development').ok).toBe(false);
  });

  it('資金がマイナスにならない', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = facilityCost(1);
    upgradeFacility(s, PLAYER_TEAM, 'development');
    expect(s.finances[PLAYER_TEAM].cash).toBeGreaterThanOrEqual(0);
    expect(upgradeFacility(s, PLAYER_TEAM, 'medical')).toBe(false);
  });

  it('施設の種類と説明がすべて用意されている', () => {
    for (const kind of FACILITY_KINDS) {
      expect(FACILITY_LABELS[kind]).toBeTruthy();
      expect(FACILITY_DESCRIPTIONS[kind]).toBeTruthy();
    }
    expect(FACILITY_KINDS).toHaveLength(4);
  });

  it('facilityLevel / facilitiesOf で引ける', () => {
    const s = newGame();
    expect(facilityLevel(s, PLAYER_TEAM, 'medical')).toBe(1);
    expect(facilitiesOf(s, 'no-such-team')).toEqual(createFacilities());
  });

  it('投資額が記録される', () => {
    const s = newGame();
    s.finances[PLAYER_TEAM].cash = 10000;
    upgradeFacility(s, PLAYER_TEAM, 'development');
    expect(s.clubs[PLAYER_TEAM].facilitySpent).toBe(facilityCost(1));
  });
});

/* ================= CPUの施設投資 ================= */

describe('PHASE4.0 CPUの施設投資', () => {
  it('CPUがオフに施設へ投資する', () => {
    const s = afterSeasons(3, 4101);
    const invested = s.teams.filter(
      (t) => t.id !== PLAYER_TEAM &&
        FACILITY_KINDS.some((k) => s.clubs[t.id].facilities[k] > 1),
    );
    expect(invested.length).toBeGreaterThan(0);
  });

  it('プレイヤー球団には自動投資しない', () => {
    const s = afterSeasons(3, 4102);
    for (const kind of FACILITY_KINDS) {
      expect(s.clubs[PLAYER_TEAM].facilities[kind]).toBe(1);
    }
  });

  it('全球団が同じ施設構成にならない', () => {
    const s = afterSeasons(6, 4103);
    const shapes = new Set(
      s.teams.map((t) => FACILITY_KINDS.map((k) => s.clubs[t.id].facilities[k]).join('-')),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('資金より多く使わない', () => {
    const s = afterSeasons(5, 4104);
    for (const team of s.teams) {
      expect(s.finances[team.id].cash).toBeGreaterThanOrEqual(0);
    }
  });

  it('方針ごとの優先順位が定義されている', () => {
    for (const direction of DIRECTIONS) {
      expect(FACILITY_PRIORITY[direction]).toHaveLength(4);
      expect(new Set(FACILITY_PRIORITY[direction]).size).toBe(4);
      expect(FACILITY_BUDGET_RATIO[direction]).toBeGreaterThan(0);
    }
  });

  it('堅実経営はもっとも投資を抑える', () => {
    expect(FACILITY_BUDGET_RATIO.THRIFTY).toBeLessThan(FACILITY_BUDGET_RATIO.BALANCED);
    expect(FACILITY_BUDGET_RATIO.REBUILD).toBeGreaterThan(FACILITY_BUDGET_RATIO.WIN_NOW);
  });

  it('若手育成は育成施設を最優先する', () => {
    expect(FACILITY_PRIORITY.DEVELOP[0]).toBe('development');
    expect(FACILITY_PRIORITY.WIN_NOW[0]).toBe('medical');
  });

  it('同じシードなら同じ投資になる', () => {
    const a = afterSeasons(4, 4105);
    const b = afterSeasons(4, 4105);
    for (const team of a.teams) {
      expect(a.clubs[team.id].facilities).toEqual(b.clubs[team.id].facilities);
    }
  });

  it('資金がなければ投資しない', () => {
    const s = playSeason(newGame(10, 4106));
    const next = cloneState(s);
    for (const team of next.teams) next.finances[team.id].cash = 0;
    runCpuFacilityInvestment(next);
    for (const team of next.teams) {
      for (const kind of FACILITY_KINDS) {
        expect(next.clubs[team.id].facilities[kind]).toBe(1);
      }
    }
  });
});

/* ================= 球団方針 ================= */

describe('PHASE4.0 球団方針', () => {
  it('新規ゲームの初期方針はバランス', () => {
    expect(newGame().clubs[PLAYER_TEAM].direction).toBe('BALANCED');
  });

  it('方針を選べる', () => {
    const s = newGame();
    setDirection(s, PLAYER_TEAM, 'REBUILD');
    expect(s.clubs[PLAYER_TEAM].direction).toBe('REBUILD');
  });

  it('方針は5種類ある', () => {
    expect(DIRECTIONS).toHaveLength(5);
    for (const d of DIRECTIONS) {
      expect(DIRECTION_LABELS[d]).toBeTruthy();
      expect(DIRECTION_DESCRIPTIONS[d]).toBeTruthy();
    }
  });

  it('CPUの方針は経営プランから決まる', () => {
    const s = afterSeasons(2, 4201);
    for (const team of s.teams) {
      if (team.id === PLAYER_TEAM) continue;
      expect(DIRECTIONS).toContain(s.clubs[team.id].direction);
    }
  });

  it('CPUの方針がばらける', () => {
    const s = afterSeasons(4, 4202);
    const kinds = new Set(
      s.teams.filter((t) => t.id !== PLAYER_TEAM).map((t) => s.clubs[t.id].direction),
    );
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('ユーザーの方針はCPU同期で上書きされない', () => {
    let s = newGame(30, 4203);
    setDirection(s, PLAYER_TEAM, 'REBUILD');
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
    expect(s.clubs[PLAYER_TEAM].direction).toBe('REBUILD');
  });

  it('ユーザーの方針が経営プランに反映される', () => {
    let s = newGame(30, 4204);
    setDirection(s, PLAYER_TEAM, 'WIN_NOW');
    s = playSeason(s);
    s = cloneState(s);
    startNextSeason(s);
    expect(s.teamPlans[PLAYER_TEAM].strategy).toBe('WIN_NOW');
  });

  it('方針ごとに経営プランが変わる', () => {
    const run = (direction: 'WIN_NOW' | 'THRIFTY') => {
      let s = newGame(30, 4205);
      setDirection(s, PLAYER_TEAM, direction);
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      return s.teamPlans[PLAYER_TEAM].strategy;
    };
    expect(run('WIN_NOW')).toBe('WIN_NOW');
    expect(run('THRIFTY')).toBe('BUDGET');
  });

  it('syncCpuDirectionsを二度呼んでも壊れない', () => {
    const s = afterSeasons(2, 4206);
    const before = s.teams.map((t) => s.clubs[t.id].direction);
    syncCpuDirections(s);
    expect(s.teams.map((t) => s.clubs[t.id].direction)).toEqual(before);
  });
});

/* ================= 球団の色 ================= */

describe('PHASE4.0 球団アイデンティティ', () => {
  it('全球団に色がつく', () => {
    const s = newGame();
    for (const team of s.teams) {
      expect(IDENTITIES).toContain(s.clubs[team.id].identity);
    }
  });

  it('同じシードなら同じ色になる', () => {
    const a = newGame(30, 4301);
    const b = newGame(30, 4301);
    for (const team of a.teams) {
      expect(a.clubs[team.id].identity).toBe(b.clubs[team.id].identity);
    }
  });

  it('シードが違えば色の並びが変わりうる', () => {
    const a = newGame(30, 4302);
    const b = newGame(30, 9999);
    const sa = a.teams.map((t) => a.clubs[t.id].identity).join(',');
    const sb = b.teams.map((t) => b.clubs[t.id].identity).join(',');
    expect(sa === sb).toBe(false);
  });

  it('色の表示名がすべて用意されている', () => {
    for (const id of IDENTITIES) expect(IDENTITY_LABELS[id]).toBeTruthy();
  });

  it('identityOfは状態を書き換えない', () => {
    const s = newGame();
    const before = JSON.stringify(s.clubs);
    identityOf(s, PLAYER_TEAM);
    expect(JSON.stringify(s.clubs)).toBe(before);
  });
});

/* ================= 起用方針 ================= */

describe('PHASE4.0 起用方針', () => {
  it('指定がなければ自動で役割が決まる', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    expect(USAGE_ROLES).toContain(autoUsageRole(s, player));
  });

  it('役割を指定できる', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    setUsageRole(s, player.id, 'CORE');
    expect(usageRoleOf(s, player)).toBe('CORE');
  });

  it('指定を取り消せる', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    setUsageRole(s, player.id, 'BENCH');
    clearUsageRole(s, player.id);
    expect(usageRoleOf(s, player)).toBe(autoUsageRole(s, player));
  });

  it('主力は控えより優先される', () => {
    expect(usagePriority('CORE', 'BALANCED', 28)).toBeGreaterThan(
      usagePriority('BENCH', 'BALANCED', 28),
    );
  });

  it('若手育成の方針では若手が優先される', () => {
    expect(usagePriority('SEMI', 'DEVELOP', 22)).toBeGreaterThan(
      usagePriority('SEMI', 'BALANCED', 22),
    );
  });

  it('優勝狙いではベテランが優先される', () => {
    expect(usagePriority('SEMI', 'WIN_NOW', 34)).toBeGreaterThan(
      usagePriority('SEMI', 'BALANCED', 34),
    );
  });

  it('再建では若手が最も優先される', () => {
    expect(usagePriority('DEVELOP', 'REBUILD', 22)).toBeGreaterThan(
      usagePriority('DEVELOP', 'DEVELOP', 22),
    );
  });

  it('役割の表示名がすべて用意されている', () => {
    expect(USAGE_ROLES).toHaveLength(5);
    for (const role of USAGE_ROLES) expect(USAGE_LABELS[role]).toBeTruthy();
  });

  it('起用方針がオーダー編成に効く', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    const before = lineupBonus(s, player);
    setUsageRole(s, player.id, 'CORE');
    expect(lineupBonus(s, player)).toBeGreaterThanOrEqual(before);
  });

  it('控え指定で優先度が下がる', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    setUsageRole(s, player.id, 'CORE');
    const core = lineupBonus(s, player);
    setUsageRole(s, player.id, 'BENCH');
    expect(lineupBonus(s, player)).toBeLessThan(core);
  });

  it('経営状態のない球団では上乗せ0', () => {
    const s = newGame();
    const player = { ...s.players[0], teamId: 'no-such-team' };
    expect(lineupBonus(s, player)).toBe(0);
  });

  it('怪我をしている選手は起用されない', () => {
    let s = newGame(30, 4401);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM && !p.isPitcher)!;
    setUsageRole(s, player.id, 'CORE');
    player.ext.injury = {
      level: 'major',
      name: '骨折',
      startDate: s.date,
      returnDate: '2027-01-01',
    };
    s = advanceDay(s).state;
    expect(s.setups[PLAYER_TEAM].lineup.some((l) => l.playerId === player.id)).toBe(false);
  });

  it('起用方針を変えても基本能力は変わらない', () => {
    const s = newGame(30, 4402);
    const before = abilityFingerprint(s);
    for (const player of s.players.filter((p) => p.teamId === PLAYER_TEAM)) {
      setUsageRole(s, player.id, 'DEVELOP');
    }
    expect(abilityFingerprint(s)).toBe(before);
  });
});

/* ================= 育成環境 ================= */

describe('PHASE4.0 育成環境', () => {
  it('初期状態（施設Lv1・バランス・主力）では補正なし', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM);
    if (!player) throw new Error('自球団に選手がいない');
    setDirection(s, PLAYER_TEAM, 'BALANCED');
    setUsageRole(s, player.id, 'CORE');
    expect(s.clubs[PLAYER_TEAM].facilities.development).toBe(1);
    const mods = developmentModifiers(s, player);
    expect(mods.facility).toBeCloseTo(1, 6);
    expect(mods.training).toBe(1);
  });

  it('育成施設を上げると成長補正が上がる', () => {
    const s = newGame(30, 4501);
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = developmentModifiers(s, player).facility;
    s.clubs[PLAYER_TEAM].facilities.development = 5;
    expect(developmentModifiers(s, player).facility).toBeGreaterThan(before);
  });

  it('若手育成の方針は若手の成長を後押しする', () => {
    const s = newGame(30, 4502);
    const young = s.players.find((p) => p.teamId === PLAYER_TEAM && p.age <= 24);
    if (!young) return;
    setDirection(s, PLAYER_TEAM, 'BALANCED');
    const balanced = developmentModifiers(s, young).facility;
    setDirection(s, PLAYER_TEAM, 'DEVELOP');
    expect(developmentModifiers(s, young).facility).toBeGreaterThan(balanced);
  });

  it('補正に上限がある', () => {
    const s = newGame(30, 4503);
    const young = s.players.find((p) => p.teamId === PLAYER_TEAM && p.age <= 24);
    if (!young) return;
    s.clubs[PLAYER_TEAM].facilities.development = 5;
    setDirection(s, PLAYER_TEAM, 'REBUILD');
    setUsageRole(s, young.id, 'DEVELOP');
    expect(developmentModifiers(s, young).facility).toBeLessThanOrEqual(1.4);
  });

  it('経営状態のない球団では補正なし', () => {
    const s = newGame();
    const player = { ...s.players[0], teamId: 'no-such-team' };
    expect(developmentModifiers(s, player)).toEqual({ facility: 1, training: 1 });
  });

  it('育成環境だけで能力が青天井にならない', () => {
    let s = newGame(30, 4504);
    for (const team of s.teams) {
      s.clubs[team.id].facilities.development = 5;
      setDirection(s, team.id, 'REBUILD');
    }
    for (let i = 0; i < 8; i++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      for (const team of s.teams) s.clubs[team.id].facilities.development = 5;
    }
    const average =
      s.players.reduce((sum, p) => sum + overallRating(p), 0) / s.players.length;
    // 潜在能力の上限があるので、平均が極端に跳ね上がることはない
    expect(average).toBeLessThan(50);
  }, 180000);
});

/* ================= 士気 ================= */

describe('PHASE4.0 チーム士気', () => {
  it('出来事で士気が動く', () => {
    const s = newGame();
    s.teamMorale[PLAYER_TEAM] = 50;
    applyMoraleEvent(s, PLAYER_TEAM, 'JAPAN_TITLE');
    expect(s.teamMorale[PLAYER_TEAM]).toBeGreaterThan(50);
  });

  it('悪い出来事では下がる', () => {
    const s = newGame();
    s.teamMorale[PLAYER_TEAM] = 50;
    applyMoraleEvent(s, PLAYER_TEAM, 'STAR_INJURY');
    expect(s.teamMorale[PLAYER_TEAM]).toBeLessThan(50);
  });

  it('0〜100に収まる', () => {
    const s = newGame();
    s.teamMorale[PLAYER_TEAM] = 99;
    for (let i = 0; i < 20; i++) applyMoraleEvent(s, PLAYER_TEAM, 'JAPAN_TITLE');
    expect(s.teamMorale[PLAYER_TEAM]).toBeLessThanOrEqual(100);
    s.teamMorale[PLAYER_TEAM] = 1;
    for (let i = 0; i < 20; i++) applyMoraleEvent(s, PLAYER_TEAM, 'FA_LEAVE');
    expect(s.teamMorale[PLAYER_TEAM]).toBeGreaterThanOrEqual(0);
  });

  it('順位が高いほど士気が上がる', () => {
    const s = newGame();
    s.teamMorale[PLAYER_TEAM] = 50;
    applyRankMorale(s, PLAYER_TEAM, 1);
    const first = s.teamMorale[PLAYER_TEAM];
    s.teamMorale[PLAYER_TEAM] = 50;
    applyRankMorale(s, PLAYER_TEAM, 6);
    expect(first).toBeGreaterThan(s.teamMorale[PLAYER_TEAM]);
  });

  it('日本一は最も士気が上がる', () => {
    expect(MORALE_DELTA.JAPAN_TITLE).toBeGreaterThan(MORALE_DELTA.LEAGUE_TITLE);
    expect(MORALE_DELTA.LEAGUE_TITLE).toBeGreaterThan(MORALE_DELTA.POSTSEASON);
  });

  it('存在しない球団では何もしない', () => {
    const s = newGame();
    applyMoraleEvent(s, 'no-such-team', 'JAPAN_TITLE');
    applyRankMorale(s, 'no-such-team', 1);
    expect(s.teamMorale['no-such-team']).toBeUndefined();
  });

  it('シーズンをまたいでも士気が発散しない', () => {
    const s = afterSeasons(10, 4601, 10);
    for (const team of s.teams) {
      const morale = s.teamMorale[team.id];
      expect(morale).toBeGreaterThanOrEqual(0);
      expect(morale).toBeLessThanOrEqual(100);
    }
    const average =
      s.teams.reduce((sum, t) => sum + s.teamMorale[t.id], 0) / s.teams.length;
    expect(average).toBeGreaterThan(35);
    expect(average).toBeLessThan(65);
  });

  it('球団ごとに士気が分かれる', () => {
    const s = afterSeasons(4, 4602);
    const values = new Set(s.teams.map((t) => Math.round(s.teamMorale[t.id])));
    expect(values.size).toBeGreaterThan(1);
  });
});

/* ================= 経営目標 ================= */

describe('PHASE4.0 経営目標', () => {
  it('オフシーズンに目標が立つ', () => {
    const s = afterSeasons(1, 4701);
    expect(s.clubs[PLAYER_TEAM].objectives.length).toBeGreaterThan(0);
  });

  it('方針によって目標が変わる', () => {
    let s = playSeason(newGame(30, 4702));
    s = cloneState(s);
    setDirection(s, PLAYER_TEAM, 'REBUILD');
    const rebuild = buildObjectives(s, PLAYER_TEAM).map((o) => o.kind);
    const t = cloneState(s);
    t.clubs[PLAYER_TEAM].objectiveYear = null;
    setDirection(t, PLAYER_TEAM, 'WIN_NOW');
    const winNow = buildObjectives(t, PLAYER_TEAM).map((o) => o.kind);
    expect(rebuild).not.toEqual(winNow);
  });

  it('同じ年に二度作り直さない', () => {
    let s = playSeason(newGame(30, 4703));
    s = cloneState(s);
    const first = buildObjectives(s, PLAYER_TEAM);
    const second = buildObjectives(s, PLAYER_TEAM);
    expect(second).toBe(first);
  });

  it('シーズン終了時に判定される', () => {
    const s = afterSeasons(2, 4704);
    const previous = s.clubs[PLAYER_TEAM];
    expect(previous.achieved).toBeGreaterThanOrEqual(0);
  });

  it('二度判定しても達成数が二重に増えない', () => {
    let s = playSeason(newGame(30, 4705));
    s = cloneState(s);
    startOffseason(s);
    const before = s.clubs[PLAYER_TEAM].achieved;
    evaluateObjectives(s, PLAYER_TEAM);
    evaluateObjectives(s, PLAYER_TEAM);
    expect(s.clubs[PLAYER_TEAM].achieved).toBe(before);
  });

  it('startOffseasonを二度呼んでも達成数が増えない', () => {
    let s = playSeason(newGame(30, 4706));
    s = cloneState(s);
    startOffseason(s);
    const before = s.clubs[PLAYER_TEAM].achieved;
    startOffseason(s);
    expect(s.clubs[PLAYER_TEAM].achieved).toBe(before);
  });

  it('判定後に実績が入る', () => {
    let s = playSeason(newGame(30, 4707));
    s = cloneState(s);
    buildObjectives(s, PLAYER_TEAM);
    // 目標を「立てた年」から進める
    s.clubs[PLAYER_TEAM].objectiveYear = s.year - 1;
    evaluateObjectives(s, PLAYER_TEAM);
    for (const objective of s.clubs[PLAYER_TEAM].objectives) {
      expect(objective.actual).not.toBeNull();
      expect(objective.achieved).not.toBeNull();
    }
  });

  it('目標の説明文が空でない', () => {
    const s = afterSeasons(1, 4708);
    for (const team of s.teams) {
      for (const objective of s.clubs[team.id].objectives) {
        expect(objectiveText(objective).length).toBeGreaterThan(0);
        expect(OBJECTIVE_LABELS[objective.kind]).toBeTruthy();
      }
    }
  });

  it('全球団に目標が立つ', () => {
    const s = afterSeasons(1, 4709);
    for (const team of s.teams) {
      expect(s.clubs[team.id].objectives.length).toBeGreaterThan(0);
    }
  });

  it('達成しても能力は変わらない', () => {
    let s = playSeason(newGame(30, 4710));
    s = cloneState(s);
    const before = abilityFingerprint(s);
    evaluateObjectives(s, PLAYER_TEAM);
    expect(abilityFingerprint(s)).toBe(before);
  });
});

/* ================= 球団評価 ================= */

describe('PHASE4.0 球団評価', () => {
  it('各項目が0〜100に収まる', () => {
    const s = afterSeasons(2, 4801);
    for (const team of s.teams) {
      const r = clubRating(s, team.id);
      for (const value of [r.strength, r.future, r.finance, r.development, r.management, r.total]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('選手のいない球団は0', () => {
    const s = newGame();
    const r = clubRating(s, 'no-such-team');
    expect(r.total).toBe(0);
  });

  it('施設を上げると育成評価が上がる', () => {
    const s = newGame(30, 4802);
    const before = clubRating(s, PLAYER_TEAM).development;
    for (const kind of FACILITY_KINDS) s.clubs[PLAYER_TEAM].facilities[kind] = 5;
    expect(clubRating(s, PLAYER_TEAM).development).toBeGreaterThan(before);
  });

  it('評価が高い球団が必ず優勝するわけではない', () => {
    const s = afterSeasons(8, 4803);
    // 評価1位の球団が毎年優勝しているなら、評価と結果が一致しすぎている
    const champions = s.history.seasons
      .map((season) => season.postseason?.japanSeriesChampionTeamId)
      .filter(Boolean);
    expect(new Set(champions).size).toBeGreaterThan(1);
  }, 120000);

  it('評価を計算しても状態が変わらない', () => {
    const s = afterSeasons(1, 4804);
    const before = JSON.stringify(s.clubs);
    for (const team of s.teams) clubRating(s, team.id);
    expect(JSON.stringify(s.clubs)).toBe(before);
  });
});

/* ================= イベント ================= */

describe('PHASE4.0 経営イベント', () => {
  it('イベントを追加できる', () => {
    const s = newGame();
    expect(pushEvent(s, makeEvent())).toBe(true);
    expect(s.events).toHaveLength(1);
  });

  it('同じIDのイベントは二度作らない', () => {
    const s = newGame();
    pushEvent(s, makeEvent());
    expect(pushEvent(s, makeEvent())).toBe(false);
    expect(s.events).toHaveLength(1);
  });

  it('IDは決定的に決まる', () => {
    expect(eventId(2030, 'A', 'x')).toBe('2030:A:x');
    expect(eventId(2030, 'A', 'x')).toBe(eventId(2030, 'A', 'x'));
  });

  it('上限を超えると古いものから消える', () => {
    const s = newGame();
    for (let i = 0; i < EVENT_LIMIT + 5; i++) {
      pushEvent(s, makeEvent({ id: `e${i}` }));
    }
    expect(s.events).toHaveLength(EVENT_LIMIT);
  });

  it('未処理のイベントを取り出せる', () => {
    const s = newGame();
    pushEvent(s, makeEvent({ id: 'a' }));
    pushEvent(s, makeEvent({ id: 'b', resolved: true }));
    expect(pendingEvents(s)).toHaveLength(1);
  });

  it('選択肢を選べる', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    pushEvent(
      s,
      makeEvent({
        playerId: player.id,
        choices: [{ id: 'promote', label: '主力', description: '' }],
      }),
    );
    expect(resolveEvent(s, 'e1', 'promote')).toBe(true);
    expect(usageRoleOf(s, player)).toBe('CORE');
  });

  it('存在しない選択肢は選べない', () => {
    const s = newGame();
    pushEvent(s, makeEvent({ choices: [{ id: 'a', label: 'A', description: '' }] }));
    expect(resolveEvent(s, 'e1', 'zzz')).toBe(false);
  });

  it('処理済みのイベントは選び直せない', () => {
    const s = newGame();
    pushEvent(s, makeEvent());
    resolveEvent(s, 'e1', 'ok');
    expect(resolveEvent(s, 'e1', 'ok')).toBe(false);
  });

  it('存在しないイベントは処理できない', () => {
    const s = newGame();
    expect(resolveEvent(s, 'no-such-event', 'ok')).toBe(false);
  });

  it('シーズン中にイベントが発生する', () => {
    const s = playSeason(newGame(143, 4901));
    expect(s.events.length).toBeGreaterThan(0);
  }, 120000);

  it('毎日は発生しない', () => {
    const s = playSeason(newGame(143, 4902));
    expect(s.events.length).toBeLessThan(20);
  }, 120000);

  it('イベントはプレイヤー球団のものだけ', () => {
    const s = playSeason(newGame(143, 4903));
    for (const event of s.events) expect(event.teamId).toBe(PLAYER_TEAM);
  }, 120000);

  it('イベントで基本能力は変わらない', () => {
    const s = newGame();
    const player = s.players.find((p) => p.teamId === PLAYER_TEAM)!;
    const before = abilityFingerprint(s);
    pushEvent(
      s,
      makeEvent({
        playerId: player.id,
        choices: [
          { id: 'promote', label: '主力', description: '' },
          { id: 'bench', label: '控え', description: '' },
        ],
      }),
    );
    resolveEvent(s, 'e1', 'promote');
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('generateManagementEventsが節目以外では何もしない', () => {
    const s = newGame(143, 4904);
    generateManagementEvents(s);
    expect(s.events).toHaveLength(0);
  });
});

/* ================= 基本能力の不変（最重要） ================= */

describe('PHASE4.0 基本能力が変わらない', () => {
  it('施設を上げても基本能力は変わらない', () => {
    const s = newGame(30, 5001);
    s.finances[PLAYER_TEAM].cash = 100000;
    const before = abilityFingerprint(s);
    for (const kind of FACILITY_KINDS) {
      for (let i = 0; i < 4; i++) upgradeFacility(s, PLAYER_TEAM, kind);
    }
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('方針を変えても基本能力は変わらない', () => {
    const s = newGame(30, 5002);
    const before = abilityFingerprint(s);
    for (const d of DIRECTIONS) setDirection(s, PLAYER_TEAM, d);
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('士気が動いても基本能力は変わらない', () => {
    const s = newGame(30, 5003);
    const before = abilityFingerprint(s);
    applyMoraleEvent(s, PLAYER_TEAM, 'JAPAN_TITLE');
    applyRankMorale(s, PLAYER_TEAM, 1);
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('CPUの施設投資でも基本能力は変わらない', () => {
    const s = playSeason(newGame(10, 5004));
    const next = cloneState(s);
    const before = abilityFingerprint(next);
    runCpuFacilityInvestment(next);
    expect(abilityFingerprint(next)).toBe(before);
  });

  it('球団評価の計算でも基本能力は変わらない', () => {
    const s = afterSeasons(1, 5005);
    const before = abilityFingerprint(s);
    for (const team of s.teams) clubRating(s, team.id);
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('育成環境の計算でも基本能力は変わらない', () => {
    const s = newGame(30, 5006);
    const before = abilityFingerprint(s);
    for (const player of s.players) developmentModifiers(s, player);
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('起用方針の計算でも基本能力は変わらない', () => {
    const s = newGame(30, 5007);
    const before = abilityFingerprint(s);
    for (const player of s.players) {
      usageRoleOf(s, player);
      lineupBonus(s, player);
    }
    expect(abilityFingerprint(s)).toBe(before);
  });

  it('育成施設を最大にしても潜在能力の上限を超えて成長しない', () => {
    let s = newGame(30, 5008);
    const maxFacilities = (g: GameState) => {
      for (const team of g.teams) g.clubs[team.id].facilities.development = 5;
    };
    // 生成時点ですでに潜在能力を上回っている能力がある（潜在能力は要約値であって
    // 能力ごとの上限そのものではない）。成長で「押し上げられていない」ことを見る。
    const grownKeys = (p: Player): [string, number][] =>
      p.pitching
        ? [
            ['control', p.pitching.control],
            ['stamina', p.pitching.stamina],
            ['power', p.pitching.power],
            ['movement', p.pitching.movement],
            ['velocity', p.pitching.velocity],
          ]
        : [
            ['contact', p.batting.contact],
            ['power', p.batting.power],
            ['trajectory', p.batting.trajectory],
            ['speed', p.batting.speed],
            ['arm', p.batting.arm],
            ['fielding', p.batting.fielding],
            ['catching', p.batting.catching],
          ];
    const start = new Map(s.players.map((p) => [p.id, new Map(grownKeys(p))]));

    maxFacilities(s);
    for (let i = 0; i < 6; i++) {
      s = playSeason(s);
      s = cloneState(s);
      startNextSeason(s);
      maxFacilities(s);
    }

    let checked = 0;
    for (const player of s.players) {
      const before = start.get(player.id);
      if (!before) continue; // 途中で入ってきた新人は対象外
      const cap = player.ext.potential;
      for (const [key, value] of grownKeys(player)) {
        const limit = key === 'velocity' ? scaleToVelocity(cap) : cap;
        const was = before.get(key) ?? limit;
        // 上限か、もともとの値のどちらか高いほうを超えていないこと
        expect(value).toBeLessThanOrEqual(Math.max(limit, was));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 180000);
});

/* ================= RNG ================= */

describe('PHASE4.0 乱数', () => {
  it('PHASE 4.0 専用の乱数は共有の状態を消費しない', () => {
    const s = newGame(30, 5101);
    const before = s.rngState;
    clubRng(s, 'phase40Facility', 'x').next();
    clubRng(s, 'phase40Event', 'y').next();
    expect(s.rngState).toBe(before);
  });

  it('同じ引数なら同じ乱数になる', () => {
    const s = newGame(30, 5102);
    expect(clubRng(s, 'phase40Facility', 'a').next()).toBe(
      clubRng(s, 'phase40Facility', 'a').next(),
    );
  });

  it('引数が違えば別の乱数になる', () => {
    const s = newGame(30, 5103);
    expect(clubRng(s, 'phase40Facility', 'a').next()).not.toBe(
      clubRng(s, 'phase40Facility', 'b').next(),
    );
  });

  it('種類が違えば別の乱数になる', () => {
    const s = newGame(30, 5104);
    expect(clubRng(s, 'phase40Facility', 'a').next()).not.toBe(
      clubRng(s, 'phase40Event', 'a').next(),
    );
  });

  it('同じシードなら同じ長期結果になる', () => {
    const a = afterSeasons(4, 5105);
    const b = afterSeasons(4, 5105);
    expect(abilityFingerprint(a)).toBe(abilityFingerprint(b));
    for (const team of a.teams) {
      expect(a.clubs[team.id].facilities).toEqual(b.clubs[team.id].facilities);
      expect(a.clubs[team.id].achieved).toBe(b.clubs[team.id].achieved);
    }
  });
});

/* ================= セーブ ================= */

describe('PHASE4.0 セーブ', () => {
  beforeEach(() => {
    class MemoryStorage {
      private map = new Map<string, string>();
      getItem(key: string) {
        return this.map.get(key) ?? null;
      }
      setItem(key: string, value: string) {
        this.map.set(key, value);
      }
      removeItem(key: string) {
        this.map.delete(key);
      }
    }
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
      new MemoryStorage();
    clearSave();
  });

  it('セーブバージョンが14になっている', () => {
    expect(SAVE_VERSION).toBe(14);
    expect(newGame().version).toBe(SAVE_VERSION);
  });

  it('経営状態が保存・復元される', () => {
    const s = afterSeasons(2, 5201);
    setDirection(s, PLAYER_TEAM, 'REBUILD');
    setUsageRole(s, s.players[0].id, 'CORE');
    saveGame(s);
    const loaded = loadGame()!;
    expect(loaded.clubs[PLAYER_TEAM].direction).toBe('REBUILD');
    expect(loaded.usage[s.players[0].id]).toBe('CORE');
    for (const team of s.teams) {
      expect(loaded.clubs[team.id].facilities).toEqual(s.clubs[team.id].facilities);
    }
  });

  it('イベントも保存・復元される', () => {
    const s = newGame();
    pushEvent(s, makeEvent());
    saveGame(s);
    expect(loadGame()!.events).toHaveLength(1);
  });

  it('v13のセーブを読み込める（施設Lv1から始まる）', () => {
    const s = afterSeasons(1, 5202);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 13;
    delete old.clubs;
    delete old.usage;
    delete old.events;
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    for (const team of migrated!.teams) {
      for (const kind of FACILITY_KINDS) {
        expect(migrated!.clubs[team.id].facilities[kind]).toBe(1);
      }
      expect(migrated!.clubs[team.id].objectives).toEqual([]);
    }
  });

  it('v13からの移行で歴史を書き換えない', () => {
    const s = afterSeasons(2, 5203);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 13;
    delete old.clubs;
    const migrated = migrate(old as unknown as GameState)!;
    expect(migrated.history.seasons.map((x) => x.year)).toEqual(
      s.history.seasons.map((x) => x.year),
    );
    expect(migrated.news.stories.length).toBe(s.news.stories.length);
  });

  it('v1のセーブも最新バージョンまで移行できる', () => {
    const s = newGame(10, 5204);
    const old = structuredClone(s) as unknown as Record<string, unknown>;
    old.version = 1;
    for (const key of ['clubs', 'usage', 'events', 'news', 'postseason', 'history', 'teamStats']) {
      delete old[key];
    }
    const migrated = migrate(old as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(SAVE_VERSION);
    expect(Object.keys(migrated!.clubs).length).toBe(12);
  });

  it('壊れた経営状態でも読み込める', () => {
    const s = afterSeasons(1, 5205);
    const broken = structuredClone(s) as unknown as Record<string, unknown>;
    broken.version = 13;
    broken.clubs = { phoenix: { facilities: null, objectives: null } };
    broken.usage = null;
    broken.events = null;
    const migrated = migrate(broken as unknown as GameState);
    expect(migrated).not.toBeNull();
    expect(migrated!.clubs[PLAYER_TEAM].facilities.development).toBe(1);
    expect(Array.isArray(migrated!.events)).toBe(true);
  });

  it('存在しない球団の状態は落とされる', () => {
    const s = afterSeasons(1, 5206);
    const broken = structuredClone(s) as unknown as Record<string, unknown>;
    broken.version = 13;
    (broken.clubs as Record<string, unknown>)['ghost-team'] = createClubState(s, 'ghost');
    const migrated = migrate(broken as unknown as GameState)!;
    expect(migrated.clubs['ghost-team']).toBeUndefined();
  });

  it('存在しない選手の起用方針は落とされる', () => {
    const s = afterSeasons(1, 5207);
    const broken = structuredClone(s) as unknown as Record<string, unknown>;
    broken.version = 13;
    broken.usage = { 'ghost-player': 'CORE' as UsageRole };
    const migrated = migrate(broken as unknown as GameState)!;
    expect(migrated.usage['ghost-player']).toBeUndefined();
  });

  it('ensureClubで欠けている状態を作れる', () => {
    const s = newGame();
    delete (s.clubs as Record<string, unknown>)[PLAYER_TEAM];
    const club = ensureClub(s, PLAYER_TEAM);
    expect(club.facilities.development).toBe(1);
    expect(club.direction).toBe('BALANCED');
  });

  it('ensureClubsで全球団ぶん用意される', () => {
    const s = newGame();
    (s as unknown as Record<string, unknown>).clubs = {};
    ensureClubs(s);
    expect(Object.keys(s.clubs)).toHaveLength(12);
  });

  it('保存サイズが実用の範囲に収まる', () => {
    const s = afterSeasons(20, 5208, 30);
    expect(JSON.stringify(s).length).toBeLessThan(5_000_000);
  }, 240000);
});

/* ================= 既存システムを壊していない ================= */

describe('PHASE4.0 既存システムが壊れていない', () => {
  it('シーズンが従来どおり進む', () => {
    let s = playSeason(newGame(10, 5301));
    const year = s.year;
    s = cloneState(s);
    startNextSeason(s);
    expect(s.year).toBe(year + 1);
    expect(validateState(s)).toEqual([]);
  });

  it('ポストシーズンが従来どおり動く', () => {
    const s = afterSeasons(1, 5302);
    expect(s.history.seasons[0].postseason!.japanSeriesChampionTeamId).not.toBeNull();
  });

  it('歴史・ニュースが従来どおり積まれる', () => {
    const s = afterSeasons(3, 5303);
    expect(s.history.seasons).toHaveLength(3);
    expect(s.news.stories).toHaveLength(3);
    expect(s.news.items.length).toBeGreaterThan(0);
  });

  it('ロスターが保たれる', () => {
    const s = afterSeasons(5, 5304);
    for (const team of s.teams) {
      expect(s.players.filter((p) => p.teamId === team.id).length).toBeGreaterThanOrEqual(24);
    }
  });

  it('10シーズン続けても壊れない', () => {
    const s = afterSeasons(10, 5305, 10);
    expect(validateState(s)).toEqual([]);
    expect(s.history.seasons).toHaveLength(10);
  });

  it('能力・年齢がインフレしない', () => {
    const s = afterSeasons(12, 5306, 10);
    const overall = s.players.reduce((sum, p) => sum + overallRating(p), 0) / s.players.length;
    const age = s.players.reduce((sum, p) => sum + p.age, 0) / s.players.length;
    expect(overall).toBeGreaterThan(30);
    expect(overall).toBeLessThan(50);
    expect(age).toBeGreaterThan(23);
    expect(age).toBeLessThan(32);
  }, 120000);

  it('財務が破綻しない', () => {
    const s = afterSeasons(8, 5307, 10);
    for (const team of s.teams) {
      expect(s.finances[team.id].cash).toBeGreaterThanOrEqual(0);
    }
  });

  it('施設Lvが上限を超えない', () => {
    const s = afterSeasons(15, 5308, 10);
    for (const team of s.teams) {
      for (const kind of FACILITY_KINDS) {
        const level = s.clubs[team.id].facilities[kind];
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(MAX_FACILITY_LEVEL);
      }
    }
  }, 120000);
});
