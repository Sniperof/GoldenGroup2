#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';

const REQUIRED_COLUMNS = ['entity_type', 'match_key', 'match_value', 'legacy_status'];
const VALID_ENTITY_TYPES = new Set(['device_model', 'spare_part']);
const VALID_MATCH_KEYS = new Set(['id', 'code', 'name']);
const ACTIVE_VALUES = new Set(['active', 'enabled', 'true', '1', 'yes', 'y']);
const INACTIVE_VALUES = new Set(['inactive', 'disabled', 'false', '0', 'no', 'n']);

function usage() {
  return [
    'Usage:',
    '  node scripts/legacy-catalog-active-state-repair.mjs --file legacy_catalog_active_state.csv',
    '  node scripts/legacy-catalog-active-state-repair.mjs --file legacy_catalog_active_state.csv --apply',
    '',
    'Options:',
    '  --file <path>          CSV mapping file.',
    '  --database-url <url>   Overrides DATABASE_URL.',
    '  --apply                Write changes. Without this flag the script is dry-run only.',
  ].join('\n');
}

function getArg(name) {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((record) => record.some((value) => value.trim() !== ''));
}

function normalizeBoolean(value, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (ACTIVE_VALUES.has(raw)) return true;
  if (INACTIVE_VALUES.has(raw)) return false;
  throw new Error(`Invalid legacy_deleted value "${value}". Use true or false.`);
}

function normalizeStatus(value, legacyDeleted) {
  if (legacyDeleted) return false;

  const raw = String(value ?? '').trim().toLowerCase();
  if (ACTIVE_VALUES.has(raw)) return true;
  if (INACTIVE_VALUES.has(raw)) return false;
  throw new Error(`Invalid legacy_status value "${value}". Use Active or Inactive.`);
}

function rowsFromCsv(records) {
  if (records.length < 2) {
    throw new Error('CSV file must include a header row and at least one data row.');
  }

  const headers = records[0].map((header) => header.trim().replace(/^\uFEFF/, ''));
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) {
      throw new Error(`CSV file is missing required column "${column}".`);
    }
  }

  return records.slice(1).map((record, index) => {
    const data = Object.fromEntries(headers.map((header, columnIndex) => [header, record[columnIndex] ?? '']));
    const entityType = data.entity_type.trim();
    const matchKey = data.match_key.trim();
    const matchValue = data.match_value.trim();
    const legacyDeleted = normalizeBoolean(data.legacy_deleted, false);
    const desiredIsActive = normalizeStatus(data.legacy_status, legacyDeleted);

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw new Error(`Row ${index + 2}: invalid entity_type "${entityType}".`);
    }
    if (!VALID_MATCH_KEYS.has(matchKey)) {
      throw new Error(`Row ${index + 2}: invalid match_key "${matchKey}".`);
    }
    if (!matchValue) {
      throw new Error(`Row ${index + 2}: match_value is required.`);
    }
    if (matchKey === 'id' && !/^\d+$/.test(matchValue)) {
      throw new Error(`Row ${index + 2}: id match_value must be a positive integer.`);
    }

    return {
      rowNumber: index + 2,
      entityType,
      matchKey,
      matchValue,
      legacyStatus: data.legacy_status.trim(),
      legacyDeleted,
      desiredIsActive,
    };
  });
}

