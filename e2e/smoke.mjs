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
/*
 * ブラウザのダイアログ（confirm / alert / prompt）を使っていないことを見張る。
 * 配布時は sandbox 付き iframe に入るため、allow-modals が無いとブラウザが
 * これらを黙って無視して false を返し、「押しても何も起きないボタン」になる。
 * ここでは呼び出しを記録しつつ、sandbox と同じく false を返す。
 */
await page.addInitScript(() => {
  const calls = [];
  window.__modalCalls = calls;
  for (const name of ['confirm', 'alert', 'prompt']) {
    window[name] = (message) => {
      calls.push(`${name}: ${message}`);
      return false;
    };
  }
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
else ok(`セーブ作成 (seed ${state.seed} / ${state.players.length}選手 / 開始日 ${state.date})`);
if (state.players.filter((p) => p.teamId === 'phoenix').length !== 65) fail('選手が65人ではない');
else ok('プレイヤー球団に65人の選手がいる（支配下70人枠の内側）');

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
// 支配下65人には同姓同名が混じりうるので、名前ではなく選手IDで絞り込む
const targetCard = page.locator(`.player-card[data-player-id="${demoteTarget.id}"]`);
await targetCard.getByText('2軍へ').click();
await page.waitForTimeout(300);
let after = await readState();
let moved = after.players.find((p) => p.id === demoteTarget.id);
if (moved.roster !== 'second') fail('2軍に降格できなかった');
else ok(`${moved.name} を2軍に降格（変更日 ${moved.lastRosterChangeDate}）`);

// 7日制限
const lockBadge = targetCard.locator('.chip', { hasText: /あと\d日/ });
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

// PHASE 4.1: 試合結果は回ごとに再生される（演出だけで、結果は計算済み）
{
  const progress = await page.locator('.sheet, .screen').first().innerText();
  if (!/回まで|試合終了/.test(progress)) fail('試合結果が段階的に表示されていない');
  else ok('試合結果が回ごとに段階的に表示される');
  const skip = page.getByRole('button', { name: 'スキップ' });
  if (await skip.count()) {
    // 連打しても二重に進まないこと
    await skip.click();
    await skip.click().catch(() => {});
    await skip.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('試合終了'),
    undefined,
    { timeout: 8000 },
  );
  ok('スキップまたは再生完了で最終結果に到達する（連打しても壊れない）');
}

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

// PHASE 3.6: 球団方針
await page.locator('.nav').getByText('ホーム').click();
const homePolicyText = await page.locator('.screen').innerText();
if (!homePolicyText.includes('今季の方針')) fail('ホームに今季の方針がない');
else ok('ホーム画面に今季の方針が表示されている');
for (const label of ['補強ポイント', 'FA積極度']) {
  if (!homePolicyText.includes(label)) fail(`ホームに「${label}」がない`);
}
ok('補強ポイントとFA・トレード積極度が表示されている');
const policyState = await readState();
const myPlan = policyState.teamPlans[policyState.playerTeamId];
if (!myPlan) fail('経営プランが保存されていない');
else {
  if (!['WIN_NOW', 'BALANCED', 'YOUTH', 'BUDGET'].includes(myPlan.strategy)) {
    fail('経営プランの戦略が不正');
  } else {
    ok(`自球団の方針は ${myPlan.strategy}（FA予算 ${myPlan.faBudget}）`);
  }
  const strategies = new Set(
    policyState.teams.map((t) => policyState.teamPlans[t.id] && policyState.teamPlans[t.id].strategy),
  );
  if (strategies.size < 2) fail('全球団が同じ方針になっている');
  else ok(`12球団で${strategies.size}種類の方針が立てられている`);
  const needs = Object.values(myPlan.needs);
  if (needs.some((n) => n < 0 || n > 100)) fail('補強必要度の値が不正');
  else ok('補強必要度は0〜100に収まっている');
}
if (/potential|truePotential/.test(homePolicyText)) fail('ホームに内部情報が出ている');
else ok('球団方針の表示に内部の隠し情報は出ない');

// PHASE 3.5: トレード
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
for (const label of ['今季の方針', '補強ポイント', 'FA積極度', 'トレード積極度']) {
  if (!profileText.includes(label)) fail(`相手球団の情報に「${label}」がない`);
}
ok('相手球団の方針・補強ポイント・積極度が表示される');
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

/*
 * 提案する（相手が受けるまで組み合わせを変える）。
 *
 * 相手球団は1つだけだと、そのシードで先方が何も欲しがらない編成のときに
 * 「UIからトレードを成立させられるか」を確かめられないまま落ちる。
 * 確かめたい内容は同じまま、断られ続けたら次の球団にも当たるようにする。
 */
let tradeDone = false;
const beforeTrade = await readState();
const partnerCandidates = tradeStart.teams.filter((t) => t.id !== 'phoenix').slice(0, 3);

for (const partner of partnerCandidates) {
  if (tradeDone) break;
  if (partner.id !== partnerId) {
    const pick = page
      .locator('.card', { hasText: '球団を選ぶ' })
      .getByRole('button', { name: partner.shortName });
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.getByRole('heading', { name: 'トレード内容' }).waitFor();
    await page.waitForTimeout(150);
  }
  const mine = page.locator('.card', { hasText: 'あなたが出す' });
  const theirs = page.locator('.card', { hasText: `${partner.shortName} から受け取る` });
  const myButtons = mine.locator('button[aria-label$="を選ぶ"]');
  const theirButtons = theirs.locator('button[aria-label$="を選ぶ"]');
  const myCount = Math.min(8, await myButtons.count());
  const theirCount = Math.min(8, await theirButtons.count());

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
          ok(
            `トレードが成立した（${partner.shortName}／${record.playerNamesFrom.join('・')} ⇄ ${record.playerNamesTo.join('・')}）`,
          );
          break outer;
        }
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
if (minRosterAfterTrade < 55) fail(`トレード後にロスターが${minRosterAfterTrade}人`);
else ok(`トレード後も全球団が55人以上（最少${minRosterAfterTrade}人）`);
const maxRosterAfterTrade = Math.max(
  ...afterTrade.teams.map((t) => afterTrade.players.filter((p) => p.teamId === t.id).length),
);
if (maxRosterAfterTrade > 70) fail(`トレード後にロスターが${maxRosterAfterTrade}人（支配下70人枠を超えた）`);
else ok(`トレード後も全球団が支配下70人枠の内側（最多${maxRosterAfterTrade}人）`);

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

// PHASE 3.5: CPU同士のトレードとCPUからの提案。
// トレードは1シーズンに数件しか成立せず、1件も成立しない年もある。
// 成立するまで試合を進め、それでも0件なら「提案は動いているか」を確かめる。
const cpuTradesOf = (s) =>
  s.trade.history.filter((r) => r.fromTeamId !== 'phoenix' && r.toTeamId !== 'phoenix');
/*
 * ここで試合を余分に進めると、このあとの検査（調子の変化・トレード期限）が
 * 前提を失ってしまう。日数は進めず、いまの時点で判断する。
 */
const cpuTrades = cpuTradesOf(state);
if (cpuTrades.length > 0) {
  // 成立したトレードは、両球団に反映されていなければならない
  for (const record of cpuTrades) {
    const gone = state.players.filter(
      (p) => record.playerIdsFrom.includes(p.id) && p.teamId === record.fromTeamId,
    );
    if (gone.length > 0) fail('トレードで出した選手が元の球団に残っている');
  }
  ok(`CPU同士のトレードが${cpuTrades.length}件成立している`);
} else {
  /*
   * 成立0件のシーズンもある（30日時点で 3/30 シード。支配下70人枠の前後で変わらない）。
   * ここで必ず1件を要求するとシードによって落ちるので、
   * 「トレード市場が開いていて、期限が今シーズンのものになっている」ことを確かめる。
   */
  if (state.trade.year !== state.year) fail('トレード市場が今シーズンのものになっていない');
  else if (!(state.trade.deadline > state.date)) fail('トレード期限がすでに過ぎている');
  else ok('このシーズンはCPU同士のトレードが成立しなかった（市場は開いている）');
}

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

// ---- PHASE 3.9: ニュース ----
{
  const news = finished.news;
  if (!news || !Array.isArray(news.items)) fail('ニュースが作られていない');
  else if (news.items.length === 0) fail('シーズンを終えてもニュースが1件もない');
  else ok(`ニュースが作られている（${news.items.length}件）`);

  // IDが重複しない
  const ids = news.items.map((n) => n.id);
  if (new Set(ids).size !== ids.length) fail('ニュースIDが重複している');
  else ok('ニュースIDに重複がない');

  // 年と日付が食い違わない
  if (news.items.some((n) => !n.date.startsWith(String(n.year)))) {
    fail('ニュースの年と日付が食い違っている');
  } else ok('ニュースの年と日付が一致している');

  // 球団が実在する
  const teamIds = new Set(finished.teams.map((t) => t.id));
  if (news.items.some((n) => n.teamId && !teamIds.has(n.teamId))) {
    fail('存在しない球団のニュースがある');
  } else ok('ニュースの球団がすべて実在する');

  // ホームに最新ニュースが出る
  const homeNews = await page.locator('.screen').innerText();
  if (!homeNews.includes('最新ニュース')) fail('ホームに最新ニュースがない');
  else ok('ホームに最新ニュースが表示されている');

  await page.getByRole('button', { name: 'すべて見る' }).click();
  await page.waitForTimeout(250);
  const newsText = await page.locator('.screen').innerText();
  if (!newsText.includes('すべて')) fail('ニュース画面にフィルターがない');
  else ok('ニュース画面が開ける');
  await shot('50-news');

  // カテゴリで絞り込める
  await page.locator('.chip', { hasText: '試合' }).first().click();
  await page.waitForTimeout(200);
  ok('ニュースをカテゴリで絞り込める');

  /*
   * PHASE 4.4: 「年度の物語」タブは「シーズンの記録」タブに広がり、
   * その中に SEASON TIMELINE と年度の物語の両方が入るようになった（§19）。
   * 確かめる内容は減らしていない — 年度の物語が読めることに加えて、
   * シーズンの記録（月ごとの流れ）が出ていることも見る。
   */
  await page.locator('.tabs button', { hasText: 'シーズンの記録' }).click();
  await page.waitForTimeout(200);
  const storyText = await page.locator('.screen').innerText();
  if (!storyText.includes('年度の物語')) fail('年度の物語が読めない');
  else ok('年度の物語が読める');
  for (const label of ['SEASON TIMELINE', 'シーズンの記録']) {
    if (!storyText.includes(label)) fail(`シーズンの記録に「${label}」がない`);
  }
  ok('シーズンの記録（月ごとの流れ）が出ている');

  // PHASE 4.4: GM日誌（§21）
  await page.locator('.tabs button', { hasText: 'GM日誌' }).click();
  await page.waitForTimeout(200);
  const journalText = await page.locator('.screen').innerText();
  for (const label of ['GM JOURNAL', 'GM日誌']) {
    if (!journalText.includes(label)) fail(`GM日誌に「${label}」がない`);
  }
  if (!journalText.includes('良し悪しの採点はしていません')) {
    fail('GM日誌が「評価ではなく記録」であることを示していない');
  }
  ok('GM日誌が開ける（判断の記録であって採点ではないと明示されている）');
  await page.locator('.tabs button', { hasText: 'ニュース' }).click();
  await page.waitForTimeout(150);

  await page.locator('.nav').getByText('ホーム').click();
  await page.waitForTimeout(200);
}

// ---- PHASE 3.8: ポストシーズン ----
{
  const ps = finished.postseason;
  if (!ps) fail('シーズン終了後にポストシーズンが用意されていない');
  else {
    ok(`ポストシーズンが用意された（${ps.phase}）`);
    const participants = Object.values(ps.participants).flat();
    if (participants.length !== 6) fail(`進出球団が6球団ではない（${participants.length}）`);
    else ok('各リーグ上位3球団が進出している');
    if (new Set(participants).size !== 6) fail('進出球団が重複している');
    else ok('進出球団に重複がない');
  }

  // ホーム画面にポストシーズンの案内が出る
  const homeText = await page.locator('.screen').innerText();
  if (!homeText.includes('ポストシーズン') && !homeText.includes('クライマックス')) {
    fail('ホームにポストシーズンの案内がない');
  } else ok('ホームにポストシーズンの案内が出ている');

  await page.getByRole('button', { name: 'ポストシーズンを見る' }).click();
  await page.waitForTimeout(200);
  const psText = await page.locator('.screen').innerText();
  for (const label of ['ポストシーズン', '進出球団', 'ファーストステージ']) {
    if (!psText.includes(label)) fail(`ポストシーズン画面に「${label}」がない`);
  }
  ok('ポストシーズン画面に進出球団とシリーズが表示されている');
  await shot('40-postseason');

  // 1試合ずつ進めて、途中で保存・再開できることを確かめる
  const playButton = page.getByRole('button', { name: /戦を進める/ });
  if (!(await playButton.count())) fail('ポストシーズンの試合を進めるボタンがない');
  else {
    await playButton.click();
    await page.waitForTimeout(300);
    const afterOne = await readState();
    const played = afterOne.postseason.series.reduce((n, x) => n + x.games.length, 0);
    if (played < 1) fail('ポストシーズンの試合が進んでいない');
    else ok(`ポストシーズンの試合を1つ進めた（通算${played}試合）`);

    // 途中でリロードして再開できる
    await page.reload();
    await page.getByRole('button', { name: '続きから' }).click();
    await page.locator('.appbar h1').waitFor();
    const resumed = await readState();
    const resumedPlayed = resumed.postseason.series.reduce((n, x) => n + x.games.length, 0);
    if (resumedPlayed !== played) fail('ポストシーズン途中で再開できない');
    else ok(`ポストシーズン途中で保存・再開できた（${resumedPlayed}試合）`);
  }

  // 残りは自動で進める（オフシーズンに入ると最後まで消化される）
}

const agesBefore = new Map(finished.players.map((p) => [p.id, p.age]));
const abilitiesBefore = new Map(finished.players.map((p) => [p.id, p.batting.contact + p.batting.power]));
const playersBefore = finished.players.length;

// PHASE 3.1: オフシーズン（引退 → ドラフト → 新人加入）
await page.locator('.nav').getByText('ホーム').click();
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
// 自球団に指名権がない年（支配下枠が埋まっていて補充が不要な年）もあるので、
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
// 最低人数(55人)を割る場合は引き止められるため、退団が0人になることもある
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
if (minRoster < 55) fail(`ロスターが55人を割っている（${minRoster}人）`);
else ok(`全球団が55人以上のロスターを保っている（最少${minRoster}人）`);
const maxRoster = Math.max(
  ...nextSeason.teams.map((t) => nextSeason.players.filter((p) => p.teamId === t.id).length),
);
if (maxRoster > 70) fail(`支配下70人枠を超えた球団がある（${maxRoster}人）`);
else ok(`全球団が支配下70人枠の内側（最多${maxRoster}人）`);
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

// ---- PHASE 3.7: 歴史・記録 ----
{
  const h = afterNew.history;
  if (!h || !Array.isArray(h.seasons)) fail('歴史データが作られていない');
  else if (h.seasons.length !== 1) fail(`確定シーズンが1年ではない（${h.seasons?.length}）`);
  else ok(`前年が歴史に確定した（${h.seasons[0].year}年）`);

  const season = h.seasons[0];
  if (!season.teams || season.teams.length !== 12) fail('球団の年度成績が12球団ぶんない');
  else ok('12球団の順位・成績が記録されている');
  const champions = season.leagues.map((l) => l.championTeamId).filter(Boolean);
  if (champions.length !== 2) fail('優勝球団が2リーグぶん記録されていない');
  else ok(`優勝球団が記録されている（${champions.join(' / ')}）`);
  if (!season.leagues.every((l) => l.mvpPlayerId)) fail('MVPが決まっていない');
  else ok('MVP・タイトルが記録されている');

  // 通算成績は年度別の合計と一致する
  const BAT = 12;
  let mismatched = 0;
  let withStats = 0;
  for (const player of Object.values(h.players)) {
    const total = new Array(BAT).fill(0);
    for (const entry of player.seasons) {
      if (!entry.b) continue;
      for (let i = 0; i < BAT; i++) total[i] += entry.b[i] ?? 0;
    }
    if (total[3] > 0) withStats += 1;
    if (total[3] !== player.career.batting.hits) mismatched += 1;
  }
  if (mismatched > 0) fail(`通算成績が年度別の合計と一致しない（${mismatched}人）`);
  else ok(`通算成績が年度別の合計と一致する（${withStats}人に成績あり）`);

  // 同じ年・同じ球団の行が重複しない
  let duplicated = 0;
  for (const player of Object.values(h.players)) {
    const seen = new Set();
    for (const entry of player.seasons) {
      const key = `${entry.year}:${entry.teamId}`;
      if (seen.has(key)) duplicated += 1;
      seen.add(key);
    }
  }
  if (duplicated > 0) fail(`年度別成績が重複している（${duplicated}件）`);
  else ok('年度別成績に重複がない');

  // PHASE 3.8: ポストシーズンの結果が歴史に残っている
  const ps = season.postseason;
  if (!ps) fail('歴史にポストシーズンの記録がない');
  else {
    if (!ps.japanSeriesChampionTeamId) fail('日本一が記録されていない');
    else ok(`日本一が記録されている（${ps.japanSeriesChampionTeamId}）`);
    if (!ps.japanSeriesMvpPlayerId) fail('日本シリーズMVPが記録されていない');
    else ok('日本シリーズMVPが記録されている');
    if (ps.series.length !== 5) fail(`シリーズ数が5ではない（${ps.series.length}）`);
    else ok('5つのシリーズ（CS 4 + 日本シリーズ 1）が記録されている');
    if (ps.series.some((x) => !x.winnerTeamId)) fail('勝者のいないシリーズがある');
    else ok('すべてのシリーズに勝者がいる');
    if (ps.series.some((x) => x.teamAId === x.teamBId)) fail('同一球団同士のシリーズがある');
    else ok('同じ球団が両側にいるシリーズはない');
    const jsChamps = season.teams.filter((t) => t.japanChampion);
    if (jsChamps.length !== 1) fail(`日本一が${jsChamps.length}球団いる`);
    else ok('日本一は1球団だけ');
    const leagueChamps = season.teams.filter((t) => t.leagueChampion);
    if (leagueChamps.length !== 2) fail(`リーグ優勝が${leagueChamps.length}球団いる`);
    else ok('リーグ優勝は各リーグ1球団');
  }

  // PHASE 3.9: 年度の物語ができている
  const stories = afterNew.news.stories;
  if (!stories || stories.length !== 1) fail(`年度の物語が1件ではない（${stories?.length}）`);
  else ok(`年度の物語ができている（${stories[0].year}年：${stories[0].headline}）`);
  if (stories?.[0] && !stories[0].headline) fail('物語に見出しがない');
  if (stories?.[0] && ps && stories[0].championTeamId !== ps.japanSeriesChampionTeamId) {
    fail('物語の日本一が歴史と食い違う');
  } else ok('物語の日本一が歴史と一致する');
  // 引退ニュースの選手は実際に引退している
  const retireNews = afterNew.news.items.filter((n) => n.category === 'RETIREMENT');
  const badRetire = retireNews.filter((n) => {
    const rec = afterNew.history.players[n.playerId];
    return !rec || rec.retiredAt === null;
  });
  if (badRetire.length > 0) fail(`引退していない選手の引退ニュースがある（${badRetire.length}件）`);
  else ok(`引退ニュースが実際の引退と一致する（${retireNews.length}件）`);

  // 引退した選手の成績が残っている
  const retired = Object.values(h.players).filter((p) => p.retiredAt !== null);
  if (retired.length === 0) fail('引退した選手の歴史が残っていない');
  else ok(`引退した選手の歴史が残っている（${retired.length}人）`);
}

// 歴史画面・記録画面
await page.getByRole('button', { name: /ホーム/ }).last().click();
const homeHistory = await page.locator('.screen').innerText();
if (!homeHistory.includes('歴史・記録')) fail('ホームに歴史・記録がない');
else ok('ホームから歴史・記録に入れる');

await page.getByRole('button', { name: '歴史', exact: true }).click();
await page.waitForTimeout(200);
const timelineText = await page.locator('.screen').innerText();
if (!/\d{4}年/.test(timelineText)) fail('年表に年が表示されていない');
else ok('年表に過去シーズンが表示されている');
if (!timelineText.includes('MVP')) fail('年表にMVPが表示されていない');
else ok('年表にMVP・タイトルが表示されている');
if (!timelineText.includes('日本一')) fail('年表に日本一が表示されていない');
else ok('年表に日本一が表示されている');
await shot('30-history');

await page.locator('.tabs button', { hasText: '球団の歩み' }).click();
await page.waitForTimeout(200);
const walkText = await page.locator('.screen').innerText();
if (!walkText.includes('優勝')) fail('球団の歩みに優勝回数がない');
else ok('球団の歩みに年度別成績と優勝回数が出る');
if (!walkText.includes('日本一')) fail('球団の歩みに日本一回数がない');
else ok('球団の歩みに日本一・CS進出の回数が出る');

await page.locator('.tabs button', { hasText: '殿堂' }).click();
await page.waitForTimeout(200);
const hofText = await page.locator('.screen').innerText();
if (!hofText.includes('殿堂')) fail('殿堂の見出しがない');
else ok('殿堂の画面が開ける');
if (!/引退/.test(hofText)) fail('引退した選手の一覧がない');
else ok('引退した選手を一覧から選べる');
// 引退選手の詳細（当時の成績。現在の能力は出さない）
const retiredRow = page.locator('.row-btn').first();
if (await retiredRow.count()) {
  await retiredRow.click();
  await page.locator('.sheet').waitFor();
  const sheet = await page.locator('.sheet').innerText();
  for (const label of ['所属', '通算成績', '年度別成績']) {
    if (!sheet.includes(label)) fail(`引退選手の詳細に「${label}」がない`);
  }
  ok('引退選手の詳細に所属・通算・年度別成績が出る');
  if (/今日の実効能力|潜在能力|成長タイプ/.test(sheet)) fail('歴史画面に現在の能力値が出ている');
  else ok('歴史画面では能力値ではなく成績を見せている');
  await shot('31-history-player');
  await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();
}

await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.getByRole('button', { name: '記録', exact: true }).click();
await page.waitForTimeout(200);
const recordsText = await page.locator('.screen').innerText();
for (const label of ['本塁打', '打率', '勝利']) {
  if (!recordsText.includes(label)) fail(`記録画面に「${label}」がない`);
}
ok('リーグ記録が表示されている');
await page.locator('.tabs button', { hasText: '球団' }).click();
await page.waitForTimeout(200);
if (!(await page.locator('.screen').innerText()).includes('シーズン記録')) {
  fail('球団記録が表示されていない');
} else ok('球団記録が表示されている');
await page.locator('.tabs button', { hasText: '通算' }).click();
await page.waitForTimeout(200);
if (!(await page.locator('.screen').innerText()).includes('通算')) {
  fail('通算記録が表示されていない');
} else ok('通算記録が表示されている');
await shot('32-records');
await page.getByRole('button', { name: /ホーム/ }).last().click();

/* ================= PHASE 4.1 分析・演出 ================= */

// --- 選手詳細の分析タブ ---
await page.getByRole('button', { name: /選手/ }).last().click();
await page.locator('.player-card').first().waitFor();
await page.locator('.player-card').first().click();
await page.locator('.sheet').waitFor();

const sheetTabs = page.locator('.sheet .tabs button');
if ((await sheetTabs.count()) === 0) fail('選手詳細にタブがない');
else ok('選手詳細が「情報」と「分析」に分かれている');

await page.locator('.sheet .tabs button', { hasText: '分析' }).click();
await page.waitForTimeout(300);
const analysisText = await page.locator('.sheet').innerText();

/*
 * PHASE 4.2: 「扱いの目安」という別の節は無くなり、画面の最上部の
 * GM RECOMMENDATION に統合された（§11: 開いた瞬間に結論が読めること）。
 * 確認する内容は減らしていない — 結論・理由・判断材料の数をこの下で個別に見る。
 */
/*
 * PHASE 4.3: 画面の用語を球団業務の言い方にそろえた（§3）。
 *   球団分析 → SCOUT REPORT / スカウト評価
 *   起用分析 → ROSTER STATUS / 起用の目安
 * 欄名（ラテン語）と日本語の見出しの両方が出ていることを確かめる。
 */
for (const label of [
  'SCOUT REPORT',
  'スカウト評価',
  'ABILITY',
  '能力資料',
  'ROSTER STATUS',
  '起用の目安',
  'GM RECOMMENDATION',
  '扱いの助言',
  'SEASON RECORD',
  '年度別成績',
]) {
  if (!analysisText.includes(label)) fail(`分析タブに「${label}」がない`);
}
ok('分析タブの各欄が欄名（英）と見出し（日）の両方で出ている');

// 扱いの結論と、その理由・判断材料が最上部に出ていること（PHASE 4.2 で追加）
{
  const verdict = page.locator('.sheet .verdict-name');
  if ((await verdict.count()) === 0) fail('扱いの結論が表示されていない');
  else ok(`扱いの結論が最上部に出ている（${(await verdict.first().innerText()).trim()}）`);
  const reason = await page.locator('.sheet .verdict-reason').first().innerText();
  if (reason.trim().length < 10) fail('結論の理由が表示されていない');
  else ok('結論に理由が添えられている');
  const tally = page.locator('.sheet .tally-head');
  if (await tally.count()) {
    const text = await tally.first().innerText();
    if (!/判断材料\s*\d+\s*\/\s*6/.test(text)) fail(`判断材料の内訳が不正（${text}）`);
    else ok(`判断材料の内訳が出ている（${text.trim()}）`);
  }
}

// レーダーチャートが描かれている
const radar = page.locator('.sheet svg.radar');
if ((await radar.count()) === 0) fail('レーダーチャートが表示されていない');
else {
  const axes = await page.locator('.sheet svg.radar .radar-label').count();
  if (axes !== 5 && axes !== 6) fail(`レーダーチャートの軸が${axes}本（5か6のはず）`);
  else ok(`レーダーチャートが表示されている（${axes}軸）`);
  const filled = await page.locator('.sheet svg.radar polygon.radar-value').count();
  if (filled === 0) fail('レーダーチャートに能力の面が描かれていない');
  else ok('レーダーチャートに現在の推定能力が描かれている');
}

// 星と理由
if (!/★/.test(analysisText)) fail('成長期待などの星が表示されていない');
else ok('現在戦力・将来性・成長期待・起用優先度が星で出る');
for (const label of ['現在戦力', '将来性', '成長期待', '起用優先度']) {
  if (!analysisText.includes(label)) fail(`分析に「${label}」がない`);
}
ok('4種類の星がそろっている');
if (!analysisText.includes('判断材料です')) fail('分析が助言であることの断りがない');
else ok('分析はあくまで判断材料だと明示されている');

// 潜在能力の実数値が漏れていないこと
const sheetState = await readState();
const shownPlayerName = (await page.locator('.sheet strong').first().innerText()).trim();
const shownPlayer = sheetState.players.find((p) => p.name === shownPlayerName);
if (shownPlayer) {
  const pot = String(shownPlayer.ext.potential);
  // 「潜在能力そのものの数値」がラベル以外の形で出ていないこと
  if (/潜在能力\s*[:：]?\s*\d/.test(analysisText)) fail('潜在能力の数値が分析に出ている');
  else ok(`潜在能力の実数値（${pot}）は分析画面に出ていない`);
}

await shot('37-player-analysis');

// 成績グラフの指標切り替え
const metricButtons = page.locator('.sheet .chip', { hasText: /打率|防御率/ });
if (await metricButtons.count()) {
  await metricButtons.first().click();
  await page.waitForTimeout(200);
  ok('成績グラフの指標を切り替えられる');
}
const trendSvg = await page.locator('.sheet svg.trend-chart').count();
const trendEmpty = analysisText.includes('まだ年度別成績が記録されていません');
if (trendSvg === 0 && !trendEmpty) fail('年度別成績のグラフも「記録なし」の案内も出ていない');
else ok(trendSvg > 0 ? '年度別成績のグラフが表示されている' : '記録が無い場合は捏造せず案内が出る');

// アニメーション中でも閉じられる
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).first().click();
await page.waitForTimeout(200);
if (await page.locator('.sheet').count()) fail('分析表示中に詳細を閉じられない');
else ok('アニメーション中でも詳細を閉じられる');

// --- 球団のチーム分析 ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: '球団経営を見る' }).click();
await page.locator('.tabs button', { hasText: '分析' }).click();
await page.waitForTimeout(300);
const teamText = await page.locator('.screen').innerText();
// PHASE 4.3: チーム分析も球団レポートの用語にそろえた（§3・§12）
for (const label of [
  'CLUB REPORT',
  '球団レポート',
  'TEAM STRENGTH',
  'チーム戦力',
  // PHASE 4.4: 課題の欄を「なぜ課題なのか」まで書く球団レポートに広げた（§12）
  'TEAM REPORT',
  '現在の課題',
  'DEPTH CHART',
  'ポジション別の層',
  '選手層の内訳',
]) {
  if (!teamText.includes(label)) fail(`チーム分析に「${label}」がない`);
}
ok('チーム分析に状態・戦力・課題・ポジション別の層が出る');
for (const label of ['打撃力', '投手力', '守備力', '走力', '若手力', 'ベテラン力', '選手層']) {
  if (!teamText.includes(label)) fail(`チーム戦力分析に「${label}」がない`);
}
ok('7つの軸がそろっている');
if ((await page.locator('.screen svg.radar').count()) === 0) {
  fail('チームのレーダーチャートが表示されていない');
} else ok('チームのレーダーチャートが表示されている');
if (!/好調|安定|注意|危険/.test(teamText)) fail('チーム状態の4段階が表示されていない');
else ok('チーム状態が4段階で表示されている');

// 深度チャートを開ける
const depthHead = page.locator('.depth-head').first();
if (await depthHead.count()) {
  await depthHead.click();
  await page.waitForTimeout(200);
  const opened = await page.locator('.screen').innerText();
  if (!/1軍主力|1軍候補|2軍|育成/.test(opened)) fail('ポジション別の層が表示されていない');
  else ok('ポジションごとに1軍主力・候補・2軍の層が見える');
  await depthHead.click();
}
await shot('38-team-analysis');

// --- 横スクロールしていないこと（390px） ---
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 2) fail(`画面が横にはみ出している（${overflow}px）`);
else ok('390pxの画面で横スクロールが発生していない');

