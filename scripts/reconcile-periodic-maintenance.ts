import process from 'node:process';
import pool from '../packages/api/db.js';
import { generateFirstPeriodicMaintenanceTask } from '../packages/api/services/periodicMaintenanceTasks.js';

interface CandidateDevice {
  installedDeviceId: number;
  clientId: number;
  branchId: number;
  contractId: number | null;
  serviceAgreementId: number | null;
  activatedAt: string | null;
  activationResultAt: string | null;
}

function readPositiveIntegerArg(name: string): number | null {
  const prefix = `${name}=`;
  const direct = process.argv.find(arg => arg.startsWith(prefix));
  const index = process.argv.indexOf(name);
  const raw = direct?.slice(prefix.length)
    ?? (index >= 0 ? process.argv[index + 1] : null);
  if (raw == null) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  pnpm run reconcile:periodic-maintenance',
    '  pnpm run reconcile:periodic-maintenance -- --device-id 38',
    '  pnpm run reconcile:periodic-maintenance -- --apply',
    '',
    'Options:',
    '  --device-id <id>  Inspect or reconcile one installed device.',
    '  --apply           Persist generated tasks. Default is read-only dry-run.',
  ].join('\n'));
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const apply = process.argv.includes('--apply');
  const installedDeviceId = readPositiveIntegerArg('--device-id');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query<CandidateDevice>(
      `SELECT d.id AS "installedDeviceId",
              d.customer_id AS "clientId",
              d.branch_id AS "branchId",
              d.contract_id AS "contractId",
              sa.id AS "serviceAgreementId",
              d.activated_at AS "activatedAt",
              activation_result.activated_at AS "activationResultAt"
         FROM installed_devices d
         LEFT JOIN LATERAL (
           SELECT agreement.id
             FROM service_agreements agreement
            WHERE agreement.installed_device_id = d.id
              AND agreement.status = 'active'
              AND (agreement.start_date IS NULL OR agreement.start_date <= CURRENT_DATE)
              AND (agreement.end_date IS NULL OR agreement.end_date >= CURRENT_DATE)
            ORDER BY COALESCE(agreement.start_date, agreement.agreement_date) DESC,
                     agreement.id DESC
            LIMIT 1
         ) sa ON TRUE
         LEFT JOIN LATERAL (
           SELECT result.closed_at AS activated_at
             FROM open_tasks activation_task
             JOIN visit_tasks visit_task
               ON visit_task.source_open_task_id = activation_task.id
             JOIN visit_task_results result
               ON result.visit_task_id = visit_task.id
            WHERE activation_task.device_id = d.id
              AND activation_task.task_type = 'device_activation'
              AND result.final_decision = 'activated_successfully'
            ORDER BY result.closed_at DESC NULLS LAST, result.id DESC
            LIMIT 1
         ) activation_result ON TRUE
        WHERE d.status = 'active'
          AND ($1::int IS NULL OR d.id = $1)
          AND NOT EXISTS (
            SELECT 1
              FROM open_tasks task
             WHERE task.task_type = 'periodic_maintenance'
               AND task.device_id = d.id
               AND task.status NOT IN ('completed', 'closed', 'cancelled')
          )
        ORDER BY d.id
        FOR UPDATE OF d`,
      [installedDeviceId],
    );

    console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: ${rows.length} active device(s) without an active periodic task`);

    const results: Array<Record<string, unknown>> = [];
    for (const candidate of rows) {
      const recoveredActivationAt = candidate.activatedAt == null
        ? candidate.activationResultAt
        : null;
      if (apply && recoveredActivationAt != null) {
        await client.query(
          `UPDATE installed_devices
              SET activated_at = $2,
                  updated_at = NOW()
            WHERE id = $1
              AND activated_at IS NULL`,
          [Number(candidate.installedDeviceId), recoveredActivationAt],
        );
      }

      const result = await generateFirstPeriodicMaintenanceTask(
        client,
        Number(candidate.installedDeviceId),
        null,
        {
          dryRun: !apply,
          activationDateOverride: !apply ? recoveredActivationAt : null,
        },
      );
      results.push({
        installedDeviceId: Number(candidate.installedDeviceId),
        clientId: Number(candidate.clientId),
        branchId: Number(candidate.branchId),
        basis: candidate.contractId != null
          ? `contract:${candidate.contractId}`
          : candidate.serviceAgreementId != null
            ? `service_agreement:${candidate.serviceAgreementId}`
            : 'none',
        activatedAt: candidate.activatedAt ?? recoveredActivationAt,
        activationDateSource: candidate.activatedAt != null
          ? 'installed_device'
          : recoveredActivationAt != null
            ? 'successful_activation_result'
            : 'missing',
        dueDate: result.dueDate,
        intervalDays: result.intervalDays,
        outcome: result.createdTaskId != null
          ? `created:${result.createdTaskId}`
          : result.skippedReason,
      });
    }

    if (results.length > 0) console.table(results);

    if (apply) {
      await client.query('COMMIT');
      const createdCount = results.filter(row => String(row.outcome).startsWith('created:')).length;
      console.log(`Committed ${createdCount} periodic maintenance task(s).`);
    } else {
      await client.query('ROLLBACK');
      const wouldCreateCount = results.filter(row => row.outcome === 'dry_run_would_create').length;
      console.log(`Dry-run complete: ${wouldCreateCount} task(s) would be created; no rows were written.`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
