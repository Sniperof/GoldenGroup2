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

// Reverse-proxy hop count / trust setting for Express `req.ip`.
// Behind nginx this MUST be set (e.g. TRUST_PROXY=1) or every caller resolves
// to 127.0.0.1 and the public rate limits collapse into one shared bucket.
// Accepts: a hop count ('1'), 'true'/'false', or an express trust-proxy string.
const rawTrustProxy = (process.env.TRUST_PROXY || '').trim();
export const TRUST_PROXY: number | boolean | string =
  rawTrustProxy === '' ? false
    : /^\d+$/.test(rawTrustProxy) ? parseInt(rawTrustProxy, 10)
    : rawTrustProxy === 'true' ? true
    : rawTrustProxy === 'false' ? false
    : rawTrustProxy;

// ── Customer app OTP (DEC-013 §6) ───────────────────────────────────────────
// Provider is pluggable (Port/Adapter). 'simulated' logs the code and never
// calls an external service; swap to 'sms' later without changing any contract.
// Fail-closed: an unknown value is a hard error, and 'simulated' is refused in
// production — a silent fallback would accept requests while delivering nothing
// and print live codes to the log (permissions standard §13, SH-3).
export const OTP_PROVIDERS = ['simulated', 'sms'] as const;
export const OTP_PROVIDER = (process.env.OTP_PROVIDER || 'simulated').toLowerCase();
if (!(OTP_PROVIDERS as readonly string[]).includes(OTP_PROVIDER)) {
  throw new Error(
    `OTP_PROVIDER="${process.env.OTP_PROVIDER}" is not a known provider. ` +
    `Known providers: ${OTP_PROVIDERS.join(', ')}.`,
  );
}
if (NODE_ENV === 'production' && OTP_PROVIDER === 'simulated') {
  throw new Error(
    'OTP_PROVIDER=simulated is refused in production: it delivers no SMS and logs live codes. ' +
    'Install a real sender adapter and set OTP_PROVIDER to it.',
  );
}
export const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || '120');
export const OTP_RESEND_SECONDS = parseInt(process.env.OTP_RESEND_SECONDS || '60');
export const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '5');
export const OTP_CODE_LENGTH = parseInt(process.env.OTP_CODE_LENGTH || '6');
// Expose the OTP code in API responses for local testing ONLY. Hard-gated to
// non-production + simulated provider so a real deployment can never leak it.
export const OTP_EXPOSE_CODE = NODE_ENV !== 'production' && OTP_PROVIDER === 'simulated';

// Per-number daily send cap, enforced in the DB (survives restarts and extra
// processes, unlike the in-memory HTTP limiter). The 60s resend window alone
// caps one number at ~1440 messages/day — with a paid SMS provider that is a
// direct spend channel. 0 disables the cap.
export const OTP_DAILY_CAP_PER_PHONE = parseInt(process.env.OTP_DAILY_CAP_PER_PHONE || '10');

// ── Rasel SMS provider (OTP_PROVIDER=sms) ───────────────────────────────────
// Config for RaselOtpSender (services/otp/raselOtpSender.ts). Ops docs from the
// provider handoff call this switch `SMS_PROVIDER_MODE=mock|rasel` — that is
// NOT a separate flag here; OTP_PROVIDER above ('simulated' == their 'mock',
// 'sms' == their 'rasel') is the single source of truth, so there is only one
// place that decides which sender is active.
export const RASEL_BASE_URL = process.env.RASEL_BASE_URL || 'https://raselsms.com';
// Provider-supplied v2 contract (public docs still show v1) — confirm in the
// Rasel dashboard before production if this ever needs to change.
export const RASEL_SEND_PATH = process.env.RASEL_SEND_PATH || '/api/v2/messages/send';
export const RASEL_API_KEY = process.env.RASEL_API_KEY;
export const RASEL_CHANNEL = process.env.RASEL_CHANNEL || 'local_sms';
export const RASEL_SENDER_ID = process.env.RASEL_SENDER_ID;
export const RASEL_TIMEOUT_MS = parseInt(process.env.RASEL_TIMEOUT_MS || '10000');
// Provider trial restricts real delivery to one number; block everything else
// server-side so testing never burns quota on a call the provider will reject.
export const RASEL_TRIAL_MODE = (process.env.RASEL_TRIAL_MODE ?? 'true') !== 'false';
export const RASEL_TRIAL_ALLOWED_TO = process.env.RASEL_TRIAL_ALLOWED_TO || '963987223900';
// Fast disable without a redeploy: flip this and `pm2 restart` (see CLAUDE.md).
export const RASEL_KILL_SWITCH = (process.env.RASEL_KILL_SWITCH || 'false') === 'true';