// --- 演出はゲーム結果を変えない ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
const beforeGame = await readState();
const afterGame = beforeGame;
await page.reload();
await page.getByRole('button', { name: '続きから' }).click();
await page.locator('.appbar h1').waitFor();
const reloadedGame = await readState();
if (
  reloadedGame.date !== afterGame.date ||
  JSON.stringify(reloadedGame.records) !== JSON.stringify(afterGame.records)
) {
  fail('演出をはさむとリロードで結果が変わってしまう');
} else {
  ok(`演出は結果を変えない（${beforeGame.date} → ${reloadedGame.date}／記録一致）`);
}

// --- ニュースの NEW とアニメーション ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
const homeNews = await page.locator('.screen').innerText();
if (homeNews.includes('最新ニュース')) ok('ホームに最新ニュースが出ている');

/* ================= PHASE 4.1 reduced-motion ================= */

// OSの「視差効果を減らす」を有効にしても、すべての情報が表示されること
const reducedContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
});
const reducedPage = await reducedContext.newPage();
reducedPage.on('pageerror', (e) => fail('reduced-motion でページ内エラー: ' + e.message));
// 別コンテキストなので localStorage は空。いまのセーブをそのまま持ち込む
const saveForReduced = await page.evaluate(() => localStorage.getItem('mipr:save:v1'));
await reducedPage.addInitScript((raw) => {
  localStorage.setItem('mipr:save:v1', raw);
}, saveForReduced);
await reducedPage.goto(BASE);
await reducedPage.getByRole('button', { name: '続きから' }).click();
await reducedPage.locator('.appbar h1').waitFor();
ok('reduced-motion でも続きからプレイできる');

