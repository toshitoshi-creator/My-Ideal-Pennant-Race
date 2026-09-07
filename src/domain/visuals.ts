/**
 * PHASE 4.5 ビジュアルの決定（§39）。
 *
 * ここは「何を描くか」を決めるだけの読み取り専用モジュール。
 * GameState・Player・Team・GameResult・NewsItem を読み、
 * 「どの顔か」「どの球場か」「どの出来事か」を返す。
 *
 * 守ること：
 *   - 乱数を使わない。使うのは playerId / teamId から作る安定したハッシュだけ（§7）
 *     ゲームのシードを変えても、同じ選手IDなら必ず同じ顔になる
 *   - state を書き換えない。rngState は絶対に進めない（§0）
 *   - 存在しない出来事を作らない。GameResult に実際にある事実だけを見る（§18）
 *   - 能力・成績を画像で捏造しない。雰囲気を決めるだけ（§10）
 *   - 画像バイナリは持たない。持つのは「どれを描くか」の識別子だけ（§5）
 */
import type {
  GameResult,
  GameState,
  NewsItem,
  Player,
  Team,
} from './types';
import { seedFrom } from './rng';
import { overallRating } from './rating';

/* ================= 決定的な取り出し ================= */

/**
 * 文字列から安定した数を作る。
 * seedFrom は乱数生成器ではなく純粋なハッシュなので、呼んでも rngState は動かない。
 */
export function visualSeed(key: string): number {
  return seedFrom(key);
}

/**
 * ハッシュの「n 番目の桁」から 0〜max-1 を取り出す。
 * 同じ key・同じ index からは必ず同じ値になる。
 */
export function pickFrom(seed: number, index: number, max: number): number {
  if (max <= 0) return 0;
  // 桁ごとに違う値を取り出すため、index ごとに混ぜ直す
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h % max;
}

/* ================= 選手 ================= */

/** 選手の「いまの空気」。能力や評価は変えない（§10・§27） */
export type PlayerMood =
  | 'ROOKIE'
  | 'HOT'
  | 'STEADY'
  | 'SLUMP'
  | 'INJURED'
  | 'VETERAN'
  | 'RETIRED';

export const MOOD_LABELS: Record<PlayerMood, string> = {
  ROOKIE: '新人',
  HOT: '好調',
  STEADY: '平常',
  SLUMP: '不振',
  INJURED: '離脱中',
  VETERAN: 'ベテラン',
  RETIRED: '引退',
};

/** 資料写真の見出し（英字と日本語をセットにする。§44 画像だけで伝えない） */
export const MOOD_CAPTIONS: Record<PlayerMood, { en: string; ja: string }> = {
  ROOKIE: { en: 'NEW SIGNING', ja: '入団時の写真' },
  HOT: { en: 'IN FORM', ja: '状態は上向き' },
  STEADY: { en: 'SQUAD PHOTO', ja: '選手名鑑の写真' },
  SLUMP: { en: 'OUT OF FORM', ja: '状態は下向き' },
  INJURED: { en: 'ON THE MEND', ja: '調整・リハビリ中' },
  VETERAN: { en: 'VETERAN', ja: 'ベテランの一枚' },
  RETIRED: { en: 'IN MEMORIAM', ja: '現役時代の一枚' },
};

export type PlayerPose = 'BAT' | 'PITCH';

/**
 * 一人ぶんの見た目。
 * 顔まわりは playerId だけで決まるので、球団が変わっても同じ顔のまま（§7）。
 */
export interface PlayerVisual {
  playerId: string;
  seed: number;
  /** 肌の明度（0〜3） */
  skin: number;
  /** 髪型（0〜7） */
  hair: number;
  /** 髪の濃さ（0〜2） */
  hairTone: number;
  /** 輪郭（0〜3） */
  face: number;
  /** 眉・目の形（0〜3） */
  brow: number;
  /** ひげ（0=なし 1=無精ひげ 2=口ひげ 3=あごひげ） */
  beard: number;
  /** 体格（0=細身 1=標準 2=がっしり） */
  build: number;
  /** 打席・マウンドのどちらの姿か */
  pose: PlayerPose;
  /** 右利きなら右向き */
  facing: 'R' | 'L';
  /** 帽子をかぶっているか（引退資料では脱ぐ） */
  cap: boolean;
  mood: PlayerMood;
  /** 所属球団（色に使う）。未所属なら null */
  teamId: string | null;
}

