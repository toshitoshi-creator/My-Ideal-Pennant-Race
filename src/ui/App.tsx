import { StoreProvider, useStore } from './store';
import type { ScreenId } from './store';
import { TitleScreen } from './screens/TitleScreen';
import { HomeScreen } from './screens/HomeScreen';
import { GameScreen } from './screens/GameScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { RosterScreen } from './screens/RosterScreen';
import { StandingsScreen } from './screens/StandingsScreen';
import { formatDateJa } from '../domain/dates';

const NAV: Array<{ id: ScreenId; label: string; icon: string }> = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'game', label: '試合', icon: '⚾' },
  { id: 'players', label: '選手', icon: '👥' },
  { id: 'roster', label: '編成', icon: '📋' },
  { id: 'standings', label: '順位', icon: '📊' },
];

export function App() {
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}

function Root() {
  const { state, screen, setScreen, toast, quitToTitle } = useStore();

  if (!state) {
    return (
      <>
        <TitleScreen />
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
        <button className="chip" style={{ padding: '8px 12px' }} onClick={quitToTitle}>
          保存して終了
        </button>
      </div>

      {screen === 'home' && <HomeScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'players' && <PlayersScreen />}
      {screen === 'roster' && <RosterScreen />}
      {screen === 'standings' && <StandingsScreen />}

      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={screen === item.id ? 'on' : ''}
            onClick={() => setScreen(item.id)}
          >
            <span className="ico">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
