// ============================================================
// migrate-inline-media.ts — base64 in the DB → files in the media store
// ============================================================
// Before migration 423, device and branch photos were written by the admin UI
// as `data:` URLs and stored inside jsonb columns. A 2 MB photo became ~2.7 MB
// inside the row, was read back by every list query, and was shipped verbatim
// to the mobile app.
//
// This walks every affected row, decodes each inline payload through the normal
// media pipeline (sniff → WebP → strip EXIF → thumbnail → register), and
// rewrites the url to /m/<id>.webp. Ownership is recorded so the GC can later
// reclaim anything that stops being referenced.
//
// Usage:
//   pnpm tsx scripts/migrate-inline-media.ts --dry-run    # report only, no writes
//   pnpm tsx scripts/migrate-inline-media.ts              # migrate
//
// Safe to re-run: rows whose urls are already /m/ or /uploads/ are skipped, so
// an interrupted run continues where it stopped. Identical images collapse onto
// one stored file via the checksum dedupe in storeMedia.
//
// A row that fails (undecodable payload, over the size cap) is REPORTED AND
// LEFT UNTOUCHED rather than blanked — a broken photo is recoverable, a lost
// one is not. Fix those by re-uploading through the admin UI.
// ============================================================

import process from 'node:process';
import type { PoolClient } from 'pg';
import pool from '../packages/api/db.js';
import { inspectMedia } from '../packages/api/services/media/mediaInspect.js';
import { storeMedia } from '../packages/api/services/media/mediaService.js';
import { syncMediaOwnership, type MediaOwnerType } from '../packages/api/services/media/mediaOwnership.js';

const DRY_RUN = process.argv.includes('--dry-run');

interface Target {
  table: 'device_models' | 'branches';
  ownerType: MediaOwnerType;
  columns: string[];
  label: string;
}

const TARGETS: Target[] = [
  { table: 'device_models', ownerType: 'device_model', columns: ['images', 'videos', 'documents'], label: 'الأجهزة' },
  { table: 'branches', ownerType: 'branch', columns: ['images'], label: 'الفروع' },
];

interface Attachment { id?: string; name?: string; url?: string; thumbUrl?: string }

interface Stats {
  rowsScanned: number;
  rowsRewritten: number;
  itemsMigrated: number;
  itemsSkipped: number;
  itemsFailed: number;
  bytesBefore: number;
  bytesAfter: number;
  failures: string[];
}

function emptyStats(): Stats {
  return {
    rowsScanned: 0, rowsRewritten: 0, itemsMigrated: 0, itemsSkipped: 0,
    itemsFailed: 0, bytesBefore: 0, bytesAfter: 0, failures: [],
  };
}

const DATA_URL = /^data:([a-zA-Z0-9.+/-]+)?(;charset=[^;,]+)?(;base64)?,(.*)$/s;

/** Decodes a data: URL. Returns null for anything that is not one. */
export function decodeDataUrl(url: string): Buffer | null {
  const match = DATA_URL.exec(url);
  if (!match) return null;
  const isBase64 = Boolean(match[3]);
  const payload = match[4] ?? '';
  try {
    return isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    return null;
  }
}