/**
 * 顔だけを決める（state を必要としない）。
 * 引退した選手や、まだ球団に属していないドラフト候補にも使える。
 */
export function playerFace(player: Player): Omit<PlayerVisual, 'mood'> {
  const seed = visualSeed(player.id);
  // 体格は能力から決める（同じIDなら常に同じ）。数字を作り出しているわけではない
  const power = player.isPitcher
    ? (player.pitching?.power ?? 50)
    : player.batting.power;
  const speed = player.batting.speed;
  const build = power >= 68 && speed < 60 ? 2 : speed >= 68 ? 0 : 1;

  // 年齢が上がるほどひげが生えやすいが、決め方は決定的
  const beardRoll = pickFrom(seed, 5, 100);
  const beardChance = player.age >= 32 ? 55 : player.age >= 27 ? 35 : 14;
  const beard = beardRoll < beardChance ? 1 + pickFrom(seed, 6, 3) : 0;

  return {
    playerId: player.id,
    seed,
    skin: pickFrom(seed, 1, 4),
    hair: player.age >= 34 && pickFrom(seed, 9, 100) < 30 ? 7 : pickFrom(seed, 2, 7),
    hairTone: pickFrom(seed, 3, 3),
    face: pickFrom(seed, 4, 4),
    brow: pickFrom(seed, 7, 4),
    beard,
    build,
    pose: player.isPitcher ? 'PITCH' : 'BAT',
    facing: player.isPitcher ? player.throws : player.bats,
    cap: true,
    teamId: player.teamId || null,
  };
}

/**
 * いまの空気を決める。
 * 既存の状態（怪我・スランプ・調子・年齢・出場）だけを見る。
 * analyzePlayer の評価を変えることは一切しない（§27）。
 */
export function playerMood(state: GameState, player: Player): PlayerMood {
  if (player.ext.injury) return 'INJURED';
  const debut = player.ext.debutYear;
  if (debut !== null && debut >= state.year) return 'ROOKIE';
  if (player.ext.slump) return 'SLUMP';
  if (player.ext.condition === 'best' || player.ext.condition === 'good') return 'HOT';
  if (player.ext.condition === 'worst' || player.ext.condition === 'bad') return 'SLUMP';
  if (player.age >= 33) return 'VETERAN';
  return 'STEADY';
}

/** 選手一人ぶんの見た目をまとめて作る */
export function playerVisual(state: GameState, player: Player): PlayerVisual {
  return { ...playerFace(player), mood: playerMood(state, player) };
}

/** 引退した選手の資料写真（帽子を脱いだ一枚） */
export function retiredVisual(player: Player): PlayerVisual {
  return { ...playerFace(player), cap: false, mood: 'RETIRED' };
}

/**
 * 選手IDと年齢だけから作る顔（引退記録など、Player が手元に無いとき用）。
 *
 * 顔の部品は playerId のハッシュだけで決まるので、
 * 現役のときに見ていた顔とここで作る顔は必ず一致する（§7）。
 * 能力に由来する体格だけは分からないので、標準の体格にする。
 */
export function faceFromId(playerId: string, age: number, isPitcher = false): PlayerVisual {
  const seed = visualSeed(playerId);
  const beardRoll = pickFrom(seed, 5, 100);
  const beardChance = age >= 32 ? 55 : age >= 27 ? 35 : 14;
  return {
    playerId,
    seed,
    skin: pickFrom(seed, 1, 4),
    hair: age >= 34 && pickFrom(seed, 9, 100) < 30 ? 7 : pickFrom(seed, 2, 7),
    hairTone: pickFrom(seed, 3, 3),
    face: pickFrom(seed, 4, 4),
    brow: pickFrom(seed, 7, 4),
    beard: beardRoll < beardChance ? 1 + pickFrom(seed, 6, 3) : 0,
    // 能力が分からないので体格は標準にする（顔の部品は現役時と同じ）
    build: 1,
    pose: isPitcher ? 'PITCH' : 'BAT',
    facing: 'R',
    cap: false,
    mood: 'RETIRED',
    teamId: null,
  };
}

/** ドラフト候補の資料写真（まだどこにも属していない） */
export function prospectVisual(player: Player): PlayerVisual {
  return { ...playerFace(player), teamId: null, mood: 'ROOKIE' };
}

/* ================= 球団 ================= */

/** 球団章の形（12球団に決定的に割り当てる） */
export type TeamMarkShape = 'STAR' | 'WING' | 'SHIELD' | 'DIAMOND' | 'CIRCLE' | 'BOLT';

