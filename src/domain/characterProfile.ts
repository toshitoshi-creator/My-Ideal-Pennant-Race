/**
 * PHASE 4.8-A Appearance Profile v3（§20・§21・§22）。
 *
 * 選手の見た目を、**player.id だけ**から決めます。
 *
 * 守っていること:
 *   ・Math.random を使わない（§20）
 *   ・Date.now を使わない（§20）
 *   ・ゲームの RNG を1回も消費しない（§20・§30-F）
 *   ・能力値・成績・年俸・球団から見た目を決めない（§21）
 *   ・保存するのは番号だけ。SVG 文字列は保存しない（§32）
 *
 * ここは純粋な計算だけ。React も DOM も画像も知りません。
 *
 * 既存の visualProfile.ts（PHASE 4.6/4.7 の画像素材むけ）とは別物です。
 * あちらは素材IDの文字列を配るもので、こちらは自作SVGの番号を配ります。
 * 同じハッシュの流儀を使うので、考え方は揃っています。
 */
import { visualHash, visualPick } from './visualProfile';

/** この版の名前。文言を変えたら上げる（見た目が総入れ替えになるので慎重に） */
export const CHARACTER_PROFILE_VERSION = 3;

/**
 * 見た目の設計図。
 *
 * **番号だけ**を持ちます（§32）。SVG も画像も持ちません。
 * これなら Player 1人あたり数十バイトで済み、セーブがほとんど増えません。
 */
export interface CharacterProfile {
  version: 3;

  head: number;
  body: number;
  hair: number;
  hairColor: number;
  skin: number;
  eyes: number;
  eyebrow: number;
  nose: number;
  mouth: number;
  ears: number;
  beard: number;
  cap: number;
}

/**
 * 種類ごとの「塩」。
 *
 * 同じ種から違う枝を引くための番号です。
 * **一度決めたら変えません。** 変えると全選手の顔が入れ替わります。
 */
const SALT = {
  head: 1,
  body: 2,
  hair: 3,
  hairColor: 4,
  skin: 5,
  eyes: 6,
  eyebrow: 7,
  nose: 8,
  mouth: 9,
  ears: 10,
  beard: 11,
  cap: 12,
} as const;

/**
 * パーツが何種類あるか。
 *
 * 実際の数は描画側（registry）が持っていますが、
 * ドメイン側が UI に依存しないよう、ここでは既定値を持ちます。
 * 呼び出し側が実数を渡せば、そちらが優先されます。
 */
export interface PartCounts {
  head?: number;
  body?: number;
  hair?: number;
  hairColor?: number;
  skin?: number;
  eyes?: number;
  eyebrow?: number;
  nose?: number;
  mouth?: number;
  ears?: number;
  beard?: number;
  cap?: number;
}

/** PHASE 4.8-A で作った数（§34 の完了条件と同じ） */
export const DEFAULT_PART_COUNTS: Required<PartCounts> = {
  head: 5,
  body: 5,
  hair: 8,
  hairColor: 10,
  skin: 8,
  eyes: 6,
  eyebrow: 5,
  nose: 4,
  mouth: 6,
  ears: 1,
  beard: 1,
  cap: 5,
};

/**
 * player.id から見た目を決める。
 *
 * 同じ id なら、何度呼んでも、いつ呼んでも、同じ結果になります。
 * シードが変わっても、年が変わっても、移籍しても、成長しても変わりません。
 */
export function buildCharacterProfile(playerId: string, counts: PartCounts = {}): CharacterProfile {
  const seed = visualHash(`player-appearance-v${CHARACTER_PROFILE_VERSION}:${playerId}`);
  const n = (key: keyof Required<PartCounts>) => counts[key] ?? DEFAULT_PART_COUNTS[key];

  return {
    version: 3,
    head: visualPick(seed, SALT.head, n('head')),
    body: visualPick(seed, SALT.body, n('body')),
    hair: visualPick(seed, SALT.hair, n('hair')),
    hairColor: visualPick(seed, SALT.hairColor, n('hairColor')),
    skin: visualPick(seed, SALT.skin, n('skin')),
    eyes: visualPick(seed, SALT.eyes, n('eyes')),
    eyebrow: visualPick(seed, SALT.eyebrow, n('eyebrow')),
    nose: visualPick(seed, SALT.nose, n('nose')),
    mouth: visualPick(seed, SALT.mouth, n('mouth')),
    ears: visualPick(seed, SALT.ears, n('ears')),
    beard: visualPick(seed, SALT.beard, n('beard')),
    cap: visualPick(seed, SALT.cap, n('cap')),
  };
}

/**
 * 年齢による見た目の変化（§22）。
 *
 * PHASE 4.8-A では本格実装しません。
 * ここでやるのは「後から足せる形にしておく」ことだけです。
 *
 * 大事な決まり: **head の番号を年齢で変えてはいけない**（§22）。
 * 変えると、年を取っただけで別人になってしまいます。
 * 変えてよいのは髪の色・ひげ・しわ・表情だけです。
 */
export type AgeStage = 'YOUTH' | 'PRIME' | 'MATURE' | 'VETERAN' | 'ELDER';

export function ageStageOf(age: number): AgeStage {
  if (age <= 21) return 'YOUTH';
  if (age <= 27) return 'PRIME';
  if (age <= 32) return 'MATURE';
  if (age <= 37) return 'VETERAN';
  return 'ELDER';
}

/**
 * 年齢を織り込んだ設計図。
 *
 * いまは白髪だけを足します。骨格（head / body / 目鼻口）は動かしません。
 */
export function characterProfileAtAge(
  playerId: string,
  age: number,
  counts: PartCounts = {},
): CharacterProfile {
  const base = buildCharacterProfile(playerId, counts);
  const stage = ageStageOf(age);
  if (stage !== 'VETERAN' && stage !== 'ELDER') return base;

  const hairColors = counts.hairColor ?? DEFAULT_PART_COUNTS.hairColor;
  const seed = visualHash(`player-grey-v${CHARACTER_PROFILE_VERSION}:${playerId}`);
  const chance = visualPick(seed, 1, 100);
  const threshold = stage === 'ELDER' ? 55 : 28;
  if (chance >= threshold) return base;

  // 白髪は色の並びの終わりのほうにある（palette.ts の HAIR_COLORS と同じ順）
  const grey = Math.max(0, hairColors - (stage === 'ELDER' ? 1 : 3));
  return { ...base, hairColor: grey };
}
