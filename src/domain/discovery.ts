/**
 * 発掘（PHASE 4.9-B）。
 *
 * 「発掘」と「調査」は別のものとして扱う。
 *
 *   発掘力 discovery … そもそも良い候補を見つけられるか
 *                      → 見つかるまでの日数・候補の数・条件に合う率
 *   調査力 (currentAbility / potential / personality / skills)
 *                    … 見つけた候補を正しく評価できるか
 *                      → 推定能力の幅・将来性や性格の推定
 *
 * 調査のしくみ（ScoutReport・推定の幅・精度）は PHASE 3.2 の scouting.ts を
 * そのまま使う。ここで2つ目の推定システムを作らない。
 *
 * 乱数は必ず専用の列（discoveryRng）を使う。試合・成長・ドラフトと同じ列を
 * 共有すると、発掘をしたかどうかで既存の抽選結果がすべてずれてしまう。
 * 画面を開くだけでは一切消費しない。消費するのは
 * 「発掘開始」「日付が進んだ」「契約」のときだけ。
 */
import type {
  AmateurCandidate,
  DiscoveryAgeBand,
  DiscoveryCondition,
  DiscoveryOrigin,
  DiscoveryPitcherRole,
  DiscoverySearch,
  DiscoveryState,
  DiscoveryType,
  DraftProspect,
  ForeignCandidate,
  GameState,
  Player,
  PositionId,
  ScoutReport,
  TeamScoutAbility,
} from './types';
import { ROSTER_LIMIT } from './types';
import { Rng, seedFrom } from './rng';
import { createPlayer } from './playerGen';
import { overallRating } from './rating';
import { potentialLabel } from './growth';
import { buildCompletedReport, scoutAbilitySummary } from './scouting';
import { createContract, marketValue } from './contract';
import { canAddPlayer } from './roster';
import { emptyBatting, emptyPitching } from './stats';
import { pushNews } from './news';

/* ================= 入れ物 ================= */

export function createDiscoveryState(): DiscoveryState {
  return {
    foreign: { search: null, candidates: [], reports: {} },
    amateur: { presets: [], active: null, search: null, candidates: [], reports: {} },
  };
}

export function emptyCondition(pitcher = false): DiscoveryCondition {
  return { pitcher, role: null, position: null, type: null, ageBand: null, origin: null };
}

/* ================= 乱数 ================= */

/**
 * 発掘専用の乱数列。
 * 同じ状態・同じ操作なら常に同じ結果になり、既存の rngState には触れない。
 */
export function discoveryRng(state: GameState, ...parts: Array<string | number>): Rng {
  return new Rng(seedFrom(`discovery:${state.seed}:${parts.join(':')}`));
}

/* ================= 発掘力 ================= */

/** 発掘力（0〜100）。記録が無い球団は普通の腕前として扱う */
export function discoveryPowerOf(state: GameState, teamId: string): number {
  const ability = state.scouting?.teams?.[teamId]?.ability;
  const value = ability?.discovery;
  return typeof value === 'number' && Number.isFinite(value) ? value : 50;
}

/** 調査力（推定の精度）。既存のスカウト能力をそのまま返す */
export function scoutAbilityOf(state: GameState, teamId: string): TeamScoutAbility {
  const ability = state.scouting?.teams?.[teamId]?.ability;
  return (
    ability ?? {
      currentAbility: 50,
      potential: 50,
      personality: 50,
      skills: 50,
      discovery: 50,
    }
  );
}

/**
 * 外国人助っ人が見つかるまでの日数。
 *
 * 発掘力 100 → 3日、発掘力 0 → 14日 を目安に、±2日のばらつきを付ける。
 * 1日1回しか進まないので、ここが長いほど「なかなか見つからない」体験になる。
 */
export const FOREIGN_SEARCH_MIN_DAYS = 2;
export const FOREIGN_SEARCH_MAX_DAYS = 16;

export function foreignSearchDays(discoveryPower: number, rng: Rng): number {
  const power = Math.max(0, Math.min(100, discoveryPower));
  const base = 14 - (power / 100) * 11;
  const jitter = rng.int(-2, 2);
  return Math.max(FOREIGN_SEARCH_MIN_DAYS, Math.min(FOREIGN_SEARCH_MAX_DAYS, Math.round(base + jitter)));
}

/**
 * 1回の発掘で見つかる外国人候補の人数。
 * 発掘力が高いほど選択肢が増えるが、無制限にはしない。
 */
export const FOREIGN_CANDIDATE_LIMIT = 5;

