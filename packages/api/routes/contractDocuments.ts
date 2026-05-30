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

// Fetch the contract bundle needed by the renderer (header + installments).
async function loadContractForRender(db: PoolClient | typeof pool, contractId: number) {
  const c = await db.query(
    `SELECT c.id, c.contract_number AS "contractNumber", c.contract_date AS "contractDate",
            c.customer_name AS "customerName", c.buyer_mother_name AS "buyerMotherName",
            c.sale_subtype AS "saleSubtype", c.contract_type AS "contractType",
            c.base_price AS "basePrice", c.final_price AS "finalPrice",
            c.payment_type AS "paymentType", c.status,
            d.device_model_name AS "deviceModelName", d.serial_number AS "serialNumber",
            d.installation_address_text AS "installationAddressText",
            d.warranty_visits AS "warrantyVisits",
            (SELECT name FROM hr_users WHERE id = c.closing_employee_id LIMIT 1) AS "closingEmployeeName"
       FROM contracts c
       LEFT JOIN installed_devices d ON d.contract_id = c.id
      WHERE c.id = $1`,
    [contractId],
  );
  if (!c.rows[0]) return null;

  const insts = await db.query(
    `SELECT installment_number AS "installmentNumber", due_date AS "dueDate", amount_syp AS "amountSyp"
       FROM contract_installments WHERE contract_id = $1 ORDER BY installment_number`,
    [contractId],
  );

  return { contract: c.rows[0], installments: insts.rows };
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
