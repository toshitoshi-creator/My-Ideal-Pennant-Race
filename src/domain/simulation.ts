import type {
  BattingStats,
  GamePlayerLine,
  GameResult,
  GameTeamResult,
  PitchingStats,
  Player,
  PositionId,
  Team,
  TeamSetup,
} from './types';
import { MAX_INNINGS } from './types';
import { Rng } from './rng';
import { velocityToScale } from './rank';
import { positionPenalty, effectiveDefense, POSITION_LABELS } from './positions';
import { emptyBatting, emptyPitching } from './stats';
import { pitchingRating } from './rating';
import { bullpen, nextStarterId } from './setup';

interface Runner {
  playerId: string;
  /** エラーで出塁した走者は自責点にしない */
  earned: boolean;
  responsiblePitcherId: string;
}

interface TeamCtx {
  team: Team;
  setup: TeamSetup;
  byId: Map<string, Player>;
  lineup: Array<{ playerId: string; position: PositionId | 'DH' }>;
  battingIndex: number;
  runs: number;
  hits: number;
  errors: number;
  inningRuns: number[];
  batting: Map<string, BattingStats>;
  pitching: Map<string, PitchingStats>;
  currentPitcherId: string;
  starterId: string;
  pitcherBF: number;
  pitcherOrder: string[];
  relievers: Player[];
}

interface ScoringEvent {
  homeRuns: number;
  awayRuns: number;
  homePitcherId: string;
  awayPitcherId: string;
}

export interface SimulateGameInput {
  rng: Rng;
  gameId: string;
  date: string;
  leagueId: string;
  useDH: boolean;
  homeTeam: Team;
  awayTeam: Team;
  homePlayers: Player[];
  awayPlayers: Player[];
  homeSetup: TeamSetup;
  awaySetup: TeamSetup;
}

function statFor<T>(map: Map<string, T>, id: string, make: () => T): T {
  let s = map.get(id);
  if (!s) {
    s = make();
    map.set(id, s);
  }
  return s;
}

function pitcherCapacity(player: Player, isStarter: boolean): number {
  const stamina = player.pitching?.stamina ?? 30;
  return isStarter ? 13 + stamina * 0.17 : 4 + stamina * 0.06;
}

function buildTeamCtx(team: Team, setup: TeamSetup, players: Player[]): TeamCtx {
  const byId = new Map(players.map((p) => [p.id, p]));
  const starterId = nextStarterId(setup) ?? players.find((p) => p.isPitcher)?.id ?? players[0].id;
  const lineup = setup.lineup.map((slot) => ({
    playerId: slot.position === 'P' ? starterId : slot.playerId,
    position: slot.position,
  }));
  const relievers = orderRelievers(players, setup);
  return {
    team,
    setup,
    byId,
    lineup,
    battingIndex: 0,
    runs: 0,
    hits: 0,
    errors: 0,
    inningRuns: [],
    batting: new Map(),
    pitching: new Map(),
    currentPitcherId: starterId,
    starterId,
    pitcherBF: 0,
    pitcherOrder: [starterId],
    relievers,
  };
}

/** 良い投手が終盤に出てくるように並べる */
function orderRelievers(players: Player[], setup: TeamSetup): Player[] {
  const pool = bullpen(players, setup.rotation).sort(
    (a, b) => pitchingRating(b) - pitchingRating(a),
  );
  const best = pool.slice(0, 4).reverse();
  return [...best, ...pool.slice(4)];
}

interface DefenseSummary {
  avgDefense: number;
  avgPenalty: number;
  catcherArm: number;
  fielders: Array<{ player: Player; position: PositionId }>;
}

function defenseSummary(ctx: TeamCtx): DefenseSummary {
  const fielders: Array<{ player: Player; position: PositionId }> = [];
  let total = 0;
  let penalty = 0;
  let catcherArm = 45;
  for (const slot of ctx.lineup) {
    if (slot.position === 'DH' || slot.position === 'P') continue;
    const player = ctx.byId.get(slot.playerId);
    if (!player) continue;
    fielders.push({ player, position: slot.position });
    total += effectiveDefense(player, slot.position);
    penalty += positionPenalty(player, slot.position);
    if (slot.position === 'C') {
      catcherArm = player.batting.arm * (1 - positionPenalty(player, slot.position));
    }
  }
  const n = Math.max(1, fielders.length);
  return { avgDefense: total / n, avgPenalty: penalty / n, catcherArm, fielders };
}

