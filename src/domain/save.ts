import type { GameState } from './types';
import { SAVE_VERSION } from './newGame';
import { repairAllSetups } from './engine';
import { LEGACY_TRAJECTORY_MAX, migrateLegacyTrajectory } from './trajectory';

export const SAVE_KEY = 'mipr:save:v1';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('セーブに失敗しました', e);
    return false;
  }
}

export function hasSave(): boolean {
  const store = storage();
  if (!store) return false;
  return store.getItem(SAVE_KEY) !== null;
}

/** セーブデータを読み込む。壊れている・バージョン違いなら null。 */
export function loadGame(): GameState | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    const state = migrate(parsed);
    if (!state) return null;
    // 念のため整合性を取り直す
    repairAllSetups(state);
    return state;
  } catch (e) {
    console.error('セーブデータの読み込みに失敗しました', e);
    return null;
  }
}

export function clearSave(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(SAVE_KEY);
}

/**
 * 古いセーブデータを現在のスキーマへ変換する。
 * 将来バージョンを増やしたときもここに変換を足していく。
 */
export function migrate(state: GameState): GameState | null {
  if (typeof state !== 'object' || state === null) return null;
  if (!Array.isArray(state.players) || !Array.isArray(state.teams)) return null;

  // v1 → v2: 弾道が 1〜4 の4段階だったので 1〜100 に変換する
  if (state.version === 1) {
    for (const player of state.players) {
      if (!player.batting) return null;
      if (player.batting.trajectory <= LEGACY_TRAJECTORY_MAX) {
        player.batting.trajectory = migrateLegacyTrajectory(player.batting.trajectory);
      }
    }
    state.version = 2;
  }

  if (state.version !== SAVE_VERSION) return null;
  return state;
}
