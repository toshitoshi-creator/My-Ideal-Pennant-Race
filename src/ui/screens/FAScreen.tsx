import { useMemo, useState } from 'react';
import { RoleGrades, positionText } from '../components/PitcherRole';
import { Sec } from '../components/Sec';
import { useGame } from '../store';
import { CountUp, RevealRows } from '../components/Reveal';
import type { FAMarketPlayer, Player } from '../../domain/types';
import { PlayerVisual } from '../components/PlayerVisual';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import {
  MAX_USER_OFFERS,
  FA_ROLE_LABELS,
  MARKET_GRADE_LABELS,
  estimatedOverallRange,
  compensationFormerTeam,
  marketGrade,
  offersByTeam,
} from '../../domain/freeAgency';
import { PROTECT_LIMIT, protectedIds, requiresCompensation } from '../../domain/compensation';
import { overallRating } from '../../domain/rating';
import { RankBadge } from '../components/common';
import {
  MAX_SALARY,
  MIN_SALARY,
  formatMoney,
  formatSalary,
  maxContractYears,
  remainingBudget,
  teamPayroll,
} from '../../domain/contract';
import { FinanceRows } from './ContractScreen';
import { Sheet, PositionBadge } from '../components/common';
import { PictureButton } from '../components/PictureButton';
import autoSignArt from '../../assets/ui/fa-auto-sign.webp';
import closeMarketArt from '../../assets/ui/fa-close-market.webp';
import checkTeamFirstArt from '../../assets/ui/fa-check-team-first.webp';
import toNewSeasonArt from '../../assets/ui/fa-to-new-season.webp';
import withdrawOfferArt from '../../assets/ui/fa-withdraw-offer.webp';
import changeOfferArt from '../../assets/ui/fa-change-offer.webp';
import makeOfferArt from '../../assets/ui/fa-make-offer.webp';

type Filter = 'all' | 'fielder' | 'pitcher' | 'young' | 'core' | 'veteran';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'fielder', label: '野手' },
  { id: 'pitcher', label: '投手' },
  { id: 'young', label: '若手' },
  { id: 'core', label: '主力' },
  { id: 'veteran', label: 'ベテラン' },
];

/**
 * FA市場（PHASE 3.4）。
 * 契約更改で残らなかった選手に、他球団と競いながら条件を提示する。
 */