export function foreignCandidateCount(discoveryPower: number, rng: Rng): number {
  const power = Math.max(0, Math.min(100, discoveryPower));
  const base = 1 + (power / 100) * 2.2;
  const value = Math.round(base + rng.normal(0, 0.5));
  return Math.max(1, Math.min(FOREIGN_CANDIDATE_LIMIT, value));
}

/**
 * 条件どおりの候補が出る確率。
 * 発掘力が低いと「条件には近いが完全一致ではない」候補が増える（§39）。
 */
export function conditionMatchChance(discoveryPower: number): number {
  const power = Math.max(0, Math.min(100, discoveryPower));
  return 0.35 + (power / 100) * 0.55;
}

/**
 * ドラフトに向けて集められる候補の人数（アマチュア発掘）。
 * 既存のドラフト候補プールの上限は超えない（§33）。
 */
export function amateurExtraProspects(discoveryPower: number): number {
  const power = Math.max(0, Math.min(100, discoveryPower));
  return Math.round((power / 100) * 4);
}

/**
 * 見つけたあと、調査を仕上げるまでの日数。
 * 発掘力（見つける力）ではなく調査力（scoutAbilitySummary。見極める力）で決まる。
 * 調査力が高いほど短くなり、できあがる ScoutReport の幅（ギャップ）も狭くなる
 * （幅の狭さそのものは scouting.ts の scoutAccuracy が担う）。
 */
export const INVESTIGATE_MIN_DAYS = 3;
export const INVESTIGATE_MAX_DAYS = 14;

export function investigateDaysFor(scoutAbility: number, rng: Rng): number {
  const ability = Math.max(0, Math.min(100, scoutAbility));
  const base = 14 - (ability / 100) * 10;
  const jitter = rng.int(-2, 2);
  return Math.max(INVESTIGATE_MIN_DAYS, Math.min(INVESTIGATE_MAX_DAYS, Math.round(base + jitter)));
}

/* ================= 条件 ================= */

const BATTER_POSITIONS: PositionId[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export const PITCHER_ROLE_LABELS: Record<DiscoveryPitcherRole, string> = {
  starter: '先発',
  relief: '中継ぎ',
  closer: '抑え',
};

export const AGE_BAND_LABELS: Record<DiscoveryAgeBand, string> = {
  young: '若手',
  prime: '中堅',
  veteran: 'ベテラン',
};

export const DISCOVERY_TYPE_LABELS: Record<DiscoveryType, string> = {
  power: 'パワー',
  speed: '俊足',
  defense: '守備',
  fastball: '速球',
  breaking: '変化球',
  control: '制球',
};

export const ORIGIN_LABELS: Record<DiscoveryOrigin, string> = {
  highschool: '高校',
  college: '大学',
  corporate: '社会人',
};

/**
 * 年齢帯の範囲。
 * 既存のゲームの年齢分布（18〜40歳、ピークは26〜29歳前後）に合わせている。
 */
export const AGE_BAND_RANGE: Record<DiscoveryAgeBand, [number, number]> = {
  young: [21, 25],
  prime: [26, 31],
  veteran: [32, 37],
};

/** 出身ごとの年齢（高校卒は18歳、大学卒は22歳、社会人は24歳前後） */
export const ORIGIN_AGE_RANGE: Record<DiscoveryOrigin, [number, number]> = {
  highschool: [18, 18],
  college: [21, 22],
  corporate: [23, 25],
};

export function ageBandOf(age: number): DiscoveryAgeBand {
  if (age <= AGE_BAND_RANGE.young[1]) return 'young';
  if (age <= AGE_BAND_RANGE.prime[1]) return 'prime';
  return 'veteran';
}

/** その選手がどのタイプに見えるか（能力から素直に決める） */
export function typeOf(player: Player): DiscoveryType {
  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    // 球速・変化・制球のうち、いちばん際立っているもの
    const velocityScore = (p.velocity - 138) * 2.4;
    const scores: Array<[DiscoveryType, number]> = [
      ['fastball', velocityScore + p.power * 0.5],
      ['breaking', p.movement],
      ['control', p.control],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    return scores[0][0];
  }
  const b = player.batting;
  const scores: Array<[DiscoveryType, number]> = [
    ['power', b.power + b.trajectory * 0.4],
    ['speed', b.speed],
    ['defense', (b.fielding + b.catching + b.arm) / 3],
  ];
  scores.sort((a, b2) => b2[1] - a[1]);
  return scores[0][0];
}

/** 投手の役割（スタミナで先発かどうかを見る。既存のローテ判断と同じ考え方） */
export function pitcherRoleOf(player: Player): DiscoveryPitcherRole {
  const stamina = player.pitching?.stamina ?? 0;
  if (stamina >= 55) return 'starter';
  if (stamina >= 38) return 'relief';
  return 'closer';
}

/** 条件に完全一致しているか */
export function matchesCondition(player: Player, condition: DiscoveryCondition): boolean {
  if (condition.pitcher !== player.isPitcher) return false;
  if (condition.pitcher) {
    if (condition.role && pitcherRoleOf(player) !== condition.role) return false;
  } else if (condition.position && player.mainPosition !== condition.position) {
    return false;
  }
  if (condition.type && typeOf(player) !== condition.type) return false;
  if (condition.ageBand && ageBandOf(player.age) !== condition.ageBand) return false;
  return true;
}

/* ================= 外国人助っ人の発掘 ================= */

const FOREIGN_FROM = ['アメリカ', 'ドミニカ共和国', 'ベネズエラ', 'キューバ', '韓国', '台湾', 'メキシコ', 'オーストラリア'];

export interface StartSearchResult {
  ok: boolean;
  reason: string | null;
}

/**
 * 外国人助っ人の発掘を始める。
 * ここで必要な日数だけを決める。候補を作るのは見つかった日（§U）。
 */
export function startForeignSearch(
  state: GameState,
  condition: DiscoveryCondition,
): StartSearchResult {
  const discovery = ensureDiscovery(state);
  if (discovery.foreign.search) {
    return { ok: false, reason: 'すでに発掘中です' };
  }
  const power = discoveryPowerOf(state, state.playerTeamId);
  const scoutAbility = scoutAbilitySummary(scoutAbilityOf(state, state.playerTeamId));
  const rng = discoveryRng(state, 'foreign', 'start', state.date);
  discovery.foreign.search = {
    condition: { ...condition },
    startedDate: state.date,
    findDays: foreignSearchDays(power, rng),
    investigateDays: investigateDaysFor(scoutAbility, rng),
    elapsed: 0,
    foundIds: [],
  };
  return { ok: true, reason: null };
}

export function cancelForeignSearch(state: GameState): void {
  ensureDiscovery(state).foreign.search = null;
}

/** 発掘の進み具合（0〜100） */
export function searchProgress(search: { days: number; elapsed: number } | null): number {
  if (!search || search.days <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((search.elapsed / search.days) * 100)));
}

