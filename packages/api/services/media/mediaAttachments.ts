// ============================================================
// mediaAttachments.ts — one shape for every entity's media list
// ============================================================
// device_models (images/videos/documents) and branches (images) both store a
// jsonb array of {id, name, url}. Until now device_models validated only that
// the value was an array — any JSON, including a 10 MB base64 blob, was
// accepted and then served straight to the mobile app.
//
// The url allowlist is deliberately narrow:
//   /m/<id>.<ext>      the media store (the only form new uploads produce)
//   /uploads/<file>    legacy files from before migration 423
// External URLs and data: URLs are rejected — an admin row must never be able
// to point the customer app at bytes we do not host, and inline base64 is the
// bloat this whole change exists to remove.
//
// Inline base64 is now rejected outright (Phase 3C, after
// scripts/migrate-inline-media.ts ran). Consequence worth knowing: if that
// script reported an item it could not migrate, the entity holding it cannot be
// saved until an admin re-uploads that one file. The script names every such
// item, and leaving them silently in place would mean keeping the bloat forever.
// ============================================================

import { appError } from '../../utils/appErrors.js';
import { publicIdFromUrl } from './mediaStorage.js';

export interface MediaAttachment {
  id: string;
  name: string;
  url: string;
  thumbUrl?: string | null;
}

export const MEDIA_URL_PATTERN = /^\/m\/[A-Za-z0-9]{8,16}(_t)?\.[a-z0-9]{2,5}$/;
export const LEGACY_UPLOAD_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Whether `data:` URLs still already in the DB are tolerated on save.
 * Turned off in Phase 3C once the migration had run; kept as a named constant
 * so a future environment that has not migrated yet can re-enable it briefly.
 */
export const LEGACY_INLINE_GRACE = false;

export const MAX_ATTACHMENTS_PER_FIELD = 20;

export function isAcceptedMediaUrl(url: string): boolean {
  if (MEDIA_URL_PATTERN.test(url) || LEGACY_UPLOAD_URL_PATTERN.test(url)) return true;
  return LEGACY_INLINE_GRACE && url.startsWith('data:');
}

/**
 * Validates one attachment array and returns it normalised.
 *
 * @param fieldLabel Arabic field name, used in the error the admin sees
 */
export function validateMediaAttachments(value: unknown, fieldLabel: string): MediaAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw appError(400, `${fieldLabel}: القيمة يجب أن تكون قائمة`, { code: 'invalid_attachments' });
  }
  if (value.length > MAX_ATTACHMENTS_PER_FIELD) {
    throw appError(400, `${fieldLabel}: الحد الأقصى ${MAX_ATTACHMENTS_PER_FIELD} عنصراً`, {
      code: 'too_many_attachments',
    });
  }

  const seen = new Set<string>();
  return value.map((raw, index) => {
    const position = `${fieldLabel} (${index + 1})`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw appError(400, `${position}: عنصر غير صالح`, { code: 'invalid_attachment' });
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';

    if (!id) throw appError(400, `${position}: معرّف مفقود`, { code: 'invalid_attachment' });
    if (id.length > 64) throw appError(400, `${position}: معرّف طويل جداً`, { code: 'invalid_attachment' });
    if (seen.has(id)) throw appError(400, `${position}: معرّف مكرر`, { code: 'duplicate_attachment' });
    seen.add(id);

    if (!url) throw appError(400, `${position}: رابط مفقود`, { code: 'invalid_attachment' });
    if (!isAcceptedMediaUrl(url)) {
      throw appError(400, `${position}: يجب رفع الملف عبر النظام`, { code: 'invalid_attachment_url' });
    }

    const thumbUrl = typeof item.thumbUrl === 'string' ? item.thumbUrl.trim() : '';
    if (thumbUrl && !isAcceptedMediaUrl(thumbUrl)) {
      throw appError(400, `${position}: رابط المصغّرة غير صالح`, { code: 'invalid_attachment_url' });
    }

    return {
      id,
      name: name.slice(0, 255),
      url,
      ...(thumbUrl ? { thumbUrl } : {}),
    };
  });
}

/** `primaryImageId` must name one of the images actually present. */
export function validatePrimaryImageId(
  primaryImageId: unknown,
  images: MediaAttachment[],
): string | null {
  if (primaryImageId === undefined || primaryImageId === null || primaryImageId === '') return null;
  if (typeof primaryImageId !== 'string') {
    throw appError(400, 'الصورة الرئيسية غير صالحة', { code: 'invalid_primary_image' });
  }
  const id = primaryImageId.trim();
  if (!images.some((image) => image.id === id)) {
    throw appError(400, 'الصورة الرئيسية غير موجودة ضمن الصور', { code: 'invalid_primary_image' });
  }
  return id;
}

/** True when the value still holds inline base64 — used by the migration report. */
export function hasInlineMedia(value: unknown): boolean {
  return Array.isArray(value)
    && value.some((item) => typeof (item as { url?: unknown })?.url === 'string'
      && (item as { url: string }).url.startsWith('data:'));
}

/** Media-store ids referenced by an attachment list. */
export function mediaIdsIn(attachments: MediaAttachment[]): string[] {
  return attachments
    .map((attachment) => publicIdFromUrl(attachment.url))
    .filter((id): id is string => id != null);
}
