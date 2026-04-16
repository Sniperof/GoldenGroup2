import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const selectFields = `
  id, first_name AS "firstName", last_name AS "lastName", nickname, mobile,
  contacts, address_text AS "addressText", geo_unit_id AS "geoUnitId", owner_user_id AS "ownerUserId",
  status, referral_sheet_id AS "referralSheetId",
  referral_date AS "referralDate", referral_reason AS "referralReason",
  referral_type AS "referralType", referral_origin_channel AS "referralOriginChannel",
  referral_name_snapshot AS "referralNameSnapshot", referral_entity_id AS "referralEntityId",
  referral_confirmation_status AS "referralConfirmationStatus",
  occupation, candidate_notes AS "candidateNotes",
  duplicate_flag AS "duplicateFlag", duplicate_type AS "duplicateType",
  duplicate_reference_id AS "duplicateReferenceId",
  converted_to_lead_id AS "convertedToLeadId",
  created_at AS "createdAt", created_by AS "createdBy"
`;

router.get('/', async (req, res) => {
  const { search } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (search) {
    conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR mobile ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT ${selectFields} FROM candidates ${where} ORDER BY id LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM candidates ${where}`, params),
    ]);
    res.json(paginatedResponse(rows, parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(
      `SELECT ${selectFields} FROM candidates ${where} ORDER BY id`,
      params,
    );
    res.json(rows);
  }
});

router.post('/', async (req, res) => {
  const c = req.body;
  const { rows } = await pool.query(
    `INSERT INTO candidates (first_name, last_name, nickname, mobile, contacts, address_text, geo_unit_id,
      owner_user_id, status, referral_sheet_id, referral_date, referral_reason,
      referral_type, referral_origin_channel, referral_name_snapshot, referral_entity_id,
      referral_confirmation_status, occupation, candidate_notes, duplicate_flag, duplicate_type,
      duplicate_reference_id, converted_to_lead_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING ${selectFields}`,
    [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
     c.ownerUserId || null, c.status || 'Suggested', c.referralSheetId || null,
     c.referralDate || null, c.referralReason || null, c.referralType || null,
     c.referralOriginChannel || null, c.referralNameSnapshot || null,
     c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
     c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
     c.duplicateReferenceId || null, c.convertedToLeadId || null, c.createdBy || null]
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const c = req.body;
  const { rows } = await pool.query(
    `UPDATE candidates SET first_name=$1, last_name=$2, nickname=$3, mobile=$4,
      contacts=$5, address_text=$6, geo_unit_id=$7, owner_user_id=$8, status=$9, referral_sheet_id=$10,
      referral_date=$11, referral_reason=$12, referral_type=$13, referral_origin_channel=$14,
      referral_name_snapshot=$15, referral_entity_id=$16, referral_confirmation_status=$17,
      occupation=$18, candidate_notes=$19, duplicate_flag=$20, duplicate_type=$21,
      duplicate_reference_id=$22, converted_to_lead_id=$23, created_by=$24
    WHERE id=$25 RETURNING ${selectFields}`,
    [c.firstName, c.lastName || null, c.nickname, c.mobile, JSON.stringify(c.contacts || []), c.addressText || '', c.geoUnitId || null,
     c.ownerUserId || null, c.status || 'Suggested', c.referralSheetId || null,
     c.referralDate || null, c.referralReason || null, c.referralType || null,
     c.referralOriginChannel || null, c.referralNameSnapshot || null,
     c.referralEntityId || null, c.referralConfirmationStatus || 'Pending',
     c.occupation || null, c.candidateNotes || null, c.duplicateFlag || false, c.duplicateType || null,
     c.duplicateReferenceId || null, c.convertedToLeadId || null, c.createdBy || null,
     req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM candidates WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
