/**
 * PlayerLink がどこからでも選手を開けるようにする、常時1つだけの受け皿（PHASE 4.9-A）。
 *
 * App.tsx のゲーム画面の中に常駐させておき、store.viewingPlayerId を見て、
 *   1. 現役選手（state.players に居る）なら PlayerDetail（能力・成績・1軍/2軍入れ替え）
 *   2. 現役ではないが記録が残っている選手（state.history.players）なら経歴シート
 *   3. どちらにも無ければ何も開かない（存在しない playerId の安全な処理）
 * を出し分ける。ここでは state を一切変更しない。
 */
import { useStore } from '../store';
import { PlayerDetail } from './PlayerDetail';
import { PlayerHistoryView } from './PlayerHistoryView';
import { Sheet } from './common';

export function PlayerDetailHost() {
  const { state, viewingPlayerId, closePlayer } = useStore();
  if (!state || !viewingPlayerId) return null;

  const live = state.players.find((p) => p.id === viewingPlayerId);
  if (live) {
    return <PlayerDetail player={live} onClose={closePlayer} />;
  }

  const history = state.history.players[viewingPlayerId];
  if (history) {
    return (
      <Sheet title={history.name} onClose={closePlayer}>
        <PlayerHistoryView history={history} />
      </Sheet>
    );
  }

  // 存在しない playerId（壊れた参照など）。何も開かず静かに諦める
  return null;
}