const TRAJ_FACTOR = [0.55, 0.85, 1.15, 1.45];

type PaOutcome =
  | { kind: 'walk' }
  | { kind: 'strikeout' }
  | { kind: 'homerun' }
  | { kind: 'error'; fielder: Player; position: PositionId }
  | { kind: 'single' }
  | { kind: 'double' }
  | { kind: 'triple' }
  | { kind: 'groundout' }
  | { kind: 'flyout' };

function resolvePlateAppearance(
  rng: Rng,
  batter: Player,
  pitcher: Player,
  bf: number,
  isStarter: boolean,
  defense: DefenseSummary,
): PaOutcome {
  const pit = pitcher.pitching!;
  const capacity = pitcherCapacity(pitcher, isStarter);
  const fatigue = Math.max(0.62, 1 - Math.max(0, bf - capacity) * 0.022);

  const vel = velocityToScale(pit.velocity);
  const stuff =
    (vel * 0.3 + pit.power * 0.32 + pit.movement * 0.23 + pit.control * 0.15) * fatigue;
  const control = pit.control * fatigue;

  const b = batter.batting;
  const pWalk = clamp(0.076 + (52 - control) * 0.0013 + (b.contact - 50) * 0.0002, 0.02, 0.2);
  const pK = clamp(0.19 + (stuff - 50) * 0.003 - (b.contact - 50) * 0.0027, 0.04, 0.4);

  const roll = rng.next();
  if (roll < pWalk) return { kind: 'walk' };
  if (roll < pWalk + pK) return { kind: 'strikeout' };

  // 打球
  const trajF = TRAJ_FACTOR[Math.max(0, Math.min(3, b.trajectory - 1))];
  const pHr = clamp(
    0.03 * Math.pow(2, (b.power - 48) / 32) * trajF * Math.pow(2, -(pit.power - 48) / 38),
    0.002,
    0.16,
  );
  const pError = clamp(
    0.021 * (1 + defense.avgPenalty * 3) * (1 - (defense.avgDefense - 45) / 170),
    0.004,
    0.14,
  );
  const pHit = clamp(
    0.282 +
      (b.contact - 50) * 0.0013 +
      (b.power - 50) * 0.0004 -
      (defense.avgDefense - 48) * 0.0018 -
      (stuff - 50) * 0.0009,
    0.16,
    0.44,
  );

  const bip = rng.next();
  if (bip < pHr) return { kind: 'homerun' };
  if (bip < pHr + pError) {
    const target = pickErrorFielder(rng, defense);
    return { kind: 'error', fielder: target.player, position: target.position };
  }
  if (bip < pHr + pError + pHit) {
    const typeRoll = rng.next();
    const pDouble = clamp(0.2 * Math.pow(2, (b.power - 50) / 50), 0.08, 0.35);
    const pTriple = clamp(0.022 * (b.speed / 50), 0.002, 0.06);
    if (typeRoll < pTriple) return { kind: 'triple' };
    if (typeRoll < pTriple + pDouble) return { kind: 'double' };
    return { kind: 'single' };
  }
  const groundProb = clamp(0.56 - (b.trajectory - 2) * 0.09, 0.28, 0.72);
  return rng.next() < groundProb ? { kind: 'groundout' } : { kind: 'flyout' };
}