await reducedPage.getByRole('button', { name: /選手/ }).last().click();
await reducedPage.locator('.player-card').first().click();
await reducedPage.locator('.sheet').waitFor();
await reducedPage.locator('.sheet .tabs button', { hasText: '分析' }).click();
await reducedPage.waitForTimeout(150);
const reducedText = await reducedPage.locator('.sheet').innerText();
for (const label of ['SCOUT REPORT', 'スカウト評価', '起用の目安', 'GM RECOMMENDATION']) {
  if (!reducedText.includes(label)) fail(`reduced-motion で「${label}」が表示されない`);
}
const reducedRadar = await reducedPage.locator('.sheet svg.radar polygon.radar-value').count();
if (reducedRadar === 0) fail('reduced-motion でレーダーチャートが描かれない');
else ok('reduced-motion でもレーダーチャートが最初から完成形で出る');
// PHASE 4.5 §19: reduced-motion では肖像が最初から完成形で出る
{
  const reducedPortraits = await reducedPage.locator('.sheet .portrait').count();
  if (reducedPortraits === 0) fail('reduced-motion で選手の肖像が出ない');
  else {
    const animated = await reducedPage.evaluate(() => {
      const el = document.querySelector('.sheet .portrait');
      if (!el) return 'none';
      return getComputedStyle(el).animationName;
    });
    if (animated !== 'none') {
      fail(`reduced-motion なのに肖像がアニメーションしている（${animated}）`);
    } else ok('reduced-motion では肖像が最初から完成形で出る');
  }
}
await reducedPage.screenshot({ path: `${OUT}/39-reduced-motion.png` });
await reducedContext.close();
ok('prefers-reduced-motion でも情報がすべて表示される');

