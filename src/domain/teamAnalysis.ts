/**
 * PHASE 4.1 チーム分析。
 *
 * 既存の rosterAnalysis（CPUが使っている枠の分析）と rating を組み合わせて、
 * 「このチームの強みと課題はどこか」を表示できる形にする。
 * 乱数・現在時刻を使わない読み取り専用の計算で、ゲーム状態は書き換えない。
 */
import type { GameState, Player } from './types';
import {
  POSITION_KEYS,
  POSITION_KEY_LABELS,
  POSITION_REQUIRED,
  analyzeRoster,
  knownPlayersOf,
  financeOf,
  positionKeyOf,
  type DepthSlot,
  type PositionKey,
  type RosterAnalysis,
} from './rosterAnalysis';
import { battingRating, defenseRating, pitchingRating, overallRating } from './rating';
import { MAX_SALARY_SHARE } from './contract';
import { standingsForLeague } from './standings';

/* ================= 型 ================= */

export type TeamAxisKey =
  | 'batting'
  | 'pitching'
  | 'defense'
  | 'speed'
  | 'youth'
  | 'veteran'
  | 'depth';

export interface TeamAxis {
  key: TeamAxisKey;
  label: string;
  /** 1〜100 */
  value: number;
  /** リーグ平均との差（プラスなら平均以上） */
  vsLeague: number;
}

/** ポジションごとの層 */
export interface DepthEntry {
  playerId: string;
  name: string;
  overall: number;
  age: number;
  slot: DepthSlot;
  /** 1軍登録か */
  firstTeam: boolean;
}

export interface DepthColumn {
  key: PositionKey;
  label: string;
  required: number;
  entries: DepthEntry[];
  /** 0〜100 の補強必要度 */
  need: number;
}

export type TeamStatus = 'GOOD' | 'STABLE' | 'CAUTION' | 'RISK';

export interface TeamIssue {
  id: string;
  text: string;
  /** 重さ 1〜3。UI では強すぎる警告にしない */
  severity: 1 | 2 | 3;
}

export interface TeamAnalysis {
  teamId: string;
  axes: TeamAxis[];
  depth: DepthColumn[];
  issues: TeamIssue[];
  status: TeamStatus;
  statusReason: string;
  /** 選手層の内訳 */
  counts: {
    total: number;
    firstTeam: number;
    starters: number;
    relievers: number;
    fielders: number;
    young: number;
    veteran: number;
  };
  roster: RosterAnalysis;
}

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  GOOD: '好調',
  STABLE: '安定',
  CAUTION: '注意',
  RISK: '危険',
};

export const TEAM_AXIS_LABELS: Record<TeamAxisKey, string> = {
  batting: '打撃力',
  pitching: '投手力',
  defense: '守備力',
  speed: '走力',
  youth: '若手力',
  veteran: 'ベテラン力',
  depth: '選手層',
};

/* ================= 軸の計算 ================= */

/** 上位 n 人の平均。人数が足りなければ足りないぶんを低く見積もる */
function topAverage(values: number[], n: number): number {
  if (n <= 0) return 0;
    const sorted = [...values].sort((a, b) => b - a);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i] ?? 0;
  return sum / n;
}

