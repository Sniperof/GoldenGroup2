import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

// Default to 'development' when NODE_ENV is not explicitly set.
// Production deployments always set NODE_ENV=production; the only time
// it is unset is on local dev machines or when running dev scripts, so
// 'production' as a fallback would incorrectly trigger hard safety checks.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Load env file based on NODE_ENV:
//   development -> .env.development (falls back to .env if absent)
//   production  -> .env
const envFile = process.env.NODE_ENV === 'development'
  ? path.join(root, '.env.development')
  : path.join(root, '.env');

dotenv.config({ path: envFile });
// Always also load .env as a fallback (lower priority than the specific file above)
dotenv.config({ path: path.join(root, '.env') });

// process.env.NODE_ENV is guaranteed to be set by the block above.
export const NODE_ENV = process.env.NODE_ENV as string;
export const PORT = parseInt(process.env.PORT || '3000');
export const DATABASE_URL = process.env.DATABASE_URL;

// In production, a missing JWT_SECRET is a hard error — a known fallback would
// let any token signed with the public dev secret pass auth silently.
if (NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production (add it to /etc/golden-crm/production.env)');
}
export const JWT_SECRET = process.env.JWT_SECRET || 'golden-crm-dev-secret-2026';

// Comma-separated list of allowed CORS origins, e.g. https://crm.example.com
// If unset: open cors() is used (dev-safe fallback; set this in production.env).
export const CORS_ORIGINS: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

// Writable directory for uploaded files. Defaults to <repo-root>/uploads.
// Override with UPLOADS_DIR=/var/lib/golden-crm/uploads in production.env.
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(root, 'uploads');

// ── Customer app OTP (DEC-013 §6) ───────────────────────────────────────────
// Provider is pluggable (Port/Adapter). 'simulated' logs the code and never
// calls an external service; swap to 'sms' later without changing any contract.
export const OTP_PROVIDER = (process.env.OTP_PROVIDER || 'simulated').toLowerCase();
export const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || '120');
export const OTP_RESEND_SECONDS = parseInt(process.env.OTP_RESEND_SECONDS || '60');
export const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '5');
export const OTP_CODE_LENGTH = parseInt(process.env.OTP_CODE_LENGTH || '6');
// Expose the OTP code in API responses for local testing ONLY. Hard-gated to
// non-production + simulated provider so a real deployment can never leak it.
export const OTP_EXPOSE_CODE = NODE_ENV !== 'production' && OTP_PROVIDER === 'simulated';

// ── Customer app tokens (DEC-013 §6) ────────────────────────────────────────
// Short access token + long rotating refresh token (separate from staff auth).
export const APP_ACCESS_TTL = process.env.APP_ACCESS_TTL || '60m';
export const APP_REFRESH_TTL_DAYS = parseInt(process.env.APP_REFRESH_TTL_DAYS || '60');