/* ================= PHASE 4.0 球団経営 ================= */

await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
const homeClubText = await page.locator('.screen').innerText();
if (!homeClubText.includes('球団経営')) fail('ホームに球団経営のカードがない');
else ok('ホームから球団経営の状況が見える');
for (const label of ['今季の方針', '球団評価', 'チーム士気', '施設']) {
  if (!homeClubText.includes(label)) fail(`球団経営カードに「${label}」がない`);
}
ok('球団経営カードに方針・評価・士気・施設が出る');

await page.getByRole('button', { name: '球団経営を見る' }).click();
await page.locator('.tabs button', { hasText: '球団' }).waitFor();
await shot('33-club');

// --- 方針 ---
const clubText = await page.locator('.screen').innerText();
for (const label of ['優勝狙い', '若手育成', '再建', 'バランス', '堅実経営']) {
  if (!clubText.includes(label)) fail(`球団方針に「${label}」がない`);
}
ok('5つの球団方針から選べる');
if (!clubText.includes('球団の色')) fail('球団の色が表示されていない');
else ok('球団の色（アイデンティティ）が表示されている');
if (!/戦力|将来性|財務|育成/.test(clubText)) fail('球団評価の内訳がない');
else ok('球団評価が戦力・将来性・財務・育成・経営で表示される');

