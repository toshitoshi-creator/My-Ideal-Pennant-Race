import { createNewGame } from '../src/domain/newGame';
import { advanceDay } from '../src/domain/engine';
import { standingsForLeague, formatWinPct } from '../src/domain/standings';
import { overallRating, teamPower } from '../src/domain/rating';
import { rankOf } from '../src/domain/rank';
import { average, era, formatInnings } from '../src/domain/stats';
import type { GameState } from '../src/domain/types';

function play(s: GameState): GameState {
  for (let i = 0; i < 400 && !s.seasonFinished; i++) s = advanceDay(s).state;
  return s;
}
let s = createNewGame('phoenix', 143, Number(process.argv[2] ?? 2026));
const byId = new Map(s.players.map((p) => [p.id, p]));
const setup = s.setups['phoenix'];
console.log('プレイヤー球団の総合力', teamPower(setup.lineup, setup.rotation.map((id) => byId.get(id)!), byId));
const ranks: Record<string, number> = {};
for (const p of s.players.filter((p) => p.teamId === 'phoenix')) {
  const r = rankOf(overallRating(p));
  ranks[r] = (ranks[r] ?? 0) + 1;
}
console.log('プレイヤー球団の総合ランク分布', ranks);
const allRanks: Record<string, number> = {};
for (const p of s.players) { const r = rankOf(overallRating(p)); allRanks[r] = (allRanks[r] ?? 0) + 1; }
console.log('全選手の総合ランク分布', allRanks);

s = play(s);
for (const l of s.leagues) {
  console.log('\n=== ' + l.name + ' ===');
  for (const r of standingsForLeague(s, l.id)) {
    const t = s.teams.find((t) => t.id === r.teamId)!;
    console.log(`${r.rank} ${t.name.padEnd(12)} ${r.games} ${r.wins}勝${r.losses}敗${r.draws}分 ${formatWinPct(r.winPct)} GB${r.gamesBehind.toFixed(1)} 得${r.runsScored} 失${r.runsAllowed}`);
  }
}
const bats = s.players.filter((p) => s.stats[p.id].batting.atBats >= 350)
  .sort((a, b) => average(s.stats[b.id].batting) - average(s.stats[a.id].batting)).slice(0, 5);
console.log('\n打率トップ5');
for (const p of bats) { const b = s.stats[p.id].batting; console.log(`${p.name} ${s.teams.find(t=>t.id===p.teamId)!.shortName} .${(average(b)*1000).toFixed(0)} ${b.hits}安 ${b.homeRuns}本 ${b.rbi}点 ${b.steals}盗 ${b.strikeouts}三振 ${b.walks}四球`); }
const pits = s.players.filter((p) => s.stats[p.id].pitching.outs >= 300)
  .sort((a, b) => era(s.stats[a.id].pitching) - era(s.stats[b.id].pitching)).slice(0, 5);
console.log('\n防御率トップ5');
for (const p of pits) { const q = s.stats[p.id].pitching; console.log(`${p.name} ${s.teams.find(t=>t.id===p.teamId)!.shortName} ${era(q).toFixed(2)} ${q.wins}勝${q.losses}敗 ${formatInnings(q.outs)}回 ${q.strikeouts}奪三振`); }
