import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Normalised: the checkout may give the .sql CRLF line endings (Windows / .gitattributes).
const sql = readFileSync(new URL('../../../migrations/474_sync_mediator_name_snapshots.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const fn = (name: string) => sql.slice(sql.indexOf(`FUNCTION public.${name}(`), sql.indexOf('$$ LANGUAGE plpgsql;', sql.indexOf(`FUNCTION public.${name}(`)));

test('mediator renames fire only on a real name change and cannot re-trigger themselves', () => {
  for (const table of ['clients', 'employees']) {
    assert.match(sql, new RegExp(`AFTER UPDATE OF name ON public\\.${table}\\s+FOR EACH ROW\\s+WHEN \\(OLD\\.name IS DISTINCT FROM NEW\\.name\\)`));
  }
  for (const name of ['tg_sync_client_mediator_name', 'tg_sync_employee_mediator_name']) {
    assert.doesNotMatch(fn(name), /SET name\b/, `${name} must never write a name column`);
  }
});

test('every snapshot copy is synced, always matched by type AND id', () => {
  for (const [name, kind] of [['tg_sync_client_mediator_name', 'Client'], ['tg_sync_employee_mediator_name', 'Employee']] as const) {
    const body = fn(name);
    for (const copy of [
      'UPDATE public.clients\n     SET referrer_name',
      'UPDATE public.clients\n     SET referrers',
      'UPDATE public.contracts\n     SET contract_referrers',
      'UPDATE public.candidates\n     SET referral_name_snapshot',
      'UPDATE public.referral_sheets\n     SET referral_name_snapshot',
      'UPDATE public.employees\n     SET referrer_name',
      'UPDATE public.client_referral_attributions\n     SET referrer_name',
    ]) assert.ok(body.includes(copy), `${name} misses: ${copy.split('\n')[0]}`);
    // an employee id can equal a client id — the type must be part of every match
    assert.equal((body.match(new RegExp(`'${kind}'`, 'g')) ?? []).length, 8, `${name} must type-check every copy`);
  }
});
