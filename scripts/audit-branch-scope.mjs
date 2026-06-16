#!/usr/bin/env node
/**
 * audit-branch-scope.mjs
 *
 * Prevents the recurrence of the "branch-scoped users are wrongly blocked"
 * bug. The branch context store (useBranchContextStore) is super-admin only;
 * list pages that gate on it directly block every branch-scoped user.
 *
 * Rule enforced: any file that renders a branch-selection block (the canonical
 * "يرجى اختيار فرع" message) MUST derive its gating from the shared
 * `useBranchListScope` hook, which guarantees branch/global users are never
 * blocked. New pages that copy the block without the hook fail CI here.
 *
 * Usage: node scripts/audit-branch-scope.mjs
 * Exit code 1 on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'packages', 'web', 'src');

const BLOCK_MESSAGE = 'يرجى اختيار فرع';
const REQUIRED_HOOK = 'useBranchListScope';
// Reading the raw super-admin store AND hand-rolling a branchId block is the
// exact anti-pattern; flag it even if the message text is reworded.
const RAW_STORE = 'useBranchContextStore';
const RAW_BLOCK = /if \(\s*!\s*(branchId|selectedBranchId)\s*\)/;

/** @type {string[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      check(full);
    }
  }
}

function check(file) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(join(__dirname, '..'), file).replace(/\\/g, '/');
  const usesHook = src.includes(REQUIRED_HOOK);

  if (src.includes(BLOCK_MESSAGE) && !usesHook) {
    violations.push(
      `${rel}: renders a "${BLOCK_MESSAGE}" block without ${REQUIRED_HOOK}().`,
    );
    return;
  }

  // A raw branchId/selectedBranchId block sourced from the super-admin store,
  // outside the hook, is the same bug even if worded differently.
  if (src.includes(RAW_STORE) && RAW_BLOCK.test(src) && !usesHook) {
    violations.push(
      `${rel}: blocks on a raw ${RAW_STORE} branchId — use ${REQUIRED_HOOK}() instead.`,
    );
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error('\n✗ Branch-scope audit failed — branch-scoped users would be blocked:\n');
  for (const v of violations) console.error('  • ' + v);
  console.error(
    `\nFix: gate the page with ${REQUIRED_HOOK}() (needsBranchSelection / effectiveBranchId).\n` +
    'See docs/constitution/domains/permissions-engineering-standard.md §5.3.\n',
  );
  process.exit(1);
}

console.log('✓ Branch-scope audit passed — no list page blocks branch-scoped users.');
