import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { optionalAppAuth, requireAppAuth } from '../middleware/appAuth.js';
import { processUpload, storePrivateMedia } from '../services/media/mediaService.js';
import { absolutePathFor } from '../services/media/mediaStorage.js';
import { sendOtp, verifyOtp } from '../services/otp/otpService.js';
import {
  createMobileComplaint, createTrackingGrant, getMyComplaint, listMyComplaints,
  resolveComplaintIdentity, trackComplaint,
} from '../services/complaints/mobileComplaintService.js';
import { sendAppError } from '../utils/appErrors.js';
import {
  COMPLAINT_CATEGORY_LABELS_AR, DEVICE_COMPLAINT_CATEGORIES, TECHNICAL_COMPLAINT_CATEGORIES,
} from '@golden-crm/shared';

const router = Router();
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_IMAGE_BYTES } }).single('file');

function positive(value: unknown): number | null {
  const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null;
}

router.get('/complaints/options', optionalAppAuth, (_req,res)=>res.json({
  formVersion:'complaint.mobile.v1',
  types:[{code:'technical',label:'شكوى فنية'},{code:'device',label:'شكوى جهاز'},{code:'general',label:'شكوى عامة'}],
  technicalCategories:TECHNICAL_COMPLAINT_CATEGORIES.map(code=>({code,label:COMPLAINT_CATEGORY_LABELS_AR[code]})),
  deviceIssueTypes:DEVICE_COMPLAINT_CATEGORIES.map(code=>({code,label:COMPLAINT_CATEGORY_LABELS_AR[code]})),
  preferredContactMethods:['phone','whatsapp','sms','no_preference'],
  attachments:{acceptedMimeTypes:['image/jpeg','image/png','image/webp'],maxImageBytes:MAX_IMAGE_BYTES,maxTotalBytes:30*1024*1024,maxVerifiedImages:5,maxUnverifiedImages:2},
  eligibility:{unverified:['general','technical'],otpVisitor:['general','technical','device'],appAccount:['general','technical','device']},
}));

router.post('/complaint-uploads', optionalAppAuth, (req, res) => upload(req, res, async (uploadError) => {
  if (uploadError) return res.status((uploadError as any).code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'complaint_media_upload_failed' });
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'file_required' });
    const inspected = await processUpload(req.file.buffer, req.file.originalname);
    if (inspected.kind !== 'image') return res.status(415).json({ error: 'complaint_images_only' });
    const client = await pool.connect();
    let identity;
    try {
      await client.query('BEGIN');
      identity = await resolveComplaintIdentity({ db: client, appAccount: req.appAccount, handle: req.body?.verificationHandle, deviceId: req.get('X-Device-Id'), ip: req.ip ?? null });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const max = identity.kind === 'unverified_device' ? 2 : 5;
    const configuredDailyBytes = await pool.query(`SELECT value FROM system_settings WHERE key='complaints_upload_daily_byte_limit'`);
    const dailyByteLimit = Math.max(0, Number(configuredDailyBytes.rows[0]?.value) || 50 * 1024 * 1024);
    const dailyUsage = await pool.query(`SELECT COALESCE(SUM(mf.byte_size),0)::bigint AS bytes FROM complaint_attachments ca JOIN media_files mf ON mf.id=ca.media_file_id WHERE ca.identity_kind=$1 AND ca.identity_key=$2 AND ca.created_at>=NOW()-INTERVAL '24 hours'`,[identity.kind,identity.key]);
    if (dailyByteLimit > 0 && Number(dailyUsage.rows[0]?.bytes) + inspected.body.length > dailyByteLimit) {
      return res.status(429).json({ error: 'complaint_upload_daily_limit_exceeded', details: { dailyByteLimit } });
    }
    const pending = await pool.query(`SELECT COUNT(*)::int AS n,COALESCE(SUM(mf.byte_size),0)::bigint AS bytes FROM complaint_attachments ca JOIN media_files mf ON mf.id=ca.media_file_id WHERE ca.identity_kind=$1 AND ca.identity_key=$2 AND ca.complaint_id IS NULL AND ca.consumed_at IS NULL AND ca.expires_at>NOW()`, [identity.kind, identity.key]);
    if (Number(pending.rows[0]?.n) >= max || Number(pending.rows[0]?.bytes) + inspected.body.length > 30 * 1024 * 1024) {
      return res.status(400).json({ error: 'attachment_limit_exceeded', details: { maximumCount: max, maximumTotalBytes: 30 * 1024 * 1024 } });
    }
    const stored = await storePrivateMedia(req.file.buffer, { originalName: req.file.originalname, uploadedBy: null });
    const { rows } = await pool.query(`INSERT INTO complaint_attachments(media_file_id,identity_kind,identity_key) VALUES($1,$2,$3) RETURNING upload_token,expires_at`, [stored.mediaFileId, identity.kind, identity.key]);
    return res.status(201).json({ uploadToken: rows[0].upload_token, mimeType: stored.mimeType, byteSize: stored.byteSize, expiresAt: rows[0].expires_at });
  } catch (error) { return sendAppError(res, error, 'complaints.media'); }
}));

