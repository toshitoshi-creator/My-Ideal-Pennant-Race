/**
 * PHASE 4.4 球団分析を「経営判断」につなぐ（§12・§13）。
 *
 * teamAnalysis が出した課題に、
 *   WHY     なぜそれが課題なのか
 *   DATA    何が足りないのか
 *   OPTIONS どんな手があるか
 *   COST    どれくらい負担になるか
 *   RISK    どんなリスクがあるか
 * を足す。ここでも「正解」は出さない（§13）。どれを選んでも失うものがある形にする。
 *
 * 乱数・現在時刻は使わない。同じ state からは必ず同じ内容になる。
 */
import type { GameState } from './types';
import { analyzeTeamForDisplay, type TeamAnalysis, type TeamIssue } from './teamAnalysis';
import {
  POSITION_KEYS,
  POSITION_KEY_LABELS,
  type PositionKey,
} from './rosterAnalysis';
import { formatMoney, remainingBudget } from './contract';
import type { GmDeskLink } from './gmDesk';
import { formatDelta } from './gmDesk';

/* ================= 型 ================= */

export interface ReportDatum {
  label: string;
  value: string;
}

/** 課題ひとつ（§12：番号を振って並べる） */
export interface IssueDetail {
  id: string;
  /** 01, 02, ... */
  no: string;
  /** 欄名（英字） */
  en: string;
  /** 課題の名前（日本語） */
  ja: string;
  /** 何が起きているか */
  text: string;
  /** なぜ課題なのか */
  why: string;
  data: ReportDatum[];
  severity: 1 | 2 | 3;
}

export type ReinforcementRoute = 'FA' | 'TRADE' | 'YOUTH' | 'STAY';

export interface ReinforcementOption {
  route: ReinforcementRoute;
  en: string;
  ja: string;
  /** 何が手に入るか */
  merit: string;
  /** どれくらい負担になるか */
  cost: string;
  /** どんなリスクがあるか */
  risk: string;
  /** 実際に手を打てる画面（無ければ null） */
  link: GmDeskLink | null;
}

/** 補強ポイントひとつ（§13） */
export interface ReinforcementPlan {
  id: string;
  en: string;
  ja: string;
  /** なぜ必要なのか */
  why: string;
  /** 何が不足しているのか */
  data: ReportDatum[];
  options: ReinforcementOption[];
}

export interface TeamReport {
  teamId: string;
  issues: IssueDetail[];
  plans: ReinforcementPlan[];
  analysis: TeamAnalysis;
}

export const ROUTE_LABELS: Record<ReinforcementRoute, { en: string; ja: string }> = {
  FA: { en: 'FREE AGENCY', ja: 'FAで獲る' },
  TRADE: { en: 'TRADE', ja: 'トレードで獲る' },
  YOUTH: { en: 'YOUTH', ja: '若手を起用する' },
  STAY: { en: 'STAY', ja: '現状のまま進める' },
};

/* ================= 課題の説明 ================= */

/** 課題IDごとの「なぜ課題なのか」。無ければ汎用の説明を出す */
function whyOf(issue: TeamIssue, analysis: TeamAnalysis): string {
  const id = issue.id;
  if (id.startsWith('need:')) {
    return 'そのポジションを守れる選手が必要人数に届かず、離脱や不振が出たときに埋める選手がいません。';
  }
  switch (id) {
    case 'starters':
      return `ローテーションは5人で回します。${analysis.counts.starters}人では、足りないぶんを中継ぎか2軍から補うことになり、そのしわ寄せが失点に出ます。`;
    case 'relievers':
      return '救援の頭数が少ないと、同じ投手が続けて登板することになり、疲労と離脱のリスクが上がります。';
    case 'youth':
      return '若手の力がリーグ平均を下回る状態は、いまの勝敗より数年後の戦力に効いてきます。';
    case 'veteran':
      return '同じ年代に偏った編成は、引退期がまとめて来たときに一度に入れ替えが必要になります。';
    case 'young-ratio':
      return '若い選手が少ないと、いまの主力が抜けたときに空いた枠を埋める選手が球団内にいません。';
    case 'fatigue':
      return '疲労はその日の実効能力を下げ、怪我の確率にも関わります。';
    case 'injury':
      return '離脱者が多いと、本来は控えの選手が続けて出場することになります。';
    case 'payroll':
      return '年俸総額が予算に迫っていると、新しい契約を結ぶ余地がありません。';
    case 'batting':
      return '打線の総合力がリーグ平均を下回っていると、接戦を落としやすくなります。';
    case 'pitching':
      return '投手陣の総合力がリーグ平均を下回っていると、リードを守りきれない試合が増えます。';
    default:
      return '編成のうえで手当てを考える材料です。';
  }
}