export type SearchStage = 'finding' | 'investigating';

/** いま発掘フェーズか調査フェーズか */
export function searchStage(search: DiscoverySearch): SearchStage {
  return search.foundIds.length === 0 ? 'finding' : 'investigating';
}

/** そのフェーズだけで見た進み具合（0〜100） */
export function searchStageProgress(search: DiscoverySearch): number {
  if (searchStage(search) === 'finding') {
    return searchProgress({ days: search.findDays, elapsed: search.elapsed });
  }
  return searchProgress({
    days: search.investigateDays,
    elapsed: search.elapsed - search.findDays,
  });
}

/**
 * 1日ぶん発掘を進める（advanceDay から1日1回だけ呼ぶ）。
 *
 * 同じ日に何度呼んでも二重に候補が増えないよう、進めるのは
 * 「日付が変わったとき」の1回だけにする責任は呼び出し側（engine）が持つ。
 */
export function advanceDiscovery(state: GameState): void {
  const discovery = ensureDiscovery(state);
  advanceForeignSearch(state, discovery);
  advanceAmateurSearch(state, discovery);
}

/**
 * 発掘→調査の2段階を1日ぶん進める。
 *   findDays 経過      … 候補が見つかる（名前・年齢・守備位置だけ分かる。能力はまだ見せない）
 *   +investigateDays 経過 … 調査が終わり、ScoutReport ができる（ここでギャップが確定する）
 */
