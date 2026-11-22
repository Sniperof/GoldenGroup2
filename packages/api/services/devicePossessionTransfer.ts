// Administrative transfer of a device's possession to another client
// (migration 500, product-owner decisions 2026-11-19).
//
// One transaction moves everything that names the holder, so the possession
// ledger and the rest of the system never disagree:
//   - the possession ledger (old holder closed, new one opened; a device with
//     no open row first gets the old holder's row, backdated to delivery);
//   - installed_devices.customer_id (and the location, when given; never the
//     branch — that is its own operation);
//   - the contract's current payer (contracts.payer_client_id; the buyer and
//     the signed legal copy stay) and the unpaid remainder of the contract and
//     of the golden warranties in the client ledger (discount on the old
//     holder, charge on the new one, at each installment's due date);
//   - the open collection tasks of those installments.
// Warranties stay on the device untouched. Maintenance installments stay with
// the client who received the service.
import type { PoolClient } from 'pg';
import type { AuthContext } from '@golden-crm/shared';
import { recordMovement } from './financialMovements.js';
import { labelDeviceChange } from './deviceActivityContext.js';
import { assertGeoUnitInScope } from './geoScopeService.js';
import { isInstallationGeoLevel, INSTALLATION_GEO_LEVEL_ERROR } from '../lib/installationGeoLevel.js';
import { persistOpenTaskSnapshots } from '../routes/openTasks.js';

export const TRANSFERABLE_DEVICE_STATUSES = ['delivered', 'installed', 'active', 'faulty', 'out_of_service'] as const;
export const POSSESSION_TRANSFER_REASONS_CATEGORY = 'device_possession_transfer_reasons';

const CLOSED_TASK_STATUSES = ['completed', 'cancelled', 'closed'];
// A collection task can follow the debt only before it is planned into a visit.
const MOVABLE_COLLECTION_STATUSES = ['open', 'needs_follow_up'];

export class PossessionTransferError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'PossessionTransferError';
  }
}

export interface PossessionTransferInput {
  deviceId: number;
  toClientId: number;
  reasonCode: string;
  notes?: string | null;
  /** Optional new location; omitted = the device stays where it is. */
  location?: {
    geoUnitId: number;
    addressText: string;
    lat?: number | null;
    lng?: number | null;
  } | null;
  authContext: AuthContext;
  userId: number;
}

export interface PossessionTransferResult {
  transferId: number;
  fromClientId: number | null;
  toClientId: number;
  contractBalanceSyp: number;
  warrantyBalanceSyp: number;
  movedTaskIds: number[];
  locationChanged: boolean;
}

function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new PossessionTransferError(status, code, message, details);
}