function clamp1to100(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

/** 1球団ぶんの生の軸値（リーグ比較の前） */
function rawAxes(state: GameState, teamId: string): Record<TeamAxisKey, number> {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const batters = roster.filter((p) => !p.isPitcher);
  const pitchers = roster.filter((p) => p.isPitcher && p.pitching);
  const staminaOf = (p: Player) => p.pitching?.stamina ?? 0;
  const starters = pitchers.filter((p) => staminaOf(p) >= 55);
  const relievers = pitchers.filter((p) => staminaOf(p) < 55);

  const batting = topAverage(batters.map(battingRating), 9);
  // 先発5人と救援5人をあわせて投手力とする
  const pitching =
    topAverage(starters.map(pitchingRating), 5) * 0.62 +
    topAverage(relievers.map(pitchingRating), 5) * 0.38;
  const defense = topAverage(batters.map(defenseRating), 8);
  const speed = topAverage(
    batters.map((p) => p.batting.speed),
    9,
  );

  const young = roster.filter((p) => p.age <= 25);
  const veterans = roster.filter((p) => p.age >= 31);
  const youth = young.length ? topAverage(young.map(overallRating), Math.min(8, young.length)) : 1;
  const veteran = veterans.length
    ? topAverage(veterans.map(overallRating), Math.min(6, veterans.length))
    : 1;

  // 選手層：主力の次にいる控えの厚み
  const depth = topAverage(roster.map(overallRating), Math.min(24, roster.length)) * 0.6 +
    topAverage(roster.map(overallRating), Math.min(30, roster.length)) * 0.4;

  return {
    batting: clamp1to100(batting),
    pitching: clamp1to100(pitching),
    defense: clamp1to100(defense),
    speed: clamp1to100(speed),
    youth: clamp1to100(youth),
    veteran: clamp1to100(veteran),
    depth: clamp1to100(depth),
  };
}

/* ================= 深度 ================= */

function buildDepth(state: GameState, roster: RosterAnalysis): DepthColumn[] {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  return POSITION_KEYS.map((key) => {
    const analysis = roster.positions[key];
    const entries: DepthEntry[] = analysis.entries.map((entry) => {
      const player = byId.get(entry.playerId);
      return {
        playerId: entry.playerId,
        name: player?.name ?? '－',
        overall: entry.overall,
        age: entry.age,
        slot: entry.slot,
        firstTeam: player?.roster === 'first',
      };
    });
    return {
      key,
      label: POSITION_KEY_LABELS[key],
      required: POSITION_REQUIRED[key],
      entries,
      need: analysis.need,
    };
  });
}

/* ================= 課題 ================= */

function buildIssues(
  state: GameState,
  teamId: string,
  roster: RosterAnalysis,
  axes: TeamAxis[],
  counts: TeamAnalysis['counts'],
): TeamIssue[] {
  const issues: TeamIssue[] = [];
  const axisOf = (key: TeamAxisKey) => axes.find((a) => a.key === key)!;

  // ポジションの穴（need が高い順に最大2つ）
  const weak = [...POSITION_KEYS]
    .map((key) => roster.positions[key])
    .filter((p) => p.need >= 45)
    .sort((a, b) => b.need - a.need)
    .slice(0, 2);
  for (const position of weak) {
    issues.push({
      id: `need:${position.key}`,
      text: `${POSITION_KEY_LABELS[position.key]}の層が薄い`,
      severity: position.need >= 70 ? 3 : 2,
    });
  }

  if (counts.starters < 5) {
    issues.push({
      id: 'starters',
      text: `先発として計算できる投手が${counts.starters}人しかいない`,
      severity: 3,
    });
  }
  if (counts.relievers < 5) {
    issues.push({
      id: 'relievers',
      text: `リリーフの頭数が${counts.relievers}人と少ない`,
      severity: 2,
    });
  }

  const youth = axisOf('youth');
  if (youth.vsLeague <= -6) {
    issues.push({ id: 'youth', text: '若手の力がリーグ平均を下回っている', severity: 2 });
  }
  if (roster.veteranRatio >= 0.34) {
    issues.push({
      id: 'veteran',
      text: `33歳以上が${Math.round(roster.veteranRatio * 100)}%とベテラン依存度が高い`,
      severity: 2,
    });
  }
  if (roster.youngRatio <= 0.16) {
    issues.push({ id: 'young-ratio', text: '25歳以下の選手が少なく世代交代が進んでいない', severity: 2 });
  }

  // 疲労のたまったリリーフ
  const tiredRelievers = state.players.filter(
    (p) => p.teamId === teamId && p.isPitcher && (p.pitching?.stamina ?? 0) < 55 && p.ext.fatigue >= 62,
  ).length;
  if (tiredRelievers >= 3) {
    issues.push({
      id: 'fatigue',
      text: `リリーフ${tiredRelievers}人の疲労が高く、離脱のリスクがある`,
      severity: 2,
    });
  }

  const injured = state.players.filter((p) => p.teamId === teamId && p.ext.injury).length;
  if (injured >= 4) {
    issues.push({ id: 'injury', text: `${injured}人が離脱中で戦力が欠けている`, severity: 2 });
  }

  if (roster.payroll > roster.budget * 0.95) {
    issues.push({
      id: 'payroll',
      text: '年俸総額が予算の上限に近く、補強の余力が小さい',
      severity: 2,
    });
  }

  const batting = axisOf('batting');
  const pitching = axisOf('pitching');
  if (batting.vsLeague <= -7) {
    issues.push({ id: 'batting', text: '打線の総合力がリーグ平均を下回っている', severity: 2 });
  }
  if (pitching.vsLeague <= -7) {
    issues.push({ id: 'pitching', text: '投手陣の総合力がリーグ平均を下回っている', severity: 2 });
  }

  return issues.sort((a, b) => b.severity - a.severity).slice(0, 3);
}

/* ================= 状態 ================= */

function decideStatus(
  state: GameState,
  teamId: string,
  issues: TeamIssue[],
): { status: TeamStatus; reason: string } {
  const record = state.records[teamId];
  const played = record ? record.wins + record.losses : 0;
  const rate = played > 0 ? record.wins / played : 0.5;
  const team = state.teams.find((t) => t.id === teamId);
  const rank = team
    ? (standingsForLeague(state, team.leagueId).find((r) => r.teamId === teamId)?.rank ?? 0)
    : 0;
  const weight = issues.reduce((sum, issue) => sum + issue.severity, 0);

  if (played < 5) {
    return {
      status: weight >= 6 ? 'CAUTION' : 'STABLE',
      reason: 'シーズンが始まったばかりのため、編成の状況から判断しています。',
    };
  }
  const rankPart = rank > 0 ? `${rank}位・` : '';
  if (rate >= 0.56 && weight <= 4) {
    return { status: 'GOOD', reason: `${rankPart}勝率 ${rate.toFixed(3)} と好調で、大きな穴もありません。` };
  }
  if (rate <= 0.42 && weight >= 5) {
    return { status: 'RISK', reason: `${rankPart}勝率 ${rate.toFixed(3)} と苦しく、編成上の課題も重なっています。` };
  }
  if (rate <= 0.46 || weight >= 6) {
    return { status: 'CAUTION', reason: `${rankPart}勝率 ${rate.toFixed(3)}。いくつか手当てすべき課題があります。` };
  }
  return { status: 'STABLE', reason: `${rankPart}勝率 ${rate.toFixed(3)}。大きく崩れてはいません。` };
}

/* ================= 本体 ================= */

/**
 * チーム分析をひとまとめに作る。state は読み取りだけ。
 */
export function analyzeTeamForDisplay(state: GameState, teamId: string): TeamAnalysis {
  // リーグ全体と比べるため、全球団の生の軸値を出す
  const raw = new Map<string, Record<TeamAxisKey, number>>();
  for (const team of state.teams) raw.set(team.id, rawAxes(state, team.id));
  const mine = raw.get(teamId) ?? rawAxes(state, teamId);

  const keys: TeamAxisKey[] = [
    'batting',
    'pitching',
    'defense',
    'speed',
    'youth',
    'veteran',
    'depth',
  ];
  const axes: TeamAxis[] = keys.map((key) => {
    const all = [...raw.values()].map((r) => r[key]);
    const league = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    return {
      key,
      label: TEAM_AXIS_LABELS[key],
      value: mine[key],
      vsLeague: Math.round((mine[key] - league) * 10) / 10,
    };
  });

  const roster = analyzeRoster(
    teamId,
    knownPlayersOf(state, teamId, 'own', () => 0),
    (playerId) => state.players.find((p) => p.id === playerId)?.pitching?.stamina ?? 0,
    financeOf(state, teamId),
    MAX_SALARY_SHARE,
  );

  const players = state.players.filter((p) => p.teamId === teamId);
  const pitchers = players.filter((p) => p.isPitcher && p.pitching);
  const counts: TeamAnalysis['counts'] = {
    total: players.length,
    firstTeam: players.filter((p) => p.roster === 'first').length,
    starters: pitchers.filter((p) => (p.pitching?.stamina ?? 0) >= 55).length,
    relievers: pitchers.filter((p) => (p.pitching?.stamina ?? 0) < 55).length,
    fielders: players.filter((p) => !p.isPitcher).length,
    young: players.filter((p) => p.age <= 25).length,
    veteran: players.filter((p) => p.age >= 31).length,
  };

  const issues = buildIssues(state, teamId, roster, axes, counts);
  const { status, reason } = decideStatus(state, teamId, issues);

  return {
    teamId,
    axes,
    depth: buildDepth(state, roster),
    issues,
    status,
    statusReason: reason,
    counts,
    roster,
  };
}

/** ポジションキーの判定を UI からも使えるように再輸出する */
export { positionKeyOf, POSITION_KEYS, POSITION_KEY_LABELS };
export type { PositionKey, DepthSlot };
