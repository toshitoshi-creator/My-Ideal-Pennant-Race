import { createNewGame } from '../src/domain/newGame';
import { advanceDay, cloneState } from '../src/domain/engine';
import { startNextSeason } from '../src/domain/season';
import { STAGE_LABELS } from '../src/domain/postseason';
import type { GameState } from '../src/domain/types';
function play(s0: GameState): GameState { let s=s0,g=0; while(!s.seasonFinished&&g++<800) s=advanceDay(s).state; return s; }
let s = createNewGame('phoenix', 30, 3801);
s = play(s);
const name = (id: string|null) => s.teams.find(t=>t.id===id)?.shortName ?? '―';
console.log('レギュラーシーズン終了。ポストシーズン:', s.postseason ? '生成済み' : 'なし');
if (s.postseason) {
  for (const [lg, ids] of Object.entries(s.postseason.participants)) {
    console.log(`  ${lg}: ${ids.map(name).join(' / ')}`);
  }
}
s = cloneState(s);
startNextSeason(s);
const season = s.history.seasons[0];
console.log('\n歴史:', season.year, '年');
for (const lg of season.leagues) {
  console.log(`  ${lg.leagueId}: 1位=${name(lg.championTeamId)} リーグ優勝=${name(lg.leagueChampionTeamId ?? null)} CS MVP=${lg.csMvpPlayerId ? s.history.players[lg.csMvpPlayerId]?.name : '―'}`);
}
const ps = season.postseason;
if (ps) {
  console.log('  日本一:', name(ps.japanSeriesChampionTeamId), '/ MVP:', ps.japanSeriesMvpPlayerId ? s.history.players[ps.japanSeriesMvpPlayerId]?.name : '―');
  for (const x of ps.series) {
    console.log(`    ${STAGE_LABELS[x.stage]} ${name(x.teamAId)} ${x.teamAWins} - ${x.teamBWins} ${name(x.teamBId)}（${x.games}試合、アドバンテージ${x.advantageA}）→ ${name(x.winnerTeamId)}`);
  }
}
console.log('  ポストシーズン状態:', s.postseason === null ? '翌年ぶんにクリア済み' : '残っている');
