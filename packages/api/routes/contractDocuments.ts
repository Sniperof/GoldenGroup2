// DEC-CT-14 / DEC-CT-15: printable contract endpoints.
//
//   GET /api/contracts/:id/printable
//     - draft: render preview HTML with "مسودة غير معتمدة" watermark; do NOT freeze.
//     - active/completed/cancelled: return frozen copy from contract_documents;
//       if no frozen copy exists yet (legacy data), freeze on first request.
//
//   POST /api/contracts/:id/printable/freeze
//     - explicit freeze trigger. Idempotent: if an original copy exists, returns it.
//
// Freezing is normally automatic at the draft→active transition (see
// freezeContractDocument() called from the contracts update path), but this
// route is the safety net for legacy/active contracts that predate the
// auto-freeze hook.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { renderContract } from '../services/contractRenderer.js';
import type { PoolClient } from 'pg';

const router = Router();
router.use(requireAuth);

function parseJsonArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadGeoPath(db: PoolClient | typeof pool, geoUnitId: number | null | undefined) {
  if (!geoUnitId) return [] as string[];
  const { rows } = await db.query(
    `WITH RECURSIVE geo_path AS (
       SELECT id, name, parent_id, 1 AS depth FROM geo_units WHERE id = $1
       UNION ALL
       SELECT g.id, g.name, g.parent_id, gp.depth + 1
       FROM geo_units g
       JOIN geo_path gp ON g.id = gp.parent_id
     )
     SELECT name FROM geo_path ORDER BY depth DESC`,
    [geoUnitId],
  );
  return rows.map((r: any) => String(r.name));
}