/** 課題IDごとの英字の欄名 */
function enOf(issue: TeamIssue): string {
  const id = issue.id;
  if (id.startsWith('need:')) return 'POSITION DEPTH';
  switch (id) {
    case 'starters':
      return 'STARTING PITCHING';
    case 'relievers':
    case 'fatigue':
      return 'BULLPEN';
    case 'youth':
    case 'young-ratio':
    case 'veteran':
      return 'SQUAD AGE';
    case 'injury':
      return 'INJURIES';
    case 'payroll':
      return 'PAYROLL';
    case 'batting':
      return 'BATTING';
    case 'pitching':
      return 'PITCHING';
    default:
      return 'CLUB REPORT';
  }
}

/** その課題を裏づける数字 */
function dataOf(state: GameState, issue: TeamIssue, analysis: TeamAnalysis): ReportDatum[] {
  const axis = (key: 'batting' | 'pitching' | 'youth' | 'veteran' | 'depth') => {
    const found = analysis.axes.find((a) => a.key === key);
    return found ? formatDelta(found.vsLeague) : '—';
  };
  if (issue.id.startsWith('need:')) {
    const key = issue.id.slice(5) as PositionKey;
    const column = analysis.depth.find((c) => c.key === key);
    return [
      { label: '在籍', value: `${column?.entries.length ?? 0}人` },
      { label: '必要', value: `${column?.required ?? 0}人` },
      { label: '補強必要度', value: `${column?.need ?? 0} / 100` },
    ];
  }
  switch (issue.id) {
    case 'starters':
      return [
        { label: '先発型', value: `${analysis.counts.starters}人` },
        { label: '必要', value: '5人' },
        { label: '投手力（平均差）', value: axis('pitching') },
      ];
    case 'relievers':
      return [
        { label: 'リリーフ型', value: `${analysis.counts.relievers}人` },
        { label: '必要', value: '5人' },
        { label: '投手力（平均差）', value: axis('pitching') },
      ];
    case 'youth':
      return [
        { label: '25歳以下', value: `${analysis.counts.young}人` },
        { label: '若手力（平均差）', value: axis('youth') },
      ];
    case 'veteran':
    case 'young-ratio':
      return [
        { label: '33歳以上の比率', value: `${Math.round(analysis.roster.veteranRatio * 100)}%` },
        { label: '25歳以下の比率', value: `${Math.round(analysis.roster.youngRatio * 100)}%` },
        { label: 'ベテラン力（平均差）', value: axis('veteran') },
      ];
    case 'fatigue': {
      const tired = state.players.filter(
        (p) =>
          p.teamId === analysis.teamId &&
          p.isPitcher &&
          (p.pitching?.stamina ?? 0) < 55 &&
          p.ext.fatigue >= 62,
      ).length;
      return [
        { label: '疲労の高いリリーフ', value: `${tired}人` },
        { label: 'リリーフ総数', value: `${analysis.counts.relievers}人` },
      ];
    }
    case 'injury': {
      const injured = state.players.filter(
        (p) => p.teamId === analysis.teamId && p.ext.injury,
      ).length;
      return [
        { label: '離脱中', value: `${injured}人` },
        { label: '在籍', value: `${analysis.counts.total}人` },
      ];
    }
    case 'payroll':
      return [
        { label: '総年俸', value: formatMoney(analysis.roster.payroll) },
        { label: '年間予算', value: formatMoney(analysis.roster.budget) },
        { label: '残り', value: formatMoney(remainingBudget(state, analysis.teamId)) },
      ];
    case 'batting':
      return [
        { label: '打撃力', value: String(analysis.axes.find((a) => a.key === 'batting')?.value ?? 0) },
        { label: 'リーグ平均差', value: axis('batting') },
      ];
    case 'pitching':
      return [
        { label: '投手力', value: String(analysis.axes.find((a) => a.key === 'pitching')?.value ?? 0) },
        { label: 'リーグ平均差', value: axis('pitching') },
      ];
    default:
      return [{ label: '選手層（平均差）', value: axis('depth') }];
  }
}

