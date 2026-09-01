import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, usePlayerMap } from '../store';
import type { LineupSlot, Player, PositionId } from '../../domain/types';
import { FIRST_TEAM_LIMIT, ROSTER_LIMIT } from '../../domain/types';
import { Sheet, Tabs } from '../components/common';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerDetail } from '../components/PlayerDetail';
import {
  FIELD_POSITIONS,
  POSITION_LABELS,
  POSITION_SHORT,
  aptitudeLabel,
  positionPenalty,
} from '../../domain/positions';
import { applyRosterChange, checkRosterChange, daysUntilChangeable } from '../../domain/roster';
import { buildAutoSetup, nextStarterId, validateLineup } from '../../domain/setup';
import { battingRating, overallRating, pitchingRating } from '../../domain/rating';

type Tab = 'roster' | 'order' | 'rotation';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'roster', label: '1軍 / 2軍' },
  { id: 'order', label: 'オーダー' },
  { id: 'rotation', label: '先発' },
];

export function RosterScreen() {
  const [tab, setTab] = useState<Tab>('roster');
  return (
    <>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="screen">
        {tab === 'roster' && <RosterTab />}
        {tab === 'order' && <OrderTab />}
        {tab === 'rotation' && <RotationTab />}
      </div>
    </>
  );
}

/* ---------------- 1軍 / 2軍 ---------------- */