// Fetch the contract bundle needed by the renderer (header + installments).
async function loadContractForRender(db: PoolClient | typeof pool, contractId: number) {
  const c = await db.query(
    `SELECT c.id, c.contract_number AS "contractNumber", c.contract_date AS "contractDate",
            c.customer_id AS "customerId",
            c.customer_name AS "customerName", c.buyer_mother_name AS "buyerMotherName",
            c.buyer_national_id_registry AS "buyerNationalIdRegistry",
            c.buyer_national_id_issued_by AS "buyerNationalIdIssuedBy",
            c.buyer_national_id_issue_date AS "buyerNationalIdIssueDate",
            c.buyer_national_id_box AS "buyerNationalIdBox",
            c.buyer_birth_date AS "buyerBirthDate",
            c.buyer_gender AS "buyerGender",
            c.sale_subtype AS "saleSubtype", c.contract_type AS "contractType",
            c.base_price AS "basePrice", c.final_price AS "finalPrice",
            c.down_payment AS "downPayment", c.installments_count AS "installmentsCount",
            c.payment_type AS "paymentType", c.status,
            c.sale_type AS "saleType", c.sale_source AS "saleSource",
            c.invoice_notes AS "invoiceNotes",
            c.discount_id AS "discountId",
            c.applied_device_discount_id AS "appliedDeviceDiscountId",
            c.branch_id AS "branchId",
            c.sale_owner_id AS "saleOwnerId",
            c.offer_team_snapshot AS "offerTeamSnapshot",
            c.contract_referrers AS "contractReferrers",
            c.no_closing_reason_id AS "noClosingReasonId",
            d.device_model_name AS "deviceModelName", d.serial_number AS "serialNumber",
            d.status AS "deviceStatus", d.delivery_date AS "deliveryDate",
            d.installation_date AS "installationDate",
            d.installation_geo_unit_id AS "installationGeoUnitId",
            d.installation_address_text AS "installationAddressText",
            d.contract_warranty_end_date AS "contractWarrantyEndDate",
            d.warranty_months AS "warrantyMonths",
            d.warranty_visits AS "warrantyVisits",
            (SELECT name FROM hr_users WHERE id = c.closing_employee_id LIMIT 1) AS "closingEmployeeName",
            (SELECT COALESCE(r.display_name, e.job_title, hu.role)
               FROM hr_users hu
               LEFT JOIN roles r ON r.id = hu.role_id
               LEFT JOIN employees e ON e.id = hu.employee_id
              WHERE hu.id = c.closing_employee_id
              LIMIT 1) AS "closingEmployeeTitle",
            (SELECT name FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchName"
       FROM contracts c
       LEFT JOIN installed_devices d ON d.contract_id = c.id
      WHERE c.id = $1`,
    [contractId],
  );
  if (!c.rows[0]) return null;

  const contract = c.rows[0];
  const clientResult = contract.customerId
    ? await db.query(
      `SELECT id, name, mobile, contacts,
              governorate, district, neighborhood,
              detailed_address AS "detailedAddress",
              national_id AS "nationalId",
              birth_date AS "birthDate",
              mother_name AS "motherName",
              national_id_registry AS "nationalIdRegistry",
              national_id_issued_by AS "nationalIdIssuedBy",
              national_id_issue_date AS "nationalIdIssueDate",
              national_id_box AS "nationalIdBox"
         FROM clients
        WHERE id = $1`,
      [contract.customerId],
    )
    : { rows: [] as any[] };

  const [installationGeoPath, clientGeoPath, lineItemsResult, paymentEntriesResult, installmentsResult, discountResult] = await Promise.all([
    loadGeoPath(db, contract.installationGeoUnitId),
    loadGeoPath(db, clientResult.rows[0]?.neighborhood),
    db.query(
      `SELECT id, item_type AS "itemType", spare_part_id AS "sparePartId",
              description, quantity, unit_price AS "unitPrice", total_price AS "totalPrice",
              is_installed AS "isInstalled"
         FROM contract_line_items
        WHERE contract_id = $1
        ORDER BY id`,
      [contractId],
    ),
    db.query(
      `SELECT id, method, currency, amount_value AS "amountValue", exchange_rate AS "exchangeRate",
              amount_syp AS "amountSyp", reference_number AS "referenceNumber",
              barter_name AS "barterName", barter_value_syp AS "barterValueSyp",
              received_by_employee_id AS "receivedByEmployeeId", received_at AS "receivedAt",
              notes, entry_type AS "entryType", installment_id AS "installmentId"
         FROM contract_payment_entries
        WHERE contract_id = $1
        ORDER BY id`,
      [contractId],
    ),
    db.query(
      `SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
              amount_syp AS "amountSyp", status, paid_amount AS "paidAmount",
              remaining_balance AS "remainingBalance", confirmed,
              collection_owner_id AS "collectionOwnerId"
         FROM contract_installments
        WHERE contract_id = $1
        ORDER BY installment_number`,
      [contractId],
    ),
    contract.discountId
      ? db.query(`SELECT id, label, percentage FROM device_discounts WHERE id = $1`, [contract.discountId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const client = clientResult.rows[0]
    ? {
      ...clientResult.rows[0],
      contacts: parseJsonArray(clientResult.rows[0].contacts),
      geoPath: clientGeoPath,
    }
    : null;

  const installments = installmentsResult.rows;
  const remainingBalance = installments.reduce((sum: number, inst: any) => sum + Number(inst.remainingBalance || 0), 0);

  return {
    contract: {
      ...contract,
      offerTeamSnapshot: contract.offerTeamSnapshot ?? null,
      contractReferrers: parseJsonArray(contract.contractReferrers),
      installationGeoPath,
      remainingBalance,
    },
    client,
    lineItems: lineItemsResult.rows,
    paymentEntries: paymentEntriesResult.rows,
    installments,
    discount: discountResult.rows[0] ?? null,
  };
}

/**
 * Freeze a contract: render with current data and persist to contract_documents.
 * Idempotent: returns the existing original copy if one already exists.
 *
 * Designed to be called either from this route or directly from the contracts
 * update path (DEC-CT-15: freeze at draft→active).
 */
export async function freezeContractDocument(
  db: PoolClient,
  contractId: number,
  actorId: number | null,
): Promise<{ id: number; contentHash: string; templateVersion: string; createdNow: boolean }> {
  // Idempotency: return the existing original if present.
  const existing = await db.query(
    `SELECT id, content_hash, template_version
       FROM contract_documents
      WHERE contract_id = $1 AND is_amendment = FALSE
      LIMIT 1`,
    [contractId],
  );
  if (existing.rows[0]) {
    return {
      id:              existing.rows[0].id,
      contentHash:     existing.rows[0].content_hash,
      templateVersion: existing.rows[0].template_version,
      createdNow:      false,
    };
  }

  const bundle = await loadContractForRender(db, contractId);
  if (!bundle) throw new Error('العقد غير موجود');

  const { templateVersion, html, contentHash } = renderContract({
    contract:     bundle.contract,
    client:       bundle.client,
    lineItems:    bundle.lineItems,
    paymentEntries: bundle.paymentEntries,
    discount:     bundle.discount,
    installments: bundle.installments,
    draftWatermark: false, // by definition we only freeze active/completed/cancelled
  });

  const { rows } = await db.query(
    `INSERT INTO contract_documents
       (contract_id, template_version, rendered_html, content_hash, frozen_by, is_amendment)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     RETURNING id`,
    [contractId, templateVersion, html, contentHash, actorId],
  );
  return { id: rows[0].id, contentHash, templateVersion, createdNow: true };
}

// GET /api/contracts/:id/printable
router.get(
  '/:id/printable',
  requirePermission('contracts.view_list'),
  async (req, res) => {
    const contractId = Number(req.params.id);
    if (!Number.isInteger(contractId) || contractId <= 0) {
      return res.status(400).json({ error: 'id غير صالح' });
    }

    const bundle = await loadContractForRender(pool, contractId);
    if (!bundle) return res.status(404).json({ error: 'العقد غير موجود' });
    const status = bundle.contract.status;

    // Draft: render preview, never store.
    if (status === 'draft' || status === 'discarded') {
      try {
        const { html } = renderContract({
          contract:     bundle.contract,
          client:       bundle.client,
          lineItems:    bundle.lineItems,
          paymentEntries: bundle.paymentEntries,
          discount:     bundle.discount,
          installments: bundle.installments,
          draftWatermark: true,
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      } catch (err: any) {
        return res.status(400).json({ error: err?.message });
      }
    }

    // Active/completed/cancelled: serve frozen copy; freeze on first read if missing.
    const existing = await pool.query(
      `SELECT id, rendered_html, content_hash, template_version, frozen_at
         FROM contract_documents
        WHERE contract_id = $1 AND is_amendment = FALSE
        LIMIT 1`,
      [contractId],
    );
    if (existing.rows[0]) {
      res.set({
        'Content-Type':       'text/html; charset=utf-8',
        'X-Contract-Document-Id':    String(existing.rows[0].id),
        'X-Contract-Document-Hash':  existing.rows[0].content_hash,
        'X-Contract-Template-Version': existing.rows[0].template_version,
      });
      return res.send(existing.rows[0].rendered_html);
    }

    // Backfill freeze for legacy contracts.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const frozen = await freezeContractDocument(client, contractId, (req as any).user?.id ?? null);
      await client.query('COMMIT');
      const fresh = await pool.query(
        `SELECT rendered_html, content_hash, template_version FROM contract_documents WHERE id = $1`,
        [frozen.id],
      );
      res.set({
        'Content-Type':       'text/html; charset=utf-8',
        'X-Contract-Document-Id':    String(frozen.id),
        'X-Contract-Document-Hash':  fresh.rows[0].content_hash,
        'X-Contract-Template-Version': fresh.rows[0].template_version,
      });
      res.send(fresh.rows[0].rendered_html);
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'فشل تجميد نسخة العقد', detail: err?.message });
    } finally {
      client.release();
    }
  },
);

// POST /api/contracts/:id/printable/freeze — explicit (idempotent).
router.post(
  '/:id/printable/freeze',
  requirePermission('contracts.edit'),
  async (req, res) => {
    const contractId = Number(req.params.id);
    if (!Number.isInteger(contractId) || contractId <= 0) {
      return res.status(400).json({ error: 'id غير صالح' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const frozen = await freezeContractDocument(client, contractId, (req as any).user?.id ?? null);
      await client.query('COMMIT');
      res.status(frozen.createdNow ? 201 : 200).json(frozen);
    } catch (err: any) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'فشل تجميد نسخة العقد', detail: err?.message });
    } finally {
      client.release();
    }
  },
);

export default router;
