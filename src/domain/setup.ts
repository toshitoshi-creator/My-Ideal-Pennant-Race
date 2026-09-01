import type { LineupSlot, Player, PositionId, TeamSetup } from './types';
import { FIELD_POSITIONS, positionDifficulty, effectiveDefense } from './positions';
import { battingRating, pitchingRating } from './rating';

/** 非 DH 制の打順における投手枠（実際の先発投手は試合開始時に差し込まれる） */
export const PITCHER_SLOT_ID = '';

export function isPitcherSlot(slot: LineupSlot): boolean {
  return slot.position === 'P';
}

export function firstTeamPlayers(players: Player[], teamId: string): Player[] {
  return players.filter((p) => p.teamId === teamId && p.roster === 'first');
}

/** 打順に入る 8（DH なら 9）人の野手を自動で選ぶ */
function chooseFielders(
  candidates: Player[],
): { slots: LineupSlot[]; used: Set<string> } {
  const used = new Set<string>();
  const slots: LineupSlot[] = [];
  // 難しい守備位置から埋める
  const order = [...FIELD_POSITIONS].sort(
    (a, b) => positionDifficulty(b) - positionDifficulty(a),
  );
  for (const position of order) {
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of candidates) {
      if (used.has(p.id)) continue;
      const score = effectiveDefense(p, position) * 0.62 + battingRating(p) * 0.38;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      slots.push({ playerId: best.id, position });
    }
  }
  return { slots, used };
}

/** 打順を能力から並べる（4番に最高打者、1番は俊足） */
function sortBattingOrder(slots: LineupSlot[], byId: Map<string, Player>): LineupSlot[] {
  const sorted = [...slots].sort((a, b) => {
    const pa = byId.get(a.playerId);
    const pb = byId.get(b.playerId);
    return (pb ? battingRating(pb) : 0) - (pa ? battingRating(pa) : 0);
  });
  if (sorted.length === 0) return sorted;
  // 上位 5 人の中で一番足の速い選手を 1 番に
  const leadoffPool = sorted.slice(0, Math.min(5, sorted.length));
  let leadoff = leadoffPool[0];
  for (const slot of leadoffPool) {
    const p = byId.get(slot.playerId);
    const cur = byId.get(leadoff.playerId);
    if (p && cur && p.batting.speed > cur.batting.speed) leadoff = slot;
  }
  const rest = sorted.filter((s) => s !== leadoff);
  // 4番→3番→5番→2番→6番... の優先順で強打者を配置
  const priority = [3, 2, 4, 1, 5, 6, 7, 8];
  const result: LineupSlot[] = new Array(sorted.length);
  result[0] = leadoff;
  rest.forEach((slot, i) => {
    const idx = priority[i];
    if (idx !== undefined && idx < result.length) result[idx] = slot;
  });
  // 埋まらなかった枠を詰める
  const leftovers = rest.filter((s) => !result.includes(s));
  for (let i = 0; i < result.length; i++) {
    if (!result[i]) result[i] = leftovers.shift()!;
  }
  return result;
}

/** ローテーション（先発 5 人）を自動で選ぶ */
export function chooseRotation(players: Player[]): string[] {
  return players
    .filter((p) => p.isPitcher && p.pitching)
    .sort((a, b) => {
      const sa = pitchingRating(a) + a.pitching!.stamina * 0.5;
      const sb = pitchingRating(b) + b.pitching!.stamina * 0.5;
      return sb - sa;
    })
    .slice(0, 5)
    .map((p) => p.id);
}

/** リリーフ候補（ローテーション以外の 1軍投手、能力の低い順＝良い投手を後ろに） */
export function bullpen(players: Player[], rotation: string[]): Player[] {
  return players
    .filter((p) => p.isPitcher && p.pitching && !rotation.includes(p.id))
    .sort((a, b) => pitchingRating(a) - pitchingRating(b));
}

export function buildAutoSetup(
  teamId: string,
  firstTeam: Player[],
  useDH: boolean,
): TeamSetup {
  const byId = new Map(firstTeam.map((p) => [p.id, p]));
  const fielderCandidates = firstTeam.filter((p) => !p.isPitcher);
  const { slots, used } = chooseFielders(fielderCandidates);
  const battingSlots = [...slots];

  if (useDH) {
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of fielderCandidates) {
      if (used.has(p.id)) continue;
      const score = battingRating(p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) battingSlots.push({ playerId: best.id, position: 'DH' });
  }

  const ordered = sortBattingOrder(battingSlots, byId);
  const lineup = useDH
    ? ordered
    : [...ordered, { playerId: PITCHER_SLOT_ID, position: 'P' as PositionId }];

  return {
    teamId,
    lineup,
    rotation: chooseRotation(firstTeam),
    rotationIndex: 0,
  };
}

/**
 * 1軍から外れた選手などがオーダーに残らないよう修復する。
 * 「存在しない選手がオーダーに入る」ことを防ぐ最後の砦。
 */