function advanceForeignSearch(state: GameState, discovery: DiscoveryState): void {
  const search = discovery.foreign.search;
  if (!search) return;
  search.elapsed += 1;

  if (search.foundIds.length === 0) {
    if (search.elapsed < search.findDays) return;

    const power = discoveryPowerOf(state, state.playerTeamId);
    const rng = discoveryRng(state, 'foreign', 'found', state.date, search.startedDate);
    const count = foreignCandidateCount(power, rng);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const candidate = createForeignCandidate(state, search.condition, power, rng, i);
      discovery.foreign.candidates.push(candidate);
      ids.push(candidate.id);
    }
    // 候補が増えすぎないよう、古いものから落とす
    const limit = FOREIGN_CANDIDATE_LIMIT * 2;
    if (discovery.foreign.candidates.length > limit) {
      const dropped = discovery.foreign.candidates.splice(
        0,
        discovery.foreign.candidates.length - limit,
      );
      for (const old of dropped) delete discovery.foreign.reports[old.id];
    }
    search.foundIds = ids;
    pushDiscoveryFoundNotice(
      state,
      'foreign',
      ids
        .map((id) => discovery.foreign.candidates.find((c) => c.id === id)?.player.name)
        .filter((name): name is string => !!name),
    );
    return;
  }

  if (search.elapsed < search.findDays + search.investigateDays) return;
  const ability = scoutAbilityOf(state, state.playerTeamId);
  const names: string[] = [];
  for (const id of search.foundIds) {
    const candidate = discovery.foreign.candidates.find((c) => c.id === id);
    if (!candidate) continue;
    discovery.foreign.reports[id] = buildForeignReport(candidate, ability, state);
    names.push(candidate.player.name);
  }
  pushDiscoveryInvestigatedNotice(state, 'foreign', names);
  discovery.foreign.search = null;
}

/**
 * アマチュアの発掘（シーズン中に1人ずつ探す）。
 * 見つかった候補はそのままドラフト候補プールへ合流する（draft.ts の createDraft）ので、
 * ここで作るのは既存の DraftProspect と同じ形にする。
 */
function advanceAmateurSearch(state: GameState, discovery: DiscoveryState): void {
  const search = discovery.amateur.search;
  if (!search) return;
  search.elapsed += 1;

  if (search.foundIds.length === 0) {
    if (search.elapsed < search.findDays) return;

    const power = discoveryPowerOf(state, state.playerTeamId);
    const rng = discoveryRng(state, 'amateur', 'found', state.date, search.startedDate);
    const candidate = createAmateurCandidate(
      state,
      search.condition,
      power,
      rng,
      discovery.amateur.candidates.length,
    );
    discovery.amateur.candidates.push(candidate);
    // 候補が増えすぎないよう、古いものから落とす
    if (discovery.amateur.candidates.length > AMATEUR_CANDIDATE_LIMIT) {
      const dropped = discovery.amateur.candidates.splice(
        0,
        discovery.amateur.candidates.length - AMATEUR_CANDIDATE_LIMIT,
      );
      for (const old of dropped) delete discovery.amateur.reports[old.id];
    }
    search.foundIds = [candidate.id];
    pushDiscoveryFoundNotice(state, 'scout', [candidate.prospect.player.name]);
    return;
  }

  if (search.elapsed < search.findDays + search.investigateDays) return;
  const ability = scoutAbilityOf(state, state.playerTeamId);
  const names: string[] = [];
  for (const id of search.foundIds) {
    const candidate = discovery.amateur.candidates.find((c) => c.id === id);
    if (!candidate) continue;
    discovery.amateur.reports[id] = buildAmateurReport(candidate.prospect, ability, state);
    names.push(candidate.prospect.player.name);
  }
  pushDiscoveryInvestigatedNotice(state, 'scout', names);
  discovery.amateur.search = null;
}

