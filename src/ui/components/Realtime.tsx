/**
 * 現実の時間で進む仕組みの画面部品。
 *   RealtimePanel   … ホームに出す「手動試合の残り回数」と「次の自動試合まで」
 *   AutoReportSheet … ゲームを開いたときに出す、自動で進んだあいだのまとめ
 *   ChargeShopSheet … 手動試合の回数を回復する購入画面（試作：実際の請求はしない）
 */
import type { AutoReport, GameState } from '../../domain/types';
import {
  CHARGE_PACKS,
  MANUAL_MAX,
  canAutoPlay,
  msUntilNextAuto,
  msUntilNextCharge,
} from '../../domain/realtime';
import { useGame } from '../store';
import { Sheet } from './common';
import { PlayerLink } from './PlayerLink';

function formatWait(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ''}`;
}

export function RealtimePanel() {
  const { state, now, openChargeShop } = useGame();
  if (!state?.realtime) return null;
  const rt = state.realtime;
  const nextCharge = msUntilNextCharge(state, now);
  const nextAuto = msUntilNextAuto(state, now);
  const charges = rt.manualCharges;
  const pct = Math.min(100, (charges / MANUAL_MAX) * 100);
  return (
    <section className="rt-panel" aria-label="試合の進み方">
      <div className="rt-row">
        <div className="rt-main">
          <span className="rt-label">手動試合</span>
          <span className={`rt-count${charges === 0 ? ' empty' : ''}`}>
            <b>{charges}</b>/{MANUAL_MAX}
          </span>
          <span className="rt-sub">
            {charges >= MANUAL_MAX ? '満タン' : `次の回復まで ${formatWait(nextCharge ?? 0)}`}
          </span>
        </div>
        <button type="button" className="btn secondary rt-buy" onClick={openChargeShop}>
          回復する
        </button>
      </div>
      <div className="rt-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="rt-auto">
        {nextAuto !== null
          ? `自動試合：1時間に1試合。次の自動試合まで ${formatWait(nextAuto)}`
          : canAutoPlay(state)
            ? '自動試合：1時間に1試合'
            : '自動試合はお休み中（シーズン終了後・オフシーズン）'}
      </div>
    </section>
  );
}

const OUTCOME_LABEL = { W: '○', L: '●', D: '△' } as const;

export function AutoReportSheet() {
  const { state, dismissAutoReport, setScreen } = useGame();
  const report = state?.realtime?.pendingReport;
  if (!state || !report) return null;
  return (
    <Sheet title="留守のあいだの試合結果" onClose={dismissAutoReport}>
      <AutoReportBody state={state} report={report} />
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            dismissAutoReport();
            setScreen('standings');
          }}
        >
          順位表を見る
        </button>
        <button type="button" className="btn primary" onClick={dismissAutoReport}>
          OK
        </button>
      </div>
    </Sheet>
  );
}

function AutoReportBody({ state, report }: { state: GameState; report: AutoReport }) {
  const wins = report.games.filter((g) => g.outcome === 'W').length;
  const losses = report.games.filter((g) => g.outcome === 'L').length;
  const draws = report.games.filter((g) => g.outcome === 'D').length;
  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.shortName ?? id;
  const shown = report.games.slice(-20).reverse();
  const ups = report.playerChanges.filter((c) => c.deltaPct > 0 && !c.injuredAfter);
  const downs = report.playerChanges.filter((c) => c.deltaPct <= 0 || c.injuredAfter);
  const rankDiff =
    report.rankBefore !== null && report.rankAfter !== null ? report.rankBefore - report.rankAfter : 0;
  const days =
    Math.round((Date.parse(report.toDate) - Date.parse(report.fromDate)) / 86400000) + 1;
  return (
    <>
      <div className="card ar-summary">
        <div className="ar-period">
          現実の{report.hours}時間で {report.games.length}試合を自動で消化（ゲーム内 {days}日間：
          {report.fromDate.slice(5).replace('-', '/')}〜{report.toDate.slice(5).replace('-', '/')}）
        </div>
        <div className="ar-big">
          <span className="ar-w">{wins}勝</span>
          <span className="ar-l">{losses}敗</span>
          {draws > 0 && <span className="ar-d">{draws}分</span>}
        </div>
        <div className="ar-stats">
          <span>
            通算 {report.recordAfter.wins}勝{report.recordAfter.losses}敗
            {report.recordAfter.draws > 0 ? `${report.recordAfter.draws}分` : ''}
          </span>
          {report.rankAfter !== null && (
            <span>
              順位 {report.rankBefore === null ? '開幕前' : `${report.rankBefore}位`} → <b>{report.rankAfter}位</b>
              {rankDiff > 0 && <em className="up"> ↑{rankDiff}</em>}
              {rankDiff < 0 && <em className="down"> ↓{-rankDiff}</em>}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>選手の調子の上下</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          経過した日数のあいだに変わった、調子・疲労・やる気込みの実力（基礎能力はシーズン中は変わりません）
        </p>
        {report.playerChanges.length === 0 && <div className="muted">大きく変わった選手はいません。</div>}
        {ups.length > 0 && (
          <div className="ar-group">
            <div className="ar-group-head up">上がった選手</div>
            {ups.map((c) => (
              <ChangeRow key={c.playerId} change={c} />
            ))}
          </div>
        )}
        {downs.length > 0 && (
          <div className="ar-group">
            <div className="ar-group-head down">下がった選手</div>
            {downs.map((c) => (
              <ChangeRow key={c.playerId} change={c} />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>試合結果</h2>
        {shown.map((g, i) => (
          <div key={`${g.date}-${i}`} className={`ar-game ${g.outcome}`}>
            <span className="ar-date">{g.date.slice(5).replace('-', '/')}</span>
            <span className="ar-mark">{OUTCOME_LABEL[g.outcome]}</span>
            <span className="ar-opp">
              {g.home ? 'vs' : '@'} {teamName(g.opponentId)}
              {g.postseason && <span className="chip ar-ps">ポストシーズン</span>}
            </span>
            <span className="ar-score">
              {g.runsFor} - {g.runsAgainst}
            </span>
          </div>
        ))}
        {report.games.length > shown.length && (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            ほか{report.games.length - shown.length}試合（試合タブ・記録で見られます）
          </div>
        )}
      </div>
    </>
  );
}

function ChangeRow({ change: c }: { change: AutoReport['playerChanges'][number] }) {
  const up = c.deltaPct > 0;
  return (
    <div className="ar-change">
      <span className="ar-name">
        <PlayerLink playerId={c.playerId}>{c.name}</PlayerLink>
      </span>
      <span className="ar-cond">
        {c.conditionBefore === c.conditionAfter ? c.conditionAfter : `${c.conditionBefore}→${c.conditionAfter}`}
        {c.injuredAfter && !c.injuredBefore && <span className="chip ar-inj">ケガ</span>}
        {!c.injuredAfter && c.injuredBefore && <span className="chip ar-ret">復帰</span>}
      </span>
      <span className={`ar-delta ${up ? 'up' : 'down'}`}>
        {up ? '▲' : '▼'}
        {Math.abs(c.deltaPct).toFixed(1)}%
      </span>
    </div>
  );
}

export function ChargeShopSheet() {
  const { state, chargeShopOpen, closeChargeShop, buyCharges, now } = useGame();
  if (!state?.realtime || !chargeShopOpen) return null;
  const nextCharge = msUntilNextCharge(state, now);
  return (
    <Sheet title="手動試合の回数を回復" onClose={closeChargeShop}>
      <div className="card">
        <div className="shop-now">
          いまの残り <b>{state.realtime.manualCharges}</b> 回
          {nextCharge !== null && <span className="muted">（次の1回は {formatWait(nextCharge)} 後に回復）</span>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          手動試合は1時間に1回、{MANUAL_MAX}回まで自然に回復します。待たずに遊びたいときは購入で回復できます。
          購入した回数は{MANUAL_MAX}回を超えて持てます。
        </p>
      </div>
      <div className="shop-packs">
        {CHARGE_PACKS.map((pack) => (
          <button key={pack.id} type="button" className="shop-pack" onClick={() => buyCharges(pack.id)}>
            <span className="shop-pack-name">{pack.label}</span>
            <span className="shop-pack-price">¥{pack.priceYen.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="shop-note">
        試作版：いまは購入ボタンを押しても実際の請求は行われず、そのまま回復します。
      </div>
    </Sheet>
  );
}