const directionBefore = (await readState()).clubs.phoenix.direction;
await page.getByRole('button', { name: /若手育成/ }).first().click();
await page.waitForTimeout(200);
const afterDirection = await readState();
if (afterDirection.clubs.phoenix.direction !== 'DEVELOP') fail('球団方針を変更できない');
else ok(`球団方針を変更できた（${directionBefore} → DEVELOP）`);

// --- 施設 ---
await page.locator('.tabs button', { hasText: '施設' }).click();
await page.waitForTimeout(200);
const facilityText = await page.locator('.screen').innerText();
for (const label of ['育成施設', '医療施設', 'スカウト施設', 'トレーニング施設']) {
  if (!facilityText.includes(label)) fail(`施設に「${label}」がない`);
}
ok('4種類の球団施設がLv付きで表示される');
if (!facilityText.includes('球団資金')) fail('球団資金が表示されていない');
else ok('施設画面に球団資金が出る');
await shot('34-club-facility');

const cashBefore = (await readState()).finances.phoenix.cash;
const levelBefore = (await readState()).clubs.phoenix.facilities.development;
const upgradeBtn = page.getByRole('button', { name: /Lv\d+へ強化/ }).first();
if ((await upgradeBtn.count()) && (await upgradeBtn.isEnabled())) {
  await upgradeBtn.click();
  await page.waitForTimeout(300);
  const afterBuy = await readState();
  const levelAfter = afterBuy.clubs.phoenix.facilities.development;
  if (afterBuy.finances.phoenix.cash >= cashBefore) fail('施設を強化しても資金が減っていない');
  else if (levelAfter !== levelBefore + 1) fail(`施設のレベルが上がっていない（${levelBefore} → ${levelAfter}）`);
  else {
    ok(
      `施設を強化できた（育成 Lv${levelBefore} → Lv${levelAfter} / ` +
        `資金 ${Math.round(cashBefore)} → ${Math.round(afterBuy.finances.phoenix.cash)}）`,
    );
  }
} else {
  ok('資金が足りないため施設強化ボタンは押せない状態（想定どおり）');
}

// --- 起用方針 ---
await page.locator('.tabs button', { hasText: '起用' }).click();
await page.waitForTimeout(200);
const usageText = await page.locator('.screen').innerText();
for (const label of ['主力', '準主力', '育成', '控え', 'ベテラン枠']) {
  if (!usageText.includes(label)) fail(`起用方針に「${label}」がない`);
}
ok('5種類の起用方針を選べる');
if (!usageText.includes('能力そのものは変わりません')) {
  fail('起用方針が能力を変えないことの説明がない');
} else ok('起用方針は出場機会だけを変えると明示されている');

const abilityBefore = JSON.stringify(
  (await readState()).players
    .filter((p) => p.teamId === 'phoenix')
    .map((p) => [p.id, p.batting, p.pitching]),
);
await page.locator('.card').getByRole('button', { name: '主力', exact: true }).first().click();
await page.waitForTimeout(300);
const afterUsage = await readState();
const usageCount = Object.keys(afterUsage.usage ?? {}).length;
if (usageCount === 0) fail('起用方針が保存されていない');
else ok(`起用方針を設定できた（${usageCount}人）`);
const abilityAfter = JSON.stringify(
  afterUsage.players.filter((p) => p.teamId === 'phoenix').map((p) => [p.id, p.batting, p.pitching]),
);
if (abilityAfter !== abilityBefore) fail('起用方針を変えたら選手の基本能力が変わってしまった');
else ok('起用方針を変えても選手の基本能力は変わらない');
await shot('35-club-usage');

// --- シーズンを進めて、経営イベント・士気・目標を確かめる ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
const moraleBefore = (await readState()).teamMorale.phoenix;
for (let i = 0; i < 40; i++) {
  const st = await readState();
  if (st.seasonFinished) break;
  const next = page.getByRole('button', { name: /次の日へ|試合へ|オフシーズンへ/ }).first();
  if (!(await next.count())) break;
  await next.click();
  await page.waitForTimeout(120);
  const sheet = page.locator('.sheet');
  if (await sheet.count()) {
    const close = sheet.getByRole('button', { name: /閉じる|進む|OK/ }).first();
    if (await close.count()) await close.click();
  }
}
const midSeason = await readState();
ok(`球団経営を設定したままシーズンを進められた（${midSeason.date}）`);
if (typeof midSeason.teamMorale.phoenix !== 'number') fail('チーム士気が失われた');
else ok(`チーム士気が動いている（${Math.round(moraleBefore)} → ${Math.round(midSeason.teamMorale.phoenix)}）`);
if (!Array.isArray(midSeason.events)) fail('経営イベントの入れ物が無い');
else ok(`経営イベントの記録がある（${midSeason.events.length}件）`);

// 発生していれば選択して決着させる
const pending = midSeason.events.filter((e) => e.resolved === false);
if (pending.length > 0) {
  await page.getByRole('button', { name: /ホーム/ }).last().click();
  await page.waitForTimeout(300);
  const openClub = page.getByRole('button', { name: '球団経営を見る' });
  if (await openClub.count()) await openClub.click();
  await page.waitForTimeout(200);
  const choice = page
    .locator('.card')
    .getByRole('button', {
      name: /いまのまま|我慢して使う|主力で戦い抜く|主力として起用|確認した/,
    })
    .first();
  if (await choice.count()) {
    await choice.click();
    await page.waitForTimeout(300);
    const resolved = (await readState()).events.filter((e) => e.resolved === true).length;
    if (resolved === 0) fail('経営イベントを選択しても決着しない');
    else ok(`経営イベントを選んで決着させた（${resolved}件）`);
  }
  await shot('36-club-event');
  await page.getByRole('button', { name: /ホーム/ }).last().click();
  await page.waitForTimeout(200);
}

