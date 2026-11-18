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
import {
  renderContract,
  ACTIVE_TEMPLATE_VERSION,
  SETTLEMENT_AMENDMENT_TEMPLATE_KEY,
} from '../services/contractRenderer.js';
import type { PoolClient } from 'pg';
import { getRoundingUnit } from '../services/fxRates.js';
import { canFreezeContractDocument, canViewContractDocument } from '../policies/contractDocumentPolicy.js';

const router = Router();
router.use(requireAuth);

const SETTLEMENT_AMENDMENT_TEMPLATE_VERSION =
  ACTIVE_TEMPLATE_VERSION[SETTLEMENT_AMENDMENT_TEMPLATE_KEY];

async function loadContractDocumentSubject(contractId: number, actorUserId: number) {
  const { rows } = await pool.query(
    `SELECT branch_id AS "branchId", sale_owner_id AS "saleOwnerId",
            (SELECT employee_id FROM hr_users WHERE id = $2) AS "currentEmployeeId"
       FROM contracts WHERE id = $1 LIMIT 1`,
    [contractId, actorUserId],
  );
  return rows[0] ?? null;
}

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
export async function loadContractForRender(db: PoolClient | typeof pool, contractId: number) {
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
            c.usd_rate_snapshot AS "usdRateSnapshot",
            c.sale_owner_id AS "saleOwnerId",
            c.offer_team_snapshot AS "offerTeamSnapshot",
            c.contract_referrers AS "contractReferrers",
            c.no_closing_reason_id AS "noClosingReasonId",
            -- A draft has no installed_devices row yet: its planned device lives in
            -- draft_device_payload (same fallback as contracts.ts contractSelect),
            -- so a draft preview still prints the device, address and warranty.
            COALESCE(d.device_model_name, c.device_model_name) AS "deviceModelName",
            COALESCE(d.serial_number, c.draft_device_payload->>'serialNumber') AS "serialNumber",
            COALESCE(d.status, c.draft_device_payload->>'deviceStatus') AS "deviceStatus",
            COALESCE(d.delivery_date, NULLIF(c.draft_device_payload->>'deliveryDate', '')::date) AS "deliveryDate",
            COALESCE(d.installation_date, NULLIF(c.draft_device_payload->>'installationDate', '')::date) AS "installationDate",
            COALESCE(d.installation_geo_unit_id, NULLIF(c.draft_device_payload->>'installationGeoUnitId', '')::int) AS "installationGeoUnitId",
            COALESCE(d.installation_address_text, c.draft_device_payload->>'installationAddressText') AS "installationAddressText",
            d.contract_warranty_end_date AS "contractWarrantyEndDate",
            COALESCE(d.warranty_months, NULLIF(c.draft_device_payload->>'warrantyMonths', '')::int) AS "warrantyMonths",
            COALESCE(d.warranty_visits, NULLIF(c.draft_device_payload->>'warrantyVisits', '')::int) AS "warrantyVisits",
            (SELECT name FROM hr_users WHERE id = c.closing_employee_id LIMIT 1) AS "closingEmployeeName",
            (SELECT COALESCE(r.display_name, e.job_title, hu.role)
               FROM hr_users hu
               LEFT JOIN roles r ON r.id = hu.role_id
               LEFT JOIN employees e ON e.id = hu.employee_id
              WHERE hu.id = c.closing_employee_id
              LIMIT 1) AS "closingEmployeeTitle",
            (SELECT name FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchName",
            -- v3: the first party's branch address / phones and the court's governorate.
            (SELECT detailed_address FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchAddress",
            (SELECT contact_info FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchContacts",
            (SELECT location_geo_id FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchGeoId",
            c.draft_gift_promises AS "draftGiftPromises",
            -- v3: a cash contract has no rate snapshot; its USD price uses the
            -- central rate in effect on the contract date.
            (SELECT r.rate FROM exchange_rates r
              WHERE r.effective_from <= COALESCE(NULLIF(TRIM(c.contract_date), '')::date, c.created_at::date)
              ORDER BY r.effective_from DESC, r.id DESC LIMIT 1) AS "contractDateRate"
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

  const [installationGeoPath, clientGeoPath, branchGeoPath, giftsResult, lineItemsResult, paymentEntriesResult, installmentsResult, discountResult] = await Promise.all([
    loadGeoPath(db, contract.installationGeoUnitId),
    loadGeoPath(db, clientResult.rows[0]?.neighborhood ?? clientResult.rows[0]?.district),
    loadGeoPath(db, contract.branchGeoId),
    db.query(
      `SELECT COALESCE(gd.name, '') AS "giftName",
              COALESCE(gr.promised_quantity, gr.approved_quantity, 1) AS "quantity",
              gr.condition_label AS "conditionLabel",
              gr.beneficiary_type AS "beneficiaryType",
              gr.beneficiary_name_snapshot AS "beneficiaryName"
         FROM gift_records gr
         LEFT JOIN gift_definitions gd ON gd.id = gr.gift_definition_id
        WHERE gr.contract_id = $1 AND gr.status <> 'cancelled'
        ORDER BY gr.id`,
      [contractId],
    ),
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
              collection_owner_id AS "collectionOwnerId",
              amount_usd AS "amountUsd"
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

  // A draft keeps its gift promises as JSON (giftDefinitionId, quantity,
  // conditionLabel, beneficiaryKind) until approval turns them into gift_records.
  const draftPromises = parseJsonArray(contract.draftGiftPromises);
  const draftDefinitionIds = draftPromises.map((p: any) => Number(p?.giftDefinitionId)).filter((n: number) => n > 0);
  const draftGiftNames = new Map<number, string>();
  if (giftsResult.rows.length === 0 && draftDefinitionIds.length > 0) {
    const { rows } = await db.query('SELECT id, name FROM gift_definitions WHERE id = ANY($1::int[])', [draftDefinitionIds]);
    rows.forEach((r: any) => draftGiftNames.set(Number(r.id), String(r.name)));
  }

  const installments = installmentsResult.rows;
  const remainingBalance = installments.reduce((sum: number, inst: any) => sum + Number(inst.remainingBalance || 0), 0);

  return {
    contract: {
      ...contract,
      offerTeamSnapshot: contract.offerTeamSnapshot ?? null,
      contractReferrers: parseJsonArray(contract.contractReferrers),
      installationGeoPath,
      branchGeoPath,
      branchContacts: parseJsonArray(contract.branchContacts),
      remainingBalance,
      // D9: printed USD sentence states the collection rounding unit.
      fxRoundingUnit: contract.usdRateSnapshot != null ? await getRoundingUnit() : null,
    },
    client,
    lineItems: lineItemsResult.rows,
    paymentEntries: paymentEntriesResult.rows,
    installments,
    discount: discountResult.rows[0] ?? null,
    // Approved contracts carry gift_records; a draft still holds its promises as JSON.
    gifts: giftsResult.rows.length > 0
      ? giftsResult.rows
      : draftPromises.map((p: any) => ({
        giftName: draftGiftNames.get(Number(p?.giftDefinitionId)) ?? '',
        quantity: p?.quantity ?? 1,
        conditionLabel: p?.conditionLabel ?? null,
        beneficiaryType: p?.beneficiaryKind ?? 'contract_customer',
        beneficiaryName: null,
      })),
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
    gifts:          bundle.gifts,
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

/**
 * Freeze the settlement amendment (ملحق تثبيت البيعة) for a trial contract
 * that has just been settled into a definitive sale.
 *
 * The original frozen copy is the trial agreement and must never be touched —
 * its own article /10/ forbids any later edit, and the unique index allows a
 * single non-amendment original per contract. The financial terms the customer
 * agrees to at purchase therefore live in an amendment row, which the schema
 * has supported since day one (contract_documents.is_amendment) but which no
 * code path had ever written.
 *
 * Idempotent per contract: a second settlement attempt returns the existing
 * amendment instead of stacking duplicates.
 */
export async function freezeContractSettlementAmendment(
  db: PoolClient,
  contractId: number,
  actorId: number | null,
): Promise<{ id: number; contentHash: string; templateVersion: string; createdNow: boolean }> {
  const existing = await db.query(
    `SELECT id, content_hash, template_version
       FROM contract_documents
      WHERE contract_id = $1
        AND is_amendment = TRUE
        AND template_version = $2
      LIMIT 1`,
    [contractId, SETTLEMENT_AMENDMENT_TEMPLATE_VERSION],
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
    contract:       bundle.contract,
    client:         bundle.client,
    lineItems:      bundle.lineItems,
    paymentEntries: bundle.paymentEntries,
    discount:       bundle.discount,
    installments:   bundle.installments,
    gifts:          bundle.gifts,
    draftWatermark: false,
    templateKey:    SETTLEMENT_AMENDMENT_TEMPLATE_KEY,
  });

  const { rows } = await db.query(
    `INSERT INTO contract_documents
       (contract_id, template_version, rendered_html, content_hash, frozen_by, is_amendment)
     VALUES ($1, $2, $3, $4, $5, TRUE)
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

    const subject = await loadContractDocumentSubject(contractId, req.authContext!.userId);
    if (!subject) return res.status(404).json({ error: 'العقد غير موجود' });
    if (!canViewContractDocument(req.authContext!, subject).allowed) {
      return res.status(403).json({ error: 'غير مسموح بعرض النسخة القانونية لهذا العقد' });
    }

    // ?document=amendment — the frozen settlement amendment (ملحق تثبيت البيعة)
    // of a trial settled into a definitive sale. The original stays the trial
    // agreement by design; the amendment is where the definitive financial
    // terms live, and it was being frozen but never served.
    if (req.query.document === 'amendment') {
      const { rows: amendmentRows } = await pool.query(
        `SELECT id, rendered_html, content_hash, template_version
           FROM contract_documents
          WHERE contract_id = $1 AND is_amendment = TRUE
          ORDER BY frozen_at DESC, id DESC
          LIMIT 1`,
        [contractId],
      );
      const amendment = amendmentRows[0];
      if (!amendment) {
        return res.status(404).json({ error: 'لا يوجد ملحق تثبيت بيعة لهذا العقد' });
      }
      res.set({
        'Content-Type':       'text/html; charset=utf-8',
        'X-Contract-Document-Id':    String(amendment.id),
        'X-Contract-Document-Hash':  amendment.content_hash,
        'X-Contract-Template-Version': amendment.template_version,
      });
      return res.send(amendment.rendered_html);
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
          gifts:          bundle.gifts,
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
      // frozen_by FK → employees.id, so pass employeeId (not the hr_users.id).
      const frozen = await freezeContractDocument(client, contractId, (req as any).user?.employeeId ?? null);
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
    const subject = await loadContractDocumentSubject(contractId, req.authContext!.userId);
    if (!subject) return res.status(404).json({ error: 'العقد غير موجود' });
    if (!canFreezeContractDocument(req.authContext!, subject).allowed) {
      return res.status(403).json({ error: 'غير مسموح بتجميد النسخة القانونية لهذا العقد' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // frozen_by FK → employees.id, so pass employeeId (not the hr_users.id).
      const frozen = await freezeContractDocument(client, contractId, (req as any).user?.employeeId ?? null);
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