/** 条件から1人ぶんの外国人候補を作る（真の能力はここで確定する。§22） */
function createForeignCandidate(
  state: GameState,
  condition: DiscoveryCondition,
  discoveryPower: number,
  rng: Rng,
  index: number,
): ForeignCandidate {
  const exact = rng.chance(conditionMatchChance(discoveryPower));

  const pitcher = condition.pitcher;
  const mainPosition: PositionId = pitcher
    ? 'P'
    : exact && condition.position
      ? condition.position
      : rng.pick(BATTER_POSITIONS);

  const band = condition.ageBand ?? rng.pick(['young', 'prime', 'veteran'] as DiscoveryAgeBand[]);
  const [ageLow, ageHigh] = AGE_BAND_RANGE[exact ? band : rng.pick(['young', 'prime', 'veteran'] as DiscoveryAgeBand[])];
  const age = rng.int(ageLow, ageHigh);

  /*
   * 助っ人は「いまの戦力」として呼ぶので、日本のドラフト候補より現在能力は高め。
   * ただし発掘力では能力の高さを上げない（発掘力は「見つける力」であって
   * 「強い選手を作る力」ではない。§M）。
   */
  const mean = Math.max(20, rng.normal(46, 9));
  const player = createPlayer(rng, {
    teamId: '',
    mainPosition,
    mean,
    age,
    startYear: state.year,
    starterStamina: pitcher && (condition.role ?? 'starter') === 'starter',
  });
  player.ext.debutYear = state.year;
  player.ext.fatigue = 0;
  player.ext.injury = null;
  player.ext.slump = null;
  player.ext.contract = null;
  // 潜在能力は年齢なりに（若い助っ人ほど伸びしろが残っている）
  const youth = Math.max(0, 28 - age);
  player.ext.potential = Math.max(
    overallRating(player),
    Math.min(100, Math.round(overallRating(player) + rng.normal(youth * 0.9 + 2, 6))),
  );

  // 条件に寄せる：完全一致のときだけ、指定タイプが出やすいよう能力を少し振る
  if (exact && condition.type) biasToType(player, condition.type, rng);

  const candidate: ForeignCandidate = {
    id: `fc${state.year}-${state.date}-${index}`,
    player,
    year: state.year,
    askingSalary: Math.round(marketValue(player, undefined, state.year) * (0.9 + rng.next() * 0.45)),
    notes: buildNotes(player, rng, null),
    from: rng.pick(FOREIGN_FROM),
    rejected: false,
  };
  return candidate;
}

/**
 * 指定タイプらしく見えるよう、その系統の能力だけを少し持ち上げる。
 * 合計の強さは変えないので、ゲームバランスには影響しない。
 */
export function biasToType(player: Player, type: DiscoveryType, rng: Rng): void {
  const bump = (value: number) => Math.max(1, Math.min(100, Math.round(value + rng.int(6, 14))));
  const trim = (value: number) => Math.max(1, Math.min(100, Math.round(value - rng.int(3, 8))));
  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    if (type === 'fastball') {
      p.velocity = Math.max(125, Math.min(165, p.velocity + rng.int(3, 7)));
      p.movement = trim(p.movement);
    } else if (type === 'breaking') {
      p.movement = bump(p.movement);
      p.velocity = Math.max(125, p.velocity - rng.int(1, 4));
    } else if (type === 'control') {
      p.control = bump(p.control);
      p.power = trim(p.power);
    }
    return;
  }
  const b = player.batting;
  if (type === 'power') {
    b.power = bump(b.power);
    b.trajectory = bump(b.trajectory);
    b.speed = trim(b.speed);
  } else if (type === 'speed') {
    b.speed = bump(b.speed);
    b.power = trim(b.power);
  } else if (type === 'defense') {
    b.fielding = bump(b.fielding);
    b.catching = bump(b.catching);
    b.power = trim(b.power);
  }
}

/**
 * 候補の推定能力（ScoutReport）。調査が完了した状態（進行度100%）で作るので、
 * あとはチームの調査力だけが幅（ギャップ）の狭さを決める。
 */
function buildForeignReport(
  candidate: ForeignCandidate,
  ability: TeamScoutAbility,
  state: GameState,
): ScoutReport {
  return buildCompletedReport(
    {
      id: candidate.id,
      player: candidate.player,
      draftRank: 0,
      projectedAbility: overallRating(candidate.player),
      projectedPotential: potentialLabel(candidate.player.ext.potential),
    },
    ability,
    state.playerTeamId,
    state.year,
  );
}

/**
 * 表示用に候補のレポートを取り出す（state を書き換えない）。
 * まだ調査が終わっていない候補には null を返す（調査中の表示に使う）。
 */
export function foreignReportOf(state: GameState, candidate: ForeignCandidate): ScoutReport | null {
  return state.discovery?.foreign?.reports?.[candidate.id] ?? null;
}

/* ================= 備考 ================= */

/**
 * スカウトが集めた情報（§36・§37）。
 *
 * 能力の一覧そのものは書かない。「最速152km/h」のような、
 * 外から見て分かる情報だけを、条件に合ったときに拾う。
 * 調査力が低いほど拾える情報が減る。
 */
