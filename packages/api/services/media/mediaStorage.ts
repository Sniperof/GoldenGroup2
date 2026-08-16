// ============================================================
// mediaStorage.ts — pure path/id/URL rules for the unified media store
// ============================================================
// Kept free of DB and fs so the rules can be tested directly, and so the
// serving route can resolve a URL to a path without touching the database.
// ============================================================

import crypto from 'crypto';
import path from 'path';
import { MEDIA_DIR } from '../../config/env.js';

export type MediaKind = 'image' | 'video' | 'document';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const PUBLIC_ID_LENGTH = 12;

/** Suffix that marks the generated thumbnail of an image. */
export const THUMBNAIL_SUFFIX = '_t';

/**
 * Everything the serving route will accept. Anchored and character-limited so
 * no traversal sequence ('..', '/', '\', NUL) can survive into a path join.
 */
export const MEDIA_FILENAME_PATTERN =
  /^([A-Za-z0-9]{8,16})(_t)?\.([a-z0-9]{2,5})$/;

export const ALLOWED_EXTENSIONS: Record<MediaKind, string[]> = {
  image: ['webp'],                          // everything is normalised to webp
  video: ['mp4', 'webm', 'mov'],
  document: ['pdf'],
};

/** Per-kind upload ceilings, applied to the ORIGINAL bytes. */
export const MAX_UPLOAD_BYTES: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 15 * 1024 * 1024,
};

export function generatePublicId(): string {
  // rejection-free: 62 does not divide 256, so map from a wider random pool.
  const bytes = crypto.randomBytes(PUBLIC_ID_LENGTH * 2);
  let id = '';
  for (let i = 0; id.length < PUBLIC_ID_LENGTH; i++) {
    const byte = bytes[i];
    if (byte >= 248) continue;              // 248 = 4*62; drop the biased tail
    id += ID_ALPHABET[byte % 62];
  }
  return id;
}

/**
 * Two levels of 2-char shards. A single directory holding tens of thousands of
 * files degrades badly on both ext4 and NTFS; the public URL stays flat because
 * the shard is derived from the id rather than stored.
 */
export function shardFor(publicId: string): string[] {
  return [publicId.slice(0, 2), publicId.slice(2, 4)];
}

export function storedFileName(publicId: string, extension: string, thumbnail = false): string {
  return `${publicId}${thumbnail ? THUMBNAIL_SUFFIX : ''}.${extension}`;
}

export function absolutePathFor(publicId: string, extension: string, thumbnail = false): string {
  return path.join(MEDIA_DIR, ...shardFor(publicId), storedFileName(publicId, extension, thumbnail));
}

export function directoryFor(publicId: string): string {
  return path.join(MEDIA_DIR, ...shardFor(publicId));
}

export function publicUrlFor(publicId: string, extension: string, thumbnail = false): string {
  return `/m/${storedFileName(publicId, extension, thumbnail)}`;
}

/**
 * Resolves a request filename to an absolute path, or null when it does not
 * match the pattern. Never returns a path outside MEDIA_DIR.
 */
export function resolveRequestedFile(fileName: string): string | null {
  const match = MEDIA_FILENAME_PATTERN.exec(fileName);
  if (!match) return null;
  const [, publicId, thumb, extension] = match;
  const resolved = path.join(MEDIA_DIR, ...shardFor(publicId), `${publicId}${thumb ?? ''}.${extension}`);
  // Defence in depth: the pattern already forbids separators, but a path that
  // escaped the root for any reason must never be served.
  const root = path.resolve(MEDIA_DIR);
  return path.resolve(resolved).startsWith(root + path.sep) ? resolved : null;
}

/** Extracts the public id from a stored URL, or null if it is not a media URL. */
export function publicIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = /^\/m\/([A-Za-z0-9]{8,16})(_t)?\.[a-z0-9]{2,5}$/.exec(url.trim());
  return match ? match[1] : null;
}