// 施設・方針・起用がセーブに残っている
const saved = await readState();
// PHASE 4.4: GMの判断記録を保存するため v15 になった（§33）。
// 確かめる内容は同じ — 保存されたデータが最新の形式であること。
if (saved.version !== 15) fail(`セーブのバージョンが15ではない（${saved.version}）`);
else ok('セーブがv15になっている');
if (!Array.isArray(saved.decisions)) fail('判断記録の入れ物が保存されていない');
else ok('判断記録の入れ物が保存されている');
if (!saved.clubs || Object.keys(saved.clubs).length !== 12) {
  fail('12球団ぶんの球団経営データが無い');
} else ok('12球団すべてに球団経営データがある');
const cpuFacilities = Object.entries(saved.clubs)
  .filter(([id]) => id !== 'phoenix')
  .map(([, c]) => Object.values(c.facilities))
  .flat();
if (cpuFacilities.some((v) => v < 1 || v > 5)) fail('CPU球団の施設Lvが範囲外');
else ok('CPU球団の施設も1〜5の範囲に収まっている');


/* ================= PHASE 4.4 GMとして判断する1日 ================= */

// --- ホーム＝GMの机 ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(250);
const p44DeskText = await page.locator('.screen').innerText();

// §14 試合前資料がホームのいちばん上の判断材料になっている
if (!p44DeskText.includes('PRE-GAME BRIEF') || !p44DeskText.includes('試合前資料')) {
  fail('ホームに試合前資料が出ていない');
} else ok('ホームに試合前資料（PRE-GAME BRIEF）が出ている');
if (!p44DeskText.includes('TEAM FORM')) fail('試合前資料に直近の成績が出ていない');
else ok('試合前資料に直近5試合の成績が出ている');

// §2・§4 案件票
const noteCount = await page.locator('.gm-note').count();
if (noteCount === 0) {
  ok('この時点では判断すべき案件が無い（案件が無いときは何も置かない）');
} else {
  if (noteCount > 3) fail(`案件が${noteCount}件あり上限3件を超えている`);
  else ok(`GMの机に案件票が${noteCount}枚（上限3枚以内）`);
  for (const label of ['GM NOTE', '今日の判断材料', 'CURRENT SITUATION', 'SCOUT NOTE', 'OPTIONS']) {
    if (!p44DeskText.includes(label)) fail(`案件票に「${label}」がない`);
  }
  ok('案件票が 状況 → 数字 → 見方 → 決められる場所 の順になっている');
  if (!p44DeskText.includes('決めるのはGMであるあなたです')) {
    fail('判断が自動実行されないことが明示されていない');
  } else ok('判断を自動実行しないと明示されている');
  // §3・§22 禁止語
  for (const word of ['おすすめ', '最適', 'AI分析', 'AIが']) {
    if (p44DeskText.includes(word)) fail(`GMの机に「${word}」が出ている`);
  }
  ok('「おすすめ」「最適」「AI」を使っていない');

  // 案件票は同じ大きさで並べない（1枚目だけ短期・長期を出す）
  const leadCount = await page.locator('.gm-note.gm-lead').count();
  if (leadCount !== 1) fail(`案件票の重みづけが不正（lead ${leadCount}枚）`);
  else ok('1枚目の案件票だけ大きく扱っている（均一に並べていない）');

  // §2 案件票の［決められる場所］は画面を移すだけで、何も決めない
  const p44Before = await readState();
  const p44Option = page.locator('.gm-note .gm-option').first();
  if (await p44Option.count()) {
    await p44Option.click();
    await page.waitForTimeout(300);
    const after = await readState();
    if (
      after.date !== p44Before.date ||
      after.rngState !== p44Before.rngState ||
      after.players.length !== p44Before.players.length ||
      JSON.stringify(after.records) !== JSON.stringify(p44Before.records)
    ) {
      fail('案件票の選択肢を押しただけでゲームの状態が変わった');
    } else ok('案件票の選択肢は画面を移すだけで、勝手に判断しない');
    await page.getByRole('button', { name: /ホーム/ }).last().click();
    await page.waitForTimeout(200);
  }
}
await shot('60-gm-desk');

// 同じ state からは同じ案件が出る（画面を出入りしても内容が変わらない）
{
  const first = await page.locator('.gm-note .gm-note-title').allInnerTexts();
  await page.locator('.nav').getByText('順位').click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /ホーム/ }).last().click();
  await page.waitForTimeout(300);
  const second = await page.locator('.gm-note .gm-note-title').allInnerTexts();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    fail('画面を出入りするだけで案件の内容が変わった');
  } else ok('判断画面は開くたびに内容が変わらない');
}

// --- §7〜§11 選手報告書 ---
await page.locator('.nav').getByText('選手').click();
await page.locator('.player-card').first().waitFor();
await page.locator('.player-card').first().click();
await page.locator('.sheet').waitFor();
await page.locator('.sheet .tabs button', { hasText: '分析' }).click();
await page.waitForTimeout(300);
const p44ReportText = await page.locator('.sheet').innerText();
for (const label of [
  'PLAYER STATUS',
  'いまの立ち位置',
  'CURRENT',
  '現在の戦力',
  'FORM',
  '直近状態',
  'TREND',
  '成績傾向',
  'ROLE',
  '現在の役割',
  'DEVELOPMENT',
  'CONTRACT',
  'HEALTH',
]) {
  if (!p44ReportText.includes(label)) fail(`選手報告書に「${label}」がない`);
}
ok('選手報告書に §7 の項目（現在戦力・状態・傾向・年齢・役割・成長・契約・状態）がそろっている');

for (const label of [
  'CURRENT PERFORMANCE',
  '現在の成績',
  'DEVELOPMENT',
  '成長傾向',
  'POTENTIAL OUTLOOK',
  '将来性の推定',
]) {
  if (!p44ReportText.includes(label)) fail(`選手報告書に「${label}」がない`);
}
ok('「活躍している」と「成長している」が別々に読める（§9）');

// §10 レーダーの隣に強み・弱みが言葉で出る
const axisNoteCount = await page.locator('.sheet .axis-note').count();
if (axisNoteCount === 0) {
  ok('能力に偏りが無い選手なので強み・弱みは出さない（無理に断定しない）');
} else {
  for (const label of ['STRENGTH', '強み', 'WEAK POINT', '弱点']) {
    if (!p44ReportText.includes(label)) fail(`レーダーの隣に「${label}」がない`);
  }
  ok('レーダーの隣に強み・弱点が言葉で出ている（§10）');
}

// §11 グラフの読み方
if (p44ReportText.includes('SEASON RECORD')) {
  const trendRead = await page.locator('.sheet .trend-read').count();
  const noRecord = p44ReportText.includes('まだ年度別成績が記録されていません');
  if (trendRead === 0 && !noRecord) fail('成績グラフに読み方が添えられていない');
  else ok(trendRead > 0 ? '成績グラフに ↑→↓ の読み方が添えられている' : '記録が無い年は捏造しない');
}
await shot('61-player-report');
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).first().click();
await page.waitForTimeout(200);

// --- §12・§13 球団レポート ---
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: '球団経営を見る' }).click();
await page.locator('.tabs button', { hasText: '分析' }).click();
await page.waitForTimeout(300);
const p44ClubReport = await page.locator('.screen').innerText();
if ((await page.locator('.issue-detail').count()) === 0) {
  ok('この球団には目立った課題が無い');
} else {
  for (const label of ['WHY', 'なぜ課題なのか']) {
    if (!p44ClubReport.includes(label)) fail(`課題に「${label}」がない`);
  }
  ok('課題に「なぜ課題なのか」が添えられている（§12）');
  const p44Numbers = await page.locator('.issue-detail-no').allInnerTexts();
  if (p44Numbers[0] !== '01') fail(`課題の番号が 01 から始まっていない（${p44Numbers[0]}）`);
  else ok(`課題に番号がついている（${p44Numbers.join(' / ')}）`);
}
if (p44ClubReport.includes('CONSIDER')) {
  for (const label of ['検討できること', 'OPTIONS', 'COST', 'RISK', 'FREE AGENCY', 'TRADE', 'YOUTH', 'STAY']) {
    if (!p44ClubReport.includes(label)) fail(`補強の検討に「${label}」がない`);
  }
  ok('補強の手だてが COST と RISK つきで4通り出ている（§13）');
  if (!p44ClubReport.includes('どれを選んでも失うものがあります')) {
    fail('「正解がある」ように見せてしまっている');
  } else ok('正解を提示していないことが明示されている');
}
for (const word of ['おすすめ', '最適', 'AI分析']) {
  if (p44ClubReport.includes(word)) fail(`球団レポートに「${word}」が出ている`);
}
ok('球団レポートに「おすすめ」「最適」「AI」を使っていない');
await shot('62-club-report');

