/**
 * vite preview を1回だけ起動して、e2e/smoke.mjs を複数回（既定8回）走らせる。
 * 新規ゲームのシードは毎回変わるので、これで複数シードの確認になる。
 *   node e2e/run-seeds.mjs [回数]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const RUNS = Number(process.argv[2] ?? 8);

const preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], {
  stdio: 'ignore',
});

const waitForServer = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4173');
      if (res.ok) return true;
    } catch {
      /* まだ起動していない */
    }
    await sleep(250);
  }
  return false;
};

if (!(await waitForServer())) {
  preview.kill();
  console.error('プレビューサーバーを起動できませんでした');
  process.exit(1);
}

const runOnce = (index) =>
  new Promise((resolve) => {
    const smoke = spawn('node', ['e2e/smoke.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, SHOT_DIR: `e2e/shots/run${index}` },
    });
    smoke.on('exit', (code) => resolve(code ?? 1));
  });

let failed = 0;
for (let i = 1; i <= RUNS; i++) {
  console.log(`\n========== E2E ${i}/${RUNS} 回目 ==========`);
  const code = await runOnce(i);
  if (code !== 0) {
    failed += 1;
    console.log(`---------- ${i}回目は失敗 ----------`);
  }
}

preview.kill();
console.log(`\n=== E2E ${RUNS}回中 ${RUNS - failed}回成功 ===`);
process.exit(failed > 0 ? 1 : 0);
