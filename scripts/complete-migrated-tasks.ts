// One-off completion of migrated tasks, run by the migration team on 62 before
// the copy to production (decisions D4 and D7, 2026-10-22).
//
//   collection  one collection task per confirmed contract installment that
//               still carries a balance on an active definitive contract and
//               has no active collection task. The application creates these
//               only when a contract is approved, which migrated contracts never
//               were.
//   snapshots   client / contract / device snapshots for open migrated tasks.
//               Completed tasks stay without one: a snapshot built today would
//               record today's address as the address of past work.
//
// Both parts call the application's own functions, so the rows match what the
// application writes. Dry run by default; safe to re-run.
import process from 'node:process';
import pool from '../packages/api/db.js';
import { createInstallmentCollectionTask } from '../packages/api/services/installmentCollectionTasks.js';
import { persistOpenTaskSnapshots } from '../packages/api/routes/openTasks.js';

type Part = 'collection' | 'snapshots';

const CLOSED_STATUSES = ['completed', 'closed', 'cancelled'];

function readArg(name: string): string | null {
  const direct = process.argv.find(arg => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function readLimit(): number | null {
  const raw = readArg('--limit');
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error('--limit must be a positive integer');
  return value;
}

function readParts(): Part[] {
  const only = readArg('--only');
  if (only == null) return ['collection', 'snapshots'];
  if (only !== 'collection' && only !== 'snapshots') throw new Error('--only must be collection or snapshots');
  return [only];
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  pnpm run migration:complete-tasks                      dry run: counts and a sample, writes nothing',
    '  pnpm run migration:complete-tasks -- --apply           write',
    '',
    'Options:',
    '  --only collection|snapshots   run one part only',
    '  --limit <n>                   process at most n rows per part (for a trial)',
  ].join('\n'));
}

async function completeCollectionTasks(apply: boolean, limit: number | null): Promise<void> {
  const { rows } = await pool.query<{ installmentId: number; contractNumber: string; remaining: string; dueDate: string }>(
    `SELECT i.id AS "installmentId", c.contract_number AS "contractNumber",
            i.remaining_balance AS remaining, i.due_date::text AS "dueDate"
       FROM contract_installments i
       JOIN contracts c ON c.id = i.contract_id
      WHERE i.confirmed = TRUE
        AND i.remaining_balance > 0
        AND c.status = 'active'
        AND c.sale_subtype = 'definitive'
        AND NOT EXISTS (
              SELECT 1 FROM open_tasks t
               WHERE t.task_type = 'installment_collection'
                 AND t.installment_id = i.id
                 AND t.status <> ALL($1::varchar[]))
      ORDER BY i.id
      ${limit ? `LIMIT ${limit}` : ''}`,
    [CLOSED_STATUSES],
  );
  const total = rows.reduce((sum, r) => sum + Number(r.remaining), 0);
  console.log(`[collection] ${rows.length} installments without a collection task, ${total.toLocaleString('en-US')} SYP`);
  if (!apply) {
    for (const r of rows.slice(0, 10)) {
      console.log(`  installment ${r.installmentId}  contract ${r.contractNumber}  due ${r.dueDate}  ${Number(r.remaining).toLocaleString('en-US')}`);
    }
    return;
  }

  const created: number[] = [];
  const skipped: Record<string, number> = {};
  for (const r of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createInstallmentCollectionTask(client, {
        installmentId: Number(r.installmentId),
        reason: 'contract_installment_due',
        creationOrigin: 'system_trigger',
        priority: 'medium',
      });
      await client.query('COMMIT');
      if (result.taskId) created.push(result.taskId);
      else skipped[result.reason ?? 'unknown'] = (skipped[result.reason ?? 'unknown'] ?? 0) + 1;
    } catch (err) {
      await client.query('ROLLBACK');
      skipped.error = (skipped.error ?? 0) + 1;
      console.error(`  installment ${r.installmentId}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  console.log(`[collection] created ${created.length}` + (created.length ? ` (tasks ${created[0]}–${created[created.length - 1]})` : ''));
  if (Object.keys(skipped).length) console.log('[collection] skipped', skipped);
}

async function completeSnapshots(apply: boolean, limit: number | null): Promise<void> {
  const { rows } = await pool.query<{ id: number; clientId: number; contractId: number | null; deviceId: number | null; taskType: string }>(
    `SELECT id, client_id AS "clientId", contract_id AS "contractId", device_id AS "deviceId", task_type AS "taskType"
       FROM open_tasks
      WHERE source_legacy_type IS NOT NULL
        AND client_snapshot IS NULL
        AND status <> ALL($1::varchar[])
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ''}`,
    [CLOSED_STATUSES],
  );
  const byType = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.taskType]: (acc[r.taskType] ?? 0) + 1 }), {});
  console.log(`[snapshots] ${rows.length} open migrated tasks without a snapshot`, byType);
  if (!apply) {
    console.log('  first ids:', rows.slice(0, 10).map(r => r.id).join(', '));
    return;
  }

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await persistOpenTaskSnapshots(pool, Number(r.id), Number(r.clientId), r.contractId, r.deviceId);
      done += 1;
    } catch (err) {
      failed += 1;
      console.error(`  task ${r.id}: ${(err as Error).message}`);
    }
    if ((done + failed) % 1000 === 0) console.log(`  … ${done + failed} / ${rows.length}`);
  }
  console.log(`[snapshots] built ${done}` + (failed ? `, failed ${failed}` : ''));
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }
  const apply = process.argv.includes('--apply');
  const limit = readLimit();
  const parts = readParts();
  console.log(apply ? 'APPLY — writing.' : 'DRY RUN — nothing is written. Add --apply to write.');

  // Collection first: the tasks it creates get their snapshots from the same call.
  if (parts.includes('collection')) await completeCollectionTasks(apply, limit);
  if (parts.includes('snapshots')) await completeSnapshots(apply, limit);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
