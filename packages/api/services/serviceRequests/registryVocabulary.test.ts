// Contract test for the registry's declared vocabularies.
//
// Migration 401 unified `submission_modes` on `for_self`. This test is the
// guard that keeps it unified: a future seed that writes `self` again would
// pass tsc, pass every unit test, and only surface as a refused submission on
// the day that type gets a mobile handler.
//
// Runs against the live dev DB; skips itself when no DATABASE_URL is present
// so it never turns a CI box without Postgres red.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DATABASE_URL } from '../../config/env.js';

const SUBMISSION_MODES = ['for_self', 'for_another', 'nomination', 'self_only', 'staff_on_behalf'];
const CHANNELS = [
  'phone', 'internal_button', 'client_detail_button', 'admin_manual',
  'mobile_app', 'website', 'whatsapp',
];
const SUBMITTER_TIERS = ['visitor', 'customer', 'lead', 'fop', 'op', 'staff'];

test('registry vocabularies stay inside the declared sets', { skip: !DATABASE_URL }, async () => {
  const { default: pool } = await import('../../db.js');
  try {
    const { rows } = await pool.query<{
      request_type: string;
      submission_modes: string[];
      channels: string[];
      submitter_tiers: string[];
    }>(
      `SELECT request_type, submission_modes, channels, submitter_tiers
         FROM public.service_request_type_config`,
    );
    assert.ok(rows.length > 0, 'the registry should not be empty');

    for (const row of rows) {
      for (const mode of row.submission_modes ?? []) {
        assert.ok(
          SUBMISSION_MODES.includes(mode),
          `${row.request_type}: submission mode "${mode}" is not in the declared set` +
          (mode === 'self' ? ' — use "for_self" (migration 401)' : ''),
        );
      }
      for (const channel of row.channels ?? []) {
        assert.ok(CHANNELS.includes(channel), `${row.request_type}: unknown channel "${channel}"`);
      }
      for (const tier of row.submitter_tiers ?? []) {
        assert.ok(SUBMITTER_TIERS.includes(tier), `${row.request_type}: unknown tier "${tier}"`);
      }
    }
  } finally {
    const { default: pool } = await import('../../db.js');
    await pool.end();
  }
});