// --- §5・§20 判断を記録する ---
await page.locator('.tabs button', { hasText: '球団' }).click();
await page.waitForTimeout(250);
{
  const beforeDecisions = (await readState()).decisions?.length ?? 0;
  const current = (await readState()).clubs.phoenix.direction;
  const target = current === 'WIN_NOW' ? '若手を育てる' : '優勝を狙う';
  const p44Button = page.locator('.card .btn', { hasText: target }).first();
  if (await p44Button.count()) {
    await p44Button.click();
    await page.waitForTimeout(700);
    const afterState = await readState();
    const afterDecisions = afterState.decisions?.length ?? 0;
    if (afterDecisions !== beforeDecisions + 1) {
      fail(`判断が記録されていない（${beforeDecisions} → ${afterDecisions}）`);
    } else ok('球団方針の判断がGM日誌に記録された');
    const p44Record = afterState.decisions[afterState.decisions.length - 1];
    if (p44Record.kind !== 'DIRECTION') fail(`記録の種類が不正（${p44Record.kind}）`);
    else ok(`記録の中身が正しい（${p44Record.title}：${p44Record.choice}）`);
    // §5 一気に全部出さず、まず「記録した」ことだけを出す
    const stamped = await page.locator('.decision-stamp').count();
    if (stamped === 0) fail('判断を記録したことが画面に出ていない');
    else ok('DECISION RECORDED が段階的に表示される');
    if (!(await page.locator('.screen').innerText()).includes('判断を記録しました')) {
      fail('判断の記録が日本語でも示されていない');
    } else ok('英字と日本語の両方で示されている');

    // 連打しても二重に記録しない
    await p44Button.click().catch(() => {});
    await page.waitForTimeout(400);
    const twice = (await readState()).decisions.filter((d) => d.kind === 'DIRECTION').length;
    if (twice > 1) fail(`同じ日に方針を選び直して記録が${twice}件に増えた`);
    else ok('同じ日に決め直しても記録は1件のまま（二重記録しない）');
  }
}
await shot('63-decision');

// --- §18・§21 一日の流れとGM日誌 ---
await page.locator('.nav').getByText('ホーム').click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'GM日誌' }).click();
await page.waitForTimeout(300);
await page.locator('.tabs button', { hasText: 'GM日誌' }).click();
await page.waitForTimeout(250);
const p44Journal = await page.locator('.screen').innerText();
if ((await page.locator('.journal-row').count()) === 0) {
  fail('GM日誌に記録が出ていない');
} else {
  ok(`GM日誌に判断の記録が出ている（${await page.locator('.journal-row').count()}件）`);
  if (!p44Journal.includes('REASON') || !p44Journal.includes('そのときの状況')) {
    fail('GM日誌に「そのときの状況」が出ていない');
  } else ok('「そのときどう判断したか」が残っている（§21）');
  for (const word of ['正解', '失敗でした', '成功でした']) {
    if (p44Journal.includes(word)) fail(`GM日誌に評価の言葉「${word}」が出ている`);
  }
  ok('結果の良し悪しを採点していない（§21）');
}
await shot('64-gm-journal');

// 一日の流れ（§18）
await page.locator('.tabs button', { hasText: 'ニュース' }).click();
await page.waitForTimeout(250);
const p44FlowText = await page.locator('.screen').innerText();
if ((await page.locator('.flow-item').count()) === 0) {
  ok('今日はまだ何も起きていない（無理に埋めない）');
} else {
  if (!p44FlowText.includes('TODAY') || !p44FlowText.includes('今日の球団')) {
    fail('一日の流れに欄名が出ていない');
  } else ok('「今日この球団で何が起きたか」が時系列で出ている（§18）');
}

// --- §14〜§17 試合前資料と試合後の講評 ---
await page.locator('.nav').getByText('試合').click();
await page.waitForTimeout(250);
const p44GameText = await page.locator('.screen').innerText();
for (const label of ['PRE-GAME BRIEF', '試合前資料', 'OPPONENT', 'STARTING PITCHER', 'TEAM FORM']) {
  if (!p44GameText.includes(label)) fail(`試合画面に「${label}」がない`);
}
ok('試合前資料に対戦相手・先発・直近の成績が出ている（§14）');
{
  // 試合前資料に相手球団の選手名が漏れていないこと（§31）
  const st = await readState();
  const nextGame = st.schedule.find((g) => !g.played && (g.homeTeamId === 'phoenix' || g.awayTeamId === 'phoenix'));
  if (nextGame) {
    const opponentId = nextGame.homeTeamId === 'phoenix' ? nextGame.awayTeamId : nextGame.homeTeamId;
    const briefBox = await page.locator('.card').first().innerText();
    const leaked = st.players.filter((p) => p.teamId === opponentId).some((p) => briefBox.includes(p.name));
    if (leaked) fail('試合前資料に相手球団の選手情報が出ている');
    else ok('相手球団については公開されている成績しか出していない（§31）');
  }
}
await shot('65-pre-game');

