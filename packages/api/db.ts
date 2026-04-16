import pg from 'pg';
import { DATABASE_URL } from './config/env.js';

const { Pool } = pg;

if (!DATABASE_URL?.trim()) {
  throw new Error(
    'تعذر الاتصال بقاعدة البيانات: المتغير DATABASE_URL غير مضبوط. تأكد من وجوده في .env.development أثناء التطوير أو .env في الإنتاج.'
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

export default pool;