export function buildNotes(player: Player, rng: Rng, origin: DiscoveryOrigin | null): string[] {
  const notes: string[] = [];
  if (player.isPitcher && player.pitching) {
    const p = player.pitching;
    notes.push(`最速${Math.round(p.velocity)}km/h`);
    if (p.movement >= 62 && rng.chance(0.8)) notes.push('変化球の切れに定評');
    if (p.control >= 64 && rng.chance(0.8)) notes.push('制球が安定している');
    if (p.stamina >= 62 && rng.chance(0.7)) notes.push('長いイニングを任せられる');
    if (p.stamina < 38 && rng.chance(0.7)) notes.push('短いイニング向き');
  } else {
    const b = player.batting;
    if (b.power >= 66 && rng.chance(0.85)) notes.push('天性のパワーヒッター');
    if (b.trajectory >= 64 && rng.chance(0.6)) notes.push('打球が上がる打者');
    if (b.contact >= 64 && rng.chance(0.75)) notes.push('広角に打ち分ける');
    if (b.speed >= 66 && rng.chance(0.8)) notes.push('走塁技術に定評');
    if ((b.fielding + b.catching) / 2 >= 62 && rng.chance(0.7)) notes.push('守備センスが高い');
    if (b.arm >= 68 && rng.chance(0.6)) notes.push('強肩');
  }

  if (origin === 'highschool' && player.ext.potential >= 72 && rng.chance(0.5)) {
    notes.push(player.isPitcher ? '高校No.1投手との評価' : '高校屈指の打者との評価');
  }
  if (origin === 'highschool' && rng.chance(0.28)) notes.push('甲子園出場');
  if (origin === 'college' && rng.chance(0.3)) {
    notes.push(player.isPitcher ? '大学リーグで最多勝' : '大学リーグで本塁打王');
  }
  if (origin === 'corporate' && rng.chance(0.3)) notes.push('社会人の主力として活躍');
  if (player.age >= 32 && rng.chance(0.5)) notes.push('経験豊富');

  if (notes.length === 0) notes.push('目立った情報は集まっていない');
  return notes.slice(0, 4);
}

/* ================= 契約 ================= */

export interface SignResult {
  ok: boolean;
  reason: string | null;
}

/**
 * 外国人助っ人と契約する。
 *
 * 能力はここで一切変えない。契約前に隠していた真の能力が見えるようになるだけ（§R）。
 * 既存の契約・年俸・70人枠の仕組みをそのまま使う。
 */
export function signForeignCandidate(
  state: GameState,
  candidateId: string,
  salary: number,
  years: number,
): SignResult {
  const discovery = ensureDiscovery(state);
  const index = discovery.foreign.candidates.findIndex((c) => c.id === candidateId);
  if (index < 0) return { ok: false, reason: '候補が見つかりません' };
  const candidate = discovery.foreign.candidates[index];
  if (candidate.rejected) return { ok: false, reason: 'この選手との交渉は終わっています' };

  if (!canAddPlayer(state, state.playerTeamId)) {
    return { ok: false, reason: `支配下は${ROSTER_LIMIT}人までです` };
  }

  const finance = state.finances[state.playerTeamId];
  if (finance && finance.cash < salary) {
    return { ok: false, reason: '球団資金が足りません' };
  }

  const rng = discoveryRng(state, 'foreign', 'sign', candidateId, Math.round(salary));
  // 提示額が要求に届くほど成立しやすい。既存のFA・契約と同じ考え方にそろえる
  const ratio = salary / Math.max(1, candidate.askingSalary);
  const chance = Math.max(0.02, Math.min(0.97, (ratio - 0.7) * 1.6));
  if (!rng.chance(chance)) {
    candidate.rejected = true;
    return { ok: false, reason: `${candidate.player.name} は提示を受け入れませんでした` };
  }

  const player = candidate.player;
  player.teamId = state.playerTeamId;
  player.roster = 'second';
  player.lastRosterChangeDate = null;
  player.ext.contract = createContract(salary, years, state.year);
  player.ext.careerTeams = [...(player.ext.careerTeams ?? []), { year: state.year, teamId: state.playerTeamId }];
  state.players.push(player);
  if (!state.stats[player.id]) {
    state.stats[player.id] = {
      playerId: player.id,
      batting: emptyBatting(),
      pitching: emptyPitching(),
    };
  }
  if (finance) finance.cash -= salary;

  discovery.foreign.candidates.splice(index, 1);
  delete discovery.foreign.reports[candidateId];
  return { ok: true, reason: null };
}

/* ================= アマチュア（ドラフト）の発掘条件 ================= */

export function saveAmateurPreset(state: GameState, name: string, condition: DiscoveryCondition): string {
  const discovery = ensureDiscovery(state);
  const id = `dp-${discovery.amateur.presets.length}-${seedFrom(`${name}:${state.date}`)}`;
  discovery.amateur.presets.push({ id, name, condition: { ...condition } });
  // 増えすぎないように上限を設ける
  if (discovery.amateur.presets.length > 8) discovery.amateur.presets.shift();
  return id;
}