/* ================= 補強の道すじ ================= */

/**
 * 「補強すべき」で終わらせない（§13）。
 * FA・トレード・若手・現状維持の4つを、必ず対価つきで並べる。
 */
function optionsFor(state: GameState, teamId: string, label: string): ReinforcementOption[] {
  const remaining = remainingBudget(state, teamId);
  const faOpen = state.fa !== null;
  const tradeOpen = state.date <= state.trade.deadline;

  return [
    {
      route: 'FA',
      ...ROUTE_LABELS.FA,
      merit: `${label}の即戦力を、選手を出さずに獲得できる可能性があります。`,
      cost:
        remaining > 0
          ? `予算の残りは ${formatMoney(remaining)} です。契約した年数ぶん、その額が固定されます。`
          : '予算に余裕がないため、契約するには他の年俸を減らす必要があります。',
      risk: '他球団と競合すれば取れません。年齢の高い選手は、契約の後半で戦力にならないことがあります。',
      link: faOpen ? 'fa' : null,
    },
    {
      route: 'TRADE',
      ...ROUTE_LABELS.TRADE,
      merit: `${label}に合う選手を、球団の余っている枠と交換できる可能性があります。`,
      cost: '相手が納得する対価が要ります。多くの場合、こちらの主力か若手を出すことになります。',
      risk: '出した選手が伸びることもあります。成立するかどうかは相手球団の事情にもよります。',
      link: tradeOpen ? 'trade' : null,
    },
    {
      route: 'YOUTH',
      ...ROUTE_LABELS.YOUTH,
      merit: `${label}の枠を、球団にいる若手に回せます。年俸の負担はほとんど増えません。`,
      cost: '当面の戦力としては読みにくく、結果が出るまでに時間がかかることがあります。',
      risk: '伸びるかどうかは分かりません。試したぶん、いまの勝敗は不安定になります。',
      link: 'roster',
    },
    {
      route: 'STAY',
      ...ROUTE_LABELS.STAY,
      merit: '資金も選手も使いません。来季以降の自由度がそのまま残ります。',
      cost: `${label}の状態は変わらないため、同じ問題が続きます。`,
      risk: '離脱や不振が重なったときに、埋める手段がありません。',
      link: null,
    },
  ];
}

/** 補強を検討する場所を、必要度の高い順に最大2つ */
function buildPlans(state: GameState, teamId: string, analysis: TeamAnalysis): ReinforcementPlan[] {
  const columns = [...POSITION_KEYS]
    .map((key) => analysis.depth.find((c) => c.key === key)!)
    .filter((column) => column && column.need >= 45)
    .sort((a, b) => (b.need !== a.need ? b.need - a.need : a.key < b.key ? -1 : 1))
    .slice(0, 2);

  return columns.map((column) => {
    const label = POSITION_KEY_LABELS[column.key];
    const shortfall = Math.max(0, column.required - column.entries.length);
    return {
      id: `plan:${column.key}`,
      en: planEn(column.key),
      ja: label,
      why:
        shortfall > 0
          ? `${label}を守れる選手が必要人数に${shortfall}人足りていません。`
          : `${label}の層はそろっていますが、評価がリーグの水準に届いていません。`,
      data: [
        { label: '在籍', value: `${column.entries.length}人` },
        { label: '必要', value: `${column.required}人` },
        { label: '補強必要度', value: `${column.need} / 100` },
      ],
      options: optionsFor(state, teamId, label),
    };
  });
}

function planEn(key: PositionKey): string {
  switch (key) {
    case 'SP':
      return 'STARTING PITCHER';
    case 'RP':
      return 'RELIEF PITCHER';
    case 'C':
      return 'CATCHER';
    case 'OF':
      return 'OUTFIELD';
    default:
      return 'INFIELD';
  }
}

/* ================= 本体 ================= */

export function buildTeamReport(state: GameState, teamId: string): TeamReport {
  const analysis = analyzeTeamForDisplay(state, teamId);
  const issues: IssueDetail[] = analysis.issues.map((issue, index) => ({
    id: issue.id,
    no: String(index + 1).padStart(2, '0'),
    en: enOf(issue),
    ja: issue.text,
    text: issue.text,
    why: whyOf(issue, analysis),
    data: dataOf(state, issue, analysis),
    severity: issue.severity,
  }));

  return {
    teamId,
    issues,
    plans: buildPlans(state, teamId, analysis),
    analysis,
  };
}
