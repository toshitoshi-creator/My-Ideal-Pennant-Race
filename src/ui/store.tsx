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
import { completeOffseason, startOffseason } from '../domain/season';
import { makePick, recordPlayerPick, runCpuPicks, currentPick } from '../domain/draft';
import { Rng } from '../domain/rng';
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
  /** シーズンを締めてオフシーズン（成長・引退・ドラフト）に入る */
  advanceSeason(): void;
  /** ドラフトでプレイヤー球団が指名する */
  draftPick(prospectId: string): void;
  /** ドラフトを終えて翌シーズンを開幕する */
  finishOffseason(): void;
  /** オフシーズン明けに成長レポートを開くかどうか */
  pendingReport: boolean;
  dismissReport(): void;
  clearLastResult(): void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<ScreenId>('home');
  const [toast, setToast] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GameResult | null>(null);
  const [saveExists, setSaveExists] = useState<boolean>(() => hasSave());
  const [pendingReport, setPendingReport] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const persist = useCallback((next: GameState) => {
    stateRef.current = next;
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
    stateRef.current = loaded;
    setState(loaded);
    setScreen('home');
    setLastResult(null);
    return true;
  }, []);

  const quitToTitle = useCallback(() => {
    if (stateRef.current) saveGame(stateRef.current);
    stateRef.current = null;
    setState(null);
    setLastResult(null);
  }, []);

  const deleteSave = useCallback(() => {
    clearSave();
    setSaveExists(false);
    stateRef.current = null;
    setState(null);
    setLastResult(null);
  }, []);

  const mutate = useCallback((fn: (draft: GameState) => void) => {
    const current = stateRef.current;
    if (!current) return;
    const draft = cloneState(current);
    fn(draft);
    repairAllSetups(draft);
    stateRef.current = draft;
    setState(draft);
    if (saveGame(draft)) setSaveExists(true);
  }, []);

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
    if (step.playerResult) {
      const r = step.playerResult;
      setLastResult(r);
      const home = step.state.teams.find((t) => t.id === r.homeTeamId)!;
      const away = step.state.teams.find((t) => t.id === r.awayTeamId)!;
      showToast(
        `${away.shortName} ${r.away.runs} - ${r.home.runs} ${home.shortName}（試合タブで詳細）`,
      );
    } else {
      showToast('1日進めました');
    }
  }, [state, persist, showToast]);

  const commit = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
    if (saveGame(next)) setSaveExists(true);
  }, []);

  /** シーズン終了 → 成長・衰退 → 引退 → ドラフト準備 */
  const advanceSeason = useCallback(() => {
    const current = stateRef.current;
    if (!current || !current.seasonFinished) return;
    if (current.draft) return; // すでにドラフト中なら何もしない（二重実行の防止）
    const next = cloneState(current);
    const { retirements } = startOffseason(next);
    commit(next);
    if (retirements.length > 0) {
      showToast(`${retirements.length}人が現役を引退しました`);
    }
  }, [commit, showToast]);

  const draftPick = useCallback(
    (prospectId: string) => {
      const current = stateRef.current;
      if (!current?.draft) return;
      const next = cloneState(current);
      const draft = next.draft!;
      const slot = currentPick(draft);
      if (!slot || slot.teamId !== next.playerTeamId) return;
      const prospect = draft.prospects.find((p) => p.id === prospectId);
      if (!prospect || !makePick(draft, prospectId)) return;
      recordPlayerPick(next, prospect, slot.round);
      const rng = new Rng(next.rngState);
      runCpuPicks(next, rng);
      next.rngState = rng.getState();
      commit(next);
      showToast(`${prospect.player.name} を指名しました`);
    },
    [commit, showToast],
  );

  /** ドラフト終了 → 新人加入 → 翌シーズン開幕 */
  const finishOffseason = useCallback(() => {
    const current = stateRef.current;
    if (!current?.draft) return;
    const next = cloneState(current);
    const rookies = completeOffseason(next);
    repairAllSetups(next);
    commit(next);
    setPendingReport(true);
    showToast(`${next.year}年シーズン開幕（新人${rookies.length}人が加入）`);
  }, [commit, showToast]);

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
      advanceSeason,
      draftPick,
      finishOffseason,
      pendingReport,
      dismissReport: () => setPendingReport(false),
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
      advanceSeason,
      draftPick,
      finishOffseason,
      pendingReport,
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
