/**
 * PHASE 4.4 GM DESK — 今日の判断材料。
 *
 * ここがやるのは「いま球団で起きていることを見つけて、資料にして机に置く」ことだけ。
 * 判断は絶対に自動実行しない（§2）。おすすめも最適解も出さない（§3・§22）。
 * 出すのは、状況・数字・見方・短期と長期の意味・どこへ行けば決められるか、の5つ。
 *
 * 制約：
 *   - 乱数を使わない。同じ GameState からは必ず同じ案件が同じ順で出る（§32）
 *     UI を開くだけで rngState が動くことは無い（この関数は state を読むだけ）
 *   - 自球団の情報だけを見る。他球団の内部情報は使わない（§31・§37）
 *   - 引退した選手・存在しない選手は参照しない（state.players にいる選手だけ）
 *   - 断定しない。「必ず伸びる」「勝率が上がる」とは書かない（§6）
 */
import type { GameState, Player } from './types';
import { analyzePlayer } from './playerAnalysis';
import { analyzeTeamForDisplay } from './teamAnalysis';
import { pendingEvents } from './club';
import { pendingOffersForPlayer } from './trade';
import { formatMoney, isExpiring, remainingBudget } from './contract';
import { overallRating } from './rating';
import { average, era } from './stats';
import { objectiveText } from './club';
import { formatDateJa } from './dates';
import { diffDays } from './dates';
import { rankOfTeam } from './standings';

/* ================= 型 ================= */

export type GmItemKind =
  | 'MANAGEMENT_EVENT'
  | 'TRADE_OFFER'
  | 'FA_MARKET'
  | 'BUDGET'
  | 'BULLPEN_FATIGUE'
  | 'ROTATION_THIN'
  | 'STAR_DECLINE'
  | 'RECENT_FORM'
  | 'INJURY_RETURN'
  | 'YOUNG_RISING'
  | 'SECOND_TEAM_READY'
  | 'CONTRACT_EXPIRING'
  | 'VETERAN_DEPENDENCE'
  | 'OBJECTIVE_PROGRESS';

/** 案件から行ける画面。ここでは画面の名前を持つだけで、勝手に遷移はしない */
export type GmDeskLink = 'trade' | 'fa' | 'club' | 'roster' | 'players' | 'game' | 'news';

export interface GmDeskOption {
  id: string;
  /** 選択肢の名前（[主力を維持] のような短いもの） */
  label: string;
  /** その選択が何を意味するか。結果は断定しない */
  note: string;
  /** 実際に決められる画面 */
  link: GmDeskLink;
}

export interface GmDeskDatum {
  label: string;
  value: string;
}

export interface GmDeskItem {
  /** 同じ状況からは必ず同じID */
  id: string;
  kind: GmItemKind;
  /** 資料の欄名（英字） */
  en: string;
  /** 見出し（日本語） */
  ja: string;
  /** 一行で言うと何が起きているか */
  headline: string;
  /** CURRENT SITUATION — いま分かっている事実 */
  situation: string[];
  /** DATA — 数字 */
  data: GmDeskDatum[];
  /** SCOUT NOTE — 数字をどう読むか。指示ではない */
  scoutNote: string;
  /** SHORT TERM — 短期的に関係すること */
  shortTerm: string[];
  /** LONG TERM — 長期的に関係すること */
  longTerm: string[];
  /** OPTIONS — 決められる場所への導線 */
  options: GmDeskOption[];
  /** 関係する自球団の選手 */
  playerIds: string[];
  /** 並べ替えの重み。大きいほど上 */
  weight: number;
}

/** 机の上に置く枚数の上限（§2：最大3件程度） */
export const GM_DESK_LIMIT = 3;

/* ================= 小道具 ================= */

