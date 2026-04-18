import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

// Load env file based on NODE_ENV:
//   development -> .env.development
//   production  -> .env
const envFile = process.env.NODE_ENV === 'development'
  ? path.join(root, '.env.development')
  : path.join(root, '.env');

dotenv.config({ path: envFile });

export const NODE_ENV = process.env.NODE_ENV ?? 'production';
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
