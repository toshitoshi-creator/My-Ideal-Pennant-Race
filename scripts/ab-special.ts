/** 特殊能力の効き具合をA/Bで測る */
import { Rng } from '../src/domain/rng';
import { generateTeamPlayers } from '../src/domain/playerGen';
import { buildAutoSetup } from '../src/domain/setup';
import { simulateGame } from '../src/domain/simulation';
import { TEAM_SEEDS } from '../src/domain/teams';
import type { Player } from '../src/domain/types';

function strip(players: Player[]): Player[] {
  return players.map((p) => ({ ...p, ext: { ...p.ext, specialAbilities: [] } }));
}

function series(a: Player[], b: Player[], label: string, n = 400) {
  const rng = new Rng(555);
  const A = TEAM_SEEDS[0];
  const B = TEAM_SEEDS[1];
  const as = buildAutoSetup(A.id, a, true);
  const bs = buildAutoSetup(B.id, b, true);
  let aw = 0, bw = 0, ra = 0, rb = 0, hr = 0, k = 0, bb = 0, e = 0, ab = 0, hits = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateGame({
      rng, gameId: `ab${i}`, date: '2026-04-01', leagueId: 'ocean', useDH: true,
      homeTeam: A, awayTeam: B, homePlayers: a, awayPlayers: b, homeSetup: as, awaySetup: bs,
    });
    if (r.winnerTeamId === A.id) aw++; else if (r.winnerTeamId === B.id) bw++;
    ra += r.home.runs; rb += r.away.runs; e += r.home.errors + r.away.errors;
    for (const l of r.playerLines) {
      if (l.batting) { ab += l.batting.atBats; hits += l.batting.hits; hr += l.batting.homeRuns; k += l.batting.strikeouts; bb += l.batting.walks; }
    }
  }
  console.log(
    `${label}: 強${aw}-${bw}弱 (${(aw / (aw + bw) * 100).toFixed(1)}%) 得点 ${(ra / n).toFixed(2)}/${(rb / n).toFixed(2)} ` +
    `AVG ${(hits / ab).toFixed(3)} HR/g ${(hr / n / 2).toFixed(2)} K/g ${(k / n / 2).toFixed(1)} BB/g ${(bb / n / 2).toFixed(1)} E/g ${(e / n / 2).toFixed(2)}`,
  );
}

const rng = new Rng(2468);
const strong = generateTeamPlayers(rng, { teamId: TEAM_SEEDS[0].id, strength: 41, starCount: 3 });
const weak = generateTeamPlayers(rng, { teamId: TEAM_SEEDS[1].id, strength: 35, starCount: 2, starBonus: [7, 14] });
series(strip(strong), strip(weak), '特殊能力なし');
series(strong, weak, '特殊能力あり');

const even1 = generateTeamPlayers(rng, { teamId: TEAM_SEEDS[0].id, strength: 39, starCount: 2 });
const even2 = generateTeamPlayers(rng, { teamId: TEAM_SEEDS[1].id, strength: 39, starCount: 2 });
series(strip(even1), strip(even2), '互角・能力なし');
series(even1, even2, '互角・能力あり');
