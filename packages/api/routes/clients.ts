import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveTargetBranchId } from '../middleware/permission.js';

const router = Router();

// All client endpoints require authentication and enforce branch scoping:
//   - branch admins see/write only their branch's clients;
//   - super admins see all, and must name a target branch on writes
//     (via X-Branch-Id header or body.branchId).
router.use(requireAuth);

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
    gender,
    national_id AS "nationalId",
    birth_date AS "birthDate",
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
    referral_notes AS "referralNotes",
    referrers,
    referral_entity_id AS "referralEntityId",
    referral_date AS "referralDate",
    referral_reason AS "referralReason",
    referral_sheet_id AS "referralSheetId",
    referral_address_text AS "referralAddressText",
    created_at AS "createdAt",
    is_candidate AS "isCandidate",
    target_client AS "targetClient",
    candidate_status AS "candidateStatus",
    branch_id AS "branchId"
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
    gender,
    national_id AS "nationalId",
    birth_date AS "birthDate",
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
    referral_notes AS "referralNotes",
    referrers,
    referral_entity_id AS "referralEntityId",
    referral_date AS "referralDate",
    referral_reason AS "referralReason",
    referral_sheet_id AS "referralSheetId",
    referral_address_text AS "referralAddressText",
    created_at AS "createdAt",
    is_candidate AS "isCandidate",
    target_client AS "targetClient",
    candidate_status AS "candidateStatus",
    branch_id AS "branchId"
`;

const toJson = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback);

/** Build a "WHERE branch_id = …" fragment honouring super-admin bypass. */
function scopedWhere(scope: Express.Request['scope'], startParamIdx = 1): { sql: string; params: any[] } {
  if (!scope || scope.isSuperAdmin) {
    // Super admin: optional branch filter via header
    return { sql: '', params: [] };
  }
  return { sql: `WHERE branch_id = $${startParamIdx}`, params: [scope.branchId] };
}

router.get('/', async (req, res) => {
  const scope = req.scope!;
  // Super admin can optionally narrow with X-Branch-Id header.
  if (scope.isSuperAdmin) {
    const headerBranch = Number(req.header('x-branch-id'));
    if (Number.isFinite(headerBranch) && headerBranch > 0) {
      const { rows } = await pool.query(`${CLIENT_SELECT} WHERE branch_id = $1 ORDER BY id`, [headerBranch]);
      return res.json(rows);
    }
    const { rows } = await pool.query(`${CLIENT_SELECT} ORDER BY id`);
    return res.json(rows);
  }
  const { rows } = await pool.query(`${CLIENT_SELECT} WHERE branch_id = $1 ORDER BY id`, [scope.branchId]);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const scope = req.scope!;
  const { rows } = await pool.query(`${CLIENT_SELECT} WHERE id = $1`, [req.params.id]);
  if (!rows[0]) {
    res.status(404).json({ message: 'الزبون غير موجود' });
    return;
  }
  if (!scope.isSuperAdmin && rows[0].branchId !== scope.branchId) {
    return res.status(403).json({ message: 'غير مسموح' });
  }
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const targetBranchId = resolveTargetBranchId(req, res, req.body?.branchId);
  if (targetBranchId == null) return; // response already sent

  const c = req.body;
  const { rows } = await pool.query(
    `INSERT INTO clients (
      first_name, father_name, last_name, nickname,
      name, mobile, contacts, governorate, district, neighborhood,
      detailed_address, gps_coordinates, gender, national_id, birth_date, occupation, spouse_occupation, data_quality, water_source, notes, rating,
      source_channel, referrer_type, referrer_id, referrer_name, referral_notes, referrers, referral_entity_id,
      referral_date, referral_reason, referral_sheet_id, referral_address_text,
      is_candidate, target_client, candidate_status,
      branch_id
    )
    VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25,$26,$27,$28,
      $29,$30,$31,$32,
      $33,$34,$35,
      $36
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
      c.gender || null,
      c.nationalId || null,
      c.birthDate || null,
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
      c.referralNotes || null,
      toJson(c.referrers, []),
      c.referralEntityId || null,
      c.referralDate || null,
      c.referralReason || null,
      c.referralSheetId || null,
      c.referralAddressText || null,
      c.isCandidate || false,
      c.targetClient || null,
      c.candidateStatus || null,
      targetBranchId,
    ],
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const scope = req.scope!;
  // Load the row first so we can enforce branch ownership before updating.
  const { rows: existing } = await pool.query('SELECT branch_id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing[0]) {
    return res.status(404).json({ message: 'الزبون غير موجود' });
  }
  if (!scope.isSuperAdmin && existing[0].branch_id !== scope.branchId) {
    return res.status(403).json({ message: 'غير مسموح' });
  }

  const c = req.body;
  const { rows } = await pool.query(
    `UPDATE clients SET
      first_name=$1, father_name=$2, last_name=$3, nickname=$4,
      name=$5, mobile=$6, contacts=$7, governorate=$8, district=$9, neighborhood=$10,
      detailed_address=$11, gps_coordinates=$12, gender=$13, national_id=$14, birth_date=$15, occupation=$16, spouse_occupation=$17, data_quality=$18, water_source=$19, notes=$20, rating=$21,
      source_channel=$22, referrer_type=$23, referrer_id=$24, referrer_name=$25, referral_notes=$26, referrers=$27, referral_entity_id=$28,
      referral_date=$29, referral_reason=$30, referral_sheet_id=$31, referral_address_text=$32,
      is_candidate=$33, target_client=$34, candidate_status=$35
    WHERE id=$36
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
      c.gender || null,
      c.nationalId || null,
      c.birthDate || null,
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
      c.referralNotes || null,
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
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const scope = req.scope!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'الزبون غير موجود' });
  if (!scope.isSuperAdmin && existing[0].branch_id !== scope.branchId) {
    return res.status(403).json({ message: 'غير مسموح' });
  }
  await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/bulk-delete', async (req, res) => {
  const scope = req.scope!;
  const { ids } = req.body;
  if (!ids || ids.length === 0) return res.json({ success: true });
  if (scope.isSuperAdmin) {
    await pool.query('DELETE FROM clients WHERE id = ANY($1)', [ids]);
  } else {
    await pool.query(
      'DELETE FROM clients WHERE id = ANY($1) AND branch_id = $2',
      [ids, scope.branchId],
    );
  }
  res.json({ success: true });
});

export default router;