router.post('/complaints', optionalAppAuth, async (req, res) => {
  try {
    const result = await createMobileComplaint({ appAccount: req.appAccount, handle: req.body?.verificationHandle, deviceId: req.get('X-Device-Id'), ip: req.ip ?? null, body: req.body ?? {} });
    return res.status(201).json(result);
  } catch (error) { return sendAppError(res, error, 'complaints.create'); }
});

router.get('/me/complaints', requireAppAuth, async (req, res) => {
  try { return res.json(await listMyComplaints(req.appAccount!)); }
  catch (error) { return sendAppError(res, error, 'complaints.mine'); }
});

router.get('/me/complaints/:id', requireAppAuth, async (req, res) => {
  try { const id = positive(req.params.id); if (!id) return res.status(400).json({ error: 'invalid_complaint_id' }); return res.json(await getMyComplaint(req.appAccount!, id)); }
  catch (error) { return sendAppError(res, error, 'complaints.mine.detail'); }
});

router.post('/complaints/tracking/otp/send', async (req, res) => {
  try { await sendOtp({ phone: req.body?.phone, purpose: 'complaint_tracking' }); return res.json({ sent: true }); }
  catch (error) { return sendAppError(res, error, 'complaints.tracking.send'); }
});

router.post('/complaints/tracking/otp/verify', async (req, res) => {
  try {
    const proof = await verifyOtp({ phone: req.body?.phone, code: req.body?.code, purpose: 'complaint_tracking' });
    return res.json(await createTrackingGrant({ publicRefNumber: req.body?.publicRefNumber, phone: req.body?.phone, verificationHandle: proof.handle }));
  } catch (error) { return sendAppError(res, error, 'complaints.tracking.verify'); }
});

router.post('/complaints/tracking', async (req, res) => {
  try { return res.json(await trackComplaint(req.body?.trackingHandle)); }
  catch (error) { return sendAppError(res, error, 'complaints.tracking'); }
});

router.get('/complaints/:complaintId/attachments/:attachmentId', optionalAppAuth, async (req, res) => {
  try {
    const complaintId = positive(req.params.complaintId); const attachmentId = positive(req.params.attachmentId);
    if (!complaintId || !attachmentId) return res.status(400).json({ error: 'invalid_attachment_id' });
    const trackingHandle = req.get('X-Complaint-Tracking');
    const { rows } = await pool.query(`SELECT mf.public_id,mf.extension,mf.mime_type FROM complaint_attachments ca JOIN complaints c ON c.id=ca.complaint_id JOIN media_files mf ON mf.id=ca.media_file_id WHERE ca.id=$1 AND c.id=$2 AND mf.visibility='private' AND (c.requester_app_account_id=$3 OR EXISTS(SELECT 1 FROM complaint_tracking_grants g WHERE g.handle=$4 AND g.complaint_id=c.id AND g.expires_at>NOW()))`, [attachmentId, complaintId, req.appAccount?.appAccountId ?? null, trackingHandle ?? null]);
    if (!rows[0]) return res.status(404).json({ error: 'attachment_not_found' });
    res.setHeader('Cache-Control', 'private, no-store'); res.type(rows[0].mime_type);
    return fs.createReadStream(absolutePathFor(rows[0].public_id, rows[0].extension)).pipe(res);
  } catch (error) { return sendAppError(res, error, 'complaints.attachment'); }
});

export default router;
