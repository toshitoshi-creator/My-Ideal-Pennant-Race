/** vite preview を起動して e2e/smoke.mjs を実行する */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

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

const smoke = spawn('node', ['e2e/smoke.mjs'], { stdio: 'inherit' });
smoke.on('exit', (code) => {
  preview.kill();
  process.exit(code ?? 1);
});
