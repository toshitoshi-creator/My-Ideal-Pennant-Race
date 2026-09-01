/**
 * 1日ごとの選手状態の更新（PHASE 2）。
 * 疲労・コンディション・モチベーション・スランプ・怪我をここでまとめて処理する。
 */
import type { GameNotice, GameResult, GameState, Player } from './types';
import { Rng } from './rng';
import {
  addGameFatigue,
  recoverFatigue,
  resolveSlump,
  updateCondition,
  updateForm,
  updateMotivation,
  updateTeamMorale,
} from './condition';
import { resolveInjury, rollInjury, tickInjuryGrace, INJURY_LABELS } from './injury';
import { overallRating } from './rating';

/** 保持する通知の最大数 */
const NOTICE_LIMIT = 60;

interface Appearance {
  plateAppearances: number;
  outs: number;
  started: boolean;
  performance: number;
}

/** 打撃・投球内容を -1〜1 の評価に変換する */
function performanceOf(line: GameResult['playerLines'][number]): number {
  let score = 0;
  let weight = 0;
  const b = line.batting;
  if (b && b.plateAppearances > 0) {
    const value =
      (b.hits * 1 + b.homeRuns * 1.4 + b.walks * 0.6 + b.rbi * 0.4 - (b.atBats - b.hits) * 0.45) /
      b.plateAppearances;
    score += Math.max(-1, Math.min(1, value));
    weight += 1;
  }
  const p = line.pitching;
  if (p && p.outs > 0) {
    const innings = p.outs / 3;
    const era = (p.earnedRuns * 9) / Math.max(1, innings);
    const value = (3.8 - era) / 4 + (p.strikeouts / Math.max(1, innings)) * 0.15;
    score += Math.max(-1, Math.min(1, value));
    weight += 1;
  }
  return weight === 0 ? 0 : score / weight;
}

function pushNotice(state: GameState, notice: GameNotice): void {
  state.notices.push(notice);
  if (state.notices.length > NOTICE_LIMIT) {
    state.notices.splice(0, state.notices.length - NOTICE_LIMIT);
  }
}

/** 怪我で1軍から外す（7日間の登録変更制限の対象外） */
export function demoteForInjury(player: Player): void {
  if (player.roster === 'first') {
    player.roster = 'second';
    player.ext.injuryDemotion = true;
    // 怪我による抹消は通常の7日ルールとは別扱いにする
    player.lastRosterChangeDate = null;
  }
}

/**
 * 怪我人が出て試合が組めなくなるのを防ぐ。
 * 1軍の野手が9人・投手が5人を下回ったら、2軍の健康な選手を繰り上げる。
 */
export function ensureFirstTeamViable(state: GameState, teamId: string): void {
  const roster = state.players.filter((p) => p.teamId === teamId);
  const healthy = (p: Player) => p.ext.injury === null;
  const firstOf = (pred: (p: Player) => boolean) =>
    roster.filter((p) => p.roster === 'first' && healthy(p) && pred(p));

  const promote = (pred: (p: Player) => boolean, need: number) => {
    while (firstOf(pred).length < need) {
      const candidate = roster
        .filter((p) => p.roster === 'second' && healthy(p) && pred(p))
        .sort((a, b) => overallRating(b) - overallRating(a))[0];
      if (!candidate) break;
      candidate.roster = 'first';
      // 怪我人の穴埋めなので登録変更制限はかけない
      candidate.lastRosterChangeDate = null;
      candidate.ext.injuryDemotion = false;
      if (teamId === state.playerTeamId) {
        pushNotice(state, {
          date: state.date,
          kind: 'return',
          message: `${candidate.name} を1軍に緊急昇格させました（怪我人の穴埋め）`,
        });
      }
    }
  };

  promote((p) => !p.isPitcher, 9);
  promote((p) => p.isPitcher, 5);
}

/** CPU球団は怪我から復帰した主力を自動で1軍に戻す */
function autoPromoteReturned(state: GameState, player: Player): void {
  if (player.teamId === state.playerTeamId) return;
  if (player.roster === 'first') return;
  if (!player.ext.injuryDemotion) return;
  const firstCount = state.players.filter(
    (p) => p.teamId === player.teamId && p.roster === 'first',
  ).length;
  if (firstCount >= 31) return;
  player.roster = 'first';
  player.lastRosterChangeDate = null;
  player.ext.injuryDemotion = false;
}

/**
 * その日の試合結果をもとに、全選手の状態を1日分進める。
 * state.date はまだ当日のまま呼ぶこと。
 */
export function applyDailyUpdates(state: GameState, rng: Rng, results: GameResult[]): void {
  const appearances = new Map<string, Appearance>();
  const teamOutcome = new Map<string, boolean | null>();

  for (const result of results) {
    for (const line of result.playerLines) {
      appearances.set(line.playerId, {
        plateAppearances: line.batting?.plateAppearances ?? 0,
        outs: line.pitching?.outs ?? 0,
        started: (line.pitching?.starts ?? 0) > 0,
        performance: performanceOf(line),
      });
    }
    const homeWon =
      result.winnerTeamId === null ? null : result.winnerTeamId === result.homeTeamId;
    teamOutcome.set(result.homeTeamId, homeWon);
    teamOutcome.set(result.awayTeamId, homeWon === null ? null : !homeWon);
  }

  for (const player of state.players) {
    const ext = player.ext;
    const isPlayerTeam = player.teamId === state.playerTeamId;

    // ---- 怪我からの復帰 ----
    if (resolveInjury(player, state.date)) {
      autoPromoteReturned(state, player);
      if (isPlayerTeam) {
        pushNotice(state, {
          date: state.date,
          kind: 'return',
          message: `${player.name} が怪我から復帰しました`,
        });
      }
    }
    tickInjuryGrace(player);

    const appearance = appearances.get(player.id);
    if (appearance) {
      addGameFatigue(player, appearance);
      // 出場した日もわずかに回復する（疲労が振り切れないように）
      recoverFatigue(player, false);
      ext.firstTeamGames += 1;
      updateForm(rng, player, state.date, appearance.performance);

      const injury = rollInjury(rng, player, state.date, { pitched: appearance.outs > 0 });
      if (injury) {
        ext.injury = injury;
        demoteForInjury(player);
        if (isPlayerTeam) {
          pushNotice(state, {
            date: state.date,
            kind: 'injury',
            message: `${player.name} が${INJURY_LABELS[injury.level]}（${injury.name}）。${injury.returnDate}まで離脱`,
          });
        }
      }
    } else {
      recoverFatigue(player, player.roster === 'second' || !teamOutcome.has(player.teamId));
      if (player.roster === 'second') ext.secondTeamDays += 1;
    }

    resolveSlump(player, state.date);
    updateCondition(rng, player);
    updateMotivation(player, {
      played: !!appearance,
      performed: (appearance?.performance ?? 0) > 0.25,
      teamWon: teamOutcome.get(player.teamId) ?? null,
      onFirstTeam: player.roster === 'first',
    });
  }

  for (const [teamId, won] of teamOutcome) {
    updateTeamMorale(state, teamId, won);
  }
  for (const team of state.teams) {
    ensureFirstTeamViable(state, team.id);
  }
}