export function repairSetup(
  setup: TeamSetup | undefined,
  teamId: string,
  firstTeam: Player[],
  useDH: boolean,
): TeamSetup {
  const auto = buildAutoSetup(teamId, firstTeam, useDH);
  if (!setup) return auto;

  const valid = new Map(firstTeam.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const lineup: LineupSlot[] = [];

  for (const slot of setup.lineup) {
    if (slot.position === 'P') {
      if (!useDH && !lineup.some((s) => s.position === 'P')) {
        lineup.push({ playerId: PITCHER_SLOT_ID, position: 'P' });
      }
      continue;
    }
    const player = valid.get(slot.playerId);
    if (!player || player.isPitcher || seen.has(slot.playerId)) continue;
    seen.add(slot.playerId);
    lineup.push({ playerId: slot.playerId, position: slot.position });
  }

  // DH 制の切り替えに追従
  if (!useDH) {
    const dhIndex = lineup.findIndex((s) => s.position === 'DH');
    if (dhIndex >= 0) lineup.splice(dhIndex, 1);
    if (!lineup.some((s) => s.position === 'P')) {
      lineup.push({ playerId: PITCHER_SLOT_ID, position: 'P' });
    }
  } else {
    const pIndex = lineup.findIndex((s) => s.position === 'P');
    if (pIndex >= 0) lineup.splice(pIndex, 1);
  }

  // 守備位置の重複を解消
  const usedPositions = new Set<string>();
  for (const slot of lineup) {
    if (slot.position === 'DH' || slot.position === 'P') continue;
    if (usedPositions.has(slot.position)) {
      slot.position = 'DH';
    } else {
      usedPositions.add(slot.position);
    }
  }

  // 足りない守備位置・打順を自動で補完
  const allowedDh = useDH ? 1 : 0;
  const missing = FIELD_POSITIONS.filter((pos) => !usedPositions.has(pos));
  const bench = firstTeam.filter((p) => !p.isPitcher && !seen.has(p.id));
  for (const position of missing) {
    // 余った DH 枠の選手をまず守備につかせる
    const dhSlots = lineup.filter((s) => s.position === 'DH');
    if (dhSlots.length > allowedDh) {
      const slot = dhSlots[dhSlots.length - 1];
      slot.position = position;
      usedPositions.add(position);
      continue;
    }
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const p of bench) {
      if (seen.has(p.id)) continue;
      const score = effectiveDefense(p, position);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      seen.add(best.id);
      lineup.push({ playerId: best.id, position });
      usedPositions.add(position);
    }
  }

  const targetLength = 9;
  while (lineup.length > targetLength) lineup.pop();
  while (lineup.length < targetLength) {
    const extra = firstTeam.find((p) => !p.isPitcher && !seen.has(p.id));
    if (!extra) break;
    seen.add(extra.id);
    lineup.push({ playerId: extra.id, position: 'DH' });
  }

  // ローテーション
  const rotation = setup.rotation.filter((id) => {
    const p = valid.get(id);
    return !!p && p.isPitcher;
  });
  const dedupRotation = [...new Set(rotation)];
  if (dedupRotation.length === 0) {
    dedupRotation.push(...auto.rotation);
  }
  while (dedupRotation.length < Math.min(5, firstTeam.filter((p) => p.isPitcher).length)) {
    const next = auto.rotation.find((id) => !dedupRotation.includes(id))
      ?? firstTeam.find((p) => p.isPitcher && !dedupRotation.includes(p.id))?.id;
    if (!next) break;
    dedupRotation.push(next);
  }

  return {
    teamId,
    lineup,
    rotation: dedupRotation.slice(0, 5),
    rotationIndex:
      dedupRotation.length > 0 ? setup.rotationIndex % dedupRotation.length : 0,
  };
}

export function nextStarterId(setup: TeamSetup): string | null {
  if (setup.rotation.length === 0) return null;
  return setup.rotation[setup.rotationIndex % setup.rotation.length];
}

export interface LineupIssue {
  message: string;
}

/** UI 表示用のオーダー検証 */
export function validateLineup(
  setup: TeamSetup,
  firstTeam: Player[],
  useDH: boolean,
): LineupIssue[] {
  const issues: LineupIssue[] = [];
  const byId = new Map(firstTeam.map((p) => [p.id, p]));
  const seen = new Set<string>();

  if (setup.lineup.length !== 9) {
    issues.push({ message: `打順が ${setup.lineup.length} 人です（9 人必要）` });
  }
  for (const slot of setup.lineup) {
    if (slot.position === 'P') continue;
    if (!byId.has(slot.playerId)) {
      issues.push({ message: '1軍にいない選手が打順に入っています' });
      continue;
    }
    if (seen.has(slot.playerId)) {
      issues.push({ message: '同じ選手が複数の打順に入っています' });
    }
    seen.add(slot.playerId);
  }
  const positions = setup.lineup
    .filter((s) => s.position !== 'DH' && s.position !== 'P')
    .map((s) => s.position);
  for (const pos of FIELD_POSITIONS) {
    if (!positions.includes(pos)) {
      issues.push({ message: `守備位置「${pos}」が空いています` });
    }
  }
  if (useDH && !setup.lineup.some((s) => s.position === 'DH')) {
    issues.push({ message: 'DH が設定されていません' });
  }
  if (setup.rotation.length === 0) {
    issues.push({ message: '先発投手が 1 人も設定されていません' });
  }
  return issues;
}