function format(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function migrateColumn(
  client: PoolClient,
  target: Target,
  rowId: number,
  column: string,
  value: unknown,
  stats: Stats,
): Promise<{ changed: boolean; next: Attachment[] }> {
  const items: Attachment[] = Array.isArray(value) ? value : [];
  let changed = false;
  const next: Attachment[] = [];

  for (const item of items) {
    const url = typeof item?.url === 'string' ? item.url : '';
    const decoded = url.startsWith('data:') ? decodeDataUrl(url) : null;
    if (!decoded) {
      stats.itemsSkipped++;
      next.push(item);
      continue;
    }

    stats.bytesBefore += url.length;
    if (DRY_RUN) {
      // Sniff for real so the dry run predicts failures instead of just
      // counting candidates — a report that over-promises is worse than none.
      if (inspectMedia(decoded)) {
        stats.itemsMigrated++;
      } else {
        stats.itemsFailed++;
        stats.failures.push(
          `${target.table}#${rowId}.${column}[${item?.id ?? '?'}]: محتوى غير مدعوم`,
        );
      }
      next.push(item);
      continue;
    }

    try {
      const stored = await storeMedia(decoded, { originalName: item.name }, client);
      stats.itemsMigrated++;
      stats.bytesAfter += stored.byteSize;
      changed = true;
      next.push({
        ...item,
        url: stored.url,
        ...(stored.thumbUrl ? { thumbUrl: stored.thumbUrl } : {}),
      });
    } catch (err) {
      // Keep the original so nothing is lost; surface it for manual handling.
      stats.itemsFailed++;
      stats.failures.push(
        `${target.table}#${rowId}.${column}[${item?.id ?? '?'}]: ${(err as Error).message}`,
      );
      next.push(item);
    }
  }

  return { changed, next };
}

async function migrateTarget(client: PoolClient, target: Target): Promise<Stats> {
  const stats = emptyStats();
  const columnList = target.columns.join(', ');
  const inlineFilter = target.columns.map((c) => `${c}::text LIKE '%data:%'`).join(' OR ');

  const { rows } = await client.query<Record<string, any>>(
    `SELECT id, ${columnList} FROM public.${target.table} WHERE ${inlineFilter} ORDER BY id`,
  );

  for (const row of rows) {
    stats.rowsScanned++;
    const updates: Record<string, Attachment[]> = {};
    let rowChanged = false;

    for (const column of target.columns) {
      const result = await migrateColumn(client, target, row.id, column, row[column], stats);
      if (result.changed) {
        updates[column] = result.next;
        rowChanged = true;
      }
    }

    if (!rowChanged || DRY_RUN) continue;

    const assignments = Object.keys(updates).map((c, i) => `${c} = $${i + 2}::jsonb`).join(', ');
    await client.query(
      `UPDATE public.${target.table} SET ${assignments} WHERE id = $1`,
      [row.id, ...Object.values(updates).map((v) => JSON.stringify(v))],
    );

    // Re-read every media column so ownership reflects the whole row, not just
    // the columns this pass rewrote.
    const { rows: fresh } = await client.query(
      `SELECT ${columnList} FROM public.${target.table} WHERE id = $1`,
      [row.id],
    );
    await syncMediaOwnership(client, target.ownerType, row.id, target.columns.map((c) => fresh[0][c]));
    stats.rowsRewritten++;
  }

  return stats;
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? '=== وضع تجريبي — لا كتابة ===' : '=== ترحيل الوسائط المضمّنة ===');

  const client = await pool.connect();
  let failed = false;
  try {
    for (const target of TARGETS) {
      // One transaction per table: a failure mid-table leaves that table exactly
      // as it was rather than half-migrated.
      await client.query('BEGIN');
      let stats: Stats;
      try {
        stats = await migrateTarget(client, target);
        if (DRY_RUN) await client.query('ROLLBACK');
        else await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      console.log(`\n── ${target.label} (${target.table}) ──`);
      console.log(`  صفوف تحوي base64 : ${stats.rowsScanned}`);
      console.log(`  صفوف مُحدَّثة      : ${stats.rowsRewritten}`);
      console.log(`  ملفات مُرحَّلة      : ${stats.itemsMigrated}`);
      console.log(`  عناصر متجاوزة     : ${stats.itemsSkipped} (روابط غير مضمّنة)`);
      console.log(`  إخفاقات           : ${stats.itemsFailed}`);
      if (!DRY_RUN && stats.itemsMigrated > 0) {
        const saved = stats.bytesBefore - stats.bytesAfter;
        const pct = stats.bytesBefore > 0 ? Math.round((saved / stats.bytesBefore) * 100) : 0;
        console.log(`  الحجم قبل         : ${format(stats.bytesBefore)}`);
        console.log(`  الحجم بعد         : ${format(stats.bytesAfter)}  (توفير ${pct}%)`);
      }
      if (stats.failures.length) {
        failed = true;
        console.log('  ── لم تُرحَّل (بقيت كما هي) ──');
        for (const failure of stats.failures) console.log(`    ${failure}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  if (DRY_RUN) {
    console.log('\nلم تُكتب أي تغييرات. أعد التشغيل بدون --dry-run للترحيل.');
  } else if (failed) {
    console.log('\nاكتمل الترحيل مع إخفاقات — أعد رفع الملفات المذكورة يدوياً.');
    process.exitCode = 1;
  } else {
    console.log('\nاكتمل الترحيل. يمكن الآن إطفاء LEGACY_INLINE_GRACE في mediaAttachments.ts');
  }
}

main().catch((err) => {
  console.error('فشل الترحيل:', err);
  process.exit(1);
});