export function removeAmateurPreset(state: GameState, id: string): void {
  const discovery = ensureDiscovery(state);
  discovery.amateur.presets = discovery.amateur.presets.filter((p) => p.id !== id);
}

export function setAmateurCondition(state: GameState, condition: DiscoveryCondition | null): void {
  ensureDiscovery(state).amateur.active = condition ? { ...condition } : null;
}

/* ================= アマチュアの発掘（シーズン中に1人ずつ探す） ================= */

/**
 * アマチュアが見つかるまでの日数。
 * 外国人助っ人より短めにしてある（国内なので、そもそも探す範囲が狭い）。
 */
export const AMATEUR_SEARCH_MIN_DAYS = 3;
export const AMATEUR_SEARCH_MAX_DAYS = 12;

export function amateurSearchDays(discoveryPower: number, rng: Rng): number {
  const power = Math.max(0, Math.min(100, discoveryPower));
  const base = 12 - (power / 100) * 8;
  const jitter = rng.int(-2, 2);
  return Math.max(AMATEUR_SEARCH_MIN_DAYS, Math.min(AMATEUR_SEARCH_MAX_DAYS, Math.round(base + jitter)));
}

/** 溜め込める候補の上限（増えすぎると選ぶだけで大変になる） */
export const AMATEUR_CANDIDATE_LIMIT = 8;

const AMATEUR_ORIGINS: DiscoveryOrigin[] = ['highschool', 'college', 'corporate'];

/**
 * アマチュアの発掘を始める。
 * 外国人助っ人と同じ考え方で、見つかるまでの日数は発掘力、
 * 見つけたあとの調査にかかる日数は調査力で決める。
 */
export function startAmateurSearch(
  state: GameState,
  condition: DiscoveryCondition,
): StartSearchResult {
  const discovery = ensureDiscovery(state);
  if (discovery.amateur.search) {
    return { ok: false, reason: 'すでに発掘中です' };
  }
  const power = discoveryPowerOf(state, state.playerTeamId);
  const scoutAbility = scoutAbilitySummary(scoutAbilityOf(state, state.playerTeamId));
  const rng = discoveryRng(state, 'amateur', 'start', state.date);
  discovery.amateur.search = {
    condition: { ...condition },
    startedDate: state.date,
    findDays: amateurSearchDays(power, rng),
    investigateDays: investigateDaysFor(scoutAbility, rng),
    elapsed: 0,
    foundIds: [],
  };
  return { ok: true, reason: null };
}

export function cancelAmateurSearch(state: GameState): void {
  ensureDiscovery(state).amateur.search = null;
}

/**
 * 条件から1人ぶんのアマチュア候補を作る。
 * ドラフト候補（DraftProspect）と同じ形にして、実際のドラフトが始まったときに
 * そのまま候補プールへ合流できるようにする（draft.ts の createDraft）。
 */
function createAmateurCandidate(
  state: GameState,
  condition: DiscoveryCondition,
  discoveryPower: number,
  rng: Rng,
  index: number,
): AmateurCandidate {
  const exact = rng.chance(conditionMatchChance(discoveryPower));

  const pitcher = condition.pitcher;
  const mainPosition: PositionId = pitcher
    ? 'P'
    : exact && condition.position
      ? condition.position
      : rng.pick(BATTER_POSITIONS);

  const origin = exact && condition.origin ? condition.origin : rng.pick(AMATEUR_ORIGINS);
  const [ageLow, ageHigh] = ORIGIN_AGE_RANGE[origin];
  const age = rng.int(ageLow, ageHigh);

  // 大学・社会人卒は現在能力がやや高い（draft.ts の generateProspects と同じ考え方）
  const maturity = (age - 18) * 1.4;
  const player = createPlayer(rng, {
    teamId: '',
    mainPosition,
    mean: Math.max(8, rng.normal(24 + maturity, 6)),
    age,
    startYear: state.year,
    starterStamina: pitcher && (condition.role ?? 'starter') === 'starter',
  });
  player.ext.debutYear = state.year + 1;
  player.ext.fatigue = 0;
  player.ext.injury = null;
  player.ext.slump = null;
  player.ext.motivation = Math.max(50, Math.min(85, Math.round(rng.normal(64, 8))));
  player.ext.potential = Math.max(
    overallRating(player) + 2,
    Math.min(100, Math.round(rng.normal(32, 7))),
  );

  if (exact && condition.type) biasToType(player, condition.type, rng);

  const prospect: DraftProspect = {
    id: `am${state.year}-${state.date}-${index}`,
    player,
    draftRank: 0,
    projectedAbility: overallRating(player),
    projectedPotential: potentialLabel(player.ext.potential + rng.normal(0, 12)),
  };

  return {
    id: prospect.id,
    prospect,
    origin,
    notes: buildNotes(player, rng, origin),
  };
}