async function employeeIdOf(db: PoolClient, userId: number): Promise<number | null> {
  const { rows } = await db.query('SELECT employee_id FROM hr_users WHERE id = $1', [userId]);
  const id = Number(rows[0]?.employee_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Runs inside the caller's transaction (BEGIN already issued). */
export async function transferDevicePossession(
  db: PoolClient,
  input: PossessionTransferInput,
): Promise<PossessionTransferResult> {
  const notes = input.notes?.trim() || null;

  // ── The device ───────────────────────────────────────────────────────────
  const { rows: [device] } = await db.query(
    `SELECT d.id, d.status, d.customer_id, d.branch_id, d.contract_id, d.device_source,
            d.delivery_date, d.installation_date, d.created_at,
            d.installation_geo_unit_id, d.installation_address_text,
            d.serial_number, COALESCE(d.device_model_name, d.external_device_name) AS model
       FROM installed_devices d WHERE d.id = $1 FOR UPDATE`,
    [input.deviceId],
  );
  if (!device) fail(404, 'device_not_found', 'الجهاز غير موجود');
  if (!(TRANSFERABLE_DEVICE_STATUSES as readonly string[]).includes(device.status)) {
    fail(409, 'device_status_not_transferable',
      'لا تُنقل الحيازة إلا لجهاز عند الزبون: مُسلَّم، أو مركّب، أو نشط، أو معطل، أو خارج الخدمة');
  }
  const fromClientId: number | null = device.customer_id != null ? Number(device.customer_id) : null;
  if (fromClientId === input.toClientId) fail(400, 'same_client', 'الجهاز بحيازة هذا الزبون أصلاً');

  // ── The new holder ───────────────────────────────────────────────────────
  const { rows: [toClient] } = await db.query(
    `SELECT id, name, is_candidate, deleted_at FROM clients WHERE id = $1`,
    [input.toClientId],
  );
  if (!toClient || toClient.deleted_at) fail(404, 'client_not_found', 'الزبون الجديد غير موجود');
  if (toClient.is_candidate) fail(400, 'client_is_candidate', 'لا تُنقل الحيازة إلى اسم مقترح؛ حوّله إلى زبون أولاً');
  const { rows: [fromClient] } = fromClientId != null
    ? await db.query('SELECT name FROM clients WHERE id = $1', [fromClientId])
    : { rows: [null] };

  // ── The reason (managed list) ────────────────────────────────────────────
  const { rows: [reason] } = await db.query(
    `SELECT value, COALESCE(metadata->>'label', value) AS label
       FROM system_lists WHERE category = $1 AND value = $2 AND is_active = TRUE`,
    [POSSESSION_TRANSFER_REASONS_CATEGORY, input.reasonCode],
  );
  if (!reason) fail(400, 'invalid_reason', 'سبب النقل غير موجود في القائمة');
  if (reason.value === 'other' && !notes) fail(400, 'notes_required', 'اختيار «أخرى» يتطلب ملاحظة');

  // ── Blockers: operational device tasks, active service agreement ────────
  const { rows: openTasks } = await db.query(
    `SELECT ot.id, ot.task_type, ot.status
       FROM open_tasks ot
      WHERE ot.task_type <> 'installment_collection'
        AND ot.status <> ALL($3::text[])
        AND (ot.device_id = $1
             OR ($2::int IS NOT NULL AND ot.device_id IS NULL AND ot.contract_id = $2 AND ot.task_type LIKE 'device\\_%'))
      ORDER BY ot.id`,
    [device.id, device.contract_id, CLOSED_TASK_STATUSES],
  );
  if (openTasks.length > 0) {
    fail(409, 'open_device_tasks',
      `لا يمكن نقل الحيازة قبل إغلاق مهام الجهاز (مكتملة أو ملغاة): ${openTasks.map(t => `#${t.id}`).join('، ')}`,
      { taskIds: openTasks.map(t => Number(t.id)) });
  }
  const { rows: agreements } = await db.query(
    `SELECT id FROM service_agreements
      WHERE installed_device_id = $1 AND status = 'active'
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [device.id],
  );
  if (agreements.length > 0) fail(409, 'active_service_agreement', 'على الجهاز اتفاق خدمة فعّال؛ لا تُنقل حيازته');

  // ── Location (optional) ──────────────────────────────────────────────────
  const location = input.location ?? null;
  if (location) {
    if (!location.addressText?.trim()) fail(400, 'address_required', 'العنوان التفصيلي مطلوب عند تغيير الموقع');
    const { rows: [geo] } = await db.query('SELECT level FROM geo_units WHERE id = $1', [location.geoUnitId]);
    if (!geo || !isInstallationGeoLevel(geo.level)) fail(400, 'installation_geo_level_invalid', INSTALLATION_GEO_LEVEL_ERROR);
    const scope = await assertGeoUnitInScope(input.authContext, location.geoUnitId, 'geo_units.lookup', device.branch_id);
    if (!scope.allowed) fail(403, 'geo_unit_outside_branch_coverage', 'الموقع الجديد خارج تغطية فرع الجهاز');
  }

  // ── Collection tasks that follow the debt ────────────────────────────────
  const collectionTasks = await listFollowingCollectionTasks(db, Number(device.id), device.contract_id);
  const planned = collectionTasks.filter(t => !MOVABLE_COLLECTION_STATUSES.includes(t.status));
  if (planned.length > 0) {
    fail(409, 'collection_tasks_in_planning',
      `مهام تحصيل الأقساط ${planned.map(t => `#${t.id}`).join('، ')} مجدولة في زيارة أو قيد التخطيط؛ أخرجها من الجدولة قبل النقل`,
      { taskIds: planned.map(t => Number(t.id)) });
  }

  // ── Write: the transfer record first (its id labels the ledger lines) ───
  const employeeId = await employeeIdOf(db, input.userId);
  const { rows: [transfer] } = await db.query(
    `INSERT INTO device_possession_transfers (
       device_id, from_client_id, to_client_id, reason_code, notes, contract_id,
       location_changed, old_geo_unit_id, old_address_text, new_geo_unit_id, new_address_text, performed_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      device.id, fromClientId, input.toClientId, reason.value, notes, device.contract_id,
      location != null, device.installation_geo_unit_id, device.installation_address_text,
      location?.geoUnitId ?? null, location?.addressText?.trim() ?? null, input.userId,
    ],
  );
  const transferId = Number(transfer.id);
  const reasonText = notes ? `${reason.label} — ${notes}` : reason.label;

  // Possession ledger: give the old holder a row when the history never had one.
  const { rows: openRows } = await db.query(
    `SELECT id FROM device_possession_log WHERE device_id = $1 AND end_at IS NULL FOR UPDATE`,
    [device.id],
  );
  if (openRows.length === 0 && fromClientId != null) {
    await db.query(
      `INSERT INTO device_possession_log (device_id, holder_type, holder_id, start_at, end_at, reason, notes, created_by)
       VALUES ($1, 'customer', $2, LEAST($3::timestamptz, NOW()), NOW(), $4, 'سجل مُستكمل عند نقل الحيازة', $5)`,
      [
        device.id, fromClientId,
        device.delivery_date ?? device.installation_date ?? device.created_at,
        device.device_source === 'external' ? 'external_registration' : 'sale_delivery',
        employeeId,
      ],
    );
  } else {
    await db.query(`UPDATE device_possession_log SET end_at = NOW() WHERE device_id = $1 AND end_at IS NULL`, [device.id]);
  }
  const { rows: [possession] } = await db.query(
    `INSERT INTO device_possession_log (device_id, holder_type, holder_id, start_at, reason, reason_code, notes, created_by)
     VALUES ($1, 'customer', $2, NOW(), 'transfer', $3, $4, $5) RETURNING id`,
    [device.id, input.toClientId, reason.value, notes, employeeId],
  );

  // The device: holder (and location). The activity log (498) records it.
  await labelDeviceChange(db, 'possession_transfer', reasonText);
  if (location) {
    await db.query(
      `UPDATE installed_devices
          SET customer_id = $2, installation_geo_unit_id = $3, installation_address_text = $4,
              installation_lat = $5, installation_lng = $6, updated_at = NOW()
        WHERE id = $1`,
      [device.id, input.toClientId, location.geoUnitId, location.addressText.trim(), location.lat ?? null, location.lng ?? null],
    );
  } else {
    await db.query(`UPDATE installed_devices SET customer_id = $2, updated_at = NOW() WHERE id = $1`, [device.id, input.toClientId]);
  }

  const finances = await moveHolderFinances(db, {
    deviceId: Number(device.id), contractId: device.contract_id, branchId: device.branch_id,
    fromClientId, toClientId: input.toClientId,
    fromName: fromClient?.name ?? (fromClientId != null ? `#${fromClientId}` : '—'),
    toName: toClient.name ?? `#${input.toClientId}`,
    transferId, userId: input.userId, collectionTasks,
  });

  await db.query(
    `UPDATE device_possession_transfers
        SET possession_log_id = $2, contract_payer_from = $3, contract_balance_syp = $4,
            warranty_balance_syp = $5, moved_task_ids = $6
      WHERE id = $1`,
    [transferId, Number(possession.id), finances.contractPayerFrom, finances.contractBalance,
      finances.warrantyBalance, finances.movedTaskIds],
  );

  return {
    transferId, fromClientId, toClientId: input.toClientId,
    contractBalanceSyp: finances.contractBalance, warrantyBalanceSyp: finances.warrantyBalance,
    movedTaskIds: finances.movedTaskIds, locationChanged: location != null,
  };
}

interface FollowingCollectionTask { id: number; status: string; contract_id: number | null }

/** The open collection tasks of the device's contract and golden-warranty installments. */
async function listFollowingCollectionTasks(
  db: PoolClient,
  deviceId: number,
  contractId: number | null,
): Promise<FollowingCollectionTask[]> {
  const { rows } = await db.query(
    `SELECT ot.id, ot.status, ot.contract_id
       FROM open_tasks ot
      WHERE ot.task_type = 'installment_collection'
        AND ot.status <> ALL($3::text[])
        AND (
          ($2::int IS NOT NULL AND ot.installment_id IN (SELECT id FROM contract_installments WHERE contract_id = $2))
          OR ot.warranty_installment_id IN (
            SELECT i.id FROM device_warranty_installments i
              JOIN device_warranties w ON w.id = i.warranty_id
             WHERE w.device_id = $1 AND w.warranty_type = 'golden')
        )
      ORDER BY ot.id`,
    [deviceId, contractId, CLOSED_TASK_STATUSES],
  );
  return rows;
}

/**
 * What follows the holder when a device changes hands: the contract's current
 * payer and unpaid remainder, the golden warranties' unpaid remainder, and the
 * given collection tasks. Shared by the administrative transfer and the field
 * device_transfer task (another_customer).
 */
async function moveHolderFinances(db: PoolClient, input: {
  deviceId: number; contractId: number | null; branchId: number | null;
  fromClientId: number | null; toClientId: number; fromName: string; toName: string;
  transferId: number; userId: number; collectionTasks: FollowingCollectionTask[];
}): Promise<{ contractBalance: number; warrantyBalance: number; contractPayerFrom: number | null; movedTaskIds: number[] }> {
  const { fromClientId, fromName, toName, transferId } = input;
  const device = { id: input.deviceId, contract_id: input.contractId, branch_id: input.branchId };
  const collectionTasks = input.collectionTasks;

  // ── The contract: current payer + its unpaid remainder in the ledger ────
  let contractBalance = 0;
  let contractPayerFrom: number | null = null;
  if (device.contract_id != null) {
    const { rows: [c] } = await db.query(
      `SELECT c.id, c.status, c.sale_subtype, c.customer_id, c.payer_client_id, c.final_price, c.created_at,
              c.contract_number, COALESCE(c.service_branch_id, c.branch_id) AS branch_id,
              COALESCE((SELECT SUM(amount_syp) FROM contract_installments WHERE contract_id = c.id), 0) AS installments_total,
              COALESCE((SELECT SUM(CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END)
                          FROM contract_payment_entries
                         WHERE contract_id = c.id AND installment_id IS NULL), 0) AS signing_paid
         FROM contracts c WHERE c.id = $1 FOR UPDATE`,
      [device.contract_id],
    );
    if (c && c.status === 'active') {
      contractPayerFrom = Number(c.payer_client_id ?? c.customer_id);
      await db.query(
        `UPDATE contracts SET payer_client_id = $2 WHERE id = $1`,
        [c.id, Number(c.customer_id) === input.toClientId ? null : input.toClientId],
      );
      // The ledger only carries definitive contracts (financialMovements.syncContractMovements).
      if (c.sale_subtype === 'definitive' && contractPayerFrom !== input.toClientId) {
        const label = c.contract_number ?? c.id;
        const lines: Array<{ at: unknown; amount: number; what: string }> = [];
        const signingRemaining = Number(c.final_price) - Number(c.installments_total) - Number(c.signing_paid);
        if (signingRemaining > 0) lines.push({ at: c.created_at, amount: signingRemaining, what: `متبقّي قيمة العقد ${label}` });
        const { rows: installments } = await db.query(
          `SELECT installment_number, due_date, remaining_balance FROM contract_installments
            WHERE contract_id = $1 AND remaining_balance > 0 ORDER BY installment_number`,
          [c.id],
        );
        for (const i of installments) {
          lines.push({ at: i.due_date, amount: Number(i.remaining_balance), what: `قسط رقم ${i.installment_number} للعقد ${label}` });
        }
        for (const line of lines) {
          contractBalance += await moveDebt(db, {
            fromClientId: contractPayerFrom, toClientId: input.toClientId, fromName, toName,
            at: line.at, amount: line.amount, what: line.what, sourceType: 'contract_debt_transfer',
            sourceId: Number(c.id), contractId: Number(c.id), branchId: c.branch_id, transferId, userId: input.userId,
          });
        }
      }
    }
  }

  // ── Golden warranties: their unpaid remainder follows the device ────────
  let warrantyBalance = 0;
  if (fromClientId != null) {
    const { rows: warranties } = await db.query(
      `SELECT w.id, w.start_date FROM device_warranties w
        WHERE w.device_id = $1 AND w.warranty_type = 'golden' AND w.status IN ('active', 'pending')`,
      [device.id],
    );
    for (const w of warranties) {
      // What the old holder still owes on this warranty, from the ledger itself.
      const { rows: [owed] } = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN kind IN ('charge', 'refund') THEN amount_syp ELSE -amount_syp END), 0) AS outstanding
           FROM financial_movements
          WHERE client_id = $1 AND source_id = $2
            AND source_type IN ('golden_warranty', 'golden_warranty_installment', 'golden_warranty_payment', 'golden_warranty_debt_transfer')`,
        [fromClientId, w.id],
      );
      let outstanding = Number(owed?.outstanding ?? 0);
      if (!(outstanding > 0)) continue;
      const { rows: installments } = await db.query(
        `SELECT installment_number, due_date, remaining_balance FROM device_warranty_installments
          WHERE warranty_id = $1 AND remaining_balance > 0 ORDER BY installment_number`,
        [w.id],
      );
      const lines: Array<{ at: unknown; amount: number; what: string }> = [];
      for (const i of installments) {
        const amount = Math.min(Number(i.remaining_balance), outstanding);
        if (!(amount > 0)) continue;
        outstanding -= amount;
        lines.push({ at: i.due_date, amount, what: `قسط رقم ${i.installment_number} للكفالة الذهبية #${w.id}` });
      }
      if (outstanding > 0) lines.push({ at: w.start_date ?? new Date(), amount: outstanding, what: `متبقّي الكفالة الذهبية #${w.id}` });
      for (const line of lines) {
        warrantyBalance += await moveDebt(db, {
          fromClientId, toClientId: input.toClientId, fromName, toName,
          at: line.at, amount: line.amount, what: line.what, sourceType: 'golden_warranty_debt_transfer',
          sourceId: Number(w.id), contractId: device.contract_id, branchId: device.branch_id, transferId, userId: input.userId,
        });
      }
    }
  }

  // ── Open collection tasks follow the debt ────────────────────────────────
  const movedTaskIds: number[] = [];
  for (const t of collectionTasks) {
    await db.query(`UPDATE open_tasks SET client_id = $2, updated_at = NOW() WHERE id = $1`, [t.id, input.toClientId]);
    await persistOpenTaskSnapshots(db, Number(t.id), input.toClientId, t.contract_id ?? null);
    movedTaskIds.push(Number(t.id));
  }

  return { contractBalance, warrantyBalance, contractPayerFrom, movedTaskIds };
}