function RosterTab() {
  const { state, mutate, showToast } = useGame();
  const [selected, setSelected] = useState<Player | null>(null);
  const roster = state.players
    .filter((p) => p.teamId === state.playerTeamId)
    .sort((a, b) => overallRating(b) - overallRating(a));
  const first = roster.filter((p) => p.roster === 'first');
  const second = roster.filter((p) => p.roster === 'second');

  const toggle = (player: Player) => {
    const target = player.roster === 'first' ? 'second' : 'first';
    const check = checkRosterChange(state, player.id, target);
    if (!check.allowed) {
      showToast(check.reason ?? '変更できません');
      return;
    }
    mutate((draft) => {
      applyRosterChange(draft, player.id, target);
    });
    showToast(`${player.name} を${target === 'first' ? '1軍' : '2軍'}に登録しました`);
  };

  const renderList = (players: Player[], toFirst: boolean) =>
    players.map((player) => {
      const lock = daysUntilChangeable(player, state.date);
      return (
        <div key={player.id} style={{ position: 'relative' }}>
          <PlayerCard
            player={player}
            today={state.date}
            showRoster={false}
            onClick={() => setSelected(player)}
            right={
              <span
                className="chip"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(player);
                }}
                style={{
                  padding: '8px 10px',
                  background: lock > 0 ? '#3a1f24' : toFirst ? '#17351f' : '#3a2b1c',
                  color: lock > 0 ? '#ff9aa2' : toFirst ? '#7ee2a0' : '#ffca7a',
                }}
              >
                {lock > 0 ? `あと${lock}日` : toFirst ? '1軍へ' : '2軍へ'}
              </span>
            }
          />
        </div>
      );
    });

  return (
    <>
      <div className="card">
        <div className="spread">
          <span>
            <strong style={{ fontSize: 17 }}>1軍 {first.length}</strong>
            <span className="muted"> / {FIRST_TEAM_LIMIT}人</span>
          </span>
          <span className="muted">
            保有 {roster.length} / {ROSTER_LIMIT}人
          </span>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          登録を変更すると、その選手は7日間再変更できません。
        </div>
      </div>

      <h2 className="muted" style={{ fontSize: 14, margin: '4px 0 8px' }}>
        1軍（{first.length}人）
      </h2>
      {renderList(first, false)}

      <h2 className="muted" style={{ fontSize: 14, margin: '14px 0 8px' }}>
        2軍（{second.length}人）
      </h2>
      {second.length === 0 && <div className="muted">2軍の選手はいません。</div>}
      {renderList(second, true)}

      {selected && (
        <PlayerDetail
          player={state.players.find((p) => p.id === selected.id)!}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

/* ---------------- オーダー ---------------- */

function OrderTab() {
  const { state, mutate, showToast } = useGame();
  const byId = usePlayerMap();
  const teamId = state.playerTeamId;
  const league = state.leagues.find(
    (l) => l.id === state.teams.find((t) => t.id === teamId)!.leagueId,
  )!;
  const setup = state.setups[teamId];
  const firstTeam = useMemo(
    () => state.players.filter((p) => p.teamId === teamId && p.roster === 'first'),
    [state.players, teamId],
  );

  const [items, setItems] = useState<LineupSlot[]>(setup.lineup);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [posEdit, setPosEdit] = useState<number | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const rowHeight = useRef(58);

  useEffect(() => {
    if (dragIndex === null) setItems(setup.lineup);
  }, [setup.lineup, dragIndex]);

  const commit = (next: LineupSlot[]) => {
    setItems(next);
    mutate((draft) => {
      draft.setups[teamId].lineup = next.map((s) => ({ ...s }));
    });
  };

  const measure = () => {
    const el = listRef.current?.querySelector('.order-row') as HTMLElement | null;
    if (el) rowHeight.current = el.getBoundingClientRect().height + 8;
  };

  const onPointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    measure();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setDragIndex(index);
    setDragY(0);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIndex === null) return;
    const dy = e.clientY - startY.current;
    const shift = Math.round(dy / rowHeight.current);
    const target = Math.max(0, Math.min(items.length - 1, dragIndex + shift));
    if (target !== dragIndex) {
      const next = [...items];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(target, 0, moved);
      setItems(next);
      startY.current += (target - dragIndex) * rowHeight.current;
      setDragIndex(target);
      setDragY(e.clientY - startY.current);
    } else {
      setDragY(dy);
    }
  };

  const onPointerUp = () => {
    if (dragIndex === null) return;
    setDragIndex(null);
    setDragY(0);
    commit(items);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const setPosition = (index: number, position: PositionId | 'DH') => {
    const next = items.map((s) => ({ ...s }));
    const holder = next.findIndex((s, i) => i !== index && s.position === position);
    if (holder >= 0) {
      next[holder].position = next[index].position;
    }
    next[index].position = position;
    commit(next);
    setPosEdit(null);
  };

  const setPlayer = (index: number, playerId: string) => {
    const next = items.map((s) => ({ ...s }));
    const holder = next.findIndex((s, i) => i !== index && s.playerId === playerId);
    if (holder >= 0) {
      next[holder].playerId = next[index].playerId;
    }
    next[index].playerId = playerId;
    commit(next);
    setSwapIndex(null);
  };

  const issues = validateLineup({ ...setup, lineup: items }, firstTeam, league.useDH);

  return (
    <>
      <div className="card">
        <div className="spread">
          <span className="muted">
            ハンドル（≡）をドラッグして打順を入れ替え。守備位置をタップで変更。
          </span>
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            className="btn secondary"
            onClick={() => {
              mutate((draft) => {
                draft.setups[teamId] = buildAutoSetup(
                  teamId,
                  draft.players.filter((p) => p.teamId === teamId && p.roster === 'first'),
                  league.useDH,
                );
              });
              showToast('おまかせオーダーを設定しました');
            }}
          >
            おまかせ編成
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          {issues.map((issue, i) => (
            <div key={i} style={{ color: 'var(--bad)', fontSize: 14 }}>
              ⚠ {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="order-list" ref={listRef}>
        {items.map((slot, index) => {
          const player = byId.get(slot.playerId);
          const isPitcherSlot = slot.position === 'P';
          const dragging = dragIndex === index;
          const penalty =
            player && slot.position !== 'DH' && slot.position !== 'P'
              ? positionPenalty(player, slot.position)
              : 0;
          return (
            <div
              key={`${index}-${slot.playerId}`}
              className={`order-row ${dragging ? 'dragging' : ''}`}
              style={dragging ? { transform: `translateY(${dragY}px)` } : undefined}
            >
              <span
                className="handle"
                onPointerDown={onPointerDown(index)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                ≡
              </span>
              <span className="num">{index + 1}</span>
              <button
                className={`pos-btn ${penalty > 0.15 ? 'bad' : penalty > 0 ? 'warn' : ''}`}
                onClick={() => !isPitcherSlot && setPosEdit(index)}
              >
                {slot.position === 'DH' ? 'DH' : POSITION_SHORT[slot.position]}
              </button>
              <button
                className="grow"
                style={{ textAlign: 'left', minWidth: 0 }}
                onClick={() => !isPitcherSlot && setSwapIndex(index)}
              >
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {isPitcherSlot ? '投手（先発）' : (player?.name ?? '未設定')}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {isPitcherSlot
                    ? '試合ごとにローテーションの投手が入ります'
                    : player
                      ? `打撃${battingRating(player)} / ${
                          slot.position === 'DH'
                            ? '指名打者'
                            : `${POSITION_LABELS[slot.position]}：${aptitudeLabel(
                                player,
                                slot.position,
                              )}`
                        }`
                      : ''}
                </div>
              </button>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button className="chip" onClick={() => move(index, -1)} disabled={index === 0}>
                  ▲
                </button>
                <button
                  className="chip"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                >
                  ▼
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {posEdit !== null && (
        <Sheet title={`${posEdit + 1}番の守備位置`} onClose={() => setPosEdit(null)}>
          {[...FIELD_POSITIONS, ...(league.useDH ? (['DH'] as const) : [])].map((pos) => {
            const player = byId.get(items[posEdit].playerId);
            const label =
              pos === 'DH' ? '指名打者' : player ? aptitudeLabel(player, pos) : '';
            const taken = items.find((s, i) => i !== posEdit && s.position === pos);
            const takenPlayer = taken ? byId.get(taken.playerId) : null;
            return (
              <button
                key={pos}
                className="team-pick"
                onClick={() => setPosition(posEdit, pos)}
              >
                <span className="grow">
                  <strong>{pos === 'DH' ? 'DH（指名打者）' : POSITION_LABELS[pos]}</strong>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {label}
                    {takenPlayer ? ` / 現在：${takenPlayer.name}（入れ替え）` : ''}
                  </span>
                </span>
                {items[posEdit].position === pos && <span className="chip">現在</span>}
              </button>
            );
          })}
        </Sheet>
      )}

      {swapIndex !== null && (
        <Sheet title={`${swapIndex + 1}番の選手を選ぶ`} onClose={() => setSwapIndex(null)}>
          {firstTeam
            .filter((p) => !p.isPitcher)
            .sort((a, b) => battingRating(b) - battingRating(a))
            .map((player) => {
              const inLineup = items.some((s) => s.playerId === player.id);
              return (
                <button
                  key={player.id}
                  className="team-pick"
                  onClick={() => setPlayer(swapIndex, player.id)}
                >
                  <span className="grow">
                    <strong>{player.name}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {POSITION_LABELS[player.mainPosition]} / 打撃{battingRating(player)} /{' '}
                      {inLineup ? 'スタメン（入れ替え）' : '控え'}
                    </span>
                  </span>
                  {items[swapIndex].playerId === player.id && <span className="chip">現在</span>}
                </button>
              );
            })}
        </Sheet>
      )}
    </>
  );
}

/* ---------------- 先発ローテーション ---------------- */

function RotationTab() {
  const { state, mutate, showToast } = useGame();
  const byId = usePlayerMap();
  const teamId = state.playerTeamId;
  const setup = state.setups[teamId];
  const [editing, setEditing] = useState<number | null>(null);
  const pitchers = state.players
    .filter((p) => p.teamId === teamId && p.roster === 'first' && p.isPitcher)
    .sort((a, b) => pitchingRating(b) - pitchingRating(a));
  const nextId = nextStarterId(setup);

  const setSlot = (index: number, playerId: string) => {
    mutate((draft) => {
      const rotation = [...draft.setups[teamId].rotation];
      const holder = rotation.indexOf(playerId);
      if (holder >= 0 && holder !== index) rotation[holder] = rotation[index];
      rotation[index] = playerId;
      draft.setups[teamId].rotation = rotation;
    });
    setEditing(null);
    showToast('先発ローテーションを変更しました');
  };

  return (
    <>
      <div className="card">
        <h2>先発ローテーション</h2>
        <div className="muted">
          試合日ごとに先発1→先発5の順で登板します。枠をタップで投手を変更できます。
        </div>
      </div>

      {setup.rotation.map((id, index) => {
        const player = byId.get(id);
        return (
          <button
            key={`${index}-${id}`}
            className="player-card"
            onClick={() => setEditing(index)}
            style={{ borderColor: id === nextId ? 'var(--accent)' : undefined }}
          >
            <span className="pos" style={{ background: id === nextId ? 'var(--accent)' : undefined, color: id === nextId ? '#241a00' : undefined }}>
              {index + 1}
            </span>
            <span className="grow">
              <span className="name">{player?.name ?? '未設定'}</span>
              <span className="meta" style={{ display: 'block' }}>
                {player?.pitching
                  ? `球速${player.pitching.velocity}km/h 制球${player.pitching.control} スタミナ${player.pitching.stamina}`
                  : ''}
              </span>
            </span>
            {id === nextId && <span className="chip">次回先発</span>}
          </button>
        );
      })}

      {editing !== null && (
        <Sheet title={`先発${editing + 1}の投手を選ぶ`} onClose={() => setEditing(null)}>
          {pitchers.map((player) => (
            <button key={player.id} className="team-pick" onClick={() => setSlot(editing, player.id)}>
              <span className="grow">
                <strong>{player.name}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  球速{player.pitching!.velocity}km/h / 制球{player.pitching!.control} / スタミナ
                  {player.pitching!.stamina} / 総合{pitchingRating(player)}
                  {setup.rotation.includes(player.id) ? ' / ローテ入り（入れ替え）' : ''}
                </span>
              </span>
              {setup.rotation[editing] === player.id && <span className="chip">現在</span>}
            </button>
          ))}
        </Sheet>
      )}
    </>
  );
}
