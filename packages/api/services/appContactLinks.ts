import type { Pool, PoolClient } from 'pg';
import pool from '../db.js';
import { appError } from '../utils/appErrors.js';

export interface AppContactLinksInput {
  facebookUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  whatsappNumber: string | null;
  telegramNumber: string | null;
}

export interface AppContactLinks extends AppContactLinksInput {
  updatedAt: string;
}

export interface PublicAppContactLinks {
  links: {
    facebook: { kind: 'url'; value: string } | null;
    website: { kind: 'url'; value: string } | null;
    instagram: { kind: 'url'; value: string } | null;
    whatsapp: { kind: 'phone'; value: string } | null;
    telegram: { kind: 'phone'; value: string } | null;
  };
  updatedAt: string;
}

export const APP_CONTACT_LINKS_SELECT = `
  facebook_url    AS "facebookUrl",
  website_url     AS "websiteUrl",
  instagram_url   AS "instagramUrl",
  whatsapp_number AS "whatsappNumber",
  telegram_number AS "telegramNumber",
  updated_at      AS "updatedAt"`;

const EXPECTED_KEYS = new Set([
  'facebookUrl',
  'websiteUrl',
  'instagramUrl',
  'whatsappNumber',
  'telegramNumber',
]);
const FACEBOOK_HOSTS = ['facebook.com', 'fb.com'];
const INSTAGRAM_HOSTS = ['instagram.com'];
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const CACHE_TTL_MS = 60_000;

let cache: { value: AppContactLinks; fetchedAt: number } | null = null;

function bad(message: string, code: string): Error {
  return appError(400, message, { code });
}

function normalizeUrl(value: unknown, fieldLabel: string, allowedHosts?: string[]): string | null {
  if (value === undefined) throw bad(`${fieldLabel} مطلوب في الطلب`, 'missing_field');
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw bad(`${fieldLabel} يجب أن يكون رابطاً نصياً`, 'invalid_url');

  const raw = value.trim();
  if (!raw) return null;
  if (raw.length > 2048) throw bad(`${fieldLabel} طويل جداً`, 'url_too_long');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw bad(`${fieldLabel} غير صالح`, 'invalid_url');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw bad(`${fieldLabel} يجب أن يكون رابط HTTPS بلا بيانات دخول`, 'invalid_url');
  }

  const host = parsed.hostname.toLowerCase();
  if (allowedHosts && !allowedHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw bad(`${fieldLabel} لا يطابق المنصة المحددة`, 'invalid_platform_url');
  }
  return parsed.toString();
}

function normalizePhone(value: unknown, fieldLabel: string): string | null {
  if (value === undefined) throw bad(`${fieldLabel} مطلوب في الطلب`, 'missing_field');
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw bad(`${fieldLabel} يجب أن يكون رقماً نصياً`, 'invalid_phone');

  const normalized = value.trim().replace(/[\s\-().]/g, '');
  if (!normalized) return null;
  if (!PHONE_PATTERN.test(normalized)) {
    throw bad(`${fieldLabel} يجب أن يكون بصيغة دولية مثل +963912345687`, 'invalid_phone');
  }
  return normalized;
}

/** Full replacement: callers must send all five fixed keys and no unknown keys. */
export function normalizeAppContactLinksInput(body: unknown): AppContactLinksInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw bad('بيانات روابط التطبيق غير صالحة', 'invalid_payload');
  }
  const raw = body as Record<string, unknown>;
  const unknown = Object.keys(raw).filter(key => !EXPECTED_KEYS.has(key));
  if (unknown.length > 0) throw bad(`حقول غير معروفة: ${unknown.join(', ')}`, 'unknown_fields');

  return {
    facebookUrl: normalizeUrl(raw.facebookUrl, 'رابط Facebook', FACEBOOK_HOSTS),
    websiteUrl: normalizeUrl(raw.websiteUrl, 'رابط الموقع'),
    instagramUrl: normalizeUrl(raw.instagramUrl, 'رابط Instagram', INSTAGRAM_HOSTS),
    whatsappNumber: normalizePhone(raw.whatsappNumber, 'رقم WhatsApp'),
    telegramNumber: normalizePhone(raw.telegramNumber, 'رقم Telegram'),
  };
}

export function toPublicAppContactLinks(value: AppContactLinks): PublicAppContactLinks {
  return {
    links: {
      facebook: value.facebookUrl ? { kind: 'url', value: value.facebookUrl } : null,
      website: value.websiteUrl ? { kind: 'url', value: value.websiteUrl } : null,
      instagram: value.instagramUrl ? { kind: 'url', value: value.instagramUrl } : null,
      whatsapp: value.whatsappNumber ? { kind: 'phone', value: value.whatsappNumber } : null,
      telegram: value.telegramNumber ? { kind: 'phone', value: value.telegramNumber } : null,
    },
    updatedAt: value.updatedAt,
  };
}

export function clearAppContactLinksCache(): void {
  cache = null;
}

export async function readAppContactLinks(
  db: Pool | PoolClient = pool,
  lockForUpdate = false,
): Promise<AppContactLinks> {
  const { rows } = await db.query<AppContactLinks>(
    `SELECT ${APP_CONTACT_LINKS_SELECT}
       FROM public.app_contact_links
      WHERE id = 1
      ${lockForUpdate ? 'FOR UPDATE' : ''}`,
  );
  if (!rows[0]) throw appError(500, 'إعدادات روابط التطبيق غير مهيأة', { code: 'app_contact_links_missing' });
  return rows[0];
}

export async function readPublicAppContactLinks(
  db: Pool | PoolClient = pool,
): Promise<PublicAppContactLinks> {
  if (!cache || Date.now() - cache.fetchedAt >= CACHE_TTL_MS) {
    cache = { value: await readAppContactLinks(db), fetchedAt: Date.now() };
  }
  return toPublicAppContactLinks(cache.value);
}
