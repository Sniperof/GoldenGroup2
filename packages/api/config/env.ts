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

// Keep the existing fallback behavior for now to avoid auth behavior changes.
export const JWT_SECRET = process.env.JWT_SECRET || 'golden-crm-dev-secret-2026';
