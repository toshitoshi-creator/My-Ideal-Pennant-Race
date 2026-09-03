import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import type { GameState } from '../src/domain/types';
function play(s0: GameState): GameState { let s=s0,g=0; while(!s.seasonFinished&&g++<800) s=advanceDay(s).state; return s; }
const YEARS = Number(process.argv[2] ?? 50);
let s = createNewGame('phoenix', 143, 3702);
const kb = (v: unknown) => Math.round(JSON.stringify(v).length / 1024);
for (let y = 1; y <= YEARS; y++) {
  s = play(s); s = cloneState(s); startNextSeason(s);
  if (y % 10 === 0 || y === 1) {
    const h = s.history;
    const t0 = Date.now();
    const round = JSON.parse(JSON.stringify(s));
    const load = Date.now() - t0;
    console.log(
      `${y}年目: 全体 ${kb(s)}KB / history ${kb(h)}KB ` +
      `(seasons ${kb(h.seasons)} players ${kb(h.players)} events ${kb(h.events)} ` +
      `teamRec ${kb(h.teamRecords)} hof ${h.hallOfFame.length}) ` +
      `events ${h.events.length}件 選手 ${Object.keys(h.players).length}人 ` +
      `直列化+復元 ${load}ms (${round.year})\n    素の状態: players ${kb(s.players)} trade.history ${kb(s.trade.history)} retired ${kb(s.retiredPlayers)} scouting ${kb(s.scouting)} results ${kb(s.results)} schedule ${kb(s.schedule)} freeAgents ${kb(s.freeAgents)}`,
    );
  }
}