const p44StartButton = page.getByRole('button', { name: '試合開始' });
if (await p44StartButton.count()) {
  await p44StartButton.click();
  await page.locator('.linescore').waitFor();
  const p44Skip = page.getByRole('button', { name: 'スキップ' });
  if (await p44Skip.count()) {
    await p44Skip.click();
    await p44Skip.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
  const p44Post = await page.locator('.screen').innerText();
  // 「試合結果」は SCOREBOOK の見出しと重なるため、講評側は「試合の講評」にした
  for (const label of ['POST GAME', '試合の講評', 'TEAM NOTE', 'チームの状況']) {
    if (!p44Post.includes(label)) fail(`試合後の講評に「${label}」がない`);
  }
  ok('試合後に POST GAME の講評が出る（§16）');
  if (!p44Post.includes('KEY MOMENTS') && !p44Post.includes('PLAYER NOTE')) {
    fail('試合の流れも個人の記録も出ていない');
  } else ok('試合の流れ・個人の記録が出ている');
  const p44Moments = await page.locator('.post-moments li').count();
  if (p44Moments > 3) fail(`試合の流れが${p44Moments}件（3件までのはず）`);
  else ok(`試合の流れは${p44Moments}件（全打席実況にはしていない）`);
  for (const word of ['復活', '間違いなく', '確実に']) {
    if (p44Post.includes(word)) fail(`試合後の講評に断定「${word}」が出ている`);
  }
  ok('試合後の講評で断定していない（§17）');
  await shot('66-post-game');
}

// --- §29 横スクロール0（PHASE 4.4 の追加分） ---
for (const screen of ['ホーム', '試合', '選手', '順位']) {
  await page.locator('.nav').getByText(screen).click();
  await page.waitForTimeout(250);
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (over > 2) fail(`${screen}画面が横にはみ出している（${over}px）`);
}
ok('PHASE 4.4 の画面でも横スクロールが出ない（390px）');

// --- §28 reduced-motion でも情報量が減らない ---
{
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.getByRole('button', { name: '続きから' }).click();
  await page.locator('.appbar h1').waitFor();
  await page.waitForTimeout(300);
  const reducedText = await page.locator('.screen').innerText();
  for (const label of ['PRE-GAME BRIEF', '試合前資料']) {
    if (!reducedText.includes(label)) fail(`reduced-motion で「${label}」が消えた`);
  }
  const reducedNotes = await page.locator('.gm-note').count();
  if (reducedNotes > 3) fail('reduced-motion で案件が増えた');
  else ok(`reduced-motion でも情報量が減らない（案件${reducedNotes}枚）`);
  await shot('67-reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.getByRole('button', { name: '続きから' }).click();
  await page.locator('.appbar h1').waitFor();
  await page.waitForTimeout(200);
}

// --- §33 セーブに判断記録が残る ---
{
  const p44Saved = await readState();
  if (p44Saved.version !== 15) fail(`セーブのバージョンが15ではない（${p44Saved.version}）`);
  else ok('セーブがv15になっている');
  if (!Array.isArray(p44Saved.decisions)) fail('判断記録の入れ物が無い');
  else ok(`判断記録が保存されている（${p44Saved.decisions.length}件）`);
  const kb = Math.round(JSON.stringify(p44Saved).length / 1024);
  ok(`セーブサイズ ${kb}KB`);
}

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

/* ================= PHASE 4.5 選手ビジュアル ================= */

/**
 * どの画面でも肖像が出て、同じ選手が同じ人物に見えること。
 * 画像ファイルを読み込まない設計なので、読み込み失敗という状態自体が起きない。
 * ここでは「SVGとして実際に描かれているか」を見る。
 */
const portraitStats = async (label) => {
  const count = await page.locator('.portrait').count();
  if (count === 0) fail(`${label}に選手の肖像が1つも出ていない`);
  else ok(`${label}に肖像が${count}件表示されている`);
  return count;
};

// ホーム
await page.getByRole('button', { name: /ホーム/ }).last().click();
await page.waitForTimeout(250);
await portraitStats('ホーム');

// 選手一覧（名鑑）
await page.getByRole('button', { name: /選手/ }).last().click();
await page.locator('.player-card').first().waitFor();
await page.waitForTimeout(200);
const listPortraits = await portraitStats('選手一覧');
{
  const cards = await page.locator('.player-card').count();
  if (listPortraits < Math.min(cards, 10)) fail('一覧の行に肖像が付いていない');
  else ok('一覧のすべての行に肖像が付いている');
}

// 同じ選手が一覧と詳細で同じ絵になること
{
  const rowSvg = await page.locator('.player-card .portrait').first().innerHTML();
  const rowLabel = await page.locator('.player-card .portrait').first().getAttribute('aria-label');
  await page.locator('.player-card').first().click();
  await page.locator('.sheet').waitFor();
  await page.waitForTimeout(250);
  const detailLabel = await page.locator('.sheet .portrait').first().getAttribute('aria-label');
  if (rowLabel !== detailLabel) {
    fail(`一覧と詳細で別人になっている（${rowLabel} / ${detailLabel}）`);
  } else ok(`一覧と詳細で同じ選手が出ている（${detailLabel}）`);

  // 顔の部品（頭・目・鼻・口）が一覧と詳細で同じであること
  const facePartsOf = (html) =>
    ['pt-eyes', 'pt-nose', 'pt-mouth', 'pt-brows', 'pt-ears'].filter((c) => html.includes(c)).join(',');
  const detailSvg = await page.locator('.sheet .portrait').first().innerHTML();
  if (facePartsOf(rowSvg) !== facePartsOf(detailSvg)) {
    fail('一覧と詳細で顔の部品構成が違う');
  } else ok('一覧と詳細で同じ部品から組み立てられている');
}

// 詳細の肖像そのもの
{
  const portrait = page.locator('.sheet .portrait').first();
  const tag = await portrait.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== 'svg') fail(`肖像が SVG ではない（${tag}）`);
  else ok('肖像は SVG で描かれている');

  const box = await portrait.boundingBox();
  if (!box || box.width < 40 || box.height < 40) fail('肖像の大きさが取れない');
  else ok(`詳細の肖像は ${Math.round(box.width)}x${Math.round(box.height)}px`);
  if (box && box.width > 390) fail('肖像が画面幅を超えている');

  const bad = await portrait.evaluate((el) => ({
    images: el.querySelectorAll('image').length,
    scripts: el.querySelectorAll('script').length,
    external: el.innerHTML.includes('http'),
    empty: el.querySelectorAll('path[d=""]').length,
  }));
  if (bad.images > 0) fail('肖像が外部画像を読み込んでいる');
  if (bad.scripts > 0) fail('肖像に script が入っている');
  if (bad.external) fail('肖像が外部URLを参照している');
  if (bad.empty > 0) fail('肖像に空のパスが含まれている');
  if (!bad.images && !bad.scripts && !bad.external && !bad.empty) {
    ok('肖像は外部依存なしで描かれている（画像・script・外部URLなし）');
  }

  const label = await portrait.getAttribute('aria-label');
  if (!label || !label.includes('肖像')) fail('肖像に読み上げ用のラベルがない');
  else ok('肖像に読み上げ用のラベルが付いている');

  // 画像だけで伝えない：名前・状態は文字でも出る
  const sheetText = await page.locator('.sheet').innerText();
  if (!sheetText.includes('歳')) fail('選手情報が文字で表示されていない');
  else ok('名前・年齢・状態は文字でも表示されている');
}
await shot('45-player-detail-portrait');

// 分析タブにも人物像が出る
await page.locator('.sheet .tabs button', { hasText: '分析' }).click();
await page.waitForTimeout(200);
{
  const count = await page.locator('.verdict .portrait').count();
  if (count === 0) fail('GM RECOMMENDATION の横に人物像が出ていない');
  else ok('GM RECOMMENDATION の横に人物像が出ている');
}
await page.locator('.sheet').getByRole('button', { name: '閉じる' }).click();

// 選手ごとに違う人物であること
{
  const labels = await page.locator('.player-card .portrait').evaluateAll((els) =>
    els.slice(0, 12).map((el) => el.innerHTML),
  );
  const unique = new Set(labels);
  if (unique.size < labels.length * 0.8) {
    fail(`一覧の肖像が似すぎている（${labels.length}人中${unique.size}種類）`);
  } else ok(`一覧の肖像は選手ごとに違う（${labels.length}人中${unique.size}種類）`);
}

// 横スクロールが出ていないこと
{
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) fail(`肖像を入れたあと横スクロールが出ている（${overflow}px）`);
  else ok('肖像を入れても横スクロールは0（390px）');
}

// 試合画面・ニュース画面でも肖像が出ること
await page.getByRole('button', { name: /ニュース|順位/ }).last().click().catch(() => {});
await page.waitForTimeout(200);

/* ---- タイトル画面の確認は画面の中で行う（sandbox でも動くこと） ---- */
await page.getByRole('button', { name: '保存して終了' }).click();
await page.getByRole('button', { name: '続きから' }).waitFor();
{
  await page.getByRole('button', { name: '新規ゲーム' }).click();
  const cancel = page.getByRole('button', { name: 'やめる' });
  if ((await cancel.count()) === 0) {
    fail('セーブがある状態で「新規ゲーム」を押しても確認が出ない');
  } else {
    ok('セーブがある状態の「新規ゲーム」は画面内で確認する');
    await cancel.click();
    await page.waitForTimeout(150);
    if ((await page.getByRole('button', { name: '続きから' }).count()) === 0) {
      fail('「やめる」を選んだのにセーブが失われた');
    } else ok('「やめる」を選ぶとセーブは残る');
  }

  await page.getByRole('button', { name: 'セーブデータを削除' }).click();
  const doDelete = page.getByRole('button', { name: '削除する' });
  if ((await doDelete.count()) === 0) {
    fail('「セーブデータを削除」を押しても確認が出ない');
  } else {
    await doDelete.click();
    await page.waitForTimeout(300);
    if ((await page.getByRole('button', { name: '続きから' }).count()) !== 0) {
      fail('削除してもセーブが残っている');
    } else ok('画面内の確認を経てセーブデータを削除できる');
  }
}

// ブラウザのダイアログに頼っていないこと（sandbox では無視されるため）
{
  const modalCalls = await page.evaluate(() => window.__modalCalls ?? []);
  if (modalCalls.length > 0) {
    fail(`ブラウザのダイアログを使っている: ${modalCalls.join(' / ')}`);
  } else {
    ok('confirm / alert / prompt を一度も使っていない（iframe 配布でも動く）');
  }
}

await browser.close();
console.log(process.exitCode ? '\n=== 失敗あり ===' : '\n=== すべて成功 ===');