export const MARK_SHAPES: TeamMarkShape[] = [
  'STAR',
  'WING',
  'SHIELD',
  'DIAMOND',
  'CIRCLE',
  'BOLT',
];

/** 本拠地の形（外野の形と屋根の有無で球場の顔を変える） */
export type StadiumShape = 'OPEN' | 'DOME' | 'BOWL';

export const STADIUM_SHAPES: StadiumShape[] = ['OPEN', 'DOME', 'BOWL'];

export interface TeamVisual {
  teamId: string;
  seed: number;
  /** 球団章 */
  mark: TeamMarkShape;
  /** 球団色（Team.color をそのまま使う。勝手な色は足さない） */
  color: string;
  /** ユニフォームの縦縞の有無 */
  pinstripe: boolean;
  /** 帽子のつばの色を濃くするか */
  darkBrim: boolean;
  stadium: StadiumShape;
  /** 本拠地の名前（架空。実在球場を使わない。§35） */
  stadiumName: string;
}

const STADIUM_SUFFIX = ['スタジアム', 'ボールパーク', '球場', 'フィールド'];

export function teamVisual(team: Team): TeamVisual {
  const seed = visualSeed(`team:${team.id}`);
  return {
    teamId: team.id,
    seed,
    mark: MARK_SHAPES[pickFrom(seed, 1, MARK_SHAPES.length)],
    color: team.color,
    pinstripe: pickFrom(seed, 2, 2) === 1,
    darkBrim: pickFrom(seed, 3, 2) === 1,
    stadium: STADIUM_SHAPES[pickFrom(seed, 4, STADIUM_SHAPES.length)],
    stadiumName: `${team.homeTown}${STADIUM_SUFFIX[pickFrom(seed, 5, STADIUM_SUFFIX.length)]}`,
  };
}

/* ================= 球場の空気 ================= */

/**
 * 球場の空気。天候をゲームに足すわけではなく、
 * すでに決まっている状況（試合の重み・結果）を絵にするだけ（§12）。
 */
export type StadiumMood = 'DAY' | 'NIGHT' | 'PACKED' | 'QUIET' | 'POSTSEASON' | 'CHAMPION';

export const STADIUM_MOOD_LABELS: Record<StadiumMood, { en: string; ja: string }> = {
  DAY: { en: 'DAY GAME', ja: 'デーゲーム' },
  NIGHT: { en: 'NIGHT GAME', ja: 'ナイター' },
  PACKED: { en: 'FULL HOUSE', ja: '大観衆' },
  QUIET: { en: 'AFTER THE GAME', ja: '試合のあと' },
  POSTSEASON: { en: 'POSTSEASON', ja: 'ポストシーズン' },
  CHAMPION: { en: 'CHAMPIONS', ja: '優勝' },
};

/**
 * 日付から昼夜を決める（表示だけ。ゲームには天候も時刻も存在しない）。
 * 同じ日付からは必ず同じ絵になる。
 */
export function stadiumMoodForDate(date: string): StadiumMood {
  return pickFrom(visualSeed(`day:${date}`), 1, 2) === 0 ? 'DAY' : 'NIGHT';
}

/* ================= 試合の出来事 ================= */

/** 絵にする出来事（§18）。実際に起きたものだけ */
export type VisualEventKind =
  | 'HOME_RUN'
  | 'STRIKEOUT'
  | 'DOUBLE_PLAY'
  | 'GREAT_CATCH'
  | 'RALLY'
  | 'COMEBACK'
  | 'WALK_OFF'
  | 'EXTRA_INNING'
  | 'SHUTOUT'
  | 'NO_HIT_NO_RUN';

export const EVENT_LABELS: Record<VisualEventKind, { en: string; ja: string }> = {
  HOME_RUN: { en: 'HOME RUN', ja: '本塁打' },
  STRIKEOUT: { en: 'STRIKEOUT', ja: '奪三振' },
  DOUBLE_PLAY: { en: 'DOUBLE PLAY', ja: '併殺' },
  GREAT_CATCH: { en: 'GREAT CATCH', ja: '好守' },
  RALLY: { en: 'RALLY', ja: '猛攻' },
  COMEBACK: { en: 'COMEBACK', ja: '逆転' },
  WALK_OFF: { en: 'WALK-OFF', ja: 'サヨナラ' },
  EXTRA_INNING: { en: 'EXTRA INNINGS', ja: '延長' },
  SHUTOUT: { en: 'SHUTOUT', ja: '完封' },
  NO_HIT_NO_RUN: { en: 'NO-HITTER', ja: '無安打無得点' },
};

