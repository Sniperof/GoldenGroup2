import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ClientModal.tsx', import.meta.url), 'utf8');

test('an empty assignment selection is sent explicitly so the last owner can be removed', () => {
  assert.match(source, /assignmentUserIds: canChooseAssignedOwner \? assignmentUserIds : undefined/);
});

test('editing the primary mediator preserves additional historical mediators', () => {
  assert.match(source, /initialData\.referrers\.slice\(1\)/);
  assert.match(source, /\[resolvedPrimaryReferrer, \.\.\.preservedAdditionalReferrers\]/);
});
