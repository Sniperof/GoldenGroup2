import fs from 'node:fs';
import pool from '../packages/api/db.js';

const raw = fs.readFileSync('migrations/467_backfill_imported_contract_financial_movements.sql', 'utf8');
const sql = raw.replace(/^([\s\S]*?\n)?BEGIN;\s*/m, match => match.slice(match.lastIndexOf('BEGIN;') + 6))
  .replace(/\s*COMMIT;\s*$/, '');

async function countMissing(client: any) {
  const { rows } = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE source = 'contract')::int AS signing,
      COUNT(*) FILTER (WHERE source = 'contract_installment')::int AS installments,
      COUNT(*) FILTER (WHERE source = 'contract_payment')::int AS payments
    FROM (
      SELECT 'contract' AS source
        FROM contracts c
       WHERE c.customer_id IS NOT NULL AND c.status IN ('active', 'completed')
         AND c.sale_subtype = 'definitive'
         AND COALESCE((SELECT SUM(s.amount_syp) FROM contract_installments s WHERE s.contract_id = c.id), 0) <= c.final_price
         AND c.final_price - COALESCE((SELECT SUM(i.amount_syp) FROM contract_installments i WHERE i.contract_id = c.id), 0) > 0
         AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type = 'contract' AND m.source_ref_id = c.id AND m.kind = 'charge')
      UNION ALL
      SELECT 'contract_installment'
        FROM contract_installments i JOIN contracts c ON c.id = i.contract_id
       WHERE c.customer_id IS NOT NULL AND c.status IN ('active', 'completed')
         AND c.sale_subtype = 'definitive' AND i.amount_syp > 0
         AND COALESCE((SELECT SUM(s.amount_syp) FROM contract_installments s WHERE s.contract_id = c.id), 0) <= c.final_price
         AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type = 'contract_installment' AND m.source_ref_id = i.id AND m.kind = 'charge')
      UNION ALL
      SELECT 'contract_payment'
        FROM contract_payment_entries p JOIN contracts c ON c.id = p.contract_id
       WHERE c.customer_id IS NOT NULL AND c.status IN ('active', 'completed')
         AND c.sale_subtype = 'definitive' AND p.amount_syp > 0
         AND COALESCE((SELECT SUM(s.amount_syp) FROM contract_installments s WHERE s.contract_id = c.id), 0) <= c.final_price
         AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type = 'contract_payment' AND m.source_ref_id = p.id
                           AND m.kind = CASE WHEN p.entry_type = 'refund' THEN 'refund' ELSE 'payment' END)
    ) missing
  `);
  return rows[0];
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await countMissing(client);
    await client.query(sql);
    const after = await countMissing(client);
    const inserted = await client.query(`
      SELECT kind, source_type AS "sourceType", COUNT(*)::int AS count
        FROM financial_movements
       WHERE notes = 'ترحيل 467: استكمال دفتر الحركات للعقود التاريخية المستوردة'
       GROUP BY kind, source_type ORDER BY source_type, kind
    `);
    const integrity = await client.query(`
      WITH eligible AS (
        SELECT c.id, c.final_price
          FROM contracts c
         WHERE c.customer_id IS NOT NULL
           AND c.status IN ('active', 'completed')
           AND c.sale_subtype = 'definitive'
           AND COALESCE((SELECT SUM(s.amount_syp) FROM contract_installments s WHERE s.contract_id = c.id), 0) <= c.final_price
      ), compared AS (
        SELECT e.id, e.final_price,
               COALESCE((SELECT SUM(m.amount_syp) FROM financial_movements m
                          WHERE m.contract_id = e.id AND m.kind = 'charge'
                            AND m.source_type IN ('contract', 'contract_installment')), 0) AS charges,
               ROUND(COALESCE((SELECT SUM(CASE WHEN p.entry_type = 'refund' THEN -p.amount_syp ELSE p.amount_syp END)
                          FROM contract_payment_entries p WHERE p.contract_id = e.id), 0), 2) AS entry_net,
               COALESCE((SELECT SUM(CASE WHEN m.kind = 'refund' THEN -m.amount_syp ELSE m.amount_syp END)
                          FROM financial_movements m WHERE m.contract_id = e.id
                            AND m.kind IN ('payment', 'refund') AND m.source_type = 'contract_payment'), 0) AS ledger_net
          FROM eligible e
      )
      SELECT COUNT(*) FILTER (WHERE charges <> final_price)::int AS charge_contract_mismatches,
             COUNT(*) FILTER (WHERE entry_net <> ledger_net)::int AS payment_contract_mismatches
        FROM compared
    `);
    const chargeMismatchShape = await client.query(`
      WITH sums AS (
        SELECT c.id, c.contract_number, c.status, c.final_price,
               COALESCE(SUM(i.amount_syp), 0) AS installments_total
          FROM contracts c
          LEFT JOIN contract_installments i ON i.contract_id = c.id
         WHERE c.customer_id IS NOT NULL AND c.status IN ('active', 'completed')
           AND c.sale_subtype = 'definitive'
         GROUP BY c.id
      )
      SELECT COUNT(*)::int AS contracts,
             COUNT(*) FILTER (WHERE installments_total > final_price)::int AS installments_above_price,
             COUNT(*) FILTER (WHERE installments_total < 0 OR final_price < 0)::int AS negative_values,
             MIN(installments_total - final_price) AS min_difference,
             MAX(installments_total - final_price) AS max_difference
        FROM sums WHERE installments_total > final_price
    `);
    const paymentMismatchSamples = await client.query(`
      SELECT c.id AS "contractId", c.contract_number AS "contractNumber", p.id AS "paymentEntryId",
             p.entry_type AS "entryType", p.amount_syp AS "entryAmount", m.amount_syp AS "ledgerAmount",
             m.kind
        FROM contract_payment_entries p
        JOIN contracts c ON c.id = p.contract_id
        JOIN financial_movements m ON m.source_type = 'contract_payment' AND m.source_ref_id = p.id
         AND m.kind = CASE WHEN p.entry_type = 'refund' THEN 'refund' ELSE 'payment' END
       WHERE c.status IN ('active', 'completed') AND c.sale_subtype = 'definitive'
         AND ROUND(p.amount_syp, 2) <> m.amount_syp
       ORDER BY c.id, p.id LIMIT 20
    `);
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ before, after, inserted: inserted.rows, integrity: integrity.rows[0],
      chargeMismatchShape: chargeMismatchShape.rows[0], paymentMismatchSamples: paymentMismatchSamples.rows,
      rolledBack: true }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
