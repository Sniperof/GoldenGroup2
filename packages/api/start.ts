import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { start } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await start();

// Run Vite from packages/web so it picks up that package's vite.config.ts
const vite = spawn('npx', ['vite'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
  cwd: path.resolve(__dirname, '..', 'web'),
});

process.on('SIGTERM', () => {
  vite.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});

vite.on('exit', (code) => {
  process.exit(code || 0);
});
