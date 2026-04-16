import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const CLIENT_SELECT = `
  SELECT
    id,
    first_name AS "firstName",
    father_name AS "fatherName",
    last_name AS "lastName",
    nickname,
    name,
    mobile,
    contacts,
    governorate,
    district,
    neighborhood,
    detailed_address AS "detailedAddress",
    gps_coordinates AS "gpsCoordinates",
    occupation,
    water_source AS "waterSource",
    notes,
    rating,
    source_channel AS "sourceChannel",
    referrer_type AS "referrerType",
    referrer_id AS "referrerId",
    referrer_name AS "referrerName",
    referrers,
    referral_entity_id AS "referralEntityId",
    referral_date AS "referralDate",
    referral_reason AS "referralReason",
    referral_sheet_id AS "referralSheetId",
    referral_address_text AS "referralAddressText",
    created_at AS "createdAt",
    is_candidate AS "isCandidate",
    target_client AS "targetClient",
    candidate_status AS "candidateStatus"
  FROM clients
`;

const CLIENT_MUTATION_RETURNING = `
  RETURNING
    id,
    first_name AS "firstName",
    father_name AS "fatherName",
    last_name AS "lastName",
    nickname,
    name,
    mobile,
    contacts,
    governorate,
    district,
    neighborhood,
    detailed_address AS "detailedAddress",
    gps_coordinates AS "gpsCoordinates",
    occupation,
    water_source AS "waterSource",
    notes,
    rating,
    source_channel AS "sourceChannel",
    referrer_type AS "referrerType",
    referrer_id AS "referrerId",
    referrer_name AS "referrerName",
    referrers,
    referral_entity_id AS "referralEntityId",
    referral_date AS "referralDate",
    referral_reason AS "referralReason",
    referral_sheet_id AS "referralSheetId",
    referral_address_text AS "referralAddressText",
    created_at AS "createdAt",
    is_candidate AS "isCandidate",
    target_client AS "targetClient",
    candidate_status AS "candidateStatus"
`;

const toJson = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback);

router.get('/', async (req, res) => {
  const { search } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (search) {
    conditions.push(`(name ILIKE $${idx} OR mobile ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `${CLIENT_SELECT} ${where} ORDER BY id LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM clients ${where}`, params),
    ]);
    res.json(paginatedResponse(rows, parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`${CLIENT_SELECT} ${where} ORDER BY id`, params);
    res.json(rows);
  }
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`${CLIENT_SELECT} WHERE id = $1`, [req.params.id]);
  if (!rows[0]) {
    res.status(404).json({ message: 'الزبون غير موجود' });
    return;
  }
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const c = req.body;
  const { rows } = await pool.query(
    `INSERT INTO clients (
      first_name, father_name, last_name, nickname,
      name, mobile, contacts, governorate, district, neighborhood,
      detailed_address, gps_coordinates, occupation, water_source, notes, rating,
      source_channel, referrer_type, referrer_id, referrer_name, referrers, referral_entity_id,
      referral_date, referral_reason, referral_sheet_id, referral_address_text,
      is_candidate, target_client, candidate_status
    )
    VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,
      $17,$18,$19,$20,$21,$22,
      $23,$24,$25,$26,
      $27,$28,$29
    )
    ${CLIENT_MUTATION_RETURNING}`,
    [
      c.firstName || null,
      c.fatherName || null,
      c.lastName || null,
      c.nickname || null,
      c.name,
      c.mobile,
      toJson(c.contacts, []),
      c.governorate || '',
      c.district || '',
      c.neighborhood || '',
      c.detailedAddress || null,
      c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
      c.occupation || null,
      c.waterSource || null,
      c.notes || null,
      c.rating || null,
      c.sourceChannel || null,
      c.referrerType || null,
      c.referrerId || null,
      c.referrerName || null,
      toJson(c.referrers, []),
      c.referralEntityId || null,
      c.referralDate || null,
      c.referralReason || null,
      c.referralSheetId || null,
      c.referralAddressText || null,
      c.isCandidate || false,
      c.targetClient || null,
      c.candidateStatus || null,
    ],
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const c = req.body;
  const { rows } = await pool.query(
    `UPDATE clients SET
      first_name=$1, father_name=$2, last_name=$3, nickname=$4,
      name=$5, mobile=$6, contacts=$7, governorate=$8, district=$9, neighborhood=$10,
      detailed_address=$11, gps_coordinates=$12, occupation=$13, water_source=$14, notes=$15, rating=$16,
      source_channel=$17, referrer_type=$18, referrer_id=$19, referrer_name=$20, referrers=$21, referral_entity_id=$22,
      referral_date=$23, referral_reason=$24, referral_sheet_id=$25, referral_address_text=$26,
      is_candidate=$27, target_client=$28, candidate_status=$29
    WHERE id=$30
    ${CLIENT_MUTATION_RETURNING}`,
    [
      c.firstName || null,
      c.fatherName || null,
      c.lastName || null,
      c.nickname || null,
      c.name,
      c.mobile,
      toJson(c.contacts, []),
      c.governorate || '',
      c.district || '',
      c.neighborhood || '',
      c.detailedAddress || null,
      c.gpsCoordinates ? toJson(c.gpsCoordinates, null) : null,
      c.occupation || null,
      c.waterSource || null,
      c.notes || null,
      c.rating || null,
      c.sourceChannel || null,
      c.referrerType || null,
      c.referrerId || null,
      c.referrerName || null,
      toJson(c.referrers, []),
      c.referralEntityId || null,
      c.referralDate || null,
      c.referralReason || null,
      c.referralSheetId || null,
      c.referralAddressText || null,
      c.isCandidate || false,
      c.targetClient || null,
      c.candidateStatus || null,
      req.params.id,
    ],
  );
  if (!rows[0]) {
    res.status(404).json({ message: 'الزبون غير موجود' });
    return;
  }
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (ids && ids.length > 0) {
    await pool.query('DELETE FROM clients WHERE id = ANY($1)', [ids]);
  }
  res.json({ success: true });
});

export default router;
