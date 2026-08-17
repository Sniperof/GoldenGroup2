// ============================================================
// mediaOwnership.ts — which entity currently references which file
// ============================================================
// Called from inside the entity's own write transaction, so ownership can
// never drift from the row that references it: if the device save rolls back,
// so does the claim on its images.
//
// This is what makes reclaiming disk space safe. Without it we cannot tell an
// abandoned upload apart from a file that is still on a live catalogue page,
// which is exactly why the old /uploads directory could only ever grow.
// ============================================================

import type { PoolClient } from 'pg';
import { publicIdFromUrl } from './mediaStorage.js';

export type MediaOwnerType = 'device_model' | 'branch' | 'app_home_banner' | 'complaint_attachment';

/**
 * Pulls every /m/ id out of an arbitrary attachment payload. Accepts the shapes
 * all three entities use: an array of {url}, a bare string, or nested arrays
 * (device models keep images, videos and documents in separate columns).
 * Legacy /uploads/ and data: URLs yield nothing and are simply not tracked.
 */
export function collectMediaIds(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 4 || node == null) return;
    if (typeof node === 'string') {
      const id = publicIdFromUrl(node);
      if (id) found.add(id);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const key of ['url', 'thumbUrl', 'imageUrl']) {
        const candidate = (node as Record<string, unknown>)[key];
        if (typeof candidate === 'string') walk(candidate, depth + 1);
      }
    }
  };
  walk(value, 0);
  return [...found];
}

/**
 * Makes the registry match reality for one entity: claims every referenced
 * file, and releases the ones this entity used to reference but no longer does.
 *
 * Released rows are NOT deleted here — detached_at starts a grace period so a
 * mistaken removal can still be undone before the GC sweep reclaims the bytes.
 *
 * @param referenced anything containing the entity's media URLs (see collectMediaIds)
 */
export async function syncMediaOwnership(
  client: PoolClient,
  ownerType: MediaOwnerType,
  ownerId: number,
  referenced: unknown,
): Promise<{ claimed: number; released: number }> {
  const ids = collectMediaIds(referenced);

  // Claim: also un-detaches a file being re-attached (admin removed an image,
  // then put it back before the GC ran).
  const claimed = ids.length === 0 ? { rowCount: 0 } : await client.query(
    `UPDATE public.media_files
        SET owner_type = $1,
            owner_id = $2,
            attached_at = COALESCE(attached_at, NOW()),
            detached_at = NULL
      WHERE public_id = ANY($3::text[])
        AND (owner_type IS NULL OR (owner_type = $1 AND owner_id = $2))`,
    [ownerType, ownerId, ids],
  );

  const released = await client.query(
    `UPDATE public.media_files
        SET owner_type = NULL,
            owner_id = NULL,
            detached_at = NOW()
      WHERE owner_type = $1
        AND owner_id = $2
        AND NOT (public_id = ANY($3::text[]))`,
    [ownerType, ownerId, ids],
  );

  return { claimed: claimed.rowCount ?? 0, released: released.rowCount ?? 0 };
}

/** Releases everything an entity owns — for a hard delete of that entity. */
export async function releaseAllMedia(
  client: PoolClient,
  ownerType: MediaOwnerType,
  ownerId: number,
): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE public.media_files
        SET owner_type = NULL, owner_id = NULL, detached_at = NOW()
      WHERE owner_type = $1 AND owner_id = $2`,
    [ownerType, ownerId],
  );
  return rowCount ?? 0;
}
