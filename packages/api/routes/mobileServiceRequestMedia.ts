import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { UPLOADS_DIR } from '../storage/uploader.js';
import { resolveMobileIntakeIdentity, type MobileIntakeIdentity } from '../services/serviceRequests/mobileIntakeIdentity.js';
import { sendAppError } from '../utils/appErrors.js';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_MAX_DURATION_MS = 8_000;

export const mobileServiceRequestMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: VIDEO_MAX_BYTES },
}).single('file');

type MediaInspection = {
  mediaType: 'image' | 'video' | 'document';
  mimeType: string;
  extension: string;
  durationMs: number | null;
};

function identityKey(identity: MobileIntakeIdentity): string {
  if (identity.kind === 'customer') return String(identity.account.appAccountId);
  if (identity.kind === 'visitor') return identity.phone;
  return identity.deviceId;
}

function inspectImage(buffer: Buffer): MediaInspection | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mediaType: 'image', mimeType: 'image/jpeg', extension: '.jpg', durationMs: null };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: 'image', mimeType: 'image/png', extension: '.png', durationMs: null };
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mediaType: 'image', mimeType: 'image/webp', extension: '.webp', durationMs: null };
  }
  return null;
}

function readIsoBmffDuration(buffer: Buffer, start = 0, end = buffer.length): number | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;
    const payloadStart = offset + headerSize;
    const boxEnd = offset + size;
    if (type === 'mvhd') {
      if (payloadStart + 20 > boxEnd) return null;
      const version = buffer[payloadStart];
      if (version === 0) {
        const timescale = buffer.readUInt32BE(payloadStart + 12);
        const duration = buffer.readUInt32BE(payloadStart + 16);
        return timescale > 0 ? Math.round((duration * 1000) / timescale) : null;
      }
      if (version === 1 && payloadStart + 32 <= boxEnd) {
        const timescale = buffer.readUInt32BE(payloadStart + 20);
        const duration = buffer.readBigUInt64BE(payloadStart + 24);
        if (timescale === 0 || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        return Math.round((Number(duration) * 1000) / timescale);
      }
      return null;
    }
    if (type === 'moov') {
      const nested = readIsoBmffDuration(buffer, payloadStart, boxEnd);
      if (nested != null) return nested;
    }
    offset = boxEnd;
  }
  return null;
}

export function inspectMobileServiceRequestMedia(buffer: Buffer): MediaInspection | null {
  const image = inspectImage(buffer);
  if (image) return image;
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return { mediaType: 'document', mimeType: 'application/pdf', extension: '.pdf', durationMs: null };
  }
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  const durationMs = readIsoBmffDuration(buffer);
  if (durationMs == null) return null;
  return { mediaType: 'video', mimeType: 'video/mp4', extension: '.mp4', durationMs };
}

export async function uploadMobileServiceRequestMedia(req: Request, res: Response) {
  let storagePath: string | null = null;
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'file_required' });
    const media = inspectMobileServiceRequestMedia(req.file.buffer);
    if (!media) return res.status(415).json({ error: 'unsupported_or_invalid_media' });
    if (media.mediaType === 'image' && req.file.size > IMAGE_MAX_BYTES) {
      return res.status(413).json({ error: 'image_too_large', details: { maximumBytes: IMAGE_MAX_BYTES } });
    }
    if (media.mediaType === 'document' && req.file.size > DOCUMENT_MAX_BYTES) {
      return res.status(413).json({ error: 'document_too_large', details: { maximumBytes: DOCUMENT_MAX_BYTES } });
    }
    if (media.mediaType === 'video' && media.durationMs! <= 0) {
      return res.status(400).json({ error: 'invalid_video_duration' });
    }
    if (media.mediaType === 'video' && media.durationMs! > VIDEO_MAX_DURATION_MS) {
      return res.status(422).json({
        error: 'video_duration_exceeded',
        details: { maximumDurationMs: VIDEO_MAX_DURATION_MS, actualDurationMs: media.durationMs },
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await resolveMobileIntakeIdentity({
        db: client,
        appAccount: req.appAccount,
        handle: req.body?.handle,
        deviceId: req.get('X-Device-Id'),
        ip: req.ip ?? null,
        allowUnverified: true,
      });
      const filename = `service-request-${crypto.randomUUID()}${media.extension}`;
      storagePath = path.join(UPLOADS_DIR, filename);
      await fs.writeFile(storagePath, req.file.buffer, { flag: 'wx' });
      const publicUrl = `/uploads/${filename}`;
      const { rows } = await client.query<{ id: string; expires_at: string }>(
        `INSERT INTO service_request_mobile_uploads
           (identity_kind, identity_key, media_type, mime_type, storage_path,
            public_url, byte_size, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, expires_at`,
        [
          identity.kind,
          identityKey(identity),
          media.mediaType,
          media.mimeType,
          storagePath,
          publicUrl,
          req.file.size,
          media.durationMs,
        ],
      );
      await client.query('COMMIT');
      return res.status(201).json({
        uploadToken: rows[0].id,
        mediaType: media.mediaType,
        mimeType: media.mimeType,
        byteSize: req.file.size,
        durationMs: media.durationMs,
        expiresAt: rows[0].expires_at,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (storagePath) await fs.unlink(storagePath).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return sendAppError(res, error, 'serviceRequests.media');
  }
}