/**
 * Field transfer to another customer (device_transfer result, another_customer):
 * the visit result already moved the device and its possession; this moves the
 * finances the same way as the administrative transfer and records it. The
 * field work is done, so nothing blocks here: collection tasks already planned
 * into a visit stay with the old holder and are listed on the record. A result
 * edit re-runs the applier; the record makes it a no-op the second time.
 */
export async function recordFieldTransferFinances(db: PoolClient, input: {
  deviceId: number; visitTaskResultId: number; fromClientId: number; toClientId: number; userId: number;
}): Promise<{ transferId: number; contractBalanceSyp: number; warrantyBalanceSyp: number; movedTaskIds: number[]; leftTaskIds: number[] } | null> {
  const { rows: [existing] } = await db.query(
    `SELECT id FROM device_possession_transfers WHERE visit_task_result_id = $1`,
    [input.visitTaskResultId],
  );
  if (existing) return null;
  if (input.fromClientId === input.toClientId) return null;

  const { rows: [device] } = await db.query(
    `SELECT id, contract_id, branch_id FROM installed_devices WHERE id = $1`,
    [input.deviceId],
  );
  if (!device) return null;
  const { rows: names } = await db.query(
    `SELECT id, name FROM clients WHERE id = ANY($1::int[])`,
    [[input.fromClientId, input.toClientId]],
  );
  const nameOf = (id: number) => names.find(n => Number(n.id) === id)?.name ?? `#${id}`;

  const all = await listFollowingCollectionTasks(db, Number(device.id), device.contract_id);
  const movable = all.filter(t => MOVABLE_COLLECTION_STATUSES.includes(t.status));
  const leftTaskIds = all.filter(t => !MOVABLE_COLLECTION_STATUSES.includes(t.status)).map(t => Number(t.id));

  const { rows: [transfer] } = await db.query(
    `INSERT INTO device_possession_transfers (
       device_id, from_client_id, to_client_id, source, visit_task_result_id, contract_id, left_task_ids, performed_by
     ) VALUES ($1, $2, $3, 'field_task', $4, $5, $6, $7) RETURNING id`,
    [device.id, input.fromClientId, input.toClientId, input.visitTaskResultId, device.contract_id, leftTaskIds, input.userId],
  );
  const transferId = Number(transfer.id);
  const finances = await moveHolderFinances(db, {
    deviceId: Number(device.id), contractId: device.contract_id, branchId: device.branch_id,
    fromClientId: input.fromClientId, toClientId: input.toClientId,
    fromName: nameOf(input.fromClientId), toName: nameOf(input.toClientId),
    transferId, userId: input.userId, collectionTasks: movable,
  });
  await db.query(
    `UPDATE device_possession_transfers
        SET contract_payer_from = $2, contract_balance_syp = $3, warranty_balance_syp = $4, moved_task_ids = $5
      WHERE id = $1`,
    [transferId, finances.contractPayerFrom, finances.contractBalance, finances.warrantyBalance, finances.movedTaskIds],
  );
  return {
    transferId, contractBalanceSyp: finances.contractBalance, warrantyBalanceSyp: finances.warrantyBalance,
    movedTaskIds: finances.movedTaskIds, leftTaskIds,
  };
}

