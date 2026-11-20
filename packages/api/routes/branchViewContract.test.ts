import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// Records lists must take their branch bound from services/branchViewService.ts.
// Hand-writing "is the selected branch one of my assignments?" in a route is
// exactly how GLOBAL operators came to be refused branches in some sections and
// not others (2026-11-21). This test keeps the pattern from coming back.

const routesDir = new URL('./', import.meta.url);
const routeFiles = readdirSync(routesDir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));

// Files allowed to keep their own check, with the reason. Keep this list short.
const ALLOWED: Record<string, string> = {
  // Broadcast AUDIENCE (a write), not a records list; it already skips the check
  // for GLOBAL senders and bounds BRANCH senders to their assignments.
  'adminAppNotifications.ts': 'audience bound for a send, GLOBAL-aware',
};

test('no route hand-writes the assigned-branch guard for a selected branch', () => {
  const offenders: string[] = [];
  for (const file of routeFiles) {
    if (ALLOWED[file]) continue;
    const source = readFileSync(new URL(file, routesDir), 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/allowedBranchIds\.includes\(requested/.test(line)) {
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'Use resolveBranchView(authContext, permission, readRequestedBranchId(...)) instead:\n' + offenders.join('\n'),
  );
});

// A positional placeholder is written `$${params.length}` inside a template
// literal. Losing the first `$` (an easy slip in generated code) silently turns
// the bound parameter into a number literal: `ANY(3::int[])`.
test('no route builds a SQL comparison against a bare ${params.length}', () => {
  const offenders: string[] = [];
  for (const file of routeFiles) {
    const lines = readFileSync(new URL(file, routesDir), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/[^$](ANY\(|= |IN \()\$\{params\.length\}/.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the records lists resolve their branch bound through the shared branch view', () => {
  const expectations: Array<[string, string]> = [
    ['clients.ts', "resolveBranchView(authContext, 'clients.view_list'"],
    ['candidates.ts', "resolveBranchView(authContext, 'candidates.view_list'"],
    ['referralSheets.ts', "resolveBranchView(authContext, 'candidates.name_lists.view_list'"],
    ['employees.ts', "resolveBranchView(authContext, 'employees.view_list'"],
    ['openTasks.ts', "resolveBranchView(authContext, 'open_tasks.view'"],
    ['openTasks.ts', 'resolveBranchView(authContext, permission,'],
    ['roles.ts', "resolveBranchView(authContext, 'admin.users.view_list'"],
  ];
  for (const [file, needle] of expectations) {
    const source = readFileSync(new URL(file, routesDir), 'utf8');
    assert.ok(source.includes(needle), `${file} must call ${needle}…`);
  }
});
