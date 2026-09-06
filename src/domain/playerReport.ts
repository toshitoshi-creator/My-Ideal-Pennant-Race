/**
 * PHASE 4.4 選手報告書の読み方（§7〜§11）。
 *
 * PHASE 4.1 の playerAnalysis を作り直さず、その結果を「なぜこの選手をこう扱うのか」が
 * 分かる並びに組み替える。ここでも乱数・現在時刻は使わない。
 *
 * 大事な分け方（§9）：
 *   CURRENT PERFORMANCE  いま結果が出ているか
 *   DEVELOPMENT          伸びているか
 *   POTENTIAL OUTLOOK    この先どこまでいけそうか（断定しない）
 * この3つは別物として扱う。「成績が良い＝伸びている」ではない。
 */
import type { GameState, Player } from './types';
import {
  analyzePlayer,
  USAGE_ADVICE_LABELS,
  type AnalysisTrend,
  type PlayerAnalysis,
  type RadarAxis,
} from './playerAnalysis';
import { overallRating } from './rating';
import { average, era, formatAverage, formatInnings } from './stats';
import { usageRoleOf, USAGE_LABELS } from './club';
import { contractStatus, formatSalary } from './contract';
import { fatigueLabel, CONDITION_LABELS } from './condition';
import { potentialLabel } from './growth';

/* ================= 型 ================= */

/** 報告書の1行。英字の欄名と日本語をセットにする（§42） */
export interface ReportRow {
  key: string;
  en: string;
  ja: string;
  value: string;
  /** 値の意味を短く添える。なければ空文字 */
  note: string;
}

export interface AxisNote {
  key: string;
  label: string;
  value: number;
  /** リーグ的な良し悪しではなく、その選手の中での相対位置 */
  text: string;
}

export interface TrendReading {
  trend: AnalysisTrend;
  /** ↑ 改善 / → 安定 / ↓ 下降 */
  mark: string;
  label: string;
  /** データから直接読める説明。断定しない（§11） */
  text: string;
}

export interface PlayerReport {
  playerId: string;
  /** §7 の8項目 */
  rows: ReportRow[];
  /** §10 レーダーの隣に置く読み方 */
  strength: AxisNote | null;
  weakness: AxisNote | null;
  /** §9 現在の成績 */
  performanceNote: string;
  /** §9 成長傾向 */
  developmentNote: string;
  /** §9 将来性の推定（断定しない） */
  outlookNote: string;
  /** §9 現在と成長を合わせた読み方 */
  combinedNote: string;
  /** §11 グラフの下に置く読み方 */
  trendReading: TrendReading;
  analysis: PlayerAnalysis;
}

/* ================= 読み方の文章 ================= */

const TREND_MARKS: Record<AnalysisTrend, { mark: string; label: string }> = {
  UP: { mark: '↑', label: '改善' },
  FLAT: { mark: '→', label: '安定' },
  DOWN: { mark: '↓', label: '下降' },
  UNKNOWN: { mark: '—', label: '判定できない' },
};

/**
 * 年度別成績の読み方（§11）。
 * データから直接読めることだけを書く。「復活した」「今後伸びる」とは書かない。
 */
export function readTrend(player: Player, analysis: PlayerAnalysis): TrendReading {
  const { mark, label } = TREND_MARKS[analysis.developmentTrend];
  const seasons = analysis.trend.length;
  if (seasons === 0) {
    return {
      trend: 'UNKNOWN',
      mark: TREND_MARKS.UNKNOWN.mark,
      label: TREND_MARKS.UNKNOWN.label,
      text: 'まだ年度別成績が残っていないため、推移からは判断できません。',
    };
  }
  if (seasons === 1) {
    return {
      trend: 'UNKNOWN',
      mark: TREND_MARKS.UNKNOWN.mark,
      label: TREND_MARKS.UNKNOWN.label,
      text: '記録が1年ぶんしかないため、推移としては読めません。',
    };
  }

  // 実際に数値がどう動いたかを、そのまま書く
  const span = Math.min(3, seasons);
  const window = analysis.trend.slice(-span);
  const first = window[0];
  const last = window[window.length - 1];
  const key = player.isPitcher ? 'era' : 'average';
  const from = first.values[key];
  const to = last.values[key];
  const metric = player.isPitcher ? '防御率' : '打率';
  const fmt = (v: number) => (player.isPitcher ? v.toFixed(2) : formatAverage(v));

  const detail =
    from === undefined || to === undefined
      ? `記録している${window.length}年ぶんの成績から判定しています。`
      : `${first.year}年の${metric} ${fmt(from)} から ${last.year}年は ${fmt(to)} です。`;

  const text =
    analysis.developmentTrend === 'UP'
      ? `直近${window.length}年の成績は上向きに動いています。${detail}`
      : analysis.developmentTrend === 'DOWN'
        ? `直近${window.length}年の成績は下向きに動いています。${detail}`
        : `直近${window.length}年の成績は大きく動いていません。${detail}`;

  return { trend: analysis.developmentTrend, mark, label, text };
}

