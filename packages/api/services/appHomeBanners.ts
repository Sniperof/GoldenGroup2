// ============================================================
// appHomeBanners.ts — mobile home-screen slider
// ============================================================
// Owns the read/write logic for app_home_banners (migration 422).
//
// Two very different readers:
//   - the customer app, which must only ever see slides that are publishable
//     RIGHT NOW and whose tap target still resolves;
//   - the admin UI, which sees every row including disabled and expired ones.
//
// The public read is hit on every app launch, so it is served from a short
// in-process cache invalidated by every admin write (same shape as
// services/systemSettings.ts).
// ============================================================

import type { Pool, PoolClient } from 'pg';
import pool from '../db.js';
import { appError } from '../utils/appErrors.js';
import { getExecutableMobileRequestTypeLabels } from './serviceRequests/mobileExecutableTypes.js';

export const BANNER_TARGET_KINDS = ['none', 'device', 'service_request', 'external_url'] as const;
export type BannerTargetKind = typeof BANNER_TARGET_KINDS[number];

export const BANNER_AUDIENCES = ['all', 'customers', 'guests'] as const;
export type BannerAudience = typeof BANNER_AUDIENCES[number];

/**
 * Audience is pinned to 'all' by product decision (2026-08-16): every banner is
 * shown to every viewer, and the admin cannot change it.
 *
 * The column, the CHECK constraint and the read-side filter in mapPublicBanners
 * are all kept intact, so re-enabling per-audience banners later means removing
 * this pin and restoring the picker — no schema change.
 */
export const PINNED_AUDIENCE: BannerAudience = 'all';

export const MIN_DISPLAY_SECONDS = 2;
export const MAX_DISPLAY_SECONDS = 60;

/**
 * Mirrors the DB CHECK (migration 423): only files this server hosts.
 * `/m/` is the media store; `/uploads/` is kept for banners created before 423.
 */
export const IMAGE_URL_PATTERN = /^(\/m\/[A-Za-z0-9]{8,16}(_t)?\.[a-z0-9]{2,5}|\/uploads\/[A-Za-z0-9._-]+)$/;

export interface BannerInput {
  titleAr: string | null;
  imageUrl: string;
  sortOrder: number;
  displaySeconds: number;
  startsAt: string | null;
  endsAt: string | null;
  targetKind: BannerTargetKind;
  targetDeviceModelId: number | null;
  targetRequestType: string | null;
  targetUrl: string | null;
  audience: BannerAudience;
  isActive: boolean;
}

export const ADMIN_SELECT = `
  -- BIGSERIAL arrives from the driver as a string; the public read emits a
  -- number, and an admin list whose ids don't round-trip into PATCH /reorder
  -- would 400. Emit a number on both surfaces.
  id::int AS id,
  title_ar                AS "titleAr",
  image_url               AS "imageUrl",
  sort_order              AS "sortOrder",
  display_seconds         AS "displaySeconds",
  starts_at               AS "startsAt",
  ends_at                 AS "endsAt",
  target_kind             AS "targetKind",
  target_device_model_id  AS "targetDeviceModelId",
  target_request_type     AS "targetRequestType",
  target_url              AS "targetUrl",
  audience,
  is_active               AS "isActive",
  created_at              AS "createdAt",
  updated_at              AS "updatedAt"`;

// ── Validation ──────────────────────────────────────────────────────────────

function bad(message: string, code: string): Error {
  return appError(400, message, { code });
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw bad(`${field} يجب أن يكون تاريخاً صالحاً`, 'invalid_publish_window');
  }
  return new Date(value).toISOString();
}

/**
 * Normalizes an admin payload into exactly one valid target shape. Throws a
 * client-visible 400 rather than letting the DB CHECK surface as a 500.
 */
