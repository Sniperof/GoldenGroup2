import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLAINT_STATUS_UPDATE_SQL } from './complaintService.js';

test('complaint status update fixes PostgreSQL parameter types explicitly', () => {
  assert.match(COMPLAINT_STATUS_UPDATE_SQL, /\$2::varchar\(30\)/);
  assert.match(COMPLAINT_STATUS_UPDATE_SQL, /\$3::bigint/);
  assert.doesNotMatch(COMPLAINT_STATUS_UPDATE_SQL, /CASE WHEN \$2='/);
});