/** §9 いま結果が出ているか */
function performanceText(state: GameState, player: Player, analysis: PlayerAnalysis): string {
  const stats = state.stats?.[player.id];
  if (analysis.recentPerformance === null) {
    const games = stats ? Math.max(stats.batting.games, stats.pitching.games) : 0;
    return games === 0
      ? '今季はまだ出場がありません。成績からは判断できません。'
      : `今季の出場は${games}試合で、成績として評価するには足りません。`;
  }
  const score = analysis.recentPerformance;
  const line = player.isPitcher
    ? `${stats?.pitching.games ?? 0}登板・${formatInnings(stats?.pitching.outs ?? 0)}回・防御率 ${
        stats ? era(stats.pitching).toFixed(2) : '-'
      }`
    : `${stats?.batting.games ?? 0}試合・打率 ${
        stats ? formatAverage(average(stats.batting)) : '-'
      }・${stats?.batting.homeRuns ?? 0}本`;
  const word =
    score >= 62 ? '高い水準' : score >= 48 ? '平均的な水準' : score >= 38 ? 'やや低い水準' : '低い水準';
  return `${line}。今季の成績は${word}です。`;
}

/** §9 伸びているか（成績が良いかどうかとは別） */
function developmentText(player: Player, analysis: PlayerAnalysis): string {
  const parts: string[] = [];
  if (analysis.developmentTrend === 'UP') parts.push('年度別の成績は上向きです');
  else if (analysis.developmentTrend === 'DOWN') parts.push('年度別の成績は下向きです');
  else if (analysis.developmentTrend === 'FLAT') parts.push('年度別の成績は安定しています');
  else parts.push('年度別の記録が足りず、傾向は判定できません');

  parts.push(`成長期待は星${analysis.stars.development}です`);
  if (player.age <= 24) parts.push('年齢的には伸びしろが残る時期です');
  else if (player.age >= 32) parts.push('年齢的な伸びしろは小さくなっています');
  return parts.join('。') + '。';
}

/** §9 将来性の推定。実数値は出さず、断定もしない */
function outlookText(player: Player, analysis: PlayerAnalysis): string {
  const label = potentialLabel(player.ext.potential);
  const confidence = Math.round(analysis.scoutingConfidence * 100);
  const upside = analysis.radar.some((axis) => axis.projected !== null);
  return upside
    ? `スカウトの見立ては「${label}」（確度 ${confidence}%）。能力にはまだ伸びる余地があると見ていますが、確定した数字ではありません。`
    : `スカウトの見立ては「${label}」（確度 ${confidence}%）。年齢と見立てから、これ以上の大きな伸びは想定していません。`;
}

/** §9 現在と成長を突き合わせた読み方 */
function combinedText(player: Player, analysis: PlayerAnalysis): string {
  const performing = analysis.recentPerformance !== null && analysis.recentPerformance >= 55;
  const struggling = analysis.recentPerformance !== null && analysis.recentPerformance < 45;
  const growing = analysis.developmentTrend === 'UP' || analysis.stars.development >= 4;
  const old = player.age >= 31;

  if (struggling && growing) {
    return 'いまは結果が出ていませんが、伸びている側の材料があります。育成の価値がある一方、当面の勝ちには結びつきにくい形です。';
  }
  if (performing && !growing && old) {
    return 'いまは戦力の中心ですが、伸びる側の材料は多くありません。維持しながら、後を継ぐ選手を用意しておく形です。';
  }
  if (performing && growing) {
    return 'いま結果が出ていて、伸びている側の材料もあります。当面と長期のどちらでも数えられる形です。';
  }
  if (struggling && !growing) {
    return 'いま結果が出ておらず、伸びている側の材料も多くありません。起用・調整・整理のどれを取るかという場面です。';
  }
  return '現在の成績と成長の傾向は、どちらも突出していません。競争のなかで見極める段階です。';
}

/* ================= 強みと弱み（§10） ================= */

/**
 * レーダーの軸のうち、いちばん高い軸と低い軸。
 * レーダーだけを見て判断させないために、必ず言葉にして隣に置く。
 */
