import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { Player, Team, TradeOffer } from '../../domain/types';
import { POSITION_LABELS, POSITION_SHORT, positionGroup } from '../../domain/positions';
import { overallRating, teamPower } from '../../domain/rating';
import { rankOfTeam } from '../../domain/standings';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import { formatMoney, formatSalary, teamPayroll } from '../../domain/contract';
import {
  MAX_TRADE_PLAYERS,
  calculateTradeValue,
  evaluateTradeFor,
  fairnessLabel,
  isTradeOpen,
  pendingOffersForPlayer,
  pendingOffersFromPlayer,
  valueLabel,
} from '../../domain/trade';
import {
  faActivityLabel,
  planSummary,
  targetLabels,
  tradeActivityLabel,
} from '../../domain/teamAi';
import { RankBadge, Sheet } from '../components/common';

type Filter = 'all' | 'pitcher' | 'catcher' | 'infield' | 'outfield' | 'young' | 'veteran' | 'core';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'pitcher', label: '投手' },
  { id: 'catcher', label: '捕手' },
  { id: 'infield', label: '内野' },
  { id: 'outfield', label: '外野' },
  { id: 'young', label: '若手' },
  { id: 'veteran', label: 'ベテラン' },
  { id: 'core', label: '主力' },
];

function matchesFilter(player: Player, filter: Filter): boolean {
  switch (filter) {
    case 'pitcher':
      return player.isPitcher;
    case 'catcher':
      return !player.isPitcher && player.mainPosition === 'C';
    case 'infield':
      return !player.isPitcher && positionGroup(player.mainPosition) === 'IF';
    case 'outfield':
      return !player.isPitcher && positionGroup(player.mainPosition) === 'OF';
    case 'young':
      return player.age <= 25;
    case 'veteran':
      return player.age >= 33;
    case 'core':
      return overallRating(player) >= 50;
    default:
      return true;
  }
}

/**
 * トレード（PHASE 3.5）。
 * 相手球団を選び、渡す選手と欲しい選手を選んで提案する。
 */
export function TradeScreen() {
  const { state, setScreen } = useGame();
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const open = isTradeOpen(state);
  const received = pendingOffersForPlayer(state);
  const sent = pendingOffersFromPlayer(state);

  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const partner = partnerId ? state.teams.find((t) => t.id === partnerId) : null;
  const payroll = teamPayroll(state, team.id);
  const finance = state.finances[team.id];

  return (
    <div className="screen">
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>トレード</div>
            <div className="muted">{state.year}年シーズン</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 11 }}>
              トレード期限
            </div>
            <div style={{ fontWeight: 700, color: open ? 'var(--accent)' : 'var(--bad)' }}>
              {state.trade.deadline}
            </div>
          </div>
        </div>
        <div className="spread" style={{ padding: '5px 0', marginTop: 8 }}>
          <span className="muted">総年俸 / 年間予算</span>
          <span style={{ fontWeight: 700 }}>
            {formatMoney(payroll)} / {formatMoney(finance.budget)}
          </span>
        </div>
        {!open && (
          <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 8, fontSize: 13 }}>
            トレード市場は閉鎖されています
          </div>
        )}
      </div>

      {received.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h2>受信トレード（{received.length}件）</h2>
          {received.map((offer) => (
            <ReceivedOfferRow
              key={offer.id}
              offer={offer}
              onOpen={() => setReviewing(offer.id)}
            />
          ))}
        </div>
      )}

      {sent.length > 0 && (
        <div className="card">
          <h2>提案中（{sent.length}件）</h2>
          {sent.map((offer) => (
            <SentOfferRow key={offer.id} offer={offer} />
          ))}
        </div>
      )}

      {open && (
        <div className="card">
          <h2>球団を選ぶ</h2>
          <div className="muted" style={{ marginBottom: 8 }}>
            相手球団を選ぶと、選手を出し合ってトレードを提案できます。
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {state.teams
              .filter((t) => t.id !== team.id)
              .map((t) => (
                <button
                  key={t.id}
                  className="chip"
                  aria-pressed={partnerId === t.id}
                  style={{
                    padding: '9px 12px',
                    background: partnerId === t.id ? 'var(--accent)' : '#2b3646',
                    color: partnerId === t.id ? '#241a00' : undefined,
                  }}
                  onClick={() => setPartnerId(partnerId === t.id ? null : t.id)}
                >
                  {t.shortName}
                </button>
              ))}
          </div>
        </div>
      )}

      {open && partner && <TradeBuilder partner={partner} key={partner.id} />}

      <TradeHistoryCard />

      <button className="btn secondary" style={{ marginTop: 4 }} onClick={() => setScreen('home')}>
        ホームに戻る
      </button>

      {reviewing && (
        <ReviewSheet offerId={reviewing} onClose={() => setReviewing(null)} />
      )}
    </div>
  );
}