/**
 * 候補の推定能力（ScoutReport）。調査が完了した状態（進行度100%）で作るので、
 * あとはチームの調査力だけが幅（ギャップ）の狭さを決める。
 */
function buildAmateurReport(
  prospect: DraftProspect,
  ability: TeamScoutAbility,
  state: GameState,
): ScoutReport {
  return buildCompletedReport(prospect, ability, state.playerTeamId, state.year);
}

/**
 * 表示用に候補のレポートを取り出す（state を書き換えない）。
 * まだ調査が終わっていない候補には null を返す（調査中の表示に使う）。
 */
export function amateurReportOf(state: GameState, candidate: AmateurCandidate): ScoutReport | null {
  return state.discovery?.amateur?.reports?.[candidate.id] ?? null;
}

/* ================= 発掘・調査の通知 ================= */

const DISCOVERY_TAB_LABELS: Record<'foreign' | 'scout', string> = {
  foreign: '外国人助っ人',
  scout: 'アマチュア',
};

function namesLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join('・');
  return `${names[0]}ほか${names.length - 1}人`;
}

function pushDiscoveryNotice(
  state: GameState,
  tab: 'foreign' | 'scout',
  stage: 'found' | 'investigated',
  names: string[],
): void {
  if (names.length === 0) return;
  const label = DISCOVERY_TAB_LABELS[tab];
  const who = namesLabel(names);
  const message =
    stage === 'found'
      ? `${label}候補「${who}」を発掘しました。調査を始めます`
      : `${label}候補「${who}」の調査が完了しました`;

  state.notices.push({ date: state.date, kind: 'scout', message });
  if (state.notices.length > 60) state.notices.splice(0, state.notices.length - 60);

  pushNews(state, {
    category: 'SYSTEM',
    priority: 'NORMAL',
    title: stage === 'found' ? `${label}候補を発掘` : `${label}候補の調査完了`,
    body: message,
    source: `discovery:${tab}:${stage}:${state.date}`,
    teamId: state.playerTeamId,
    action: { screen: 'discovery', tab },
  });
}

function pushDiscoveryFoundNotice(state: GameState, tab: 'foreign' | 'scout', names: string[]): void {
  pushDiscoveryNotice(state, tab, 'found', names);
}

function pushDiscoveryInvestigatedNotice(
  state: GameState,
  tab: 'foreign' | 'scout',
  names: string[],
): void {
  pushDiscoveryNotice(state, tab, 'investigated', names);
}

/* ================= 小道具 ================= */

/** 古いセーブや壊れたセーブでも落ちないようにする */
export function ensureDiscovery(state: GameState): DiscoveryState {
  if (!state.discovery) state.discovery = createDiscoveryState();
  const discovery = state.discovery;
  // v16 で amateur に search/candidates/reports が増えた。既存セーブには無いことがある
  if (discovery.amateur.search === undefined) discovery.amateur.search = null;
  if (!Array.isArray(discovery.amateur.candidates)) discovery.amateur.candidates = [];
  if (!discovery.amateur.reports || typeof discovery.amateur.reports !== 'object') {
    discovery.amateur.reports = {};
  }
  // 発掘→調査の2段階（findDays/investigateDays/foundIds）より前の形の
  // 進行中の発掘は、安全のためいったん取り消す
  if (discovery.foreign.search && !('findDays' in discovery.foreign.search)) {
    discovery.foreign.search = null;
  }
  if (discovery.amateur.search && !('findDays' in discovery.amateur.search)) {
    discovery.amateur.search = null;
  }
  return discovery;
}

/** 年が変わったら、去年の助っ人候補は市場から消える */
export function clearStaleCandidates(state: GameState): void {
  const discovery = ensureDiscovery(state);
  const kept = discovery.foreign.candidates.filter((c) => c.year === state.year);
  if (kept.length !== discovery.foreign.candidates.length) {
    const keptIds = new Set(kept.map((c) => c.id));
    for (const id of Object.keys(discovery.foreign.reports)) {
      if (!keptIds.has(id)) delete discovery.foreign.reports[id];
    }
    discovery.foreign.candidates = kept;
  }
}
