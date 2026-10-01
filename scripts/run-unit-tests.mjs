#!/usr/bin/env node
// Runs every unit test (*.test.ts / *.test.tsx) under packages/ with tsx's
// node:test runner. Integration tests (*.integration.test.*) need a live
// database and are excluded; DB-touching unit tests skip themselves when
// DATABASE_URL is unset (e.g. in CI).
//
// Files are run in batches because Windows caps command-line length.
// Run from the repo root — some tests read fixtures by repo-relative path.
//
//   pnpm test

import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const BATCH_SIZE = 40;
// Invoke tsx's CLI through the current node binary — no shell needed.
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.test\.tsx?$/.test(entry.name) && !/\.integration\.test\./.test(entry.name)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const files = collect(join(ROOT, 'packages')).sort();
if (files.length === 0) {
  console.error('No unit tests found under packages/.');
  process.exit(1);
}
console.log(`Running ${files.length} unit test files in batches of ${BATCH_SIZE}…`);

let failed = false;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  const result = spawnSync(process.execPath, [TSX_CLI, '--test', ...batch], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