export function axisNotes(analysis: PlayerAnalysis): {
  strength: AxisNote | null;
  weakness: AxisNote | null;
} {
  const axes = analysis.radar;
  if (axes.length === 0) return { strength: null, weakness: null };
  const sorted = [...axes].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  // 全部同じ高さなら「強み」「弱み」とは呼ばない
  if (top.value - bottom.value < 8) return { strength: null, weakness: null };
  return {
    strength: { key: top.key, label: top.label, value: top.value, text: describeAxis(top, true) },
    weakness: {
      key: bottom.key,
      label: bottom.label,
      value: bottom.value,
      text: describeAxis(bottom, false),
    },
  };
}

function describeAxis(axis: RadarAxis, high: boolean): string {
  const word = axis.value >= 70 ? '高い' : axis.value >= 55 ? '平均以上' : axis.value >= 42 ? '平均的' : '低い';
  return high
    ? `${axis.label} ${axis.value}。この選手のなかでいちばん${word}能力です。`
    : `${axis.label} ${axis.value}。この選手のなかでいちばん低い能力です。`;
}

/* ================= 本体 ================= */

/**
 * §7 の8項目。数字を並べるだけにせず、「なぜ1軍に置くのか」が読める順に並べる。
 */
export function buildPlayerReport(state: GameState, player: Player): PlayerReport {
  const analysis = analyzePlayer(state, player);
  const stats = state.stats?.[player.id];
  const contract = player.ext.contract;
  const status = contractStatus(player);
  const role = usageRoleOf(state, player);

  const rows: ReportRow[] = [
    {
      key: 'current',
      en: 'CURRENT',
      ja: '現在の戦力',
      value: `総合 ${overallRating(player)}`,
      note: `現在戦力 星${analysis.stars.current}`,
    },
    {
      key: 'form',
      en: 'FORM',
      ja: '直近状態',
      value: CONDITION_LABELS[player.ext.condition],
      note: `疲労 ${Math.round(player.ext.fatigue)}（${fatigueLabel(player.ext.fatigue)}）`,
    },
    {
      key: 'trend',
      en: 'TREND',
      ja: '成績傾向',
      value: `${TREND_MARKS[analysis.developmentTrend].mark} ${TREND_MARKS[analysis.developmentTrend].label}`,
      note: analysis.trendSeasons > 0 ? `記録 ${analysis.trendSeasons}年ぶん` : '記録なし',
    },
    {
      key: 'age',
      en: 'AGE',
      ja: '年齢',
      value: `${player.age}歳`,
      note: player.ext.debutYear ? `${state.year - player.ext.debutYear + 1}年目` : '',
    },
    {
      key: 'role',
      en: 'ROLE',
      ja: '現在の役割',
      value: `${player.roster === 'first' ? '1軍' : '2軍'}・${USAGE_LABELS[role]}`,
      note: USAGE_ADVICE_LABELS[analysis.usage],
    },
    {
      key: 'development',
      en: 'DEVELOPMENT',
      ja: '成長状況',
      value: `成長期待 星${analysis.stars.development}`,
      note: `将来性 星${analysis.stars.future}`,
    },
    {
      key: 'contract',
      en: 'CONTRACT',
      ja: '契約',
      value: contract ? formatSalary(contract.salary) : '無契約',
      note: contract
        ? status === 'expiring'
          ? '今季で満了'
          : `残り${contract.yearsRemaining}年`
        : '',
    },
    {
      key: 'health',
      en: 'HEALTH',
      ja: '状態',
      value: player.ext.injury ? player.ext.injury.name : '出場可能',
      note: player.ext.injury
        ? `復帰予定 ${player.ext.injury.returnDate}`
        : `離脱リスク ${analysis.injuryRisk}`,
    },
  ];

  // 出場の実績は「なぜこの扱いなのか」に直結するので、ここにも一行足す
  const games = stats ? Math.max(stats.batting.games, stats.pitching.games) : 0;
  rows.splice(5, 0, {
    key: 'usage',
    en: 'PLAYING TIME',
    ja: '出場状況',
    value: `今季 ${games}試合`,
    note: `1軍出場 ${player.ext.firstTeamGames}試合`,
  });

  const { strength, weakness } = axisNotes(analysis);

  return {
    playerId: player.id,
    rows,
    strength,
    weakness,
    performanceNote: performanceText(state, player, analysis),
    developmentNote: developmentText(player, analysis),
    outlookNote: outlookText(player, analysis),
    combinedNote: combinedText(player, analysis),
    trendReading: readTrend(player, analysis),
    analysis,
  };
}