export function normalizeBannerInput(body: unknown): BannerInput {
  const raw = (body ?? {}) as Record<string, unknown>;

  const imageUrl = typeof raw.imageUrl === 'string' ? raw.imageUrl.trim() : '';
  if (!imageUrl) throw bad('صورة البانر مطلوبة', 'image_required');
  if (!IMAGE_URL_PATTERN.test(imageUrl)) {
    throw bad('يجب رفع الصورة عبر النظام قبل حفظ البانر', 'invalid_image_url');
  }

  const titleRaw = typeof raw.titleAr === 'string' ? raw.titleAr.trim() : '';
  if (titleRaw.length > 120) throw bad('العنوان طويل جداً', 'title_too_long');

  const displaySeconds = raw.displaySeconds === undefined ? 5 : Number(raw.displaySeconds);
  if (!Number.isInteger(displaySeconds)
    || displaySeconds < MIN_DISPLAY_SECONDS
    || displaySeconds > MAX_DISPLAY_SECONDS) {
    throw bad(
      `مدة العرض يجب أن تكون بين ${MIN_DISPLAY_SECONDS} و${MAX_DISPLAY_SECONDS} ثانية`,
      'invalid_display_seconds',
    );
  }

  const sortOrder = raw.sortOrder === undefined ? 0 : Number(raw.sortOrder);
  if (!Number.isInteger(sortOrder)) throw bad('ترتيب العرض غير صالح', 'invalid_sort_order');

  const startsAt = optionalTimestamp(raw.startsAt, 'تاريخ بداية النشر');
  const endsAt = optionalTimestamp(raw.endsAt, 'تاريخ نهاية النشر');
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw bad('نهاية النشر يجب أن تكون بعد بدايته', 'invalid_publish_window');
  }

  // Rejected rather than silently coerced: a caller sending another audience is
  // working from a stale contract and should be told, not quietly overridden.
  if (raw.audience !== undefined && raw.audience !== PINNED_AUDIENCE) {
    throw bad('الجمهور المستهدف ثابت على "الجميع" ولا يمكن تغييره', 'audience_locked');
  }

  const targetKind = (raw.targetKind ?? 'none') as BannerTargetKind;
  if (!BANNER_TARGET_KINDS.includes(targetKind)) throw bad('نوع الهدف غير صالح', 'invalid_target_kind');

  const base = {
    titleAr: titleRaw || null,
    imageUrl,
    sortOrder,
    displaySeconds,
    startsAt,
    endsAt,
    audience: PINNED_AUDIENCE,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
    targetKind,
    targetDeviceModelId: null as number | null,
    targetRequestType: null as string | null,
    targetUrl: null as string | null,
  };

  if (targetKind === 'device') {
    const id = Number(raw.targetDeviceModelId);
    if (!Number.isInteger(id) || id <= 0) throw bad('معرف الجهاز غير صالح', 'invalid_target_device');
    return { ...base, targetDeviceModelId: id };
  }
  if (targetKind === 'service_request') {
    const requestType = typeof raw.targetRequestType === 'string' ? raw.targetRequestType.trim() : '';
    if (!requestType) throw bad('نوع الطلب مطلوب', 'invalid_target_request_type');
    return { ...base, targetRequestType: requestType };
  }
  if (targetKind === 'external_url') {
    const url = typeof raw.targetUrl === 'string' ? raw.targetUrl.trim() : '';
    if (!/^https:\/\/\S+$/.test(url)) throw bad('الرابط يجب أن يبدأ بـ https://', 'invalid_target_url');
    return { ...base, targetUrl: url };
  }
  return base;
}

/**
 * Rejects a target that does not exist (or is no longer publishable) at write
 * time, so the admin is told immediately instead of silently saving a banner
 * the app will drop.
 */