/** 自球団の選手だけを、IDの昇順で返す（並びを毎回同じにするため） */
function ownPlayers(state: GameState): Player[] {
  return state.players
    .filter((p) => p.teamId === state.playerTeamId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function isReliever(player: Player): boolean {
  return player.isPitcher && (player.pitching?.stamina ?? 0) < 55;
}

/** 直近 n 試合の自球団の勝敗（新しい順ではなく、古い順のまま数える） */
export function recentForm(
  state: GameState,
  games = 5,
): { wins: number; losses: number; draws: number; played: number } {
  const teamId = state.playerTeamId;
  const mine = state.results.filter(
    (r) => r.homeTeamId === teamId || r.awayTeamId === teamId,
  );
  const recent = mine.slice(-games);
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const result of recent) {
    if (!result.winnerTeamId) draws += 1;
    else if (result.winnerTeamId === teamId) wins += 1;
    else losses += 1;
  }
  return { wins, losses, draws, played: recent.length };
}

/** シーズンの進み具合 0〜1 */
export function seasonProgress(state: GameState): number {
  const record = state.records[state.playerTeamId];
  if (!record) return 0;
  return Math.min(1, record.games / Math.max(1, state.seasonLength));
}

/* ================= 案件の作成 ================= */

/**
 * 今日の判断材料をすべて洗い出す（上限をかける前）。
 * 上限は buildGmDesk がかける。
 */
export function collectGmDeskItems(state: GameState): GmDeskItem[] {
  const items: GmDeskItem[] = [];
  const teamId = state.playerTeamId;
  const players = ownPlayers(state);
  const push = (item: GmDeskItem | null) => {
    if (item) items.push(item);
  };

  push(managementEventItem(state));
  push(tradeOfferItem(state));
  push(faMarketItem(state));
  push(budgetItem(state, teamId));
  push(bullpenFatigueItem(state, players));
  push(rotationThinItem(state, teamId));
  push(starDeclineItem(state, players));
  push(recentFormItem(state));
  push(injuryReturnItem(state, players));
  push(youngRisingItem(state, players));
  push(secondTeamReadyItem(state, players));
  push(contractExpiringItem(state, players));
  push(veteranDependenceItem(state, teamId));
  push(objectiveItem(state, teamId));

  return items;
}

/**
 * 机の上に置く案件（最大 GM_DESK_LIMIT 件）。
 * 重みの大きい順。重みが同じときはIDの順で決める（毎回同じ並びにするため）。
 */
export function buildGmDesk(state: GameState, limit = GM_DESK_LIMIT): GmDeskItem[] {
  const sorted = collectGmDeskItems(state).sort((a, b) =>
    b.weight !== a.weight ? b.weight - a.weight : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return sorted.slice(0, Math.max(0, limit));
}

/* ---------------- 個々の案件 ---------------- */

function managementEventItem(state: GameState): GmDeskItem | null {
  const events = pendingEvents(state);
  if (events.length === 0) return null;
  const event = events[0];
  return {
    id: `event:${event.id}`,
    kind: 'MANAGEMENT_EVENT',
    en: 'PENDING DECISION',
    ja: '未決の案件',
    headline: event.title,
    situation: [event.body],
    data: [
      { label: '未決の案件', value: `${events.length}件` },
      { label: '受付日', value: formatDateJa(event.date) },
    ],
    scoutNote:
      '球団として返答を決める案件です。選択肢はどれも一長一短で、選ばなければ先に進みません。',
    shortTerm: ['選んだ内容は、その場でチームの空気（士気）に関わります'],
    longTerm: ['選び方の積み重ねが、球団の色として残ります'],
    options: [
      { id: 'club', label: '案件を読む', note: '球団経営の画面で内容と選択肢を確認します', link: 'club' },
    ],
    playerIds: event.playerId ? [event.playerId] : [],
    weight: 98,
  };
}

function tradeOfferItem(state: GameState): GmDeskItem | null {
  const offers = pendingOffersForPlayer(state);
  if (offers.length === 0) return null;
  const names = offers
    .flatMap((offer) => offer.requestedPlayerIds)
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n)
    .slice(0, 3);
  return {
    id: `trade:${offers.map((o) => o.id).sort().join(',')}`,
    kind: 'TRADE_OFFER',
    en: 'TRADE OFFER',
    ja: 'トレード提案',
    headline: `他球団から${offers.length}件のトレード提案が届いています`,
    situation: [
      names.length > 0
        ? `先方が求めているのは ${names.join('・')} です。`
        : '提案の中身は交渉画面で確認できます。',
      '期限を過ぎた提案は自動的に流れます。',
    ],
    data: [
      { label: '届いている提案', value: `${offers.length}件` },
      { label: 'トレード期限', value: formatDateJa(state.trade.deadline) },
    ],
    scoutNote:
      '提案の釣り合いは交渉画面で数値として出ます。出す選手と受け取る選手の年齢・契約・ポジションの重なりを見てください。',
    shortTerm: ['成立すればその日から1軍の顔ぶれが変わります'],
    longTerm: ['出した選手が伸びる可能性も、受け取った選手が伸びる可能性も残ります'],
    options: [
      { id: 'trade', label: '提案を見る', note: '内容と釣り合いを確認してから決められます', link: 'trade' },
      { id: 'players', label: '対象選手を調べる', note: '選手名鑑で状態と成績を確認します', link: 'players' },
    ],
    playerIds: offers.flatMap((o) => o.requestedPlayerIds).filter((id) =>
      state.players.some((p) => p.id === id && p.teamId === state.playerTeamId),
    ),
    weight: 94,
  };
}

function faMarketItem(state: GameState): GmDeskItem | null {
  const fa = state.fa;
  if (!fa) return null;
  const listed = fa.listings.filter((l) => l.status !== 'SIGNED').length;
  const mine = fa.offers.filter(
    (o) => o.teamId === state.playerTeamId && o.status === 'PENDING',
  ).length;
  return {
    id: `fa:${state.year}`,
    kind: 'FA_MARKET',
    en: 'FREE AGENCY',
    ja: 'FA市場',
    // PHASE 4.3 から使っている言い方をそのまま残す（ホームで一目で分かること）
    headline: `FA市場開催中（市場に残り${listed}人）`,
    situation: [
      '市場にいるのは他球団と契約が切れた選手です。提示は締め切りまで何度でも見直せます。',
    ],
    data: [
      { label: '市場に残る選手', value: `${listed}人` },
      { label: '提示中', value: `${mine}人` },
    ],
    scoutNote:
      '即戦力は手に入りますが、そのぶん年俸が固定されます。予算の残りと相談する場面です。',
    shortTerm: ['獲得できれば来季の1軍の層がすぐ厚くなります'],
    longTerm: ['長期契約は、数年後の予算をいまのうちに使うことでもあります'],
    options: [
      { id: 'fa', label: 'FA市場を見る', note: '市場の選手と提示額を確認します', link: 'fa' },
    ],
    playerIds: [],
    weight: 92,
  };
}

function budgetItem(state: GameState, teamId: string): GmDeskItem | null {
  const finance = state.finances[teamId];
  if (!finance) return null;
  const remaining = remainingBudget(state, teamId);
  if (remaining >= 0 && finance.cash >= 0) return null;
  const situation: string[] = [];
  if (remaining < 0) situation.push('総年俸が今季の予算を超えています。');
  if (finance.cash < 0) situation.push('球団資金がマイナスです。');
  return {
    id: `budget:${state.year}:${remaining < 0 ? 'over' : ''}${finance.cash < 0 ? 'cash' : ''}`,
    kind: 'BUDGET',
    en: 'CLUB FINANCE',
    ja: '球団財務',
    headline: remaining < 0 ? '総年俸が予算を超えています' : '球団資金がマイナスです',
    situation,
    data: [
      { label: '年間予算', value: formatMoney(finance.budget) },
      { label: '総年俸', value: formatMoney(finance.payroll) },
      { label: '球団資金', value: formatMoney(finance.cash) },
    ],
    scoutNote:
      '予算を超えたままでも試合は続きますが、補強の余力は無くなります。契約更改とFAで調整する場面です。',
    shortTerm: ['新しい契約を結ぶ余地が小さくなります'],
    longTerm: ['赤字が続くと、翌年以降の予算そのものが小さくなります'],
    options: [
      { id: 'club', label: '球団経営を見る', note: '施設投資と資金の使い道を確認します', link: 'club' },
      { id: 'players', label: '年俸を確認する', note: '選手ごとの契約を確認します', link: 'players' },
    ],
    playerIds: [],
    weight: 90,
  };
}

function bullpenFatigueItem(state: GameState, players: Player[]): GmDeskItem | null {
  const relievers = players.filter((p) => isReliever(p) && p.roster === 'first');
  const tired = relievers.filter((p) => p.ext.fatigue >= 62 && !p.ext.injury);
  if (tired.length < 3) return null;
  const worst = [...tired].sort((a, b) => b.ext.fatigue - a.ext.fatigue).slice(0, 3);
  const avgFatigue = Math.round(
    tired.reduce((sum, p) => sum + p.ext.fatigue, 0) / Math.max(1, tired.length),
  );
  const injured = relievers.filter((p) => p.ext.injury).length;
  return {
    id: `bullpen:${state.date}`,
    kind: 'BULLPEN_FATIGUE',
    en: 'BULLPEN',
    ja: '中継ぎ陣',
    headline: '中継ぎ陣に疲労が蓄積しています',
    situation: [
      `1軍のリリーフ${relievers.length}人のうち${tired.length}人の疲労が高い水準です。`,
      injured > 0 ? `${injured}人はすでに離脱しています。` : '離脱者はまだ出ていません。',
    ],
    data: [
      { label: '疲労の高いリリーフ', value: `${tired.length}人` },
      { label: '平均疲労', value: `${avgFatigue} / 100` },
      ...worst.map((p) => ({ label: p.name, value: `疲労 ${Math.round(p.ext.fatigue)}` })),
    ],
    scoutNote:
      '疲労はその日の実効能力を下げ、怪我の確率にも関わります。登板間隔を空けるか、2軍から入れ替えるかを選べる場面です。',
    shortTerm: ['疲れた投手をそのまま使うと、失点が増えやすくなります'],
    longTerm: ['連投を続けた選手は離脱のリスクが上がります'],
    options: [
      { id: 'roster', label: '編成を見直す', note: '1軍と2軍の入れ替えを検討します', link: 'roster' },
      { id: 'players', label: '疲労を確認する', note: '選手ごとの疲労と調子を確認します', link: 'players' },
    ],
    playerIds: worst.map((p) => p.id),
    weight: 80,
  };
}

function rotationThinItem(state: GameState, teamId: string): GmDeskItem | null {
  /*
   * 「先発が足りているか」は、能力の分類ではなく実際のローテーションで見る。
   * rosterAnalysis のスタミナ55という線引きは CPU の補強判断のためのもので、
   * 実際に先発する5人とは別物。ここで前者を使うと、5人そろっていても
   * 毎日「先発が足りません」と出てしまう。
   */
  const setup = state.setups[teamId];
  if (!setup) return null;
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const available = setup.rotation.filter((id) => {
    const player = byId.get(id);
    return !!player && player.teamId === teamId && player.roster === 'first' && !player.ext.injury;
  });
  if (setup.rotation.length >= 5 && available.length >= 5) return null;

  const analysis = analyzeTeamForDisplay(state, teamId);
  const missing = 5 - available.length;
  const injured = setup.rotation.filter((id) => byId.get(id)?.ext.injury).length;
  return {
    id: `rotation:${state.date}:${available.length}`,
    kind: 'ROTATION_THIN',
    en: 'STARTING PITCHING',
    ja: '先発陣',
    headline: `ローテーションが${missing}人足りていません`,
    situation: [
      `ローテーションは5人で回します。いま先発として出せるのは${available.length}人です。`,
      injured > 0
        ? `うち${injured}人は離脱中です。`
        : '空いた枠は中継ぎか2軍から補うことになります。',
    ],
    data: [
      { label: 'ローテーション登録', value: `${setup.rotation.length}人` },
      { label: 'うち出場可能', value: `${available.length}人` },
      {
        label: '投手力（リーグ平均差）',
        value: formatDelta(analysis.axes.find((a) => a.key === 'pitching')?.vsLeague ?? 0),
      },
    ],
    scoutNote:
      '先発が足りない状態は、中継ぎの負担に形を変えて出てきます。補強・若手の抜擢・現状維持のどれを取るかで、来季以降の姿が変わります。',
    shortTerm: ['先発の枠を埋める選手が必要になります'],
    longTerm: ['若手に回せば経験が積める一方、当面の失点は増えるかもしれません'],
    options: [
      { id: 'roster', label: 'ローテーションを組む', note: '先発の並びを確認します', link: 'roster' },
      { id: 'club', label: '球団分析を見る', note: 'ポジション別の層と補強の考え方を確認します', link: 'club' },
    ],
    playerIds: [],
    weight: 76,
  };
}

function starDeclineItem(state: GameState, players: Player[]): GmDeskItem | null {
  const candidates = players.filter(
    (p) => p.roster === 'first' && !p.ext.injury && overallRating(p) >= 56,
  );
  let target: { player: Player; recent: number } | null = null;
  for (const player of candidates) {
    const analysis = analyzePlayer(state, player);
    if (analysis.recentPerformance === null || analysis.recentPerformance >= 40) continue;
    if (!target || analysis.recentPerformance < target.recent) {
      target = { player, recent: analysis.recentPerformance };
    }
  }
  if (!target) return null;
  const { player } = target;
  const stats = state.stats?.[player.id];
  const line = player.isPitcher
    ? `${stats?.pitching.games ?? 0}登板 防御率 ${stats ? era(stats.pitching).toFixed(2) : '-'}`
    : `${stats?.batting.games ?? 0}試合 打率 ${stats ? average(stats.batting).toFixed(3).replace(/^0/, '') : '-'}`;
  const analysis = analyzePlayer(state, player);
  return {
    id: `decline:${player.id}`,
    kind: 'STAR_DECLINE',
    en: 'PLAYER FORM',
    ja: '主力の状態',
    headline: `${player.name}の成績が落ちています`,
    situation: [
      `現在能力は ${overallRating(player)} で保たれていますが、今季の成績が水準を下回っています。`,
      analysis.developmentTrend === 'DOWN'
        ? 'ここ数年の成績も下降しています。'
        : '過去の成績と比べて、今季だけが低い形です。',
    ],
    data: [
      { label: '今季', value: line },
      { label: '年齢', value: `${player.age}歳` },
      { label: '調子', value: `疲労 ${Math.round(player.ext.fatigue)} / 100` },
    ],
    scoutNote:
      '能力が落ちたのか、調子と疲労で落ちているのかは、この数字だけでは分けられません。休ませる・使い続ける・2軍で調整するのどれもありえます。',
    shortTerm: ['起用を続ければ、立て直す機会も低迷が続く可能性も両方あります'],
    longTerm: ['年齢的な下降であれば、後継を用意する時期にあたります'],
    options: [
      { id: 'players', label: '選手の資料を読む', note: 'スカウト報告と年度別成績を確認します', link: 'players' },
      { id: 'roster', label: '起用を見直す', note: '打順・ローテーション・登録を確認します', link: 'roster' },
    ],
    playerIds: [player.id],
    weight: 74,
  };
}

function recentFormItem(state: GameState): GmDeskItem | null {
  const form = recentForm(state, 5);
  if (form.played < 5) return null;
  const losing = form.losses >= 4;
  const winning = form.wins >= 4;
  if (!losing && !winning) return null;
  const rank = rankOfTeam(state, state.playerTeamId);
  const record = state.records[state.playerTeamId];
  return {
    id: `form:${state.date}:${losing ? 'down' : 'up'}`,
    kind: 'RECENT_FORM',
    en: 'TEAM FORM',
    ja: 'チームの流れ',
    headline: losing ? '直近5試合で4敗以上しています' : '直近5試合で4勝以上しています',
    situation: [
      `直近5試合は ${form.wins}勝${form.losses}敗${form.draws}分です。`,
      `今季は ${record.wins}勝${record.losses}敗${record.draws}分（${rank}位）です。`,
    ],
    data: [
      { label: '直近5試合', value: `${form.wins}勝${form.losses}敗${form.draws}分` },
      { label: '順位', value: `${rank}位` },
      { label: '得失点差', value: formatDelta(record.runsScored - record.runsAllowed) },
    ],
    scoutNote: losing
      ? '連敗そのものは戦力の問題とは限りません。疲労・調子・相手の並びも同じ数字に混ざって出ます。'
      : '流れが良いときほど、疲労は静かに溜まります。主力の連続出場日数を見ておく場面です。',
    shortTerm: [losing ? '打順や継投を組み替える選択肢があります' : '主力の休養を挟む選択肢があります'],
    longTerm: ['短い期間の勝敗は、シーズン全体では平均に戻っていく傾向があります'],
    options: [
      { id: 'roster', label: '編成を見る', note: '打順とローテーションを確認します', link: 'roster' },
      { id: 'game', label: '試合結果を見る', note: 'これまでの試合を振り返ります', link: 'game' },
    ],
    playerIds: [],
    weight: 72,
  };
}

function injuryReturnItem(state: GameState, players: Player[]): GmDeskItem | null {
  // 直近7日以内に「復帰」の連絡があった選手（球団報にある事実だけを使う）
  const recent = state.notices.filter(
    (n) => n.message.includes('復帰') && diffDays(n.date, state.date) <= 7 && n.date <= state.date,
  );
  if (recent.length === 0) return null;
  const returned = players.filter(
    (p) => !p.ext.injury && recent.some((n) => n.message.includes(p.name)),
  );
  if (returned.length === 0) return null;
  const target = returned[0];
  return {
    id: `return:${target.id}:${recent[recent.length - 1].date}`,
    kind: 'INJURY_RETURN',
    en: 'RETURN FROM INJURY',
    ja: '離脱からの復帰',
    headline: `${target.name}が離脱から戻っています`,
    situation: [
      `${returned.length > 1 ? `${returned.length}人が` : ''}出場できる状態になりました。`,
      target.roster === 'first'
        ? 'すでに1軍に登録されています。'
        : '現在は2軍に登録されています。',
    ],
    data: [
      { label: '登録', value: target.roster === 'first' ? '1軍' : '2軍' },
      { label: '現在能力', value: String(overallRating(target)) },
      { label: '疲労', value: `${Math.round(target.ext.fatigue)} / 100` },
    ],
    scoutNote:
      '復帰直後は試合勘と体力が戻りきっていないことがあります。すぐ1軍で使うか、2軍で数試合を挟むかを選べる場面です。',
    shortTerm: ['1軍に戻せば、その日から戦力に数えられます'],
    longTerm: ['戻し方によっては、再離脱の可能性が変わります'],
    options: [
      { id: 'roster', label: '登録を見直す', note: '1軍と2軍の入れ替えを検討します', link: 'roster' },
      { id: 'players', label: '状態を確認する', note: 'コンディションと疲労を確認します', link: 'players' },
    ],
    playerIds: returned.slice(0, 3).map((p) => p.id),
    weight: 70,
  };
}

function youngRisingItem(state: GameState, players: Player[]): GmDeskItem | null {
  const young = players.filter((p) => p.age <= 24 && !p.ext.injury);
  let best: { player: Player; score: number } | null = null;
  for (const player of young) {
    const analysis = analyzePlayer(state, player);
    const rising =
      analysis.developmentTrend === 'UP' ||
      (analysis.recentPerformance !== null && analysis.recentPerformance >= 58);
    if (!rising) continue;
    const score = (analysis.recentPerformance ?? 50) + analysis.stars.development * 4;
    if (!best || score > best.score) best = { player, score };
  }
  if (!best) return null;
  const player = best.player;
  const analysis = analyzePlayer(state, player);
  const stats = state.stats?.[player.id];
  return {
    id: `young:${player.id}`,
    kind: 'YOUNG_RISING',
    en: 'YOUNG PLAYER',
    ja: '若手の状況',
    headline: `${player.name}（${player.age}歳）が結果を出しています`,
    situation: [
      analysis.developmentTrend === 'UP'
        ? 'ここ数年の成績が上向いています。'
        : '今季の成績が水準を上回っています。',
      player.roster === 'first' ? '1軍に登録されています。' : '現在は2軍に登録されています。',
    ],
    data: [
      {
        label: '今季',
        value: player.isPitcher
          ? `${stats?.pitching.games ?? 0}登板 ${stats?.pitching.wins ?? 0}勝${stats?.pitching.losses ?? 0}敗`
          : `${stats?.batting.games ?? 0}試合 ${stats?.batting.hits ?? 0}安打${stats?.batting.homeRuns ?? 0}本`,
      },
      { label: '現在能力', value: String(overallRating(player)) },
      { label: '出場', value: `1軍 ${player.ext.firstTeamGames}試合` },
    ],
    scoutNote:
      '出場機会を増やせば経験は積めますが、そのぶん既存の選手の枠が減ります。どちらを取るかという形の判断です。',
    shortTerm: ['起用を増やせば、当面の勝敗は読みにくくなります'],
    longTerm: ['この年齢で1軍の出場を重ねた選手は、数年後の中心になる可能性があります'],
    options: [
      { id: 'players', label: '選手の資料を読む', note: 'スカウト報告と成長の傾向を確認します', link: 'players' },
      { id: 'roster', label: '起用を検討する', note: '打順・ローテーション・登録を確認します', link: 'roster' },
    ],
    playerIds: [player.id],
    weight: 66,
  };
}

function secondTeamReadyItem(state: GameState, players: Player[]): GmDeskItem | null {
  const second = players.filter((p) => p.roster === 'second' && !p.ext.injury);
  const first = players.filter((p) => p.roster === 'first' && !p.ext.injury);
  if (second.length === 0 || first.length === 0) return null;
  // 1軍の下位5人の平均より明らかに上の2軍選手
  const firstSorted = [...first].sort((a, b) => overallRating(a) - overallRating(b));
  const bottom = firstSorted.slice(0, 5);
  const bottomAvg =
    bottom.reduce((sum, p) => sum + overallRating(p), 0) / Math.max(1, bottom.length);
  const ready = second
    .filter((p) => overallRating(p) >= bottomAvg + 6)
    .sort((a, b) => overallRating(b) - overallRating(a));
  if (ready.length === 0) return null;
  const target = ready[0];
  return {
    id: `second:${state.year}:${target.id}`,
    kind: 'SECOND_TEAM_READY',
    en: 'SECOND TEAM',
    ja: '2軍の状況',
    headline: `${target.name}が2軍にいます`,
    situation: [
      `現在能力は ${overallRating(target)} で、1軍の下位の選手を上回っています。`,
      `同じ状態の選手が${ready.length}人います。`,
    ],
    data: [
      { label: '2軍で該当', value: `${ready.length}人` },
      { label: `${target.name}`, value: `総合 ${overallRating(target)}・${target.age}歳` },
      { label: '1軍下位5人の平均', value: String(Math.round(bottomAvg)) },
    ],
    scoutNote:
      '能力の数字だけで入れ替えが正しくなるわけではありません。守備位置の重なり、登録変更の7日制限、契約も同時に関わります。',
    shortTerm: ['入れ替えれば、当面の1軍の平均能力は上がります'],
    longTerm: ['外れた選手の出場機会は減り、そのぶん成長は鈍くなります'],
    options: [
      { id: 'roster', label: '編成を見る', note: '1軍と2軍の入れ替えを検討します', link: 'roster' },
      { id: 'players', label: '2軍を確認する', note: '2軍の選手を一覧で確認します', link: 'players' },
    ],
    playerIds: ready.slice(0, 3).map((p) => p.id),
    weight: 62,
  };
}

function contractExpiringItem(state: GameState, players: Player[]): GmDeskItem | null {
  const expiring = players.filter((p) => isExpiring(p));
  if (expiring.length === 0) return null;
  const core = [...expiring].sort((a, b) => overallRating(b) - overallRating(a)).slice(0, 3);
  const progress = seasonProgress(state);
  return {
    id: `contract:${state.year}:${expiring.length}`,
    kind: 'CONTRACT_EXPIRING',
    en: 'CONTRACT DESK',
    ja: '契約の状況',
    headline: `今季で契約が切れる選手が${expiring.length}人います`,
    situation: [
      'シーズンが終わると契約更改があり、そこで結論を出すことになります。',
      progress >= 0.6 ? 'シーズンは後半に入っています。' : 'シーズンはまだ途中です。',
    ],
    data: [
      { label: '契約満了', value: `${expiring.length}人` },
      ...core.map((p) => ({
        label: p.name,
        value: `${p.age}歳・総合 ${overallRating(p)}`,
      })),
    ],
    scoutNote:
      '更改では、いまの成績と年齢の両方が年俸に効きます。残す選手を決めるほど、他の補強に使える額は減ります。',
    shortTerm: ['シーズン中は何も起きません。判断はオフに行います'],
    longTerm: ['更改の積み重ねが、数年後の年俸総額の形を決めます'],
    options: [
      { id: 'players', label: '契約を確認する', note: '選手ごとの年俸と残り年数を確認します', link: 'players' },
      { id: 'club', label: '球団経営を見る', note: '予算と資金の余裕を確認します', link: 'club' },
    ],
    playerIds: core.map((p) => p.id),
    weight: 44,
  };
}

function veteranDependenceItem(state: GameState, teamId: string): GmDeskItem | null {
  const analysis = analyzeTeamForDisplay(state, teamId);
  const ratio = analysis.roster.veteranRatio;
  if (ratio < 0.34) return null;
  const youth = analysis.axes.find((a) => a.key === 'youth');
  return {
    id: `veteran:${state.year}:${Math.round(ratio * 100)}`,
    kind: 'VETERAN_DEPENDENCE',
    en: 'SQUAD AGE',
    ja: '編成の年齢',
    headline: `33歳以上が${Math.round(ratio * 100)}%を占めています`,
    situation: [
      `25歳以下の選手は${analysis.counts.young}人、31歳以上は${analysis.counts.veteran}人です。`,
    ],
    data: [
      { label: 'ベテラン比率', value: `${Math.round(ratio * 100)}%` },
      { label: '25歳以下', value: `${analysis.counts.young}人` },
      { label: '若手力（リーグ平均差）', value: formatDelta(youth?.vsLeague ?? 0) },
    ],
    scoutNote:
      '経験のある選手が多い編成は、いまの勝ちには向いています。同時に、数年後に一度に抜ける形にもなります。',
    shortTerm: ['当面の戦力には直接の影響はありません'],
    longTerm: ['同じ年代がまとめて引退期に入ると、入れ替えが一度に必要になります'],
    options: [
      { id: 'club', label: '球団分析を見る', note: 'ポジション別の層と年齢構成を確認します', link: 'club' },
      { id: 'players', label: '若手を確認する', note: '年齢で並べ替えて確認します', link: 'players' },
    ],
    playerIds: [],
    weight: 46,
  };
}

function objectiveItem(state: GameState, teamId: string): GmDeskItem | null {
  const club = state.clubs?.[teamId];
  if (!club || club.objectives.length === 0) return null;
  const progress = seasonProgress(state);
  if (progress < 0.5) return null;
  const record = state.records[teamId];
  const rank = rankOfTeam(state, teamId);
  return {
    id: `objective:${state.year}:${Math.round(progress * 10)}`,
    kind: 'OBJECTIVE_PROGRESS',
    en: 'CLUB OBJECTIVE',
    ja: '球団目標',
    headline: '今季の目標に対する現在地',
    situation: club.objectives.map((objective) => objectiveText(objective)),
    data: [
      { label: '消化', value: `${record.games} / ${state.seasonLength}試合` },
      { label: '現在', value: `${record.wins}勝${record.losses}敗${record.draws}分（${rank}位）` },
      { label: '球団の色', value: club.direction },
    ],
    scoutNote:
      '目標はシーズン終了時に判定されます。届きそうにない年に無理な補強をするかどうかも、ひとつの判断です。',
    shortTerm: ['残り試合の使い方（主力中心か、若手を試すか）が変わります'],
    longTerm: ['目標の達成は球団の評価として積み上がります'],
    options: [
      { id: 'club', label: '球団経営を見る', note: '目標と球団評価を確認します', link: 'club' },
    ],
    playerIds: [],
    weight: 42,
  };
}

/* ================= 表示の小道具 ================= */

/** プラスマイナスを必ず付ける（色だけで良し悪しを表さないため。§22） */
export function formatDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/** 自球団の選手かどうか（他球団を案件に載せないための確認に使う） */
export function isOwnPlayer(state: GameState, player: Player): boolean {
  return player.teamId === state.playerTeamId;
}