export function FAScreen() {
  const { state, resolveFA, finishOffseason, hideFA, autoFA } = useGame();
  const fa = state.fa!;
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;
  const finance = state.finances[state.playerTeamId];
  const [filter, setFilter] = useState<Filter>('all');
  const [target, setTarget] = useState<string | null>(null);
  const [protecting, setProtecting] = useState(false);
  const protectCount = protectedIds(state, state.playerTeamId).size;

  const myOffers = offersByTeam(fa, state.playerTeamId);
  const payroll = teamPayroll(state, state.playerTeamId);
  const remaining = remainingBudget(state, state.playerTeamId);
  const resolved = fa.phase === 'resolved';

  const rows = useMemo(() => {
    const available = fa.listings
      .filter((l) => l.status !== 'SIGNED')
      .map((listing) => ({
        listing,
        player: state.freeAgents.find((p) => p.id === listing.playerId),
      }))
      .filter((row): row is { listing: FAMarketPlayer; player: Player } => !!row.player);

    const matches = (row: { listing: FAMarketPlayer; player: Player }) => {
      switch (filter) {
        case 'fielder':
          return !row.player.isPitcher;
        case 'pitcher':
          return row.player.isPitcher;
        case 'young':
          return row.player.age <= 25;
        case 'core':
          return row.listing.role === 'STARTER' || row.listing.role === 'ROTATION';
        case 'veteran':
          return row.player.age >= 33;
        default:
          return true;
      }
    };

    return available
      .filter(matches)
      .sort((a, b) => b.listing.askingSalary - a.listing.askingSalary);
  }, [fa.listings, state.freeAgents, filter]);

  const targetRow = target
    ? {
        listing: fa.listings.find((l) => l.playerId === target),
        player: state.freeAgents.find((p) => p.id === target),
      }
    : null;

  return (
    <div className="app" style={{ paddingBottom: 20 }}>
      <div className="appbar">
        <div>
          <h1>{fa.year}年 FA市場</h1>
          <div className="sub">{team.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 11 }}>
            残りオファー枠
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--accent)' }}>
            {MAX_USER_OFFERS - myOffers.length} / {MAX_USER_OFFERS}
          </div>
        </div>
      </div>

      <div className="screen">
        <div className="card">
          <Sec en="BUDGET" ja="球団の資金" size="sub" />
          <FinanceRows
            cash={finance.cash}
            budget={finance.budget}
            payroll={payroll}
            lastResult={finance.lastResult}
          />
          {remaining < 0 && (
            <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 8, fontSize: 13 }}>
              ⚠ 年間予算を超えています
            </div>
          )}
        </div>

        {resolved ? (
          <ResultsCard onFinish={finishOffseason} />
        ) : (
          <>
            <div className="card">
              <Sec en="FREE AGENCY" ja="FA市場" size="lead" />
              <div className="muted">
                契約が決まらなかった選手が移籍先を探しています。提示は締切でまとめて判断され、
                選手は年俸だけでなく球団の力・出場機会も見て決めます。
              </div>
              {myOffers.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    提示中（{myOffers.length}人）
                  </div>
                  {myOffers.map((offer) => {
                    const player = state.freeAgents.find((p) => p.id === offer.playerId);
                    return (
                      <div key={offer.id} className="spread" style={{ padding: '5px 0' }}>
                        <span>{player?.name ?? offer.playerId}</span>
                        <span style={{ fontWeight: 700 }}>
                          {formatSalary(offer.salary)} / {offer.years}年
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card protect-card">
              <div className="spread">
                <div>
                  <div style={{ fontWeight: 800 }}>プロテクト（人的補償）</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    評価S〜BのFA選手を獲ると、元の球団がプロテクト外から1人を補償として選びます
                  </div>
                </div>
                <strong className="protect-count">
                  {protectCount}/{PROTECT_LIMIT}
                </strong>
              </div>
              <button type="button" className="btn secondary" onClick={() => setProtecting(true)}>
                {state.protectList ? 'プロテクトを見直す' : 'プロテクトを設定する'}
              </button>
              {!state.protectList && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  未設定の間は、総合力の高い順に{PROTECT_LIMIT}人を守ります。
                </div>
              )}
            </div>

            <div className="tabs" role="tablist" aria-label="FA選手の絞り込み">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  className={filter === f.id ? 'on' : ''}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="card">
                <div style={{ fontWeight: 700 }}>該当するFA選手はいません</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  今年は市場に出た選手が少ないようです。
                </div>
              </div>
            ) : (
              rows.map((row) => (
                <FACard
                  key={row.listing.playerId}
                  listing={row.listing}
                  player={row.player}
                  offered={myOffers.some((o) => o.playerId === row.listing.playerId)}
                  onOpen={() => setTarget(row.listing.playerId)}
                />
              ))
            )}

            <PictureButton src={autoSignArt} alt="おまかせで補強する" className="label-btn" onClick={() => autoFA()} />
            <PictureButton src={closeMarketArt} alt="FA市場を締め切る" className="label-btn" onClick={() => resolveFA()} />
            <PictureButton src={checkTeamFirstArt} alt="先に球団を確認する" className="label-btn" onClick={() => hideFA()} />
          </>
        )}
      </div>

      {targetRow?.listing && targetRow.player && (
        <OfferSheet
          listing={targetRow.listing}
          player={targetRow.player}
          onClose={() => setTarget(null)}
        />
      )}
      {protecting && <ProtectSheet onClose={() => setProtecting(false)} />}
    </div>
  );
}