export async function assertTargetResolvable(
  input: BannerInput,
  db: Pool | PoolClient = pool,
): Promise<void> {
  if (input.targetKind === 'device') {
    const { rows } = await db.query(
      `SELECT 1 FROM public.device_models
        WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
      [input.targetDeviceModelId],
    );
    if (!rows[0]) throw appError(400, 'الجهاز المحدد غير متاح في الكتالوج', { code: 'target_device_unavailable' });
  }
  if (input.targetKind === 'service_request') {
    const labels = await getExecutableMobileRequestTypeLabels(db);
    if (!labels.has(input.targetRequestType!)) {
      throw appError(400, 'نوع الطلب المحدد غير متاح في التطبيق', { code: 'target_request_type_unavailable' });
    }
  }
}

// ── Public (mobile) read ────────────────────────────────────────────────────

export interface PublicBannerRow {
  id: string;
  titleAr: string | null;
  imageUrl: string;
  displaySeconds: number;
  targetKind: BannerTargetKind;
  targetDeviceModelId: number | null;
  targetRequestType: string | null;
  targetUrl: string | null;
  audience: BannerAudience;
}

export interface PublicBanner {
  id: number;
  titleAr: string | null;
  imageUrl: string;
  displaySeconds: number;
  target:
    | { kind: 'none' }
    | { kind: 'device'; deviceId: number }
    | { kind: 'service_request'; requestType: string; labelAr: string }
    | { kind: 'external_url'; url: string };
}

const CACHE_TTL_MS = 60_000;
let cache: { rows: PublicBannerRow[]; fetchedAt: number } | null = null;

export function clearAppHomeBannersCache(): void {
  cache = null;
}

/**
 * Publishable rows only: active, inside the publish window, and — for device
 * targets — still pointing at a live catalog device. The device join is done
 * in SQL because a catalog device can be deactivated long after the banner was
 * written; request-type liveness is checked in TS against the code registry.
 */
async function readPublishableRows(db: Pool | PoolClient): Promise<PublicBannerRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  const { rows } = await db.query<PublicBannerRow>(
    `SELECT b.id,
            b.title_ar               AS "titleAr",
            b.image_url              AS "imageUrl",
            b.display_seconds        AS "displaySeconds",
            b.target_kind            AS "targetKind",
            b.target_device_model_id AS "targetDeviceModelId",
            b.target_request_type    AS "targetRequestType",
            b.target_url             AS "targetUrl",
            b.audience
       FROM public.app_home_banners b
       LEFT JOIN public.device_models dm ON dm.id = b.target_device_model_id
      WHERE b.is_active = TRUE
        AND (b.starts_at IS NULL OR b.starts_at <= NOW())
        AND (b.ends_at   IS NULL OR b.ends_at   >  NOW())
        AND (b.target_kind <> 'device'
             OR (dm.id IS NOT NULL AND dm.is_active = TRUE AND dm.deleted_at IS NULL))
      ORDER BY b.sort_order, b.id`,
  );
  cache = { rows, fetchedAt: Date.now() };
  return rows;
}

/**
 * Audience filter + target projection. Pure — exported for tests.
 *
 * @param isAuthenticated whether the caller presented a valid app token; drives
 *        the audience filter (guests-only banners are hidden from customers and
 *        vice versa).
 * @param labels Arabic label per request type the app can currently open.
 */
export function mapPublicBanners(
  rows: PublicBannerRow[],
  isAuthenticated: boolean,
  labels: Map<string, string>,
): PublicBanner[] {
  const viewerAudience: BannerAudience = isAuthenticated ? 'customers' : 'guests';
  const visible = rows.filter((row) => row.audience === 'all' || row.audience === viewerAudience);

  return visible.flatMap((row): PublicBanner[] => {
    const head = {
      id: Number(row.id),
      titleAr: row.titleAr,
      imageUrl: row.imageUrl,
      displaySeconds: row.displaySeconds,
    };
    if (row.targetKind === 'device') {
      return [{ ...head, target: { kind: 'device', deviceId: row.targetDeviceModelId! } }];
    }
    if (row.targetKind === 'service_request') {
      const labelAr = labels.get(row.targetRequestType!);
      // The type was disabled or its handler/form version drifted after the
      // banner was created — drop the slide rather than open a dead form.
      if (!labelAr) return [];
      return [{ ...head, target: { kind: 'service_request', requestType: row.targetRequestType!, labelAr } }];
    }
    if (row.targetKind === 'external_url') {
      return [{ ...head, target: { kind: 'external_url', url: row.targetUrl! } }];
    }
    return [{ ...head, target: { kind: 'none' } }];
  });
}

export async function listPublicHomeBanners(
  isAuthenticated: boolean,
  db: Pool | PoolClient = pool,
): Promise<PublicBanner[]> {
  const rows = await readPublishableRows(db);
  // Only pay for the registry read when a banner actually needs a label.
  const needsLabels = rows.some((row) => row.targetKind === 'service_request');
  const labels = needsLabels
    ? await getExecutableMobileRequestTypeLabels(db)
    : new Map<string, string>();
  return mapPublicBanners(rows, isAuthenticated, labels);
}
