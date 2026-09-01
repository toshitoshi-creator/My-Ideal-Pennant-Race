import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameResult, GameState, Player, SeasonLength, Team } from '../domain/types';
import { createNewGame } from '../domain/newGame';
import {
  advanceDay,
  advanceToNextPlayerGame,
  cloneState,
  repairAllSetups,
  validateState,
} from '../domain/engine';
import { clearSave, hasSave, loadGame, saveGame } from '../domain/save';
import { addDays } from '../domain/dates';

export type ScreenId = 'home' | 'game' | 'players' | 'roster' | 'standings';

interface StoreValue {
  state: GameState | null;
  screen: ScreenId;
  toast: string | null;
  lastResult: GameResult | null;
  saveExists: boolean;
  setScreen(screen: ScreenId): void;
  showToast(message: string): void;
  startNewGame(teamId: string, seasonLength: SeasonLength): void;
  continueGame(): boolean;
  quitToTitle(): void;
  deleteSave(): void;
  /** state を書き換えて自動保存する */
  mutate(fn: (draft: GameState) => void): void;
  playNextGame(): GameResult | null;
  skipOneDay(): void;
  clearLastResult(): void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<ScreenId>('home');
  const [toast, setToast] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [saveExists, setSaveExists] = useState<boolean>(() => hasSave());
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const persist = useCallback((next: GameState) => {
    setState(next);
    if (saveGame(next)) setSaveExists(true);
  }, []);

  const startNewGame = useCallback(
    (teamId: string, seasonLength: SeasonLength) => {
      const next = createNewGame(teamId, seasonLength);
      const errors = validateState(next);
      if (errors.length > 0) console.error('データ整合性エラー', errors);
      persist(next);
      setScreen('home');
      setLastResult(null);
    },
    [persist],
  );

  const continueGame = useCallback(() => {
    const loaded = loadGame();
    if (!loaded) {
      setSaveExists(false);
      return false;
    }
    setState(loaded);
    setScreen('home');
    setLastResult(null);
    return true;
  }, []);

  const quitToTitle = useCallback(() => {
    setState((current) => {
      if (current) saveGame(current);
      return null;
    });
    setLastResult(null);
  }, []);

  const deleteSave = useCallback(() => {
    clearSave();
    setSaveExists(false);
    setState(null);
    setLastResult(null);
  }, []);

  const mutate = useCallback(
    (fn: (draft: GameState) => void) => {
      setState((current) => {
        if (!current) return current;
        const draft = cloneState(current);
        fn(draft);
        repairAllSetups(draft);
        saveGame(draft);
        setSaveExists(true);
        return draft;
      });
    },
    [],
  );

  const playNextGame = useCallback((): GameResult | null => {
    if (!state) return null;
    if (state.seasonFinished) {
      showToast('シーズンは終了しました');
      return null;
    }
    const step = advanceToNextPlayerGame(state);
    persist(step.state);
    setLastResult(step.playerResult);
    return step.playerResult;
  }, [state, persist, showToast]);

  const skipOneDay = useCallback(() => {
    if (!state) return;
    if (state.seasonFinished) {
      // シーズン後も日付だけは進められる
      const next = cloneState(state);
      next.date = addDays(next.date, 1);
      persist(next);
      return;
    }
    const step = advanceDay(state);
    persist(step.state);
    if (step.playerResult) setLastResult(step.playerResult);
  }, [state, persist]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      screen,
      toast,
      lastResult,
      saveExists,
      setScreen,
      showToast,
      startNewGame,
      continueGame,
      quitToTitle,
      deleteSave,
      mutate,
      playNextGame,
      skipOneDay,
      clearLastResult: () => setLastResult(null),
    }),
    [
      state,
      screen,
      toast,
      lastResult,
      saveExists,
      showToast,
      startNewGame,
      continueGame,
      quitToTitle,
      deleteSave,
      mutate,
      playNextGame,
      skipOneDay,
    ],
  );

  // 離脱時にも保存しておく
  useEffect(() => {
    const handler = () => {
      if (state) saveGame(state);
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('StoreProvider の外で useStore を呼び出しました');
  return ctx;
}

/** state が確定している画面用 */
export function useGame(): StoreValue & { state: GameState } {
  const store = useStore();
  if (!store.state) throw new Error('ゲームが開始されていません');
  return store as StoreValue & { state: GameState };
}

export function useTeam(teamId: string): Team {
  const { state } = useGame();
  return state.teams.find((t) => t.id === teamId)!;
}

export function usePlayerMap(): Map<string, Player> {
  const { state } = useGame();
  return useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
}