async function assertSchema(client) {
  const { rows } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('device_models', 'spare_parts')
      AND column_name IN ('is_active', 'deleted_at')
  `);

  const available = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const required = [
    'device_models.is_active',
    'device_models.deleted_at',
    'spare_parts.is_active',
    'spare_parts.deleted_at',
  ];
  const missing = required.filter((column) => !available.has(column));
  if (missing.length > 0) {
    throw new Error(`Database is missing required catalog columns: ${missing.join(', ')}.`);
  }
}

function matchSql(item) {
  if (item.entityType === 'device_model') {
    if (item.matchKey === 'id') {
      return {
        sql: `SELECT id, code, COALESCE(name_ar, name, name_en) AS label, is_active, deleted_at
              FROM device_models
              WHERE id = $1::int`,
        params: [item.matchValue],
      };
    }
    if (item.matchKey === 'code') {
      return {
        sql: `SELECT id, code, COALESCE(name_ar, name, name_en) AS label, is_active, deleted_at
              FROM device_models
              WHERE code IS NOT NULL AND lower(code) = lower($1)`,
        params: [item.matchValue],
      };
    }
    return {
      sql: `SELECT id, code, COALESCE(name_ar, name, name_en) AS label, is_active, deleted_at
            FROM device_models
            WHERE lower(name) = lower($1)
               OR lower(COALESCE(name_ar, '')) = lower($1)
               OR lower(COALESCE(name_en, '')) = lower($1)`,
      params: [item.matchValue],
    };
  }

  if (item.matchKey === 'id') {
    return {
      sql: `SELECT id, code, name AS label, is_active, deleted_at
            FROM spare_parts
            WHERE id = $1::int`,
      params: [item.matchValue],
    };
  }
  if (item.matchKey === 'code') {
    return {
      sql: `SELECT id, code, name AS label, is_active, deleted_at
            FROM spare_parts
            WHERE code IS NOT NULL AND lower(code) = lower($1)`,
      params: [item.matchValue],
    };
  }
  return {
    sql: `SELECT id, code, name AS label, is_active, deleted_at
          FROM spare_parts
          WHERE lower(name) = lower($1)`,
    params: [item.matchValue],
  };
}

async function buildPlan(client, mappingRows) {
  const issues = [];
  const byTarget = new Map();

  for (const item of mappingRows) {
    const query = matchSql(item);
    const { rows } = await client.query(query.sql, query.params);

    if (rows.length === 0) {
      issues.push(`Row ${item.rowNumber}: no ${item.entityType} matched ${item.matchKey}="${item.matchValue}".`);
      continue;
    }
    if (rows.length > 1) {
      issues.push(`Row ${item.rowNumber}: ${rows.length} ${item.entityType} rows matched ${item.matchKey}="${item.matchValue}".`);
      continue;
    }

    const current = rows[0];
    const targetKey = `${item.entityType}:${current.id}`;
    const existing = byTarget.get(targetKey);
    const desiredDeletedAt = item.legacyDeleted ? 'set_if_null' : null;

    if (existing) {
      if (existing.desiredIsActive !== item.desiredIsActive || existing.legacyDeleted !== item.legacyDeleted) {
        issues.push(`Rows ${existing.sourceRows.join(', ')} and ${item.rowNumber}: conflicting updates for ${targetKey}.`);
      } else {
        existing.sourceRows.push(item.rowNumber);
      }
      continue;
    }

    byTarget.set(targetKey, {
      targetKey,
      entityType: item.entityType,
      id: Number(current.id),
      code: current.code,
      label: current.label,
      currentIsActive: current.is_active,
      currentDeletedAt: current.deleted_at,
      desiredIsActive: item.desiredIsActive,
      desiredDeletedAt,
      legacyDeleted: item.legacyDeleted,
      sourceRows: [item.rowNumber],
      sourceStatus: item.legacyStatus,
      match: `${item.matchKey}=${item.matchValue}`,
    });
  }

  return { issues, plan: [...byTarget.values()] };
}

function printPlan(plan, apply) {
  const changed = plan.filter((item) => {
    const desiredDeleted = item.legacyDeleted;
    const currentlyDeleted = item.currentDeletedAt != null;
    return item.currentIsActive !== item.desiredIsActive || currentlyDeleted !== desiredDeleted;
  });

  console.log(`Mapping rows resolved: ${plan.length}`);
  console.log(`Rows that would change: ${changed.length}`);

  for (const item of changed) {
    const deletedText = item.legacyDeleted
      ? `deleted_at: ${item.currentDeletedAt ? 'kept' : 'set'}`
      : `deleted_at: ${item.currentDeletedAt ? 'cleared' : 'already NULL'}`;
    console.log(
      `- ${item.targetKey} ${item.code ?? ''} "${item.label}": ` +
      `is_active ${item.currentIsActive} -> ${item.desiredIsActive}; ${deletedText}`
    );
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply after reviewing the changes.');
  }
}

async function applyPlan(client, plan) {
  await client.query('BEGIN');
  try {
    for (const item of plan) {
      const table = item.entityType === 'device_model' ? 'device_models' : 'spare_parts';
      if (item.legacyDeleted) {
        await client.query(
          `UPDATE ${table}
           SET is_active = FALSE,
               deleted_at = COALESCE(deleted_at, NOW())
           WHERE id = $1`,
          [item.id]
        );
      } else {
        await client.query(
          `UPDATE ${table}
           SET is_active = $2,
               deleted_at = NULL
           WHERE id = $1`,
          [item.id, item.desiredIsActive]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const file = getArg('--file');
  const databaseUrl = getArg('--database-url') ?? process.env.DATABASE_URL;
  const apply = process.argv.includes('--apply');

  if (!file) {
    throw new Error(`Missing --file.\n\n${usage()}`);
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Set it in the environment or pass --database-url.');
  }

  const records = parseCsv(await fs.readFile(file, 'utf8'));
  const mappingRows = rowsFromCsv(records);
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await assertSchema(client);
    const { issues, plan } = await buildPlan(client, mappingRows);
    if (issues.length > 0) {
      console.error('Mapping has blocking issues:');
      for (const issue of issues) console.error(`- ${issue}`);
      process.exitCode = 1;
      return;
    }

    printPlan(plan, apply);
    if (apply) {
      await applyPlan(client, plan);
      console.log('\nApplied catalog active-state mapping successfully.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

