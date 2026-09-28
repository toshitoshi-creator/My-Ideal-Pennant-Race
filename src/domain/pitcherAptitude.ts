/**
 * 投手の適性（先発・中継ぎ・抑え）。表示専用で、試合の計算には使わない。
 *
 *   先発 … 長いイニングを投げるスタミナが第一。制球・変化球で打者一巡を抑える
 *   中継ぎ … 短いイニングを任せる。球威・制球・変化球のバランス
 *   抑え … 1イニングをねじ伏せる。球速と球威が第一
 *
 * 同じ能力からは必ず同じ結果になる（乱数は使わない）。
 */
import type { Player } from './types';
import { velocityToScale } from './rank';

export type PitcherRoleKey = 'starter' | 'relief' | 'closer';
export type AptitudeGrade = '◎' | '○' | '△' | '×';

export const ROLE_LABEL: Record<PitcherRoleKey, string> = {
  starter: '先発',
  relief: '中継ぎ',
  closer: '抑え',
};

export const ROLE_SHORT: Record<PitcherRoleKey, string> = {
  starter: '先',
  relief: '中',
  closer: '抑',
};

/** 守備位置の欄に出す2文字（1文字の「中」は中堅と紛らわしいので2文字にする） */
export const ROLE_BADGE: Record<PitcherRoleKey, string> = {
  starter: '先発',
  relief: '中継',
  closer: '抑え',
};

export const ROLE_ORDER: PitcherRoleKey[] = ['starter', 'relief', 'closer'];

export interface PitcherAptitude {
  /** いちばん向いている役割 */
  best: PitcherRoleKey;
  grades: Record<PitcherRoleKey, AptitudeGrade>;
  scores: Record<PitcherRoleKey, number>;
}

function gradeOf(score: number): AptitudeGrade {
  if (score >= GRADE_LINES[0]) return '◎';
  if (score >= GRADE_LINES[1]) return '○';
  if (score >= GRADE_LINES[2]) return '△';
  return '×';
}

/** ◎・○・△ の下限（このゲームの投手の能力の散らばりに合わせてある） */
export const GRADE_LINES = [44, 36, 28] as const;

export function pitcherAptitude(player: Pick<Player, 'isPitcher' | 'pitching'>): PitcherAptitude | null {
  const p = player.pitching;
  if (!player.isPitcher || !p) return null;
  const vel = velocityToScale(p.velocity);
  const stuff = (p.control + p.movement + p.power) / 3;
  // 先発はスタミナが足りなければ、どれだけ球が良くても長くは投げられない
  const starter = Math.min(p.stamina * 0.55 + stuff * 0.45, p.stamina + 12);
  const relief = vel * 0.2 + p.power * 0.25 + p.control * 0.3 + p.movement * 0.25;
  const closer = vel * 0.38 + p.power * 0.37 + p.control * 0.2 + p.movement * 0.05;
  const scores = { starter, relief, closer };
  const grades = {
    starter: gradeOf(starter),
    relief: gradeOf(relief),
    closer: gradeOf(closer),
  };
  /*
   * いちばん向いている役割：
   * スタミナがあって先発の評価が中継ぎと同じくらいなら先発を優先する（先発は替えが効きにくい）。
   * 救援なら、球速・球威で押せる投手を抑え、それ以外を中継ぎとする。
   */
  let best: PitcherRoleKey;
  if (p.stamina >= 40 && starter >= relief - 4) best = 'starter';
  else if (closer >= relief + 1 && closer >= GRADE_LINES[1]) best = 'closer';
  else best = 'relief';
  return { best, grades, scores };
}

/** 「投手（先発）」のような表記。野手はそのまま守備位置名 */
export function pitcherRoleText(player: Pick<Player, 'isPitcher' | 'pitching'>): string | null {
  const apt = pitcherAptitude(player);
  return apt ? ROLE_LABEL[apt.best] : null;
}
