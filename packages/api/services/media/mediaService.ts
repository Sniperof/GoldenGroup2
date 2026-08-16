// ============================================================
// mediaService.ts — store a file, register it, hand back a short URL
// ============================================================
// Single entry point for every device / branch / banner image, video and
// catalogue. Callers never build paths or URLs themselves.
//
// Images are normalised rather than stored as uploaded:
//   - re-encoded to WebP (one output format keeps the serving contract trivial)
//   - capped at MAX_IMAGE_DIMENSION on the long edge
//   - a 400px thumbnail is generated for list screens
//   - ALL metadata is dropped — phone photos carry GPS coordinates, device
//     model and capture time, and those were previously shipped to customers
// Videos and documents are stored byte-for-byte; we do not transcode.
// ============================================================

import crypto from 'crypto';
import fs from 'fs/promises';
import type { Pool, PoolClient } from 'pg';
import sharp, { type Metadata, type Sharp } from 'sharp';
import pool from '../../db.js';
import { appError } from '../../utils/appErrors.js';
import { inspectMedia } from './mediaInspect.js';
import {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  type MediaKind,
  absolutePathFor,
  directoryFor,
  generatePublicId,
  publicUrlFor,
} from './mediaStorage.js';

export const MAX_IMAGE_DIMENSION = 2048;
export const THUMBNAIL_WIDTH = 400;
const WEBP_QUALITY = 82;
const THUMBNAIL_QUALITY = 75;

export interface StoredMedia {
  publicId: string;
  kind: MediaKind;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  mimeType: string;
}

interface ProcessedBytes {
  kind: MediaKind;
  extension: string;
  mimeType: string;
  body: Buffer;
  thumbnail: Buffer | null;
  width: number | null;
  height: number | null;
}

/**
 * Decodes, validates and normalises. Throws client-visible errors; never
 * touches disk or the DB, so it is testable on buffers alone.
 */
export async function processUpload(buffer: Buffer, originalName?: string): Promise<ProcessedBytes> {
  if (!buffer?.length) throw appError(400, 'لم يتم رفع أي ملف', { code: 'file_required' });

  const inspected = inspectMedia(buffer);
  if (!inspected) {
    throw appError(415, 'نوع الملف غير مدعوم', { code: 'unsupported_media_type' });
  }
  if (buffer.length > MAX_UPLOAD_BYTES[inspected.kind]) {
    throw appError(413, 'حجم الملف أكبر من المسموح', {
      code: 'file_too_large',
      details: { kind: inspected.kind, maximumBytes: MAX_UPLOAD_BYTES[inspected.kind] },
    });
  }

  if (inspected.kind !== 'image') {
    return {
      kind: inspected.kind,
      extension: inspected.extension,
      mimeType: inspected.mimeType,
      body: buffer,
      thumbnail: null,
      width: null,
      height: null,
    };
  }

  let pipeline: Sharp;
  let metadata: Metadata;
  try {
    // failOn:'none' — a slightly malformed but decodable photo from a phone
    // should still be accepted; genuinely undecodable input throws below.
    pipeline = sharp(buffer, { failOn: 'none' });
    metadata = await pipeline.metadata();
  } catch {
    throw appError(400, 'تعذّرت قراءة الصورة', { code: 'unreadable_image' });
  }
  if (!metadata.width || !metadata.height) {
    throw appError(400, 'تعذّرت قراءة أبعاد الصورة', { code: 'unreadable_image' });
  }

  const body = await sharp(buffer, { failOn: 'none' })
    .rotate()                                   // apply EXIF orientation before stripping it
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,                 // never upscale a small logo
    })
    .webp({ quality: WEBP_QUALITY })            // sharp drops metadata unless withMetadata() is called
    .toBuffer();

  const thumbnail = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

  const stored = await sharp(body).metadata();
  return {
    kind: 'image',
    extension: 'webp',
    mimeType: 'image/webp',
    body,
    thumbnail,
    width: stored.width ?? null,
    height: stored.height ?? null,
  };
}

/**
 * Writes the processed bytes and registers them. The row starts unowned; the
 * entity save that references the URL claims it via syncMediaOwnership.
 * Anything never claimed is reclaimed by the GC sweep.
 */
export async function storeMedia(
  buffer: Buffer,
  options: { originalName?: string; uploadedBy?: number | null } = {},
  db: Pool | PoolClient = pool,
): Promise<StoredMedia> {
  const processed = await processUpload(buffer, options.originalName);
  // Recorded for audit and duplicate REPORTING only. Deliberately not used to
  // return an existing file: media_files carries a single owner, so handing the
  // same file to two entities would leave one of them referencing a file it
  // does not own — and the GC would delete it out from under them when the
  // owner detached it. One upload, one file.
  const checksum = crypto.createHash('sha256').update(processed.body).digest('hex');

  const publicId = generatePublicId();
  await fs.mkdir(directoryFor(publicId), { recursive: true });
  // 'wx' — refuse to clobber. A collision on a 12-char base62 id is effectively
  // impossible, but silently overwriting someone else's file is not a failure
  // mode worth risking.
  await fs.writeFile(absolutePathFor(publicId, processed.extension), processed.body, { flag: 'wx' });
  if (processed.thumbnail) {
    await fs.writeFile(
      absolutePathFor(publicId, processed.extension, true),
      processed.thumbnail,
      { flag: 'wx' },
    );
  }

  try {
    await db.query(
      `INSERT INTO public.media_files
         (public_id, kind, mime_type, extension, byte_size, width, height,
          has_thumbnail, checksum, original_name, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        publicId, processed.kind, processed.mimeType, processed.extension,
        processed.body.length, processed.width, processed.height,
        processed.thumbnail != null, checksum,
        options.originalName?.slice(0, 255) ?? null, options.uploadedBy ?? null,
      ],
    );
  } catch (err) {
    // Don't leave bytes on disk that no row points at — the GC works off the
    // registry, so an unregistered file would never be reclaimed.
    await removeFiles(publicId, processed.extension, processed.thumbnail != null);
    throw err;
  }

  return {
    publicId,
    kind: processed.kind,
    url: publicUrlFor(publicId, processed.extension),
    thumbUrl: processed.thumbnail ? publicUrlFor(publicId, processed.extension, true) : null,
    width: processed.width,
    height: processed.height,
    byteSize: processed.body.length,
    mimeType: processed.mimeType,
  };
}

export async function removeFiles(
  publicId: string,
  extension: string,
  hasThumbnail: boolean,
): Promise<void> {
  await fs.rm(absolutePathFor(publicId, extension), { force: true });
  if (hasThumbnail) await fs.rm(absolutePathFor(publicId, extension, true), { force: true });
}

/** Verifies the extensions we hand out are ones the serving route will accept. */
export function isServableExtension(kind: MediaKind, extension: string): boolean {
  return ALLOWED_EXTENSIONS[kind].includes(extension);
}