/** 自球団のプロテクト（28人まで）を選ぶ */
function ProtectSheet({ onClose }: { onClose: () => void }) {
  const { state, setProtectList } = useGame();
  const roster = useMemo(
    () =>
      state.players
        .filter((p) => p.teamId === state.playerTeamId)
        .sort((a, b) => overallRating(b) - overallRating(a)),
    [state.players, state.playerTeamId],
  );
  const [picked, setPicked] = useState<Set<string>>(() => protectedIds(state, state.playerTeamId));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < PROTECT_LIMIT) next.add(id);
      return next;
    });
  const full = picked.size >= PROTECT_LIMIT;

  return (
    <Sheet title="プロテクト設定" onClose={onClose}>
      <div className="card">
        <div className="spread">
          <span className="muted">
            補償で渡したくない選手を{PROTECT_LIMIT}人まで選びます。今オフにFAで獲った選手は対象外です。
          </span>
          <strong className="protect-count">
            {picked.size}/{PROTECT_LIMIT}
          </strong>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="chip"
            onClick={() => setPicked(new Set(roster.slice(0, PROTECT_LIMIT).map((p) => p.id)))}
          >
            総合力の上位{PROTECT_LIMIT}人
          </button>
          <button
            type="button"
            className="chip"
            onClick={() =>
              setPicked(
                new Set(
                  roster
                    .slice()
                    .sort((a, b) => a.age - b.age || overallRating(b) - overallRating(a))
                    .slice(0, PROTECT_LIMIT)
                    .map((p) => p.id),
                ),
              )
            }
          >
            若手を優先
          </button>
          <button type="button" className="chip" onClick={() => setPicked(new Set())}>
            すべて外す
          </button>
        </div>
      </div>
      <div className="protect-list">
        {roster.map((player) => {
          const on = picked.has(player.id);
          return (
            <button
              key={player.id}
              type="button"
              className={`player-card protect-row${on ? ' on' : ''}`}
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(player.id)}
            >
              <span className="protect-check" aria-hidden="true">
                {on ? '🛡' : ''}
              </span>
              <PositionBadge player={player} />
              <span className="grow">
                <span className="row" style={{ gap: 6 }}>
                  <span className="name">{player.name}</span>
                  <span className="meta">{player.age}歳</span>
                </span>
                <span className="meta">{positionText(player)}</span>
              </span>
              <RankBadge value={overallRating(player)} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn primary protect-save"
        onClick={() => {
          setProtectList([...picked]);
          onClose();
        }}
      >
        この{picked.size}人をプロテクトする
      </button>
    </Sheet>
  );
}

function ResultsCard({ onFinish }: { onFinish: () => void }) {
  const { state } = useGame();
  const fa = state.fa!;
  const mine = fa.results.filter((r) => r.teamId === state.playerTeamId);
  const others = fa.results.filter((r) => r.teamId !== state.playerTeamId);
  const team = state.teams.find((t) => t.id === state.playerTeamId)!;

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>FA市場が終わりました</div>
        <div className="muted" style={{ marginTop: 4 }}>
          契約が決まらなかった選手（{fa.unsigned}人）は来オフも市場に残ります。
        </div>
      </div>

      {/* PHASE 4.1: 選手 → 契約内容 → 加入 の順に見せる */}
      {mine.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--good)' }}>
          <Sec en="SIGNED" ja="獲得した選手" />
          {mine.map((r) => (
            <div key={r.playerId} style={{ marginBottom: 10 }}>
              <RevealRows
                animationKey={`fa:${r.playerId}`}
                intervalMs={260}
                rows={[
                  { label: '選手', value: r.name },
                  {
                    label: '年俸',
                    value: <CountUp value={r.salary} format={(v) => formatSalary(v)} />,
                  },
                  { label: '契約年数', value: `${r.years}年` },
                  { label: '', value: `${team.name} に加入`, emphasis: true },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>あなたの獲得（{mine.length}人）</h2>
        {mine.length === 0 ? (
          <div className="muted">今オフの獲得はありませんでした。</div>
        ) : (
          mine.map((r) => (
            <div key={r.playerId} className="spread" style={{ padding: '6px 0' }}>
              <span>{r.name}</span>
              <span style={{ fontWeight: 700, color: 'var(--good)' }}>
                {formatSalary(r.salary)} / {r.years}年
              </span>
            </div>
          ))
        )}
      </div>

      <CompensationCard />

      <div className="card">
        <h2>他球団の動き（{others.length}人）</h2>
        {others.length === 0 ? (
          <div className="muted">他球団の補強はありませんでした。</div>
        ) : (
          others.slice(0, 12).map((r) => {
            const team = state.teams.find((t) => t.id === r.teamId);
            return (
              <div key={r.playerId} className="spread" style={{ padding: '6px 0' }}>
                <span>{r.name}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {team?.shortName ?? r.teamId} / {formatSalary(r.salary)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <PictureButton src={toNewSeasonArt} alt="新シーズンへ" className="label-btn" onClick={onFinish} />
    </>
  );
}

/** 人的補償の結果と、自球団が選ぶ補償選手 */
function CompensationCard() {
  const { state, chooseCompensation } = useGame();
  const list = state.fa?.compensations ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (list.length === 0) return null;
  const teamOf = (id: string) => state.teams.find((t) => t.id === id);

  return (
    <div className="card comp-card">
      <Sec en="COMPENSATION" ja="人的補償" />
      {list.map((c) => {
        const mineToChoose = c.status === 'pending' && c.formerTeamId === state.playerTeamId;
        const options = (c.options ?? [])
          .map((id) => state.players.find((p) => p.id === id && p.teamId === c.signingTeamId))
          .filter((p): p is Player => !!p);
        return (
          <div key={c.id} className="comp-entry">
            <div className="spread">
              <span>
                <strong>{c.faName}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {' '}
                  {teamOf(c.formerTeamId)?.shortName} → {teamOf(c.signingTeamId)?.shortName}（評価{c.grade}）
                </span>
              </span>
              <span className={`comp-status ${c.status}`}>
                {c.status === 'taken'
                  ? c.formerTeamId === state.playerTeamId
                    ? '獲得'
                    : '流出'
                  : c.status === 'waived'
                    ? 'なし'
                    : '選択待ち'}
              </span>
            </div>
            {c.status === 'taken' && (
              <div className="muted" style={{ fontSize: 13 }}>
                補償選手：<strong>{c.playerName}</strong>
                {c.formerTeamId === state.playerTeamId
                  ? ' が加入しました（2軍から）'
                  : ` が${teamOf(c.formerTeamId)?.shortName ?? ''}へ移籍しました`}
              </div>
            )}
            {c.status === 'waived' && c.note && (
              <div className="muted" style={{ fontSize: 13 }}>
                {c.note}
              </div>
            )}
            {mineToChoose && (
              <>
                <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                  {teamOf(c.signingTeamId)?.name}のプロテクト外から1人を選べます（選ばずに進むと総合力の最も高い選手を獲得）
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setOpen(open === c.id ? null : c.id)}
                >
                  {open === c.id ? '候補を閉じる' : `補償候補を見る（${options.length}人）`}
                </button>
                {open === c.id && (
                  <div className="comp-options">
                    {options.map((p) => (
                      <div key={p.id} className="player-card comp-option">
                        <PositionBadge player={p} />
                        <span className="grow">
                          <span className="row" style={{ gap: 6 }}>
                            <span className="name">{p.name}</span>
                            <span className="meta">{p.age}歳</span>
                          </span>
                          <span className="meta">
                            {positionText(p)} / {formatSalary(p.ext.contract?.salary ?? 0)}
                          </span>
                        </span>
                        <RankBadge value={overallRating(p)} />
                        <button
                          type="button"
                          className="chip comp-pick"
                          onClick={() => chooseCompensation(c.id, p.id)}
                        >
                          選ぶ
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => chooseCompensation(c.id, null)}
                    >
                      補償を受け取らない
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FACard({
  listing,
  player,
  offered,
  onOpen,
}: {
  listing: FAMarketPlayer;
  player: Player;
  offered: boolean;
  onOpen: () => void;
}) {
  const { state } = useGame();
  const grade = marketGrade(listing.marketValue);
  const former = requiresCompensation(grade) ? compensationFormerTeam(state, player) : null;
  const formerTeam = former ? state.teams.find((t) => t.id === former) : undefined;
  return (
    <button className="player-card" onClick={onOpen} aria-label={`${player.name} に条件を提示する`}>
      {/* PHASE 4.5: FA市場でも顔が出る。所属が変わっても同じ顔（§7・§22） */}
      <PlayerVisual player={player} size="small" showCap={false} className="portrait-row" />
      <PositionBadge player={player} />
      <span className="grow">
        <span className="row" style={{ gap: 6 }}>
          <span className="name">{player.name}</span>
          <span className="meta">{player.age}歳</span>
          {offered && (
            <span className="chip" style={{ padding: '1px 6px', fontSize: 11 }}>
              提示中
            </span>
          )}
        </span>
        <span className="meta" style={{ display: 'block' }}>
          市場評価 {grade}（{MARKET_GRADE_LABELS[grade]}） / {FA_ROLE_LABELS[listing.role]}
        </span>
        <span className="meta" style={{ display: 'block' }}>
          希望 {formatSalary(listing.askingSalary)} / {listing.preferredYears}年
        </span>
        {formerTeam && (
          <span className={`comp-tag${former === state.playerTeamId ? ' mine' : ''}`}>
            {former === state.playerTeamId
              ? '自球団から流出：他球団が獲れば人的補償を選べる'
              : `人的補償あり（${formerTeam.shortName}）`}
          </span>
        )}
      </span>
    </button>
  );
}

function OfferSheet({
  listing,
  player,
  onClose,
}: {
  listing: FAMarketPlayer;
  player: Player;
  onClose: () => void;
}) {
  const { state, makeFAOffer, cancelFAOffer } = useGame();
  const stats = state.stats[player.id];
  const maxYears = maxContractYears(player.age);
  const grade = marketGrade(listing.marketValue);
  const range = estimatedOverallRange(state, state.playerTeamId, player);
  const existing = state.fa?.offers.find(
    (o) => o.playerId === player.id && o.teamId === state.playerTeamId && o.status === 'PENDING',
  );

  const [salary, setSalary] = useState(existing?.salary ?? listing.askingSalary);
  const [years, setYears] = useState(existing?.years ?? Math.min(listing.preferredYears, maxYears));
  const step = salary >= 200 ? 20 : salary >= 100 ? 10 : 5;
  const strong = salary >= listing.askingSalary;

  return (
    <Sheet title={`${player.name} へのオファー`} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{player.name}</div>
            <div className="muted">
              {player.age}歳 / {positionText(player)} <RoleGrades player={player} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 11 }}>
              市場評価
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>{grade}</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Row label="推定総合" value={`${range.low}〜${range.high}`} />
          <Row label="役割" value={FA_ROLE_LABELS[listing.role]} />
          <Row label="希望年俸" value={formatSalary(listing.askingSalary)} />
          <Row label="希望年数" value={`${listing.preferredYears}年`} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          推定総合は自球団のスカウトによる見立てです（実際の数値とは差があります）。
        </div>
        {requiresCompensation(grade) &&
          (() => {
            const former = compensationFormerTeam(state, player);
            const t = former && former !== state.playerTeamId ? state.teams.find((x) => x.id === former) : null;
            return t ? (
              <div className="comp-tag" style={{ marginTop: 6 }}>
                獲得すると {t.name} がプロテクト外の選手を1人、人的補償として獲得します
              </div>
            ) : null;
          })()}
      </div>

      <div className="card">
        <h2>前年の成績</h2>
        {stats ? (
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
          <div className="muted">前年の出場記録はありません。</div>
        )}
      </div>

      <div className="card">
        <h2>提示条件</h2>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="muted" id="fa-salary-label">
            年俸
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              className="chip"
              style={{ padding: '10px 14px' }}
              aria-label="年俸を下げる"
              onClick={() => setSalary((v) => Math.max(MIN_SALARY, v - step))}
            >
              －
            </button>
            <strong
              style={{ fontSize: 17, minWidth: 92, textAlign: 'center' }}
              aria-labelledby="fa-salary-label"
            >
              {formatSalary(salary)}
            </strong>
            <button
              className="chip"
              style={{ padding: '10px 14px' }}
              aria-label="年俸を上げる"
              onClick={() => setSalary((v) => Math.min(MAX_SALARY, v + step))}
            >
              ＋
            </button>
          </span>
        </div>

        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="muted">契約年数</span>
          <span className="row" style={{ gap: 6 }}>
            {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
              <button
                key={y}
                className="chip"
                aria-pressed={years === y}
                style={{
                  padding: '9px 12px',
                  background: years === y ? 'var(--accent)' : '#2b3646',
                  color: years === y ? '#241a00' : undefined,
                }}
                onClick={() => setYears(y)}
              >
                {y}年
              </button>
            ))}
          </span>
        </div>

        <Row label="総額" value={formatMoney(salary * years)} />
        <div
          style={{
            marginTop: 10,
            fontWeight: 700,
            color: strong ? 'var(--good)' : 'var(--bad)',
          }}
        >
          {strong ? '◎ 希望額を満たしています' : '△ 希望額に届いていません'}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          他球団も同じ選手を狙っています。金額だけでなく、球団の成績と出場機会も選手は見ています。
        </div>
      </div>

      {existing && (
        <PictureButton
          src={withdrawOfferArt}
          alt="この提示を取り下げる"
          className="label-btn"
          onClick={() => {
            cancelFAOffer(player.id);
            onClose();
          }}
        />
      )}
      <PictureButton
        src={existing ? changeOfferArt : makeOfferArt}
        alt={existing ? 'この条件に変更する' : 'この条件でオファーする'}
        className="label-btn"
        onClick={() => {
          if (makeFAOffer(player.id, salary, years)) onClose();
        }}
      />
    </Sheet>
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
