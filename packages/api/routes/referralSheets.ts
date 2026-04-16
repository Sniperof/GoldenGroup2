import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const selectFields = `
  id, referral_type AS "referralType", referral_entity_id AS "referralEntityId",
  referral_name_snapshot AS "referralNameSnapshot", referral_address_text AS "referralAddressText",
  referral_origin_channel AS "referralOriginChannel", referral_notes AS "referralNotes",
  referral_date AS "referralDate", owner_user_id AS "ownerUserId", status,
  total_candidates AS "totalCandidates", quality_percentage AS "qualityPercentage",
  conversion_percentage AS "conversionPercentage",
  created_at AS "createdAt", created_by AS "createdBy"
`;

function mapRow(r: any) {
  return {
    ...r,
    stats: {
      totalCandidates: r.totalCandidates,
      qualityPercentage: r.qualityPercentage,
      conversionPercentage: r.conversionPercentage,
    }
  };
}

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT ${selectFields} FROM referral_sheets ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM referral_sheets`),
    ]);
    res.json(paginatedResponse(rows.map(mapRow), parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`SELECT ${selectFields} FROM referral_sheets ORDER BY id DESC`);
    res.json(rows.map(mapRow));
  }
});

router.post('/', async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `INSERT INTO referral_sheets (referral_type, referral_entity_id, referral_name_snapshot,
      referral_address_text, referral_origin_channel, referral_notes, referral_date,
      owner_user_id, status, total_candidates, quality_percentage, conversion_percentage, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING ${selectFields}`,
    [s.referralType, s.referralEntityId || null, s.referralNameSnapshot || '',
     s.referralAddressText || '', s.referralOriginChannel || null, s.referralNotes || null,
     s.referralDate || null, s.ownerUserId, s.status || 'New',
     s.stats?.totalCandidates || 0, s.stats?.qualityPercentage || 0,
     s.stats?.conversionPercentage || 0, s.createdBy || null]
  );
  res.json(mapRow(rows[0]));
});

router.put('/:id', async (req, res) => {
  const s = req.body;
  const id = req.params.id;

  const { rows: existing } = await pool.query(`SELECT ${selectFields} FROM referral_sheets WHERE id=$1`, [id]);
  if (!existing[0]) {
    res.status(404).json({ error: 'Referral sheet not found' });
    return;
  }

  const current = existing[0];
  const merged = {
    referralType: s.referralType ?? current.referralType,
    referralEntityId: s.referralEntityId !== undefined ? s.referralEntityId : current.referralEntityId,
    referralNameSnapshot: s.referralNameSnapshot ?? current.referralNameSnapshot,
    referralAddressText: s.referralAddressText ?? current.referralAddressText,
    referralOriginChannel: s.referralOriginChannel ?? current.referralOriginChannel,
    referralNotes: s.referralNotes ?? current.referralNotes,
    referralDate: s.referralDate ?? current.referralDate,
    ownerUserId: s.ownerUserId ?? current.ownerUserId,
    status: s.status ?? current.status,
    totalCandidates: s.stats?.totalCandidates ?? current.totalCandidates,
    qualityPercentage: s.stats?.qualityPercentage ?? current.qualityPercentage,
    conversionPercentage: s.stats?.conversionPercentage ?? current.conversionPercentage,
  };

  const { rows } = await pool.query(
    `UPDATE referral_sheets SET referral_type=$1, referral_entity_id=$2, referral_name_snapshot=$3,
      referral_address_text=$4, referral_origin_channel=$5, referral_notes=$6, referral_date=$7,
      owner_user_id=$8, status=$9, total_candidates=$10, quality_percentage=$11, conversion_percentage=$12
    WHERE id=$13 RETURNING ${selectFields}`,
    [merged.referralType, merged.referralEntityId || null, merged.referralNameSnapshot || '',
     merged.referralAddressText || '', merged.referralOriginChannel || null, merged.referralNotes || null,
     merged.referralDate || null, merged.ownerUserId, merged.status || 'New',
     merged.totalCandidates || 0, merged.qualityPercentage || 0,
     merged.conversionPercentage || 0, id]
  );
  res.json(mapRow(rows[0]));
});

export default router;
