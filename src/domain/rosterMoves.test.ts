import { describe, expect, it } from 'vitest';
import { createNewGame } from './newGame';
import { startContractPhase, startFAPhase, startOffseason } from './season';
import { canSignDirectly, directAsking, releasePlayer, retirePlayer, signFreeAgentDirect } from './rosterMoves';
import { compensationFormerTeam } from './freeAgency';
import {
  PROTECT_LIMIT,
  autoChooseCompensations,
  chooseCompensation,
  protectedIds,
  registerCompensation,
  setProtectList,
} from './compensation';
import type { FACompensation, GameState } from './types';
import { ROSTER_LIMIT } from './types';
import { overallRating } from './rating';

function offseason(seed: number): GameState {
  const state = createNewGame('phoenix', 143, seed);
  state.seasonFinished = true;
  startOffseason(state);
  startContractPhase(state);
  return state;
}

const mine = (s: GameState) => s.players.filter((p) => p.teamId === s.playerTeamId);

describe('自由契約・引退を選べる', () => {
  it('自由契約にすると未所属になり、契約更改の対象から外れ、人的補償の対象にもならない', () => {
    const state = offseason(11);
    const id = state.contractPhase!.pending[0] ?? mine(state)[0].id;
    expect(releasePlayer(state, id).ok).toBe(true);
    expect(state.players.some((p) => p.id === id)).toBe(false);
    const fa = state.freeAgents.find((p) => p.id === id)!;
    expect(fa.teamId).toBe('');
    expect(state.contractPhase!.pending).not.toContain(id);
    expect(compensationFormerTeam(state, fa)).toBeNull();
    // FA市場を開けば市場にも並ぶ
    startFAPhase(state);
    expect(state.fa!.listings.some((l) => l.playerId === id)).toBe(true);
  });

  it('引退させると歴史に残り、ロスターからも未所属からも消える', () => {
    const state = offseason(12);
    const player = mine(state)[3];
    const retired = state.retiredPlayers.length;
    expect(retirePlayer(state, player.id).ok).toBe(true);
    expect(state.retiredPlayers.length).toBe(retired + 1);
    expect(state.players.some((p) => p.id === player.id)).toBe(false);
    expect(state.freeAgents.some((p) => p.id === player.id)).toBe(false);
  });

  it('他球団の選手は整理できない', () => {
    const state = offseason(13);
    const other = state.players.find((p) => p.teamId !== state.playerTeamId)!;
    expect(releasePlayer(state, other.id).ok).toBe(false);
    expect(retirePlayer(state, other.id).ok).toBe(false);
  });
});

describe('自由契約の選手にオファーできる', () => {
  it('希望に近い条件ならその場で契約でき、安すぎると断られる', () => {
    const state = offseason(14);
    const id = mine(state)[5].id;
    releasePlayer(state, id);
    // 枠を空けておく
    const player = state.freeAgents.find((p) => p.id === id)!;
    const { asking, minimum } = directAsking(state, player);
    const low = Math.max(1, Math.min(minimum, Math.round(asking * 0.9)) - 50);
    if (low < Math.max(minimum, Math.round(asking * 0.9))) {
      expect(signFreeAgentDirect(state, id, low, 1).ok).toBe(false);
    }
    const result = signFreeAgentDirect(state, id, asking, 1);
    expect(result).toEqual({ ok: true, reason: null });
    const signed = state.players.find((p) => p.id === id)!;
    expect(signed.teamId).toBe(state.playerTeamId);
    expect(signed.roster).toBe('second');
    expect(signed.ext.contract?.salary).toBe(asking);
    expect(state.freeAgents.some((p) => p.id === id)).toBe(false);
  });

  it('FA市場が開いている間は直接契約できない', () => {
    const state = offseason(15);
    const id = mine(state)[6].id;
    releasePlayer(state, id);
    startFAPhase(state);
    expect(canSignDirectly(state)).toBe(false);
    const player = state.freeAgents.find((p) => p.id === id)!;
    expect(signFreeAgentDirect(state, id, directAsking(state, player).asking, 1).ok).toBe(false);
  });
});

