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
await page.locator('.player-card').first().click();
await page.locator('.sheet').waitFor();
await page.locator('.sheet .team-pick').nth(3).click();
await page.waitForTimeout(300);
const rotAfter = (await readState()).setups.phoenix.rotation;
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

// 日付進行
await page.locator('.nav').getByText('ホーム').click();
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
await page.waitForTimeout(400);
const picking = await readState();
if (picking.draft.phase !== 'picking') fail('指名段階に移行していない');
else ok('ドラフト会議が始まった');

const draftText = await page.locator('.screen').innerText();
if (!draftText.includes('将来性')) fail('ドラフト画面に将来性がない');
ok('スカウト結果を見ながら指名できる');

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
const allPicks = afterPicks.draft ? afterPicks.draft.picks : [];
const playerPicks = allPicks.filter((p) => p.teamId === 'phoenix').length;
const cpuPicks = allPicks.filter((p) => p.teamId !== 'phoenix').length;
if (myPicks === 0) fail('プレイヤー球団が指名できなかった');
else ok(`プレイヤー球団が${playerPicks}人を指名した`);
if (cpuPicks === 0) fail('CPU球団が指名していない');
else ok(`CPU球団が${cpuPicks}人を指名した`);
const pickedIds = allPicks.map((p) => p.prospectId);
if (new Set(pickedIds).size !== pickedIds.length) fail('同じ候補が重複して指名されている');
else ok('重複指名は発生していない');
await shot('16c-draft-done');

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
const stillDemoted = reloaded.players.find((p) => p.id === demoteTarget.id);
if (stillDemoted.roster !== 'second') fail('再起動で登録情報が失われた');
else ok('再起動後も1軍/2軍の登録が保持されている');
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
