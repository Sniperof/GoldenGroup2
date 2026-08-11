import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationsDirectory = new URL('../../../../migrations/', import.meta.url);
const migrationFilename = '356_service_request_type_registry_contract.sql';
const migration = readFileSync(new URL(migrationFilename, migrationsDirectory), 'utf8');

test('registry contract migration runs after legacy seed and before canonical consumers', () => {
  const orderedMigrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const contractIndex = orderedMigrations.indexOf(migrationFilename);
  assert.ok(contractIndex > orderedMigrations.indexOf('355_seed_water_check_request_type.sql'));
  assert.ok(contractIndex < orderedMigrations.indexOf('367_seed_account_creation_request_type.sql'));
  assert.ok(contractIndex < orderedMigrations.indexOf('379_water_check_runtime_registry.sql'));
  assert.ok(contractIndex < orderedMigrations.indexOf('382_request_permission_families.sql'));
});

test('registry contract normalizes the legacy key and provides every runtime column', () => {
  assert.match(migration, /RENAME\s+COLUMN\s+code\s+TO\s+request_type/i);

  const runtimeColumns = [
    'request_type',
    'label_ar',
    'description_ar',
    'is_active',
    'display_order',
    'default_form_version',
    'form_source',
    'channels',
    'submitter_tiers',
    'submission_modes',
    'external_party_policy',
    'mismatch_policy',
    'linkage_policy',
    'permission_policy',
    'audit_policy',
  ];

  for (const column of runtimeColumns) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, 'i'), `missing ${column}`);
  }

  assert.match(
    migration,
    /ALTER\s+COLUMN\s+default_form_version\s+SET\s+DEFAULT[\s\S]*ALTER\s+COLUMN\s+default_form_version\s+SET\s+NOT\s+NULL/i,
  );
  assert.match(
    migration,
    /ALTER\s+COLUMN\s+permission_policy\s+SET\s+DEFAULT[\s\S]*ALTER\s+COLUMN\s+permission_policy\s+SET\s+NOT\s+NULL/i,
  );
});

test('registry contract seeds the historical default and enforces the canonical FK', () => {
  assert.match(
    migration,
    /INSERT\s+INTO\s+public\.service_request_type_config[\s\S]*'emergency_maintenance'/i,
  );
  assert.match(
    migration,
    /FOREIGN\s+KEY\s*\(request_type\)[\s\S]*REFERENCES\s+public\.service_request_type_config\s*\(request_type\)/i,
  );
  assert.match(migration, /unregistered request types/i);
  assert.match(migration, /both request_type and legacy code exist/i);
});
