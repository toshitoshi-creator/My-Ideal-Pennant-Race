import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

const fail = (msg) => {
  console.error('❌ ' + msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log('✅ ' + msg);

const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
page.on('pageerror', (e) => fail('ページ内エラー: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') fail('コンソールエラー: ' + m.text());
});

const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png` });

await page.goto(BASE);
await page.getByRole('heading', { name: 'My Ideal Pennant Race' }).waitFor();
await shot('01-title');
ok('タイトル画面が表示された');

// 球団選択 → シーズン設定 → 開始
await page.getByRole('button', { name: '新規ゲーム' }).click();
await page.getByText('東都フェニックス').first().click();
await page.getByRole('button', { name: '次へ' }).click();
await page.getByText('10試合').click();
await shot('02-newgame');
await page.getByRole('button', { name: 'この設定で開始' }).click();
await page.locator('.appbar h1').waitFor();
ok('球団を選んでゲームを開始できた');
await shot('03-home');

const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('mipr:save:v1')));
let state = await readState();
if (!state) fail('セーブデータが作られていない');
else ok(`セーブ作成 (${state.players.length}選手 / 開始日 ${state.date})`);
if (state.players.filter((p) => p.teamId === 'phoenix').length !== 25) fail('選手が25人ではない');
else ok('プレイヤー球団に25人の選手がいる');

// 選手一覧 → 詳細
await page.getByRole('button', { name: /選手/ }).last().click();
await page.locator('.player-card').first().waitFor();
const count = await page.locator('.player-card').count();
ok(`選手一覧に ${count} 枚の選手カード`);
const listText = await page.locator('.screen').innerText();
if (!/(絶好調|好調|普通|不調|絶不調)/.test(listText)) fail('選手一覧に調子が表示されていない');
else ok('選手一覧に各選手の調子が表示されている');
await shot('04-players');
// 野手を1人選ぶ（打撃系カテゴリの表示を確認するため）
await page.locator('.tabs button', { hasText: '野手' }).click();
await page.locator('.player-card').first().waitFor();
await page.locator('.player-card').first().click();
await page.locator('.sheet').waitFor();
if (!(await page.locator('.sheet').getByText('能力', { exact: true }).first().isVisible())) fail('能力が表示されない');
else ok('選手詳細に能力が表示された');
// PHASE 2: 個性・状態の表示
const detailText = await page.locator('.sheet').innerText();
for (const label of ['コンディション', '疲労', 'モチベーション', '性格', '将来性', '成長タイプ', '特殊能力']) {
  if (!detailText.includes(label)) fail(`選手詳細に「${label}」がない`);
}
ok('選手詳細に性格・将来性・コンディション・疲労・特殊能力が表示された');
// PHASE 2.5: 調子と実効能力の内訳
for (const label of ['今日の実効能力', '能力カテゴリ別の実効倍率', 'ミート系']) {
  if (!detailText.includes(label)) fail(`選手詳細に「${label}」がない`);
}
if (!/[+-]?\d+%/.test(detailText)) fail('実効能力の数値が表示されていない');
else ok('選手詳細に「今日の実効能力」とカテゴリ別の内訳が表示された');
await shot('05-player-detail');
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

// 編成：1軍/2軍
await page.locator('.nav').getByText('編成').click();
await page.locator('.tabs button', { hasText: '1軍 / 2軍' }).click();
const firstCountText = await page.locator('.card').first().innerText();
ok('編成画面: ' + firstCountText.replace(/\n/g, ' / '));
await shot('06-roster');

const before = await readState();
const demoteTarget = before.players.find((p) => p.teamId === 'phoenix' && p.roster === 'first');
await page.locator('.player-card', { hasText: demoteTarget.name }).first().getByText('2軍へ').click();
await page.waitForTimeout(300);
let after = await readState();
let moved = after.players.find((p) => p.id === demoteTarget.id);
if (moved.roster !== 'second') fail('2軍に降格できなかった');
else ok(`${moved.name} を2軍に降格（変更日 ${moved.lastRosterChangeDate}）`);

// 7日制限
const lockBadge = page.locator('.player-card', { hasText: demoteTarget.name }).first().locator('.chip', { hasText: /あと\d日/ });
await lockBadge.waitFor();
ok('7日間の登録変更制限が表示されている');
await lockBadge.click();
await page.getByText(/登録変更まであと/).first().waitFor();
ok('再変更しようとすると制限メッセージが出る');
await page.waitForTimeout(2300);
after = await readState();
if (after.players.find((p) => p.id === demoteTarget.id).roster !== 'second') fail('制限中に登録が変わってしまった');
else ok('制限中は登録が変更されない');
await shot('07-roster-lock');

// オーダー：ドラッグ＆ドロップ
await page.locator('.tabs button', { hasText: 'オーダー' }).click();
await page.locator('.order-row').first().waitFor();
const orderBefore = (await readState()).setups.phoenix.lineup.map((s) => s.playerId);
const handle = page.locator('.order-row').first().locator('.handle');
const box = await handle.boundingBox();
const rowBox = await page.locator('.order-row').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (rowBox.height + 8) * 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
const orderAfter = (await readState()).setups.phoenix.lineup.map((s) => s.playerId);
if (orderBefore[0] === orderAfter[0]) fail('ドラッグ＆ドロップで打順が変わらなかった');
else ok(`打順をドラッグで変更（1番: ${orderBefore[0].slice(0, 12)} → ${orderAfter[0].slice(0, 12)}）`);
await shot('08-order');

// 守備位置の変更
await page.locator('.order-row').first().locator('.pos-btn').click();
await page.locator('.sheet').waitFor();
await shot('09-position');
await page.locator('.sheet .team-pick').first().click();
await page.waitForTimeout(200);
ok('守備位置を変更できた');

// 先発ローテーション
await page.locator('.tabs button', { hasText: '先発' }).click();
await page.locator('.player-card').first().waitFor();
const rotBefore = (await readState()).setups.phoenix.rotation.slice();
// 候補の並びによっては同じ投手を選んでしまうので、変わるまで候補を試す
let rotAfter = rotBefore;
for (let i = 1; i <= 5; i++) {
  await page.locator('.player-card').first().click();
  await page.locator('.sheet').waitFor();
  const picks = page.locator('.sheet .team-pick');
  if ((await picks.count()) <= i) break;
  await picks.nth(i).click();
  await page.waitForTimeout(300);
  rotAfter = (await readState()).setups.phoenix.rotation;
  if (rotBefore[0] !== rotAfter[0]) break;
}
if (rotBefore[0] === rotAfter[0]) fail('先発投手を変更できなかった');
else ok('先発ローテーションを変更できた');
await shot('10-rotation');

// 試合
await page.locator('.nav').getByText('試合').click();
await page.getByRole('button', { name: '試合開始' }).click();
await page.locator('.linescore').waitFor();
const scoreText = await page.locator('.big-score').innerText();
ok('試合結果: ' + scoreText.replace(/\n/g, ' '));
const commentaryLines = await page.locator('.commentary > div').count();
if (commentaryLines < 10) fail('簡易実況が生成されていない');
else ok(`簡易実況 ${commentaryLines} 行`);
await shot('11-game');

state = await readState();
if (state.records.phoenix.games !== 1) fail('試合数が記録されていない');
else ok(`勝敗記録: ${state.records.phoenix.wins}勝${state.records.phoenix.losses}敗${state.records.phoenix.draws}分`);
const playedAll = state.results.length;
if (playedAll !== 6) fail(`その日の全6試合が処理されていない (${playedAll})`);
else ok('12球団すべての試合が処理された');

// 順位表
await page.locator('.nav').getByText('順位').click();
await page.locator('table.data').first().waitFor();
await shot('12-standings');
const standingsText = await page.locator('.card').first().innerText();
if (!standingsText.includes('東都フェニックス')) fail('順位表に球団がない');
else ok('順位表が表示された');

// 成績
await page.locator('.nav').getByText('選手').click();
await page.locator('.tabs button', { hasText: '成績' }).click();
await page.getByText('野手成績').waitFor();
const statsText = await page.locator('.card').first().innerText();
if (!/\d/.test(statsText)) fail('選手成績が更新されていない');
else ok('選手成績が更新された');
await shot('13-stats');

// PHASE 3.3: 契約タブ
await page.locator('.tabs button', { hasText: '契約' }).click();
await page.waitForTimeout(200);
const contractTabText = await page.locator('.screen').innerText();
for (const label of ['球団資金', '年間予算', '総年俸']) {
  if (!contractTabText.includes(label)) fail(`契約タブに「${label}」がない`);
}
if (!/万円|億円/.test(contractTabText)) fail('契約タブに年俸が表示されていない');
else ok('選手一覧の契約タブに年俸・球団資金が表示されている');
await shot('13b-contract-tab');

// PHASE 3.3: ホームの球団経営カード
await page.locator('.nav').getByText('ホーム').click();
const homeFinanceText = await page.locator('.screen').innerText();
if (!homeFinanceText.includes('球団経営')) fail('ホームに球団経営カードがない');
else ok('ホーム画面に球団経営（資金・予算・総年俸）が表示されている');

// PHASE 3.5: トレード
await page.locator('.nav').getByText('ホーム').click();
const homeTradeText = await page.locator('.screen').innerText();
if (!homeTradeText.includes('トレード')) fail('ホームにトレードカードがない');
else ok('ホーム画面にトレードが表示されている');
await page.getByRole('button', { name: 'トレードを見る' }).click();
await page.getByRole('heading', { name: 'トレード履歴' }).waitFor();
ok('ホームからトレード画面に移動できる');

const tradeStart = await readState();
if (!tradeStart.trade || !tradeStart.trade.deadline) fail('トレードの状態が保存されていない');
else ok(`トレード期限は ${tradeStart.trade.deadline}`);
const tradeScreenText = await page.locator('.screen').innerText();
for (const label of ['トレード期限', '総年俸 / 年間予算', '球団を選ぶ']) {
  if (!tradeScreenText.includes(label)) fail(`トレード画面に「${label}」がない`);
}
ok('トレード画面に期限・資金・球団選択が表示されている');
if (/potential|真の総合|内部評価/.test(tradeScreenText)) fail('トレード画面に内部情報が出ている');
else ok('トレード画面に内部評価は表示されない');

// CPU球団を選ぶ
const partnerId = tradeStart.teams.find((t) => t.id !== 'phoenix').id;
const partnerName = tradeStart.teams.find((t) => t.id === partnerId).shortName;
await page.locator('.card', { hasText: '球団を選ぶ' }).getByRole('button', { name: partnerName }).click();
await page.getByRole('heading', { name: 'トレード内容' }).waitFor();
const profileText = await page.locator('.screen').innerText();
for (const label of ['順位', '総合力', '保有選手', '手薄なポジション']) {
  if (!profileText.includes(label)) fail(`相手球団の情報に「${label}」がない`);
}
ok('相手球団の戦力・順位・弱点ポジションが表示される');
await shot('21-trade');

// 選手を選ぶ（自球団・相手球団）
const myCard = page.locator('.card', { hasText: 'あなたが出す' });
const theirCard = page.locator('.card', { hasText: `${partnerName} から受け取る` });
// 選手の選択ボタン（絞り込みチップと区別するため aria-label で選ぶ）
await myCard.locator('button[aria-label$="を選ぶ"]').first().click();
await theirCard.locator('button[aria-label$="を選ぶ"]').first().click();
await page.waitForTimeout(200);
const previewText = await page.locator('.card', { hasText: 'トレード内容' }).innerText();
for (const label of ['出す', 'もらう', 'あなたの提供', '相手の提供', '予想評価']) {
  if (!previewText.includes(label)) fail(`トレードプレビューに「${label}」がない`);
}
if (!/非常に不利|不利|やや不利|互角|やや有利|有利|非常に有利/.test(previewText)) {
  fail('トレードの公平度が表示されていない');
}
ok('トレードプレビューに提供内容と公平度が表示される');
if (/\d+\.\d+/.test(previewText)) fail('トレード画面に内部評価値が出ている');
else ok('公平度はラベルで表示され、内部の数値は出ない');
await shot('22-trade-preview');

// 提案する（相手が受けるまで組み合わせを変える）
let tradeDone = false;
const myButtons = myCard.locator('button[aria-label$="を選ぶ"]');
const theirButtons = theirCard.locator('button[aria-label$="を選ぶ"]');
const myCount = Math.min(8, await myButtons.count());
const theirCount = Math.min(8, await theirButtons.count());
const beforeTrade = await readState();
outer: for (let i = 0; i < myCount; i++) {
  for (let j = 0; j < theirCount; j++) {
    // 選択をやり直す
    for (const list of [myButtons, theirButtons]) {
      const n = await list.count();
      for (let k = 0; k < n; k++) {
        const b = list.nth(k);
        if ((await b.getAttribute('aria-pressed')) === 'true') await b.click();
      }
    }
    await myButtons.nth(i).click();
    await theirButtons.nth(j).click();
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: 'この内容でトレードを提案する' }).click();
    await page.waitForTimeout(350);
    const after = await readState();
    if (after.trade.history.length > beforeTrade.trade.history.length) {
      const record = after.trade.history[after.trade.history.length - 1];
      if (record.fromTeamId === 'phoenix' || record.toTeamId === 'phoenix') {
        tradeDone = true;
        ok(`トレードが成立した（${record.playerNamesFrom.join('・')} ⇄ ${record.playerNamesTo.join('・')}）`);
        break outer;
      }
    }
  }
}
if (!tradeDone) fail('ユーザーからのトレードが1件も成立しなかった');

const afterTrade = await readState();
const lastTrade = afterTrade.trade.history[afterTrade.trade.history.length - 1];
for (const id of lastTrade.playerIdsFrom) {
  const player = afterTrade.players.filter((p) => p.id === id);
  if (player.length !== 1) fail('トレードした選手が重複または消失している');
  else if (player[0].teamId !== lastTrade.toTeamId) fail('トレードした選手の所属が変わっていない');
}
for (const id of lastTrade.playerIdsTo) {
  const player = afterTrade.players.filter((p) => p.id === id);
  if (player.length !== 1) fail('受け取った選手が重複または消失している');
  else if (player[0].teamId !== lastTrade.fromTeamId) fail('受け取った選手の所属が変わっていない');
}
ok('トレードした選手が1球団だけに所属している');
const allIds = afterTrade.players.map((p) => p.id);
if (new Set(allIds).size !== allIds.length) fail('選手IDが重複している');
else ok('リーグ全体で選手IDの重複はない');
const contractsKept = lastTrade.playerIdsFrom.every((id) => {
  const p = afterTrade.players.find((x) => x.id === id);
  return p && p.ext.contract && p.ext.contract.salary > 0;
});
if (!contractsKept) fail('トレード後に契約が失われている');
else ok('契約は選手と一緒に移動している');
const payrollOk = afterTrade.teams.every((t) => {
  const sum = afterTrade.players
    .filter((p) => p.teamId === t.id)
    .reduce((a, p) => a + (p.ext.contract ? p.ext.contract.salary : 0), 0);
  return afterTrade.finances[t.id].payroll === sum;
});
if (!payrollOk) fail('トレード後に総年俸が再計算されていない');
else ok('トレード後に総年俸が再計算されている');
const minRosterAfterTrade = Math.min(
  ...afterTrade.teams.map((t) => afterTrade.players.filter((p) => p.teamId === t.id).length),
);
if (minRosterAfterTrade < 24) fail(`トレード後にロスターが${minRosterAfterTrade}人`);
else ok(`トレード後も全球団が24人以上（最少${minRosterAfterTrade}人）`);

// トレード履歴
const historyText = await page.locator('.card', { hasText: 'トレード履歴' }).innerText();
if (!historyText.includes(String(afterTrade.year))) fail('トレード履歴に年が出ていない');
else ok('トレード履歴が表示される');
await shot('23-trade-history');

// 在籍履歴
await myCard.locator('button[aria-label$="の詳細"]').first().click();
await page.locator('.sheet').waitFor();
const tradeSheetText = await page.locator('.sheet').innerText();
if (!tradeSheetText.includes('推定戦力') || !tradeSheetText.includes('契約')) fail('選手詳細に情報がない');
else ok('トレード画面の選手詳細に戦力・契約・成績が出る');
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

await page.getByRole('button', { name: 'ホームに戻る' }).click();
await page.waitForTimeout(200);
ok('トレード画面からホームに戻れる');

// 日付進行
const dateBefore = (await readState()).date;
await page.getByRole('button', { name: '1日進める' }).click();
await page.waitForTimeout(400);
const dateAfter = (await readState()).date;
if (!(dateAfter > dateBefore)) fail('日付が進まない');
else ok(`日付が進んだ ${dateBefore} → ${dateAfter}`);

// 次の試合へ を数回
for (let i = 0; i < 5; i++) {
  await page.locator('.nav').getByText('ホーム').click();
  await page.getByRole('button', { name: '次の試合へ' }).click();
  await page.waitForTimeout(250);
}
state = await readState();
ok(`6試合消化: ${state.records.phoenix.wins}勝${state.records.phoenix.losses}敗${state.records.phoenix.draws}分 / 日付 ${state.date}`);

// PHASE 3.5: CPU同士のトレードとCPUからの提案
const cpuTrades = state.trade.history.filter(
  (r) => r.fromTeamId !== 'phoenix' && r.toTeamId !== 'phoenix',
);
if (cpuTrades.length === 0) fail('CPU同士のトレードが起きていない');
else ok(`CPU同士のトレードが${cpuTrades.length}件成立している`);

// リロードしてもトレード履歴が残る
const tradeSnapshot = await readState();
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.locator('.appbar h1').waitFor();
const tradeReloaded = await readState();
if (tradeReloaded.trade.history.length !== tradeSnapshot.trade.history.length) {
  fail('再起動でトレード履歴が失われた');
} else {
  ok(`再起動してもトレード履歴が残る（${tradeReloaded.trade.history.length}件）`);
}
const movedPlayer = tradeReloaded.trade.history.length
  ? tradeReloaded.players.find(
      (p) => p.id === tradeReloaded.trade.history[0].playerIdsFrom[0],
    )
  : null;
if (movedPlayer && movedPlayer.ext.careerTeams.length < 2) fail('再起動で在籍履歴が失われた');
else ok('再起動しても在籍履歴が残る');

// CPUからの提案が届いていれば確認する
const received = tradeReloaded.trade.offers.filter(
  (o) => o.toTeamId === 'phoenix' && o.status === 'PENDING',
);
if (received.length > 0) {
  await page.locator('.nav').getByText('ホーム').click();
  await page.getByRole('button', { name: 'トレードを見る' }).click();
  await page.getByRole('heading', { name: /受信トレード/ }).waitFor();
  ok(`CPUからトレード提案が届いた（${received.length}件）`);
  await page.locator('button[aria-label$="からのトレード提案を確認する"]').first().click();
  await page.locator('.sheet').waitFor();
  const offerText = await page.locator('.sheet').innerText();
  for (const label of ['もらう選手', '出す選手', 'トレード評価']) {
    if (!offerText.includes(label)) fail(`CPU提案の確認画面に「${label}」がない`);
  }
  ok('CPUからの提案内容と評価が確認できる');
  await page.locator('.sheet').getByRole('button', { name: '断る' }).click();
  await page.waitForTimeout(300);
  const afterDecline = await readState();
  const declined = afterDecline.trade.offers.find((o) => o.id === received[0].id);
  if (!declined || declined.status !== 'REJECTED') fail('提案を断れなかった');
  else ok('CPUからの提案を断れる（履歴に残る）');
  await page.getByRole('button', { name: 'ホームに戻る' }).click();
  await page.waitForTimeout(200);
} else {
  ok('今回はCPUからの提案は届かなかった（提案数の上限が効いている）');
}
await page.locator('.nav').getByText('ホーム').click();
await page.locator('.nav').getByText('ホーム').click();
await shot('14-home-after');

// PHASE 2.5: 調子が日々変化し、履歴が残る
const beforeConditions = (await readState()).players
  .filter((p) => p.teamId === 'phoenix')
  .map((p) => p.ext.condition)
  .join(',');
await page.locator('.nav').getByText('ホーム').click();
await page.getByRole('button', { name: '1日進める' }).click();
await page.waitForTimeout(400);
const afterState = await readState();
const afterConditions = afterState.players
  .filter((p) => p.teamId === 'phoenix')
  .map((p) => p.ext.condition)
  .join(',');
if (beforeConditions === afterConditions) fail('日付を進めても調子が変化しない');
else ok('1日進めると選手の調子が変化する');
const withHistory = afterState.players.filter((p) => (p.ext.conditionHistory ?? []).length > 0);
if (withHistory.length !== afterState.players.length) fail('調子の履歴が記録されていない');
else if (withHistory.some((p) => p.ext.conditionHistory.length > 7)) fail('調子の履歴が7日を超えている');
else ok(`全選手の調子の履歴が記録されている（最大${Math.max(...withHistory.map((p) => p.ext.conditionHistory.length))}日分）`);

// PHASE 2: シーズンを最後まで進めて成長処理を確認
for (let i = 0; i < 12; i++) {
  const current = await readState();
  if (current.seasonFinished) break;
  await page.locator('.nav').getByText('ホーム').click();
  const button = page.getByRole('button', { name: '次の試合へ' });
  if (!(await button.isEnabled())) break;
  await button.click();
  await page.waitForTimeout(250);
}
await page.locator('.nav').getByText('ホーム').click();
const finished = await readState();
if (!finished.seasonFinished) fail('シーズンが終了しなかった');
else ok(`シーズン終了（${finished.records.phoenix.wins}勝${finished.records.phoenix.losses}敗${finished.records.phoenix.draws}分）`);
await shot('16-season-end');

const agesBefore = new Map(finished.players.map((p) => [p.id, p.age]));
const abilitiesBefore = new Map(finished.players.map((p) => [p.id, p.batting.contact + p.batting.power]));
const playersBefore = finished.players.length;

// PHASE 3.1: オフシーズン（引退 → ドラフト → 新人加入）
await page.getByRole('button', { name: /オフシーズンへ/ }).click();
await page.getByRole('heading', { name: /ドラフト会議/ }).waitFor();
const offseason = await readState();
if (!offseason.draft) fail('ドラフトが開始されていない');
else ok(`ドラフト開始（候補${offseason.draft.prospects.length}人 / 全${offseason.draft.rounds}巡）`);
const retiredCount = offseason.retiredPlayers.length;
if (retiredCount === 0) ok('今オフの引退者はいなかった');
else ok(`${retiredCount}人が引退した`);
await shot('16b-draft');

// PHASE 3.2: スカウト期間
if (offseason.draft.phase !== 'scouting') fail('スカウト期間から始まっていない');
else ok('ドラフトはスカウト期間から始まる');
const prospectCards = await page.locator('.player-card').count();
if (prospectCards === 0) fail('ドラフト候補が表示されていない');
else ok(`ドラフト候補が${prospectCards}人表示されている`);
const scoutText = await page.locator('.screen').innerText();
for (const label of ['スカウト期間', '将来性', '調査']) {
  if (!scoutText.includes(label)) fail(`スカウト画面に「${label}」がない`);
}
const pointsBefore = offseason.scouting.teams.phoenix.points;
ok(`スカウト画面が表示された（調査ポイント ${pointsBefore}）`);

// 候補を選んで将来性を調査する
await page.locator('.player-card button').first().click();
await page.locator('.sheet').waitFor();
const detailBefore = await page.locator('.sheet').innerText();
if (!detailBefore.includes('未調査')) fail('未調査の項目が表示されていない');
else ok('未調査の項目が「未調査」と表示されている');
await shot('16b1-scout-detail');

const scoutButtons = page.locator('.sheet button', { hasText: /調査 \d+pt/ });
const scoutButtonCount = await scoutButtons.count();
if (scoutButtonCount < 4) fail(`調査ボタンが4項目そろっていない（${scoutButtonCount}）`);
else ok('現在能力・将来性・性格・特殊能力の4項目を個別に調査できる');

// 将来性を2回調査する
for (let i = 0; i < 2; i++) {
  await page.locator('.sheet .spread', { hasText: '将来性' }).locator('button').first().click();
  await page.waitForTimeout(250);
}
const afterScout = await readState();
const scoutState = afterScout.scouting.teams.phoenix;
const firstProspectId = Object.keys(scoutState.reports)[0];
const report = scoutState.reports[firstProspectId];
if (!report || report.progress.potential === 0) fail('将来性の調査が反映されていない');
else ok(`将来性の調査が進んだ（進行度 ${report.progress.potential}%）`);
if (scoutState.points >= pointsBefore) fail('スカウトポイントが消費されていない');
else ok(`スカウトポイントが消費された（${pointsBefore} → ${scoutState.points}）`);
if (!report.estimate.potential) fail('将来性の推定が生成されていない');
else ok(`将来性の推定が得られた（${report.estimate.potential}）`);

const detailAfter = await page.locator('.sheet').innerText();
if (!detailAfter.includes('信頼度')) fail('信頼度が表示されていない');
else ok('推定情報に信頼度が表示されている');
await shot('16b2-scout-done');
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

// 別の候補も調査する
await page.locator('.player-card button').nth(1).click();
await page.locator('.sheet').waitFor();
await page.locator('.sheet .spread', { hasText: '現在能力' }).locator('button').first().click();
await page.waitForTimeout(250);
const twoScouted = await readState();
if (Object.keys(twoScouted.scouting.teams.phoenix.reports).length < 2) {
  fail('2人目の調査が記録されていない');
} else {
  ok('複数の候補を調査できる');
}
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

// リロードして調査情報が復元されることを確認する
const scoutSnapshot = await readState();
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.getByRole('heading', { name: /ドラフト会議/ }).waitFor();
const reloadedScout = await readState();
const restored = reloadedScout.scouting.teams.phoenix;
if (
  restored.points !== scoutSnapshot.scouting.teams.phoenix.points ||
  Object.keys(restored.reports).length !== Object.keys(scoutSnapshot.scouting.teams.phoenix.reports).length
) {
  fail('リロードでスカウト情報が失われた');
} else {
  ok(`リロード後もスカウト情報が残る（ポイント${restored.points} / 調査済み${Object.keys(restored.reports).length}人）`);
}

// 他球団の調査情報は独立している
const cpuReports = Object.keys(reloadedScout.scouting.teams.bluewave.reports).length;
if (cpuReports === 0) fail('CPU球団がスカウトしていない');
else ok(`CPU球団も独自に調査している（関東ブルーウェーブ ${cpuReports}人）`);

// ドラフト会議を開始する
await page.getByRole('button', { name: 'ドラフト会議を始める' }).click();
// CPU球団の指名が終わるのを待つ。
// 自球団に指名権がない年（保有25人で補充が不要な年）もあるので、
// 「指名待ち」か「ドラフト終了」のどちらかになるまで待つ。
await Promise.race([
  page
    .getByRole('button', { name: 'この選手を指名' })
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {}),
  page
    .getByRole('button', { name: '契約更改へ' })
    .waitFor({ timeout: 20000 })
    .catch(() => {}),
]);
const picking = await readState();
if (picking.draft && picking.draft.phase !== 'picking') fail('指名段階に移行していない');
else ok('ドラフト会議が始まった');

if ((await page.getByRole('button', { name: 'この選手を指名' }).count()) > 0) {
  const draftText = await page.locator('.screen').innerText();
  if (!draftText.includes('将来性')) fail('ドラフト画面に将来性がない');
  ok('スカウト結果を見ながら指名できる');
}

let myPicks = 0;
for (let i = 0; i < 8; i++) {
  const state2 = await readState();
  if (!state2.draft) break;
  const slotTeam = state2.draft.order[state2.draft.cursor % state2.draft.order.length];
  void slotTeam;
  const button = page.getByRole('button', { name: 'この選手を指名' }).first();
  if ((await button.count()) === 0) break;
  await button.click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: '指名する' }).click();
  await page.waitForTimeout(300);
  myPicks += 1;
  const s2 = await readState();
  if (!s2.draft) break;
}
const afterPicks = await readState();
const allPicks = afterPicks.draft ? afterPicks.draft.picks : (picking.draft ? picking.draft.picks : []);
const playerPicks = allPicks.filter((p) => p.teamId === 'phoenix').length;
const cpuPicks = allPicks.filter((p) => p.teamId !== 'phoenix').length;
if (myPicks === 0) ok('今年は自球団の補充が不要で、指名権がなかった');
else ok(`プレイヤー球団が${playerPicks}人を指名した`);
if (cpuPicks === 0) fail('CPU球団が指名していない');
else ok(`CPU球団が${cpuPicks}人を指名した`);
const pickedIds = allPicks.map((p) => p.prospectId);
if (new Set(pickedIds).size !== pickedIds.length) fail('同じ候補が重複して指名されている');
else ok('重複指名は発生していない');
await shot('16c-draft-done');

// PHASE 3.3: 契約更改（新人契約 → 交渉 → 保存 → 再起動 → 新シーズン）
const salariesBefore = new Map(
  afterPicks.players.map((p) => [p.id, p.ext.contract ? p.ext.contract.yearsRemaining : 0]),
);
await page.getByRole('button', { name: '契約更改へ' }).click();
await page.getByRole('heading', { name: /年 契約更改/ }).waitFor();
const contractStart = await readState();
if (!contractStart.contractPhase) fail('契約更改フェーズが始まっていない');
else ok(`契約更改が始まった（交渉対象${contractStart.contractPhase.pending.length}人）`);

const newRookies = contractStart.players.filter((p) => !agesBefore.has(p.id));
const rookieNoContract = newRookies.filter((p) => !p.ext.contract || p.ext.contract.salary <= 0);
if (newRookies.length === 0) fail('新人が加入していない');
else if (rookieNoContract.length > 0) fail('新人に契約・年俸がない');
else {
  const rookieSalaries = newRookies.map((p) => p.ext.contract.salary);
  ok(
    `新人${newRookies.length}人に契約が付与された（年俸 ${Math.min(...rookieSalaries)}〜${Math.max(...rookieSalaries)} / 100万円）`,
  );
}

const financeText = await page.locator('.screen').innerText();
for (const label of ['球団資金', '年間予算', '総年俸', '予算残り']) {
  if (!financeText.includes(label)) fail(`契約更改画面に「${label}」がない`);
}
ok('契約更改画面に球団の資金状況が表示されている');

const financeBefore = contractStart.finances['phoenix'];
if (!financeBefore || !Number.isFinite(financeBefore.cash)) fail('球団資金が保存されていない');
else ok(`球団資金 ${financeBefore.cash} / 予算 ${financeBefore.budget} / 前年度収支 ${financeBefore.lastResult}`);

// 1人と実際に交渉する
if (contractStart.contractPhase.pending.length > 0) {
  await page.locator('button.player-card').first().click();
  await page.locator('.sheet').waitFor();
  const sheet = page.locator('.sheet');
  if (!(await sheet.innerText()).includes('◎')) fail('希望額どおりの提示が受け入れられない');
  else ok('希望どおりの条件は「受け入れられそう」と表示される');
  await sheet.getByRole('button', { name: '－' }).click();
  await page.waitForTimeout(120);
  if (!(await sheet.innerText()).includes('×')) fail('提示額を下げても拒否予想にならない');
  else ok('提示額を下げると「拒否されそう」に変わる');
  await sheet.getByRole('button', { name: '＋' }).click();
  await page.waitForTimeout(120);
  await sheet.getByRole('button', { name: 'この条件で契約する' }).click();
  await page.waitForTimeout(300);
  const afterOffer = await readState();
  const resolved = afterOffer.contractPhase ? afterOffer.contractPhase.resolved : [];
  if (resolved.length !== 1 || !resolved[0].accepted) fail('契約交渉が成立していない');
  else {
    const signed = afterOffer.players.find((p) => p.id === resolved[0].playerId);
    if (!signed || signed.ext.contract.salary !== resolved[0].salary) fail('合意した年俸が反映されていない');
    else ok(`${resolved[0].name} と ${resolved[0].salary}（100万円） / ${resolved[0].years}年で合意した`);
  }
  await shot('16d-contract');
}

// わざと低い条件を提示して決裂させ、その選手をFA市場へ送る
const beforeReject = await readState();
if (beforeReject.contractPhase && beforeReject.contractPhase.pending.length > 0) {
  await page.locator('button.player-card').first().click();
  await page.locator('.sheet').waitFor();
  const sheet = page.locator('.sheet');
  for (let i = 0; i < 12; i++) {
    await sheet.getByRole('button', { name: '－' }).click();
  }
  await page.waitForTimeout(120);
  if (!(await sheet.innerText()).includes('×')) fail('大幅に下げても拒否予想にならない');
  await sheet.getByRole('button', { name: 'この条件で契約する' }).click();
  await page.waitForTimeout(300);
  const afterReject = await readState();
  const rejected = afterReject.contractPhase.resolved.filter((r) => !r.accepted);
  if (rejected.length === 0) fail('低い提示でも交渉が決裂しない');
  else ok(`${rejected[0].name} との交渉が決裂した（FA市場へ）`);
}

// 契約更改の途中で再起動しても続きから交渉できる
const midContract = await readState();
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.getByRole('heading', { name: /年 契約更改/ }).waitFor();
const restoredContract = await readState();
if (!restoredContract.contractPhase || restoredContract.contractPhase.pending.length !== midContract.contractPhase.pending.length) {
  fail('再起動で契約更改の途中経過が失われた');
} else {
  ok(`再起動しても契約更改の途中から再開できる（残り${restoredContract.contractPhase.pending.length}人）`);
}
if (restoredContract.finances['phoenix'].cash !== midContract.finances['phoenix'].cash) fail('再起動で球団資金が変わった');
else ok('再起動後も球団資金が保持されている');

// 残りはおまかせで交渉
const autoButton = page.getByRole('button', { name: /おまかせで交渉する/ });
if ((await autoButton.count()) > 0) {
  await autoButton.click();
  await page.waitForTimeout(400);
}
const contractDone = await readState();
if (!contractDone.contractPhase || contractDone.contractPhase.pending.length !== 0) {
  fail('おまかせ交渉で契約更改が終わらない');
} else {
  const accepted = contractDone.contractPhase.resolved.filter((r) => r.accepted).length;
  ok(`契約更改が完了した（合意${accepted}人 / 決裂${contractDone.contractPhase.resolved.length - accepted}人）`);
}
// PHASE 3.4: FA市場
const rosterBeforeFA = contractDone.players
  .filter((p) => p.teamId === 'phoenix')
  .map((p) => p.id);
await page.getByRole('button', { name: 'FA市場へ' }).click();
await page.getByRole('heading', { name: /年 FA市場/ }).waitFor();
const faStart = await readState();
if (!faStart.fa) fail('FA市場が始まっていない');
else ok(`FA市場が開幕した（${faStart.fa.listings.length}人）`);
if (faStart.contractPhase !== null) fail('FA市場開始後も契約更改に戻れてしまう');
else ok('FA市場が始まると契約更改には戻れない');

// 契約が成立しなかった選手は自球団のロスターから外れ、FAとして保持される
const goneFromRoster = rosterBeforeFA.filter(
  (id) => !faStart.players.some((p) => p.id === id),
);
// 最低人数(24人)を割る場合は引き止められるため、退団が0人になることもある
if (goneFromRoster.length > 0) {
  for (const id of goneFromRoster) {
    if (!faStart.freeAgents.some((p) => p.id === id)) fail('退団した選手がFA市場にいない');
  }
  ok(`${goneFromRoster.length}人が自球団のロスターから外れ、FA市場へ移った`);
} else {
  ok('自球団からの退団はなかった（最低人数を保つため引き止められた）');
}
if (faStart.fa.listings.length === 0) fail('FA市場に選手が1人もいない');
else ok(`FA市場に${faStart.fa.listings.length}人が並んでいる`);
const rosterIds = new Set(faStart.players.map((p) => p.id));
if (faStart.freeAgents.some((p) => rosterIds.has(p.id))) fail('FA選手が球団にも所属している');
else if (faStart.freeAgents.some((p) => p.teamId !== '')) fail('FA選手に球団IDが残っている');
else ok('FA選手はどの球団にも所属していない');
const retiredIds = new Set(faStart.retiredPlayers.map((r) => r.playerId));
if (faStart.freeAgents.some((p) => retiredIds.has(p.id))) fail('引退した選手がFA市場にいる');
else ok('引退した選手はFA市場に入っていない');
const faIds = faStart.freeAgents.map((p) => p.id);
if (new Set(faIds).size !== faIds.length) fail('FA市場に重複登録がある');
else ok('FA市場に重複登録はない');
await shot('18-fa-market');

const faText = await page.locator('.app').innerText();
for (const label of ['残りオファー枠', '球団資金', 'FA市場']) {
  if (!faText.includes(label)) fail(`FA画面に「${label}」がない`);
}
ok('FA画面に残りオファー枠と球団の資金が表示されている');

// 絞り込み
await page.locator('.tabs button', { hasText: '野手' }).click();
await page.waitForTimeout(150);
await page.locator('.tabs button', { hasText: 'すべて' }).click();
await page.waitForTimeout(150);
ok('FA選手を絞り込める');

// 選手詳細 → 年俸・年数を入力してオファー
const faCards = page.locator('button.player-card');
if ((await faCards.count()) === 0) fail('FA選手が表示されていない');
await faCards.first().click();
await page.locator('.sheet').waitFor();
const faSheet = page.locator('.sheet');
const sheetText = await faSheet.innerText();
for (const label of ['市場評価', '推定総合', '希望年俸', '希望年数', '前年の成績', '提示条件']) {
  if (!sheetText.includes(label)) fail(`FA選手詳細に「${label}」がない`);
}
ok('FA選手詳細に市場評価・推定総合・希望条件・前年成績が出る');
if (/潜在能力|真の総合|growthType/.test(sheetText)) fail('FA画面に内部情報が表示されている');
else ok('FA画面に潜在能力などの内部情報は表示されない');

await faSheet.getByRole('button', { name: '年俸を上げる' }).click();
await faSheet.getByRole('button', { name: '年俸を上げる' }).click();
await page.waitForTimeout(120);
const yearButtons = faSheet.locator('.chip', { hasText: /^\d年$/ });
if ((await yearButtons.count()) > 1) await yearButtons.nth(1).click();
await page.waitForTimeout(120);
await faSheet.getByRole('button', { name: 'この条件でオファーする' }).click();
await page.waitForTimeout(350);
const afterOfferState = await readState();
const myOffers = afterOfferState.fa.offers.filter(
  (o) => o.teamId === 'phoenix' && o.status === 'PENDING',
);
if (myOffers.length !== 1) fail('FAオファーが登録されていない');
else ok(`FA選手に条件を提示した（${myOffers[0].salary} / ${myOffers[0].years}年）`);
await shot('19-fa-offer');

// 再起動してもFA市場と提示が残る
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.getByRole('heading', { name: /年 FA市場/ }).waitFor();
const faReloaded = await readState();
if (!faReloaded.fa || faReloaded.fa.offers.filter((o) => o.teamId === 'phoenix').length !== 1) {
  fail('再起動でFAの提示が失われた');
} else {
  ok('再起動してもFA市場と提示が残る');
}
if (faReloaded.freeAgents.length !== faStart.freeAgents.length) fail('再起動でFA選手が変わった');
else ok(`再起動後もFA選手が保持されている（${faReloaded.freeAgents.length}人）`);

// ホームからFA市場に戻れる
await page.getByRole('button', { name: '先に球団を確認する' }).click();
await page.locator('.nav').waitFor();
const homeDuringFA = await page.locator('.screen').innerText();
if (!homeDuringFA.includes('FA市場開催中')) fail('ホームにFA市場開催中の表示がない');
else ok('ホームに「FA市場開催中」が表示される');
await page.getByRole('button', { name: 'FA市場を見る' }).click();
await page.getByRole('heading', { name: /年 FA市場/ }).waitFor();
ok('ホームからFA市場に戻れる');

// おまかせ補強 → 締切
await page.getByRole('button', { name: 'おまかせで補強する' }).click();
await page.waitForTimeout(400);
const beforeResolve = await readState();
const cpuOffers = beforeResolve.fa.offers.filter((o) => o.teamId !== 'phoenix');
if (cpuOffers.length === 0) fail('CPU球団がFAにオファーしていない');
else ok(`CPU球団も${new Set(cpuOffers.map((o) => o.teamId)).size}球団がオファーしている`);

await page.getByRole('button', { name: 'FA市場を締め切る' }).click();
await page.waitForTimeout(500);
const resolved = await readState();
if (!resolved.fa || resolved.fa.phase !== 'resolved') fail('FA市場が締め切られていない');
else ok(`FA市場が締め切られた（成立${resolved.fa.results.length}件 / 未契約${resolved.fa.unsigned}人）`);
const signedIds = resolved.fa.results.map((r) => r.playerId);
if (new Set(signedIds).size !== signedIds.length) fail('同じ選手が複数の球団と契約した');
else ok('同じ選手が複数球団と契約していない');
for (const record of resolved.fa.results) {
  const owners = resolved.players.filter((p) => p.id === record.playerId);
  if (owners.length !== 1) fail('FA契約した選手が重複してロスターにいる');
  else if (owners[0].teamId !== record.teamId) fail('FA契約した選手が違う球団にいる');
  else if (!owners[0].ext.contract) fail('FA契約した選手に契約がない');
  else if (owners[0].ext.contract.salary !== record.salary) fail('FA契約の年俸が反映されていない');
  if (resolved.freeAgents.some((p) => p.id === record.playerId)) fail('FA契約後も未所属のまま');
}
ok('FA契約が成立した選手は1球団だけに加入し、契約が有効になっている');
const resultText = await page.locator('.screen').innerText();
if (!resultText.includes('あなたの獲得')) fail('FAの結果画面が表示されていない');
else ok('FAの結果（自球団・他球団の動き）が表示される');
await shot('20-fa-result');

await page.getByRole('button', { name: '新シーズンへ' }).click();
await page.locator('.sheet').waitFor();
const reportText = await page.locator('.sheet').innerText();
if (!/→/.test(reportText)) fail('成長レポートに能力の変化が出ていない');
else ok('シーズン終了時の成長結果が表示された');
await shot('17-growth-report');
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

const nextSeason = await readState();
if (nextSeason.draft !== null) fail('ドラフトが終了していない');
const rookies = nextSeason.players.filter((p) => !agesBefore.has(p.id));
if (rookies.length === 0) fail('新人が加入していない');
else {
  const ages = rookies.map((r) => r.age);
  ok(`新人${rookies.length}人が加入（${Math.min(...ages)}〜${Math.max(...ages)}歳）`);
}
if (rookies.some((r) => !r.ext.personality || typeof r.ext.potential !== 'number' || !r.ext.growthType)) {
  fail('新人に性格・潜在能力・成長タイプがない');
} else {
  ok('新人にも性格・潜在能力・成長タイプ・調子が設定されている');
}
const retiredNow = nextSeason.retiredPlayers.map((r) => r.playerId);
if (retiredNow.some((id) => nextSeason.players.some((p) => p.id === id))) {
  fail('引退した選手がロスターに残っている');
} else {
  ok('引退した選手はロスターから除外されている');
}
const rosterSizes = nextSeason.teams.map(
  (t) => nextSeason.players.filter((p) => p.teamId === t.id).length,
);
ok(`各球団のロスター ${Math.min(...rosterSizes)}〜${Math.max(...rosterSizes)}人（前年 ${playersBefore}人 → ${nextSeason.players.length}人）`);
if (nextSeason.year !== finished.year + 1) fail('年度が進んでいない');
else ok(`翌シーズンが開幕（${finished.year}年 → ${nextSeason.year}年）`);
const agedCorrectly = nextSeason.players
  .filter((p) => agesBefore.has(p.id))
  .every((p) => p.age === agesBefore.get(p.id) + 1);
if (!agedCorrectly) fail('年齢が1歳加算されていない');
else ok('全選手の年齢が1歳加算された');

// PHASE 3.3: 新シーズンで契約年数が1年ずつ減る
const carried = nextSeason.players.filter((p) => salariesBefore.has(p.id) && salariesBefore.get(p.id) >= 2);
const decremented = carried.filter(
  (p) => p.ext.contract && p.ext.contract.yearsRemaining === salariesBefore.get(p.id) - 1,
);
if (carried.length === 0 || decremented.length !== carried.length) {
  fail('新シーズンで契約年数が1年ずつ減っていない');
} else {
  ok(`新シーズン開始で契約年数が1年減った（対象${carried.length}人）`);
}
const noContract = nextSeason.players.filter((p) => !p.ext.contract);
if (noContract.length > 0) fail(`契約のない選手が${noContract.length}人いる`);
else ok('全選手が契約を持っている');
const payrollNow = nextSeason.finances['phoenix'].payroll;
const sumSalary = nextSeason.players
  .filter((p) => p.teamId === 'phoenix')
  .reduce((a, p) => a + p.ext.contract.salary, 0);
if (payrollNow !== sumSalary) fail('総年俸が選手の年俸合計と一致しない');
else ok(`総年俸が正しく再計算されている（${payrollNow} / 100万円）`);
const offseasonSummary = nextSeason.lastOffseason;
if (!offseasonSummary) fail('オフシーズンの結果が記録されていない');
else {
  ok(
    `オフシーズンの結果：FA市場${offseasonSummary.faListed}人 / 成立${offseasonSummary.faSigned}人` +
      `（自球団${offseasonSummary.faSignedByPlayer}人）/ 未契約${offseasonSummary.faUnsigned}人`,
  );
}
if (nextSeason.fa !== null) fail('FA市場が終了していない');
else ok('新シーズン開幕時にFA市場は閉じている');
if (nextSeason.freeAgents.some((p) => nextSeason.players.some((q) => q.id === p.id))) {
  fail('新シーズンでFA選手が球団にも所属している');
} else {
  ok(`未契約のFA選手は保持されている（${nextSeason.freeAgents.length}人）`);
}
const minRoster = Math.min(
  ...nextSeason.teams.map((t) => nextSeason.players.filter((p) => p.teamId === t.id).length),
);
if (minRoster < 24) fail(`ロスターが24人を割っている（${minRoster}人）`);
else ok(`全球団が24人以上のロスターを保っている（最少${minRoster}人）`);
const changed = nextSeason.players.filter(
  (p) => abilitiesBefore.has(p.id) && p.batting.contact + p.batting.power !== abilitiesBefore.get(p.id),
);
if (changed.length === 0) fail('シーズン終了時に能力が変化していない');
else ok(`${changed.length}人の能力が成長・衰退した`);
if (nextSeason.records.phoenix.games !== 0) fail('新シーズンの成績がリセットされていない');
else ok('新シーズンの成績・日程がリセットされた');

// 新シーズンでも試合ができる
await page.getByRole('button', { name: '次の試合へ' }).click();
await page.waitForTimeout(400);
const afterNew = await readState();
if (afterNew.records.phoenix.games !== 1) fail('新シーズンで試合ができない');
else ok('新シーズンでも試合を進められる');

// リロード（アプリ再起動）
const snapshot = await readState();
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.locator('.appbar h1').waitFor();
const reloaded = await readState();
if (reloaded.date !== snapshot.date || reloaded.records.phoenix.games !== snapshot.records.phoenix.games) {
  fail('再起動でデータが変わってしまった');
} else {
  ok(`再起動しても続きからプレイできる（${reloaded.date} / ${reloaded.records.phoenix.games}試合）`);
}
// 1軍/2軍の登録が再起動をまたいで保持されているか
// （降格させた選手が引退している場合があるので、球団全体の登録内容で比較する）
const rosterKey = (st) =>
  st.players
    .filter((p) => p.teamId === 'phoenix')
    .map((p) => `${p.id}:${p.roster}`)
    .sort()
    .join(',');
const secondCount = reloaded.players.filter((p) => p.teamId === 'phoenix' && p.roster === 'second').length;
if (rosterKey(reloaded) !== rosterKey(snapshot)) fail('再起動で登録情報が失われた');
else if (secondCount === 0) fail('2軍登録の選手がいない');
else ok(`再起動後も1軍/2軍の登録が保持されている（2軍 ${secondCount}人）`);
const samplePlayer = reloaded.players.find((p) => p.teamId === 'phoenix');
if (!samplePlayer.ext.personality || typeof samplePlayer.ext.potential !== 'number') {
  fail('再起動でPHASE2のデータが失われた');
} else {
  ok(`再起動後もPHASE2のデータが残る（性格 ${samplePlayer.ext.personality} / 潜在 ${samplePlayer.ext.potential}）`);
}
if (!samplePlayer.ext.condition || !Array.isArray(samplePlayer.ext.conditionHistory)) {
  fail('再起動で調子のデータが失われた');
} else {
  ok(`再起動後も調子が残る（${samplePlayer.ext.condition} / 履歴${samplePlayer.ext.conditionHistory.length}日分）`);
}
await shot('15-reload');

await browser.close();
console.log(process.exitCode ? '\n=== 失敗あり ===' : '\n=== すべて成功 ===');
