import { StoreProvider, useStore } from './store';
import type { ScreenId } from './store';
import { TitleScreen } from './screens/TitleScreen';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { RosterScreen } from './screens/RosterScreen';
import { StandingsScreen } from './screens/StandingsScreen';
import { DraftScreen } from './screens/DraftScreen';
import { ContractScreen } from './screens/ContractScreen';
import { FAScreen } from './screens/FAScreen';
import { TradeScreen } from './screens/TradeScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { PostseasonScreen } from './screens/PostseasonScreen';
import { NewsScreen } from './screens/NewsScreen';
import { ClubScreen } from './screens/ClubScreen';
import { DiscoveryScreen } from './screens/DiscoveryScreen';
import { PlayerCheckScreen } from './screens/PlayerCheckScreen';
import { PlayerDetailHost } from './components/PlayerDetailHost';
import { formatDateJa } from '../domain/dates';
import { PictureButton } from './components/PictureButton';
import { LoadingFlourish } from './components/LoadingFlourish';
import saveQuitArt from '../assets/ui/app-save-quit.webp';
import { useEffect, useRef, useState } from 'react';
import { LiveBroadcast } from './components/LiveBroadcast';
import { TapFx, SettingsButton } from './components/GameFx';
import { broadcastEnabled } from './sfx';

/*
 * ナビゲーション。絵文字のアイコンはやめ、文字だけにする。
 * 上の小さなラテン語は「どの資料を開いているか」の見出しで、
 * 日本語のほうが実際のラベル。
 */
const NAV: Array<{ id: ScreenId; label: string; tag: string }> = [
  { id: 'home', label: 'ホーム', tag: 'DESK' },
  { id: 'game', label: '試合', tag: 'GAME' },
  { id: 'players', label: '選手', tag: 'ROSTER' },
  { id: 'roster', label: '編成', tag: 'LINEUP' },
  { id: 'standings', label: '順位', tag: 'STANDINGS' },
];

export function App() {
  return (
    <StoreProvider>
      <TapFx />
      <Root />
    </StoreProvider>
  );
}

function Root() {
  const { state, screen, setScreen, toast, quitToTitle, faHidden, lastResult } = useStore();

  /*
   * 試合中継。新しい試合結果が出たら（次の試合・1日進める・スワイプで次へ）
   * 1回だけ中継の演出を重ねる。結果はすでに確定していて、ここは見せ方だけ。
   */
  const [liveId, setLiveId] = useState<string | null>(null);
  const seenResult = useRef<string | null>(null);
  useEffect(() => {
    if (!lastResult || lastResult.id === seenResult.current) return;
    seenResult.current = lastResult.id;
    if (broadcastEnabled()) setLiveId(lastResult.id);
  }, [lastResult]);
  const liveResult = lastResult && lastResult.id === liveId ? lastResult : null;
  const navIndex = NAV.findIndex((n) => n.id === screen);

  /*
   * 画面の切り替わりのたびに読み込み演出を挟む（§後日のロード対応）。
   * どの分岐で return しても同じ key の変化を追えるよう、状態から
   * 1つの文字列を作る（タイトル→本編の切り替わりもここに含める）。
   */
  const transitionKey = !state
    ? 'title'
    : state.draft
      ? 'draft'
      : state.contractPhase
        ? 'contract'
        : state.fa && !faHidden
          ? 'fa'
          : `screen:${screen}`;

  if (!state) {
    return (
      <>
        <TitleScreen />
        <LoadingFlourish key={transitionKey} />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  // ドラフト中・契約更改中は専用画面に切り替える
  if (state.draft) {
    return (
      <>
        <DraftScreen />
        <LoadingFlourish key={transitionKey} />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }
  if (state.contractPhase) {
    return (
      <>
        <ContractScreen />
        <LoadingFlourish key={transitionKey} />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }
  // FA市場は「先に球団を確認する」で一時的に閉じられる
  if (state.fa && !faHidden) {
    return (
      <>
        <FAScreen />
        <LoadingFlourish key={transitionKey} />
        {toast && <div className="toast">{toast}</div>}
      </>
    );
  }

  const team = state.teams.find((t) => t.id === state.playerTeamId)!;

  return (
    <div className="app">
      <div className="appbar">
        <div>
          <h1>{team.name}</h1>
          <div className="sub">
            {state.year}年 {formatDateJa(state.date)}
          </div>
        </div>
        <div className="appbar-actions">
          <SettingsButton />
          <PictureButton src={saveQuitArt} alt="保存して終了" className="appbar-quit" onClick={quitToTitle} />
        </div>
      </div>

      {/* PHASE 4.1: 画面が切り替わったことが分かる軽い演出（reduced-motion では効かない） */}
      <div className="screen-anim" key={screen}>
      {screen === 'home' && <HomeScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'players' && <PlayersScreen />}
      {screen === 'roster' && <RosterScreen />}
      {screen === 'standings' && <StandingsScreen />}
      {screen === 'trade' && <TradeScreen />}
      {screen === 'history' && <HistoryScreen />}
      {screen === 'records' && <RecordsScreen />}
      {screen === 'postseason' && <PostseasonScreen />}
      {screen === 'news' && <NewsScreen />}
      {screen === 'club' && <ClubScreen />}
      {screen === 'playerCheck' && <PlayerCheckScreen />}
      {screen === 'discovery' && <DiscoveryScreen />}
      </div>
      <LoadingFlourish key={transitionKey} />

      <nav className="nav">
        <span
          className="nav-indicator"
          style={{
            transform: `translateX(${Math.max(0, navIndex) * 100}%)`,
            opacity: navIndex < 0 ? 0 : 1,
          }}
          aria-hidden="true"
        />
        {NAV.map((item) => (
          <button
            key={item.id}
            className={screen === item.id ? 'on' : ''}
            onClick={() => setScreen(item.id)}
          >
            <span className="nav-tag">{item.tag}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" key={toast}>
          {toast}
        </div>
      )}
      {liveResult && (
        <LiveBroadcast
          state={state}
          result={liveResult}
          onClose={() => {
            setLiveId(null);
            // 試合タブにいれば、中継を閉じたらそのままスコアブックを見せる
            requestAnimationFrame(() =>
              document.querySelector('.swipe-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            );
          }}
        />
      )}
      {/* PHASE 4.9-A: どの画面からでも選手名をタップしたら、ここが選手詳細を出す */}
      <PlayerDetailHost />
    </div>
  );
}
