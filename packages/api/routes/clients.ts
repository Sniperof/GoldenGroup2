import { Router } from 'express';
import pool from '../db.js';

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
    spouse_occupation AS "spouseOccupation",
    data_quality AS "dataQuality",
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
    spouse_occupation AS "spouseOccupation",
    data_quality AS "dataQuality",
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

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`${CLIENT_SELECT} ORDER BY id`);
  res.json(rows);
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
      detailed_address, gps_coordinates, occupation, spouse_occupation, data_quality, water_source, notes, rating,
      source_channel, referrer_type, referrer_id, referrer_name, referrers, referral_entity_id,
      referral_date, referral_reason, referral_sheet_id, referral_address_text,
      is_candidate, target_client, candidate_status
    )
    VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24,
      $25,$26,$27,$28,
      $29,$30,$31
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
      c.spouseOccupation || null,
      c.dataQuality || null,
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
      detailed_address=$11, gps_coordinates=$12, occupation=$13, spouse_occupation=$14, data_quality=$15, water_source=$16, notes=$17, rating=$18,
      source_channel=$19, referrer_type=$20, referrer_id=$21, referrer_name=$22, referrers=$23, referral_entity_id=$24,
      referral_date=$25, referral_reason=$26, referral_sheet_id=$27, referral_address_text=$28,
      is_candidate=$29, target_client=$30, candidate_status=$31
    WHERE id=$32
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
      c.spouseOccupation || null,
      c.dataQuality || null,
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