if (OTP_PROVIDER === 'sms' && !RASEL_API_KEY) {
  throw new Error('OTP_PROVIDER=sms requires RASEL_API_KEY to be set.');
}
if (OTP_PROVIDER === 'sms' && !RASEL_SENDER_ID) {
  throw new Error('OTP_PROVIDER=sms requires RASEL_SENDER_ID to be set.');
}
if (NODE_ENV === 'production' && RASEL_TRIAL_MODE) {
  throw new Error(
    'RASEL_TRIAL_MODE=true is refused in production: it silently blocks delivery to every ' +
    'number except the provider trial number. Set RASEL_TRIAL_MODE=false once Rasel has ' +
    'enabled production sending.',
  );
}

// ── Customer app tokens (DEC-013 §6) ────────────────────────────────────────
// Short access token + long rotating refresh token (separate from staff auth).
export const APP_ACCESS_TTL = process.env.APP_ACCESS_TTL || '60m';
export const APP_REFRESH_TTL_DAYS = parseInt(process.env.APP_REFRESH_TTL_DAYS || '60');

// ── Public mobile surface limits ────────────────────────────────────────────
// In-memory fixed-window HTTP limits for /api/app/* (per client IP). These are
// the coarse outer gate; identity-level caps (per phone / per app account) live
// in the DB next to the rule they protect. Any limit set to 0 is disabled.
export const APP_RATE_LIMIT_ENABLED = (process.env.APP_RATE_LIMIT_ENABLED || 'true') !== 'false';
/** OTP send: the only endpoint that spends money per call. */
export const APP_RATE_OTP_SEND = parseInt(process.env.APP_RATE_OTP_SEND || '5');
export const APP_RATE_OTP_SEND_WINDOW_S = parseInt(process.env.APP_RATE_OTP_SEND_WINDOW_S || '600');
/** OTP verify: guessing attempts are already capped per code; this caps churn. */
export const APP_RATE_OTP_VERIFY = parseInt(process.env.APP_RATE_OTP_VERIFY || '20');
export const APP_RATE_OTP_VERIFY_WINDOW_S = parseInt(process.env.APP_RATE_OTP_VERIFY_WINDOW_S || '600');
/** Session + account mutations (login/refresh/logout/create/delete). */
export const APP_RATE_MUTATION = parseInt(process.env.APP_RATE_MUTATION || '30');
export const APP_RATE_MUTATION_WINDOW_S = parseInt(process.env.APP_RATE_MUTATION_WINDOW_S || '600');
/** Service-request intake. */
export const APP_RATE_INTAKE = parseInt(process.env.APP_RATE_INTAKE || '10');
export const APP_RATE_INTAKE_WINDOW_S = parseInt(process.env.APP_RATE_INTAKE_WINDOW_S || '3600');
/** Reads (status, types, catalog, areas) — generous, just anti-scrape. */
export const APP_RATE_READ = parseInt(process.env.APP_RATE_READ || '120');
export const APP_RATE_READ_WINDOW_S = parseInt(process.env.APP_RATE_READ_WINDOW_S || '60');

// ── Mobile service-request intake caps (identity level, DB-enforced) ────────
/**
 * Open (received|in_review) water_check requests allowed per SUBMITTER.
 *
 * Keyed on the submitter, not the beneficiary, since DEC-016 D-WC4: without
 * OTP, a beneficiary-keyed rule lets a stranger lock a real customer out.
 * Falls back to the superseded variable so a deployed .env keeps its tuning.
 */
export const APP_WATER_CHECK_OPEN_PER_REQUESTER = parseInt(
  process.env.APP_WATER_CHECK_OPEN_PER_REQUESTER
    || process.env.APP_WATER_CHECK_OPEN_PER_PHONE
    || '1',
);
/** Rolling-24h water_check submissions allowed per submitting identity. */
export const APP_WATER_CHECK_DAILY_PER_REQUESTER = parseInt(
  process.env.APP_WATER_CHECK_DAILY_PER_REQUESTER || '5',
);
/**
 * Rolling-24h water_check submissions allowed per IP, for unverified
 * submitters only. Looser than the per-device cap on purpose: a household or
 * office shares one address legitimately (DEC-016 D-WC3).
 */
export const APP_WATER_CHECK_DAILY_PER_IP = parseInt(
  process.env.APP_WATER_CHECK_DAILY_PER_IP || '20',
);
/** Hard ceiling on the immutable submitted payload (characters of JSON). */
export const APP_SUBMITTED_PAYLOAD_MAX_CHARS = parseInt(
  process.env.APP_SUBMITTED_PAYLOAD_MAX_CHARS || '8000',
);
