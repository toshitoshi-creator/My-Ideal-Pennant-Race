import type { GameState } from './types';
import { SAVE_VERSION } from './newGame';
import { repairAllSetups } from './engine';
import { repairFreeAgents } from './freeAgency';
import {
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
} from './migrate';

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
    repairFreeAgents(state);
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

  for (const player of state.players) {
    if (!player.batting) return null;
  }

  // v1 → v2: 弾道が 1〜4 の4段階だったので 1〜100 に変換する
  if (state.version === 1) migrateV1ToV2(state);
  // v2 → v3: PHASE 2 のデータ（性格・潜在能力・成長・特殊能力・状態）を補完する
  if (state.version === 2) migrateV2ToV3(state);
  // v3 → v4: PHASE 2.5 の調子まわりのデータを補完する
  if (state.version === 3) migrateV3ToV4(state);
  // v4 → v5: PHASE 3.1 の引退・ドラフトのデータを補完する
  if (state.version === 4) migrateV4ToV5(state);
  // v5 → v6: PHASE 3.2 のスカウト情報を補完する
  if (state.version === 5) migrateV5ToV6(state);
  // v6 → v7: PHASE 3.3 の契約・球団資金を補完する
  if (state.version === 6) migrateV6ToV7(state);
  // v7 → v8: PHASE 3.4 の FA 市場・未所属選手を補完する
  if (state.version === 7) migrateV7ToV8(state);

  if (state.version !== SAVE_VERSION) return null;
  return state;
}