/* ---------------- 受信・送信 ---------------- */

function offerSummary(state: ReturnType<typeof useGame>['state'], offer: TradeOffer) {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?';
  return {
    from: offer.offeredPlayerIds.map(name),
    to: offer.requestedPlayerIds.map(name),
  };
}

function ReceivedOfferRow({ offer, onOpen }: { offer: TradeOffer; onOpen: () => void }) {
  const { state } = useGame();
  const other = state.teams.find((t) => t.id === offer.fromTeamId);
  const summary = offerSummary(state, offer);
  return (
    <button
      className="player-card"
      onClick={onOpen}
      aria-label={`${other?.name ?? ''} からのトレード提案を確認する`}
    >
      <span className="grow">
        <span className="name">{other?.name ?? offer.fromTeamId}</span>
        <span className="meta" style={{ display: 'block' }}>
          もらう：{summary.from.join('・')}
        </span>
        <span className="meta" style={{ display: 'block' }}>
          出す：{summary.to.join('・')}
        </span>
      </span>
      <span className="chip" style={{ padding: '4px 8px' }}>
        確認
      </span>
    </button>
  );
}

function SentOfferRow({ offer }: { offer: TradeOffer }) {
  const { state, withdrawTradeOffer } = useGame();
  const other = state.teams.find((t) => t.id === offer.toTeamId);
  const summary = offerSummary(state, offer);
  return (
    <div className="spread" style={{ padding: '6px 0', gap: 8 }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{other?.shortName ?? offer.toTeamId}</span>
        <span className="meta" style={{ display: 'block' }}>
          {summary.to.join('・')} ⇄ {summary.from.join('・')}
        </span>
      </span>
      <button className="chip" style={{ padding: '6px 10px' }} onClick={() => withdrawTradeOffer(offer.id)}>
        取り下げ
      </button>
    </div>
  );
}

function ReviewSheet({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const { state, acceptTradeOffer, declineTradeOffer } = useGame();
  const offer = state.trade.offers.find((o) => o.id === offerId);
  if (!offer) return null;
  const other = state.teams.find((t) => t.id === offer.fromTeamId);
  const incoming = offer.offeredPlayerIds
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
  const outgoing = offer.requestedPlayerIds
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
  const evaluation = evaluateTradeFor(state, state.playerTeamId, incoming, outgoing);

  return (
    <Sheet title={`${other?.name ?? ''} からの提案`} onClose={onClose}>
      <div className="card">
        <h2>もらう選手</h2>
        {incoming.map((p) => (
          <PlayerLine key={p.id} player={p} />
        ))}
      </div>
      <div className="card">
        <h2>出す選手</h2>
        {outgoing.map((p) => (
          <PlayerLine key={p.id} player={p} />
        ))}
      </div>
      <div className="card">
        <h2>トレード評価</h2>
        <div className="spread" style={{ padding: '4px 0' }}>
          <span className="muted">あなた側</span>
          <span style={{ fontWeight: 800, fontSize: 17 }}>{fairnessLabel(evaluation.ratio)}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          能力だけでなく、年齢・契約・ポジションの厚みから見た評価です。
        </div>
      </div>
      <button
        className="btn primary"
        onClick={() => {
          acceptTradeOffer(offer.id);
          onClose();
        }}
      >
        トレードを受け入れる
      </button>
      <button
        className="btn secondary"
        style={{ marginTop: 10 }}
        onClick={() => {
          declineTradeOffer(offer.id);
          onClose();
        }}
      >
        断る
      </button>
    </Sheet>
  );
}

/* ---------------- 提案を組み立てる ---------------- */

function TradeBuilder({ partner }: { partner: Team }) {
  const { state, proposeTrade } = useGame();
  const [mine, setMine] = useState<string[]>([]);
  const [theirs, setTheirs] = useState<string[]>([]);
  const [myFilter, setMyFilter] = useState<Filter>('all');
  const [theirFilter, setTheirFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Player | null>(null);

  const myRoster = useMemo(
    () =>
      state.players
        .filter((p) => p.teamId === state.playerTeamId)
        .sort((a, b) => overallRating(b) - overallRating(a)),
    [state.players, state.playerTeamId],
  );
  const theirRoster = useMemo(
    () =>
      state.players
        .filter((p) => p.teamId === partner.id)
        .sort((a, b) => overallRating(b) - overallRating(a)),
    [state.players, partner.id],
  );

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    if (list.includes(id)) setList(list.filter((x) => x !== id));
    else if (list.length < MAX_TRADE_PLAYERS) setList([...list, id]);
  };

  const minePlayers = mine
    .map((id) => myRoster.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
  const theirPlayers = theirs
    .map((id) => theirRoster.find((p) => p.id === id))
    .filter((p): p is Player => !!p);
  const ready = minePlayers.length > 0 && theirPlayers.length > 0;

  const myView = ready
    ? evaluateTradeFor(state, state.playerTeamId, theirPlayers, minePlayers)
    : null;

  return (
    <>
      <TeamProfile team={partner} />

      <div className="card">
        <h2>あなたが出す（{mine.length}/{MAX_TRADE_PLAYERS}）</h2>
        <FilterRow value={myFilter} onChange={setMyFilter} label="自球団の絞り込み" />
        {myRoster
          .filter((p) => matchesFilter(p, myFilter))
          .map((p) => (
            <SelectableRow
              key={p.id}
              player={p}
              selected={mine.includes(p.id)}
              onToggle={() => toggle(mine, setMine, p.id)}
              onDetail={() => setDetail(p)}
            />
          ))}
      </div>

      <div className="card">
        <h2>
          {partner.shortName} から受け取る（{theirs.length}/{MAX_TRADE_PLAYERS}）
        </h2>
        <FilterRow value={theirFilter} onChange={setTheirFilter} label="相手球団の絞り込み" />
        {theirRoster
          .filter((p) => matchesFilter(p, theirFilter))
          .map((p) => (
            <SelectableRow
              key={p.id}
              player={p}
              selected={theirs.includes(p.id)}
              onToggle={() => toggle(theirs, setTheirs, p.id)}
              onDetail={() => setDetail(p)}
            />
          ))}
      </div>

      <div className="card" style={{ borderColor: ready ? 'var(--accent)' : undefined }}>
        <h2>トレード内容</h2>
        {ready ? (
          <>
            <div className="spread" style={{ padding: '4px 0' }}>
              <span className="muted">出す</span>
              <span style={{ fontWeight: 700 }}>{minePlayers.map((p) => p.name).join('・')}</span>
            </div>
            <div className="spread" style={{ padding: '4px 0' }}>
              <span className="muted">もらう</span>
              <span style={{ fontWeight: 700 }}>{theirPlayers.map((p) => p.name).join('・')}</span>
            </div>
            <div className="spread" style={{ padding: '4px 0' }}>
              <span className="muted">あなたの提供</span>
              <span style={{ fontWeight: 700 }}>
                {valueLabel(
                  minePlayers.reduce(
                    (a, p) => a + calculateTradeValue(state, p, state.playerTeamId),
                    0,
                  ),
                )}
              </span>
            </div>
            <div className="spread" style={{ padding: '4px 0' }}>
              <span className="muted">相手の提供</span>
              <span style={{ fontWeight: 700 }}>
                {valueLabel(
                  theirPlayers.reduce(
                    (a, p) => a + calculateTradeValue(state, p, state.playerTeamId),
                    0,
                  ),
                )}
              </span>
            </div>
            <div className="spread" style={{ padding: '8px 0 4px' }}>
              <span className="muted">予想評価</span>
              <span style={{ fontWeight: 800, fontSize: 17 }}>
                {fairnessLabel(myView?.ratio ?? 1)}
              </span>
            </div>
          </>
        ) : (
          <div className="muted">両球団から最低1人ずつ選んでください。</div>
        )}
        <button
          className="btn primary"
          style={{ marginTop: 10 }}
          disabled={!ready}
          onClick={() => {
            const result = proposeTrade(partner.id, mine, theirs);
            if (result.ok) {
              setMine([]);
              setTheirs([]);
            }
          }}
        >
          この内容でトレードを提案する
        </button>
      </div>

      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function FilterRow({
  value,
  onChange,
  label,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
  label: string;
}) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginBottom: 8 }} aria-label={label}>
      {FILTERS.map((f) => (
        <button
          key={f.id}
          className="chip"
          aria-pressed={value === f.id}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: value === f.id ? 'var(--accent)' : '#2b3646',
            color: value === f.id ? '#241a00' : undefined,
          }}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function SelectableRow({
  player,
  selected,
  onToggle,
  onDetail,
}: {
  player: Player;
  selected: boolean;
  onToggle: () => void;
  onDetail: () => void;
}) {
  const contract = player.ext.contract;
  return (
    <div
      className="spread"
      style={{
        gap: 8,
        padding: '7px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <button
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`${player.name} を選ぶ`}
        style={{
          minWidth: 30,
          height: 30,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: selected ? 'var(--accent)' : '#2b3646',
          color: selected ? '#241a00' : 'var(--text-dim)',
          fontWeight: 800,
        }}
      >
        {selected ? '✓' : '＋'}
      </button>
      <button
        onClick={onDetail}
        style={{ flex: 1, textAlign: 'left', minWidth: 0, padding: 0 }}
        aria-label={`${player.name} の詳細`}
      >
        <span className="row" style={{ gap: 6 }}>
          <span className="chip" style={{ padding: '1px 6px', fontSize: 11 }}>
            {POSITION_SHORT[player.mainPosition]}
          </span>
          <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {player.name}
          </span>
          <span className="meta">{player.age}歳</span>
        </span>
        <span className="meta" style={{ display: 'block' }}>
          {contract ? `${formatSalary(contract.salary)} / 残り${contract.yearsRemaining}年` : '無契約'}
          {player.ext.injury ? '　⚠ 故障中' : ''}
        </span>
      </button>
      <RankBadge value={overallRating(player)} />
    </div>
  );
}

function PlayerLine({ player }: { player: Player }) {
  const contract = player.ext.contract;
  return (
    <div className="spread" style={{ padding: '5px 0' }}>
      <span>
        <span style={{ fontWeight: 700 }}>{player.name}</span>
        <span className="meta" style={{ display: 'block' }}>
          {player.age}歳 / {POSITION_LABELS[player.mainPosition]}
          {contract ? ` / ${formatSalary(contract.salary)}` : ''}
        </span>
      </span>
      <RankBadge value={overallRating(player)} />
    </div>
  );
}

function PlayerSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const { state } = useGame();
  const stats = state.stats[player.id];
  const contract = player.ext.contract;
  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{player.name}</div>
            <div className="muted">
              {player.age}歳 / {POSITION_LABELS[player.mainPosition]}
            </div>
          </div>
          <RankBadge value={overallRating(player)} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Row label="推定戦力" value={`${overallRating(player)}`} />
          <Row label="年俸" value={contract ? formatSalary(contract.salary) : '－'} />
          <Row
            label="契約"
            value={contract ? `残り${contract.yearsRemaining}年 / 全${contract.totalYears}年` : '－'}
          />
          <Row label="状態" value={player.ext.injury ? `故障中（${player.ext.injury.name}）` : '出場可能'} />
        </div>
      </div>
      <div className="card">
        <h2>今季の成績</h2>
        {stats && (player.isPitcher ? stats.pitching.games > 0 : stats.batting.games > 0) ? (
          player.isPitcher ? (
            <>
              <Row label="登板" value={`${stats.pitching.games}試合`} />
              <Row label="投球回" value={formatInnings(stats.pitching.outs)} />
              <Row label="防御率" value={formatEra(stats.pitching)} />
              <Row label="勝敗" value={`${stats.pitching.wins}勝${stats.pitching.losses}敗`} />
            </>
          ) : (
            <>
              <Row label="試合" value={`${stats.batting.games}試合`} />
              <Row label="打率" value={formatAverage(average(stats.batting))} />
              <Row label="本塁打" value={`${stats.batting.homeRuns}本`} />
              <Row label="打点" value={`${stats.batting.rbi}点`} />
            </>
          )
        ) : (
          <div className="muted">まだ出場記録がありません。</div>
        )}
      </div>
      {player.ext.careerTeams.length > 1 && (
        <div className="card">
          <h2>在籍履歴</h2>
          {player.ext.careerTeams.map((entry, i) => (
            <Row
              key={`${entry.year}-${entry.teamId}-${i}`}
              label={`${entry.year}年`}
              value={state.teams.find((t) => t.id === entry.teamId)?.name ?? entry.teamId}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------- 相手球団の情報 ---------------- */

function TeamProfile({ team }: { team: Team }) {
  const { state } = useGame();
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const setup = state.setups[team.id];
  const power = useMemo(
    () =>
      teamPower(
        setup.lineup,
        setup.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p),
        byId,
      ),
    [setup, byId],
  );
  const roster = state.players.filter((p) => p.teamId === team.id);
  const record = state.records[team.id];
  const rank = rankOfTeam(state, team.id);

  // 手薄な枠を出す（内部の評価値そのものは見せない）
  const groups: Array<{ key: string; label: string; players: Player[] }> = [
    { key: 'P', label: '投手', players: roster.filter((p) => p.isPitcher) },
    {
      key: 'C',
      label: '捕手',
      players: roster.filter((p) => !p.isPitcher && p.mainPosition === 'C'),
    },
    {
      key: 'IF',
      label: '内野',
      players: roster.filter((p) => !p.isPitcher && positionGroup(p.mainPosition) === 'IF'),
    },
    {
      key: 'OF',
      label: '外野',
      players: roster.filter((p) => !p.isPitcher && positionGroup(p.mainPosition) === 'OF'),
    },
  ];
  const weakest = groups
    .map((g) => ({
      label: g.label,
      score: g.players.length
        ? g.players.map((p) => overallRating(p)).sort((a, b) => b - a)[0]
        : 0,
    }))
    .sort((a, b) => a.score - b.score)[0];

  const plan = state.teamPlans?.[team.id];

  return (
    <div className="card">
      <h2>{team.name}</h2>
      {plan && (
        <>
          <Row label="今季の方針" value={planSummary(plan)} />
          <Row label="補強ポイント" value={targetLabels(plan).join('・') || '特になし'} />
          <Row label="FA積極度" value={faActivityLabel(plan)} />
          <Row label="トレード積極度" value={tradeActivityLabel(plan)} />
        </>
      )}
      <Row label="順位" value={`${rank}位（${record.wins}勝${record.losses}敗）`} />
      <div className="spread" style={{ padding: '4px 0' }}>
        <span className="muted">総合力</span>
        <span className="row" style={{ gap: 6, fontWeight: 700 }}>
          {power.total} <RankBadge value={power.total} />
        </span>
      </div>
      <Row label="保有選手" value={`${roster.length}人`} />
      <Row label="総年俸" value={formatMoney(teamPayroll(state, team.id))} />
      <Row label="手薄なポジション" value={weakest?.label ?? '－'} />
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {groups.map((g) => `${g.label}${g.players.length}`).join(' / ')}
      </div>
    </div>
  );
}

/* ---------------- 履歴 ---------------- */

function TradeHistoryCard() {
  const { state } = useGame();
  const history = [...state.trade.history].reverse().slice(0, 12);
  return (
    <div className="card">
      <h2>トレード履歴</h2>
      {history.length === 0 ? (
        <div className="muted">まだトレードは成立していません。</div>
      ) : (
        history.map((record) => {
          const from = state.teams.find((t) => t.id === record.fromTeamId);
          const to = state.teams.find((t) => t.id === record.toTeamId);
          return (
            <div key={record.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {record.year}年 {record.date}
              </div>
              {/* PHASE 4.1: OUT が離れて IN が入ってくるように見せる（CSS のみ） */}
              <div className={`trade-out`} style={{ fontSize: 13 }}>
                <span className="chip" style={{ marginRight: 6 }}>
                  OUT
                </span>
                {from?.shortName ?? record.fromTeamId} {record.playerNamesFrom.join('・')} →{' '}
                {to?.shortName ?? record.toTeamId}
              </div>
              <div className={`trade-in`} style={{ fontSize: 13 }}>
                <span className="chip on" style={{ marginRight: 6 }}>
                  IN
                </span>
                {to?.shortName ?? record.toTeamId} {record.playerNamesTo.join('・')} →{' '}
                {from?.shortName ?? record.fromTeamId}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="spread" style={{ padding: '4px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