// The pair that moves one unpaid line between holders: the old holder's debt
// is offset (discount, as a cancellation voids it) and the new holder is
// charged, both at the line's due date so «المستحق» stays right.
async function moveDebt(db: PoolClient, m: {
  fromClientId: number; toClientId: number; fromName: string; toName: string;
  at: unknown; amount: number; what: string; sourceType: string; sourceId: number;
  contractId: number | null; branchId: number | null; transferId: number; userId: number;
}): Promise<number> {
  // The ledger stores 2 decimals; a fractional leftover would round to 0.
  const amount = Math.round(m.amount * 100) / 100;
  if (amount < 0.01) return 0;
  const occurredAt = (m.at ?? new Date()) as Date | string;
  const notes = `نقل حيازة #${m.transferId}`;
  await recordMovement(db, {
    clientId: m.fromClientId, occurredAt, kind: 'discount', amountSyp: amount,
    sourceType: m.sourceType, sourceId: m.sourceId, contractId: m.contractId,
    description: `نقل ${m.what} إلى ${m.toName}`, occurredBranchId: m.branchId,
    recordedBy: m.userId, notes,
  });
  await recordMovement(db, {
    clientId: m.toClientId, occurredAt, kind: 'charge', amountSyp: amount,
    sourceType: m.sourceType, sourceId: m.sourceId, contractId: m.contractId,
    description: `ذمة منقولة من ${m.fromName}: ${m.what}`, occurredBranchId: m.branchId,
    recordedBy: m.userId, notes,
  });
  return amount;
}
