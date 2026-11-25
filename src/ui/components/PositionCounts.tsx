/**
 * ポジション別の人数表と、ポジションの色つき札。
 *
 * 投手は「先発・中継ぎ・抑え」（いちばん向いている役割）、野手は本職の守備位置で数える。
 * 最初の選手契約とドラフトで「どこが足りないか」をひと目で分かるようにするための表示専用。
 * マスを押すと、そのポジションの候補だけに絞り込める（onSelect を渡したときだけ）。
 */
import type { Player, PositionId } from '../../domain/types';
import { FIELD_POSITIONS, POSITION_GROUP_COLORS, POSITION_LABELS, positionGroup } from '../../domain/positions';
import { ROLE_BADGE, ROLE_LABEL, pitcherAptitude, type PitcherRoleKey } from '../../domain/pitcherAptitude';
import { ROLE_COLOR } from './PitcherRole';

export type PositionSlot = PitcherRoleKey | Exclude<PositionId, 'P'>;

export const PITCHER_SLOTS: PitcherRoleKey[] = ['starter', 'relief', 'closer'];
export const FIELDER_SLOTS = FIELD_POSITIONS as Array<Exclude<PositionId, 'P'>>;

type SlotPlayer = Pick<Player, 'isPitcher' | 'pitching' | 'mainPosition'>;

/** 選手がどのマスに入るか */
export function positionSlotOf(player: SlotPlayer): PositionSlot {
  const apt = pitcherAptitude(player);
  if (apt) return apt.best;
  return player.mainPosition === 'P' ? 'starter' : player.mainPosition;
}

export function slotLabel(slot: PositionSlot): string {
  return isPitcherSlot(slot) ? ROLE_LABEL[slot] : POSITION_LABELS[slot];
}

function slotShort(slot: PositionSlot): string {
  return isPitcherSlot(slot) ? ROLE_BADGE[slot] : POSITION_LABELS[slot];
}

export function slotColor(slot: PositionSlot): string {
  return isPitcherSlot(slot) ? ROLE_COLOR[slot] : POSITION_GROUP_COLORS[positionGroup(slot)];
}

function isPitcherSlot(slot: PositionSlot): slot is PitcherRoleKey {
  return slot === 'starter' || slot === 'relief' || slot === 'closer';
}

export function countBySlot(players: SlotPlayer[]): Record<PositionSlot, number> {
  const counts = Object.fromEntries(
    [...PITCHER_SLOTS, ...FIELDER_SLOTS].map((s) => [s, 0]),
  ) as Record<PositionSlot, number>;
  for (const p of players) counts[positionSlotOf(p)] += 1;
  return counts;
}

/** 候補の行に出す、ポジション名の札（「三塁」「先発」など） */
export function PositionTag({ player }: { player: SlotPlayer }) {
  const slot = positionSlotOf(player);
  const label = slotLabel(slot);
  return (
    <span className="pos-tag" style={{ background: slotColor(slot) }} title={label}>
      {slotShort(slot)}
    </span>
  );
}

/**
 * ポジション別の人数表。
 * counts … いまの人数、added … 今回増えた人数（ドラフトの指名など。「+1」で出す）
 */
export function PositionCounts({
  counts,
  added,
  selected,
  onSelect,
  caption,
}: {
  counts: Record<PositionSlot, number>;
  added?: Record<PositionSlot, number>;
  selected?: PositionSlot | null;
  onSelect?: (slot: PositionSlot | null) => void;
  caption?: string;
}) {
  const cell = (slot: PositionSlot) => {
    const n = counts[slot] + (added?.[slot] ?? 0);
    const plus = added?.[slot] ?? 0;
    const on = selected === slot;
    const content = (
      <>
        <span className="pc-swatch" style={{ background: slotColor(slot) }}>
          {slotShort(slot)}
        </span>
        <span className={`pc-num${n === 0 ? ' zero' : ''}`}>{n}</span>
        {plus > 0 && <span className="pc-plus">+{plus}</span>}
      </>
    );
    return onSelect ? (
      <button
        key={slot}
        type="button"
        className={`pc-cell${on ? ' on' : ''}`}
        aria-pressed={on}
        aria-label={`${slotLabel(slot)} ${n}人${on ? '（絞り込み中）' : ''}`}
        onClick={() => onSelect(on ? null : slot)}
      >
        {content}
      </button>
    ) : (
      <span key={slot} className="pc-cell" aria-label={`${slotLabel(slot)} ${n}人`}>
        {content}
      </span>
    );
  };
  return (
    <div className="pos-counts">
      {caption && <div className="pos-counts-caption">{caption}</div>}
      <div className="pos-counts-row">
        <span className="pos-counts-group">投手</span>
        {PITCHER_SLOTS.map(cell)}
      </div>
      <div className="pos-counts-row fielders">
        <span className="pos-counts-group">野手</span>
        {FIELDER_SLOTS.map(cell)}
      </div>
    </div>
  );
}