function pickErrorFielder(
  rng: Rng,
  defense: DefenseSummary,
): { player: Player; position: PositionId } {
  // 守備適性の低い選手ほどエラーしやすい
  const weights = defense.fielders.map((f) => {
    const skill = effectiveDefense(f.player, f.position);
    return Math.max(0.2, 2.2 - skill / 55);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < defense.fielders.length; i++) {
    r -= weights[i];
    if (r <= 0) return defense.fielders[i];
  }
  return defense.fielders[defense.fielders.length - 1];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function simulateGame(input: SimulateGameInput): GameResult {
  const { rng } = input;
  const home = buildTeamCtx(input.homeTeam, input.homeSetup, input.homePlayers);
  const away = buildTeamCtx(input.awayTeam, input.awaySetup, input.awayPlayers);
  const commentary: string[] = [];
  const scoringEvents: ScoringEvent[] = [];

  commentary.push(`▼ ${input.awayTeam.name} vs ${input.homeTeam.name}`);
  commentary.push(
    `先発： ${away.byId.get(away.starterId)?.name ?? '－'}（${input.awayTeam.shortName}） / ${
      home.byId.get(home.starterId)?.name ?? '－'
    }（${input.homeTeam.shortName}）`,
  );

  // 先発登板記録
  for (const ctx of [home, away]) {
    const s = statFor(ctx.pitching, ctx.starterId, emptyPitching);
    s.games = 1;
    s.starts = 1;
  }

  let inning = 1;
  let gameOver = false;
  while (!gameOver) {
    home.inningRuns[inning - 1] = home.inningRuns[inning - 1] ?? 0;
    away.inningRuns[inning - 1] = away.inningRuns[inning - 1] ?? 0;

    playHalfInning(rng, away, home, inning, 'top', commentary, scoringEvents, false);
    changePitcherIfNeeded(home, true, commentary);

    const skipBottom = inning >= 9 && home.runs > away.runs;
    if (!skipBottom) {
      playHalfInning(rng, home, away, inning, 'bottom', commentary, scoringEvents, true);
      changePitcherIfNeeded(away, true, commentary);
    } else {
      commentary.push(`${inning}回裏 ${input.homeTeam.name}の攻撃なし（試合終了）`);
    }

    if (inning >= 9 && home.runs !== away.runs) gameOver = true;
    else if (inning >= MAX_INNINGS) gameOver = true;
    else inning += 1;
  }

  const innings = inning;
  finalizeInningRuns(home, innings);
  finalizeInningRuns(away, innings);

  const winnerTeamId =
    home.runs > away.runs ? home.team.id : away.runs > home.runs ? away.team.id : null;
  const loserTeamId =
    winnerTeamId === null ? null : winnerTeamId === home.team.id ? away.team.id : home.team.id;

  const decisions = assignDecisions(scoringEvents, home, away, winnerTeamId);

  commentary.push(
    `試合終了　${input.awayTeam.name} ${away.runs} - ${home.runs} ${input.homeTeam.name}`,
  );
  if (winnerTeamId) {
    const winnerName = winnerTeamId === home.team.id ? input.homeTeam.name : input.awayTeam.name;
    commentary.push(`勝利球団：${winnerName}`);
  } else {
    commentary.push('引き分け');
  }

  const playerLines = collectPlayerLines(home).concat(collectPlayerLines(away));

  const homeResult: GameTeamResult = {
    teamId: home.team.id,
    runs: home.runs,
    hits: home.hits,
    errors: home.errors,
    inningRuns: home.inningRuns,
  };
  const awayResult: GameTeamResult = {
    teamId: away.team.id,
    runs: away.runs,
    hits: away.hits,
    errors: away.errors,
    inningRuns: away.inningRuns,
  };

  return {
    id: input.gameId,
    date: input.date,
    leagueId: input.leagueId,
    homeTeamId: input.homeTeam.id,
    awayTeamId: input.awayTeam.id,
    home: homeResult,
    away: awayResult,
    innings,
    winnerTeamId,
    loserTeamId,
    winningPitcherId: decisions.winnerPitcherId,
    losingPitcherId: decisions.loserPitcherId,
    commentary,
    playerLines,
  };
}

function finalizeInningRuns(ctx: TeamCtx, innings: number): void {
  for (let i = 0; i < innings; i++) {
    if (ctx.inningRuns[i] === undefined) ctx.inningRuns[i] = 0;
  }
  ctx.inningRuns.length = innings;
}

function playHalfInning(
  rng: Rng,
  offense: TeamCtx,
  defenseCtx: TeamCtx,
  inning: number,
  half: 'top' | 'bottom',
  commentary: string[],
  scoringEvents: ScoringEvent[],
  isHomeBatting: boolean,
): void {
  const bases: Array<Runner | null> = [null, null, null];
  let outs = 0;
  let runsThisInning = 0;
  commentary.push(`${inning}回${half === 'top' ? '表' : '裏'}　${offense.team.name}の攻撃`);

  const score = (runner: Runner, rbiBatterId: string | null) => {
    offense.runs += 1;
    runsThisInning += 1;
    offense.inningRuns[inning - 1] = (offense.inningRuns[inning - 1] ?? 0) + 1;
    statFor(offense.batting, runner.playerId, emptyBatting).runs += 1;
    if (rbiBatterId) statFor(offense.batting, rbiBatterId, emptyBatting).rbi += 1;
    const pit = statFor(defenseCtx.pitching, runner.responsiblePitcherId, emptyPitching);
    pit.runsAllowed += 1;
    if (runner.earned) pit.earnedRuns += 1;
    scoringEvents.push({
      homeRuns: isHomeBatting ? offense.runs : defenseCtx.runs,
      awayRuns: isHomeBatting ? defenseCtx.runs : offense.runs,
      homePitcherId: isHomeBatting ? offense.currentPitcherId : defenseCtx.currentPitcherId,
      awayPitcherId: isHomeBatting ? defenseCtx.currentPitcherId : offense.currentPitcherId,
    });
  };

  const walkOff = () => isHomeBatting && inning >= 9 && offense.runs > defenseCtx.runs;

  while (outs < 3) {
    const defense = defenseSummary(defenseCtx);
    const slot = offense.lineup[offense.battingIndex % offense.lineup.length];
    offense.battingIndex = (offense.battingIndex + 1) % offense.lineup.length;
    const batter = offense.byId.get(slot.playerId);
    const pitcher = defenseCtx.byId.get(defenseCtx.currentPitcherId);
    if (!batter || !pitcher || !pitcher.pitching) {
      outs = 3;
      break;
    }

    // 盗塁
    if (bases[0] && !bases[1] && outs < 2) {
      const runnerPlayer = offense.byId.get(bases[0].playerId);
      if (runnerPlayer) {
        const speed = runnerPlayer.batting.speed;
        const attempt = clamp((speed - 40) / 260, 0, 0.2);
        if (rng.chance(attempt)) {
          const success = clamp(
            0.62 + (speed - 50) * 0.005 - (defense.catcherArm - 50) * 0.004,
            0.3,
            0.92,
          );
          if (rng.chance(success)) {
            statFor(offense.batting, runnerPlayer.id, emptyBatting).steals += 1;
            bases[1] = bases[0];
            bases[0] = null;
            commentary.push(`　${runnerPlayer.name}が二盗成功！`);
          } else {
            commentary.push(`　${runnerPlayer.name}は盗塁失敗`);
            bases[0] = null;
            outs += 1;
            addOuts(defenseCtx, 1);
            if (outs >= 3) break;
          }
        }
      }
    }

    const bat = statFor(offense.batting, batter.id, emptyBatting);
    const pit = statFor(defenseCtx.pitching, pitcher.id, emptyPitching);
    bat.games = 1;
    pit.games = 1;
    defenseCtx.pitcherBF += 1;

    const outcome = resolvePlateAppearance(
      rng,
      batter,
      pitcher,
      defenseCtx.pitcherBF,
      pitcher.id === defenseCtx.starterId,
      defense,
    );

    const runnerOf = (): Runner => ({
      playerId: batter.id,
      earned: true,
      responsiblePitcherId: pitcher.id,
    });

    bat.plateAppearances += 1;

    switch (outcome.kind) {
      case 'walk': {
        bat.walks += 1;
        pit.walks += 1;
        // 押し出し
        if (bases[0] && bases[1] && bases[2]) {
          score(bases[2]!, batter.id);
          bases[2] = bases[1];
          bases[1] = bases[0];
          bases[0] = runnerOf();
          commentary.push(`　${batter.name}が押し出しの四球！`);
        } else {
          if (bases[0] && bases[1]) bases[2] = bases[1];
          if (bases[0]) bases[1] = bases[0];
          bases[0] = runnerOf();
          commentary.push(`　${batter.name}が四球で出塁`);
        }
        break;
      }
      case 'strikeout': {
        bat.atBats += 1;
        bat.strikeouts += 1;
        pit.strikeouts += 1;
        outs += 1;
        addOuts(defenseCtx, 1);
        if (rng.chance(0.3)) {
          commentary.push(`　${pitcher.name}が${batter.name}を三振に打ち取った！`);
        }
        break;
      }
      case 'homerun': {
        bat.atBats += 1;
        bat.hits += 1;
        bat.homeRuns += 1;
        offense.hits += 1;
        pit.hitsAllowed += 1;
        pit.homeRunsAllowed += 1;
        const onBase = bases.filter((r): r is Runner => !!r);
        for (const runner of onBase) score(runner, batter.id);
        bases[0] = bases[1] = bases[2] = null;
        const self = runnerOf();
        score(self, batter.id);
        const n = onBase.length + 1;
        commentary.push(
          n === 1
            ? `　${batter.name}がソロホームラン！`
            : `　${batter.name}が${n}ランホームラン！`,
        );
        break;
      }
      case 'single':
      case 'double':
      case 'triple': {
        bat.atBats += 1;
        bat.hits += 1;
        offense.hits += 1;
        pit.hitsAllowed += 1;
        let rbi = 0;
        if (outcome.kind === 'single') {
          if (bases[2]) {
            score(bases[2], batter.id);
            rbi++;
            bases[2] = null;
          }
          if (bases[1]) {
            const runnerPlayer = offense.byId.get(bases[1].playerId);
            const speed = runnerPlayer?.batting.speed ?? 40;
            if (rng.chance(clamp(0.5 + (speed - 50) * 0.006, 0.25, 0.85))) {
              score(bases[1], batter.id);
              rbi++;
            } else {
              bases[2] = bases[1];
            }
            bases[1] = null;
          }
          if (bases[0]) {
            if (!bases[2] && rng.chance(0.28)) bases[2] = bases[0];
            else bases[1] = bases[0];
            bases[0] = null;
          }
          bases[0] = runnerOf();
        } else if (outcome.kind === 'double') {
          bat.doubles += 1;
          for (const idx of [2, 1]) {
            if (bases[idx]) {
              score(bases[idx]!, batter.id);
              rbi++;
              bases[idx] = null;
            }
          }
          if (bases[0]) {
            if (rng.chance(0.45)) {
              score(bases[0], batter.id);
              rbi++;
            } else {
              bases[2] = bases[0];
            }
            bases[0] = null;
          }
          bases[1] = runnerOf();
        } else {
          bat.triples += 1;
          for (const idx of [2, 1, 0]) {
            if (bases[idx]) {
              score(bases[idx]!, batter.id);
              rbi++;
              bases[idx] = null;
            }
          }
          bases[2] = runnerOf();
        }
        const label =
          outcome.kind === 'single' ? 'ヒット' : outcome.kind === 'double' ? '二塁打' : '三塁打';
        commentary.push(
          rbi > 0
            ? `　${batter.name}のタイムリー${label}！${rbi}点追加！`
            : `　${batter.name}が${label}で出塁`,
        );
        break;
      }
      case 'error': {
        bat.atBats += 1;
        defenseCtx.errors += 1;
        if (bases[2]) {
          score({ ...bases[2], earned: false }, null);
          bases[2] = null;
        }
        if (bases[1]) {
          bases[2] = bases[1];
          bases[1] = null;
        }
        if (bases[0]) {
          bases[1] = bases[0];
          bases[0] = null;
        }
        bases[0] = { playerId: batter.id, earned: false, responsiblePitcherId: pitcher.id };
        commentary.push(
          `　${outcome.fielder.name}（${POSITION_LABELS[outcome.position]}）がエラー！${
            batter.name
          }が出塁`,
        );
        break;
      }
      case 'groundout': {
        bat.atBats += 1;
        const dp = bases[0] && outs < 2 && rng.chance(0.32);
        if (dp) {
          bases[0] = null;
          outs += 2;
          addOuts(defenseCtx, 2);
          commentary.push(`　${batter.name}はゲッツー`);
        } else {
          outs += 1;
          addOuts(defenseCtx, 1);
          if (bases[2] && outs < 3 && rng.chance(0.45)) {
            score(bases[2], batter.id);
            bases[2] = null;
            commentary.push(`　${batter.name}の内野ゴロの間に1点`);
          }
          if (bases[0] && outs < 3) {
            bases[1] = bases[1] ?? bases[0];
            bases[0] = null;
          }
        }
        break;
      }
      case 'flyout': {
        if (bases[2] && outs < 2 && rng.chance(0.35)) {
          score(bases[2], batter.id);
          bases[2] = null;
          outs += 1;
          addOuts(defenseCtx, 1);
          commentary.push(`　${batter.name}の犠牲フライで1点！`);
        } else {
          bat.atBats += 1;
          outs += 1;
          addOuts(defenseCtx, 1);
        }
        break;
      }
    }

    if (walkOff()) {
      commentary.push(`　サヨナラ！ ${offense.team.name}が試合を決めた！`);
      return;
    }

    if (outs < 3) {
      changePitcherIfNeeded(defenseCtx, false, commentary);
    }
  }

  if (runsThisInning > 0) commentary.push(`　この回 ${runsThisInning}点`);
}

function addOuts(defenseCtx: TeamCtx, outs: number): void {
  const pit = statFor(defenseCtx.pitching, defenseCtx.currentPitcherId, emptyPitching);
  pit.outs += outs;
}

function changePitcherIfNeeded(
  ctx: TeamCtx,
  atInningEnd: boolean,
  commentary: string[],
): void {
  if (ctx.relievers.length === 0) return;
  const current = ctx.byId.get(ctx.currentPitcherId);
  if (!current) return;
  const isStarter = ctx.currentPitcherId === ctx.starterId;
  const capacity = pitcherCapacity(current, isStarter);
  const over = ctx.pitcherBF - capacity;
  const shouldChange = atInningEnd ? over >= 0 : over >= 8;
  if (!shouldChange) return;
  const next = ctx.relievers.shift();
  if (!next) return;
  ctx.currentPitcherId = next.id;
  ctx.pitcherBF = 0;
  ctx.pitcherOrder.push(next.id);
  const s = statFor(ctx.pitching, next.id, emptyPitching);
  s.games = 1;
  commentary.push(`　【投手交代】${ctx.team.shortName}：${next.name}`);
}

function assignDecisions(
  events: ScoringEvent[],
  home: TeamCtx,
  away: TeamCtx,
  winnerTeamId: string | null,
): { winnerPitcherId: string | null; loserPitcherId: string | null } {
  if (!winnerTeamId || events.length === 0) {
    return { winnerPitcherId: null, loserPitcherId: null };
  }
  const winnerIsHome = winnerTeamId === home.team.id;
  const ahead = (e: ScoringEvent) => (winnerIsHome ? e.homeRuns > e.awayRuns : e.awayRuns > e.homeRuns);

  // 勝ちチームが「決勝点」を挙げた場面を探す（そこから最後までリードを守った）
  let goAheadIndex = events.length - 1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (!ahead(events[i])) break;
    goAheadIndex = i;
  }
  const decisive = events[goAheadIndex];
  let winnerPitcherId = winnerIsHome ? decisive.homePitcherId : decisive.awayPitcherId;
  const loserPitcherId = winnerIsHome ? decisive.awayPitcherId : decisive.homePitcherId;

  // 先発が 5 回未満なら救援に勝ちをつける
  const winnerCtx = winnerIsHome ? home : away;
  if (winnerPitcherId === winnerCtx.starterId) {
    const starterOuts = winnerCtx.pitching.get(winnerCtx.starterId)?.outs ?? 0;
    if (starterOuts < 15) {
      const reliever = winnerCtx.pitcherOrder
        .slice(1)
        .map((id) => ({ id, outs: winnerCtx.pitching.get(id)?.outs ?? 0 }))
        .sort((a, b) => b.outs - a.outs)[0];
      if (reliever) winnerPitcherId = reliever.id;
    }
  }

  const winStat = winnerCtx.pitching.get(winnerPitcherId);
  if (winStat) winStat.wins += 1;
  const loserCtx = winnerIsHome ? away : home;
  const loseStat = loserCtx.pitching.get(loserPitcherId);
  if (loseStat) loseStat.losses += 1;

  // セーブ（最後に投げた救援投手で、勝ち投手でない場合）
  const lastPitcher = winnerCtx.pitcherOrder[winnerCtx.pitcherOrder.length - 1];
  if (lastPitcher !== winnerPitcherId && lastPitcher !== winnerCtx.starterId) {
    const margin = Math.abs(home.runs - away.runs);
    if (margin <= 3) {
      const s = winnerCtx.pitching.get(lastPitcher);
      if (s) s.saves += 1;
    }
  }

  return { winnerPitcherId, loserPitcherId };
}

function collectPlayerLines(ctx: TeamCtx): GamePlayerLine[] {
  const ids = new Set<string>([...ctx.batting.keys(), ...ctx.pitching.keys()]);
  const lines: GamePlayerLine[] = [];
  for (const id of ids) {
    lines.push({
      playerId: id,
      teamId: ctx.team.id,
      batting: ctx.batting.get(id) ?? null,
      pitching: ctx.pitching.get(id) ?? null,
    });
  }
  return lines;
}