describe('プロテクトと人的補償', () => {
  function withRoom(state: GameState, teamId: string) {
    // 支配下に空きを作る（下位の選手を未所属へ）
    const roster = state.players.filter((p) => p.teamId === teamId).sort((a, b) => overallRating(a) - overallRating(b));
    const drop = new Set(roster.slice(0, Math.max(0, roster.length - (ROSTER_LIMIT - 3))).map((p) => p.id));
    state.players = state.players.filter((p) => !drop.has(p.id));
  }

  it('プロテクトは28人まで。未設定なら総合力の上位28人', () => {
    const state = offseason(21);
    expect(protectedIds(state, state.playerTeamId).size).toBe(Math.min(PROTECT_LIMIT, mine(state).length));
    setProtectList(state, mine(state).map((p) => p.id));
    expect(state.protectList!.length).toBe(Math.min(PROTECT_LIMIT, mine(state).length));
  });

  it('自球団がFA選手を獲ると、元の球団がプロテクト外から1人を獲る', () => {
    const state = offseason(22);
    const former = state.teams.find((t) => t.id !== state.playerTeamId)!.id;
    withRoom(state, former);
    const protect = mine(state).slice(0, PROTECT_LIMIT).map((p) => p.id);
    setProtectList(state, protect);
    const list: FACompensation[] = [];
    registerCompensation(
      state,
      list,
      { faPlayerId: 'x', faName: 'FA選手', signingTeamId: state.playerTeamId, formerTeamId: former, grade: 'A' },
      new Set(),
    );
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('taken');
    const taken = state.players.find((p) => p.id === list[0].playerId)!;
    expect(taken.teamId).toBe(former);
    expect(protect).not.toContain(taken.id);
  });

  it('評価C以下や、CPU どうしの移籍では補償は発生しない', () => {
    const state = offseason(23);
    const [a, b] = state.teams.filter((t) => t.id !== state.playerTeamId);
    const list: FACompensation[] = [];
    const base = { faPlayerId: 'x', faName: 'FA選手' };
    registerCompensation(state, list, { ...base, signingTeamId: state.playerTeamId, formerTeamId: a.id, grade: 'C' }, new Set());
    registerCompensation(state, list, { ...base, signingTeamId: a.id, formerTeamId: b.id, grade: 'S' }, new Set());
    expect(list).toHaveLength(0);
  });

  it('自球団の選手がFA移籍すると、移籍先のプロテクト外から選べる（選ばなければ最上位を自動で獲得）', () => {
    const state = offseason(24);
    withRoom(state, state.playerTeamId);
    const signing = state.teams.find((t) => t.id !== state.playerTeamId)!.id;
    state.fa = { year: state.year, phase: 'resolved', listings: [], offers: [], results: [], unsigned: 0, compensations: [] } as unknown as GameState['fa'];
    const list = state.fa!.compensations!;
    registerCompensation(
      state,
      list,
      { faPlayerId: 'x', faName: 'FA選手', signingTeamId: signing, formerTeamId: state.playerTeamId, grade: 'S' },
      new Set(),
    );
    const entry = list[0];
    expect(entry.status).toBe('pending');
    const guard = protectedIds(state, signing);
    expect(entry.options!.length).toBeGreaterThan(0);
    expect(entry.options!.every((id) => !guard.has(id))).toBe(true);

    // 候補外は選べない
    expect(chooseCompensation(state, entry.id, [...guard][0])).toBe(false);
    const pick = entry.options![2];
    expect(chooseCompensation(state, entry.id, pick)).toBe(true);
    expect(state.players.find((p) => p.id === pick)!.teamId).toBe(state.playerTeamId);

    // 2件目は選ばずに進む → 自動で最上位
    registerCompensation(
      state,
      list,
      { faPlayerId: 'y', faName: 'FA選手2', signingTeamId: signing, formerTeamId: state.playerTeamId, grade: 'B' },
      new Set(),
    );
    const second = list[1];
    const best = second.options![0];
    autoChooseCompensations(state);
    expect(second.status).toBe('taken');
    expect(second.playerId).toBe(best);
  });
});