/** 演出の重み（§47）。S が最優先 */
export const EVENT_RANK: Record<VisualEventKind, 'S' | 'A' | 'B'> = {
  WALK_OFF: 'S',
  HOME_RUN: 'S',
  NO_HIT_NO_RUN: 'S',
  COMEBACK: 'A',
  GREAT_CATCH: 'A',
  SHUTOUT: 'A',
  DOUBLE_PLAY: 'B',
  STRIKEOUT: 'B',
  RALLY: 'B',
  EXTRA_INNING: 'B',
};

export interface VisualEvent {
  kind: VisualEventKind;
  /** 何回の出来事か。試合全体にかかるものは null */
  inning: number | null;
  /** 中心になる選手（自球団の選手だけ）。いなければ null */
  playerId: string | null;
  playerName: string | null;
  /** 添える一行。事実だけを書く */
  text: string;
}

/**
 * 試合結果から、絵にできる出来事を拾う。
 *
 * 作り出さない。GameResult に実際に記録されている数字だけから決める（§18）。
 * 同じ試合からは必ず同じ結果になる。
 */
export function gameVisualEvents(state: GameState, result: GameResult): VisualEvent[] {
  const teamId = state.playerTeamId;
  const isHome = result.homeTeamId === teamId;
  const mine = isHome ? result.home : result.away;
  const theirs = isHome ? result.away : result.home;
  const events: VisualEvent[] = [];
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? null;

  // 自球団の打者・投手の記録から拾う
  const lines = result.playerLines
    .filter((line) => line.teamId === teamId)
    .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));

  // ホームラン（いちばん多く打った選手）
  let hrLine: (typeof lines)[number] | null = null;
  for (const line of lines) {
    const hr = line.batting?.homeRuns ?? 0;
    if (hr > 0 && (!hrLine || hr > (hrLine.batting?.homeRuns ?? 0))) hrLine = line;
  }
  if (hrLine) {
    const hr = hrLine.batting!.homeRuns;
    events.push({
      kind: 'HOME_RUN',
      inning: null,
      playerId: hrLine.playerId,
      playerName: nameOf(hrLine.playerId),
      text: `${nameOf(hrLine.playerId) ?? '打者'}が${hr}本塁打`,
    });
  }

  // 奪三振（10個以上を記録した投手）
  for (const line of lines) {
    const k = line.pitching?.strikeouts ?? 0;
    if (k >= 10) {
      events.push({
        kind: 'STRIKEOUT',
        inning: null,
        playerId: line.playerId,
        playerName: nameOf(line.playerId),
        text: `${nameOf(line.playerId) ?? '投手'}が${k}奪三振`,
      });
      break;
    }
  }

  // 完封・無安打無得点（自球団が守りきった試合）
  if (theirs.runs === 0) {
    const starter = lines.find((line) => (line.pitching?.starts ?? 0) > 0);
    if (theirs.hits === 0) {
      events.push({
        kind: 'NO_HIT_NO_RUN',
        inning: null,
        playerId: starter?.playerId ?? null,
        playerName: starter ? nameOf(starter.playerId) : null,
        text: '無安打無得点',
      });
    } else {
      events.push({
        kind: 'SHUTOUT',
        inning: null,
        playerId: starter?.playerId ?? null,
        playerName: starter ? nameOf(starter.playerId) : null,
        text: `${theirs.hits}安打で完封`,
      });
    }
  }

  // 猛攻（1イニングに4点以上）
  const myInnings = mine.inningRuns;
  for (let i = 0; i < myInnings.length; i++) {
    if (myInnings[i] >= 4) {
      events.push({
        kind: 'RALLY',
        inning: i + 1,
        playerId: null,
        playerName: null,
        text: `${i + 1}回に${myInnings[i]}点`,
      });
      break;
    }
  }

  // 逆転・サヨナラ・延長は、得点の推移から読み取れる事実だけ
  const flow = leadFlow(result);
  if (flow.comeback && result.winnerTeamId === teamId) {
    events.push({
      kind: 'COMEBACK',
      inning: flow.comebackInning,
      playerId: null,
      playerName: null,
      text: `${flow.comebackInning}回に逆転`,
    });
  }
  if (isWalkOffFor(result, teamId)) {
    events.push({
      kind: 'WALK_OFF',
      inning: result.innings,
      playerId: null,
      playerName: null,
      text: `${result.innings}回裏にサヨナラ`,
    });
  }
  if (result.innings > 9) {
    events.push({
      kind: 'EXTRA_INNING',
      inning: result.innings,
      playerId: null,
      playerName: null,
      text: `延長${result.innings}回`,
    });
  }

  // 重い順に並べる。同じ重みならIDの順で決める（毎回同じ並びにするため）
  const rankValue = { S: 0, A: 1, B: 2 } as const;
  return events.sort((a, b) => {
    const diff = rankValue[EVENT_RANK[a.kind]] - rankValue[EVENT_RANK[b.kind]];
    return diff !== 0 ? diff : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

/** 得点の推移から「逆転があったか」を読む */
function leadFlow(result: GameResult): { comeback: boolean; comebackInning: number } {
  const innings = Math.max(result.away.inningRuns.length, result.home.inningRuns.length);
  let away = 0;
  let home = 0;
  let lead = 0;
  let everBehind = false;
  let comebackInning = 0;
  const winnerIsHome = result.winnerTeamId === result.homeTeamId;
  for (let i = 0; i < innings; i++) {
    away += result.away.inningRuns[i] ?? 0;
    home += result.home.inningRuns[i] ?? 0;
    const next = home > away ? 1 : home < away ? -1 : 0;
    if (next !== 0 && next !== lead) {
      const winnerAhead = winnerIsHome ? next === 1 : next === -1;
      if (everBehind && winnerAhead) comebackInning = i + 1;
      if (!winnerAhead) everBehind = true;
      lead = next;
    }
  }
  return { comeback: comebackInning > 0, comebackInning };
}

/** サヨナラかどうか（後攻が最終回に勝ち越して終わった試合） */
export function isWalkOffFor(result: GameResult, teamId: string): boolean {
  if (result.winnerTeamId !== teamId) return false;
  if (result.homeTeamId !== teamId) return false;
  const last = result.home.inningRuns[result.innings - 1] ?? 0;
  return last > 0 && result.home.runs > result.away.runs;
}

/* ================= ニュース ================= */

/**
 * ニュースに添える絵。合わないものには絵を付けない（§20）。
 * 記事の内容と関係のない画像は出さない。
 */
export type NewsVisualKind =
  | 'CHAMPION'
  | 'POSTSEASON'
  | 'PLAYER'
  | 'DRAFT'
  | 'TRANSFER'
  | 'INJURY'
  | 'RETIREMENT'
  | 'RECORD'
  | 'STADIUM';

export function newsVisualKind(item: NewsItem): NewsVisualKind | null {
  switch (item.category) {
    case 'CHAMPIONSHIP':
      return 'CHAMPION';
    case 'POSTSEASON':
      return 'POSTSEASON';
    case 'DRAFT':
      return 'DRAFT';
    case 'FA':
    case 'TRADE':
    case 'TRANSFER':
      return 'TRANSFER';
    case 'INJURY':
      return 'INJURY';
    case 'RETIREMENT':
      return 'RETIREMENT';
    case 'RECORD':
    case 'AWARD':
      return 'RECORD';
    case 'PLAYER':
      return item.playerId ? 'PLAYER' : null;
    case 'GAME':
      // 通常の試合は過剰演出しない（§47 B）。速報だけ球場を添える
      return item.priority === 'BREAKING' ? 'STADIUM' : null;
    default:
      return null;
  }
}

/* ================= 並べ替えの小道具 ================= */

/** 表示に使う「この選手らしさ」の一言。能力の断定はしない */
export function buildNote(visual: PlayerVisual, player: Player): string {
  const size = visual.build === 2 ? 'がっしりした' : visual.build === 0 ? '細身の' : '';
  const role = player.isPitcher ? '投手' : '野手';
  const hand = player.isPitcher
    ? `${player.throws === 'R' ? '右' : '左'}投`
    : `${player.bats === 'R' ? '右' : '左'}打`;
  return `${player.age}歳・${size}${role}・${hand}`;
}

/** 総合評価を星の数に落とす（既存の評価をそのまま使う。画像で変えない） */
export function portraitRank(player: Player): number {
  const overall = overallRating(player);
  if (overall >= 68) return 5;
  if (overall >= 57) return 4;
  if (overall >= 46) return 3;
  if (overall >= 36) return 2;
  return 1;
}
