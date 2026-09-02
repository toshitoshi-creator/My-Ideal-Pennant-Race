import { useMemo, useState } from 'react';
import { useGame } from '../store';
import type { FAMarketPlayer, Player } from '../../domain/types';
import { POSITION_LABELS, POSITION_SHORT } from '../../domain/positions';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import {
  MAX_USER_OFFERS,
  FA_ROLE_LABELS,
  MARKET_GRADE_LABELS,
  estimatedOverallRange,
  marketGrade,
  offersByTeam,
} from '../../domain/freeAgency';
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
import { Sheet } from '../components/common';

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
          <h2>球団の資金</h2>
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
              <h2>FA市場</h2>
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

            <button className="btn secondary" onClick={() => autoFA()}>
              おまかせで補強する
            </button>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={() => resolveFA()}>
              FA市場を締め切る
            </button>
            <button className="btn" style={{ marginTop: 10 }} onClick={() => hideFA()}>
              先に球団を確認する
            </button>
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
    </div>
  );
}

function ResultsCard({ onFinish }: { onFinish: () => void }) {
  const { state } = useGame();
  const fa = state.fa!;
  const mine = fa.results.filter((r) => r.teamId === state.playerTeamId);
  const others = fa.results.filter((r) => r.teamId !== state.playerTeamId);

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>FA市場が終わりました</div>
        <div className="muted" style={{ marginTop: 4 }}>
          契約が決まらなかった選手（{fa.unsigned}人）は来オフも市場に残ります。
        </div>
      </div>

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

      <button className="btn primary" onClick={onFinish}>
        新シーズンへ
      </button>
    </>
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
  const grade = marketGrade(listing.marketValue);
  return (
    <button className="player-card" onClick={onOpen} aria-label={`${player.name} に条件を提示する`}>
      <span className="pos">{POSITION_SHORT[player.mainPosition]}</span>
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
              {player.age}歳 / {POSITION_LABELS[player.mainPosition]}
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
        <button
          className="btn secondary"
          style={{ marginBottom: 10 }}
          onClick={() => {
            cancelFAOffer(player.id);
            onClose();
          }}
        >
          この提示を取り下げる
        </button>
      )}
      <button
        className="btn primary"
        onClick={() => {
          if (makeFAOffer(player.id, salary, years)) onClose();
        }}
      >
        {existing ? 'この条件に変更する' : 'この条件でオファーする'}
      </button>
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
