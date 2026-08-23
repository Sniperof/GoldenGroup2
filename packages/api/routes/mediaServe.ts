import { Router } from 'express';
import { resolveRequestedFile } from '../services/media/mediaStorage.js';
import { publicIdFromUrl } from '../services/media/mediaStorage.js';
import pool from '../db.js';

const router = Router();

const MIME_BY_EXTENSION: Record<string, string> = {
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
};

/**
 * Public read path for the media store: GET /m/<publicId>[_t].<ext>
 *
 * Deliberately a route rather than express.static:
 *   - the on-disk layout is sharded (media/aB/3x/aB3x….webp) while the URL is
 *     flat, so the path has to be derived from the id;
 *   - a strict filename pattern is the traversal guard, applied before any
 *     path join (resolveRequestedFile also re-checks the resolved path);
 *   - public ids are never reused, which makes every URL permanently
 *     immutable — so we can hand out a one-year immutable cache and the mobile
 *     app re-downloads an image exactly once, ever.
 *
 * No auth is required here because the database gate below serves only rows
 * marked public. Private complaint photos have a separate authorized route.
 */
router.get('/:fileName', async (req, res) => {
  const resolved = resolveRequestedFile(req.params.fileName);
  if (!resolved) return res.status(404).end();

  const extension = req.params.fileName.split('.').pop() ?? '';
  const contentType = MIME_BY_EXTENSION[extension];
  if (!contentType) return res.status(404).end();

  const publicId = publicIdFromUrl(`/m/${req.params.fileName}`);
  if (!publicId) return res.status(404).end();
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM media_files
        WHERE public_id=$1 AND extension=$2 AND visibility='public' AND detached_at IS NULL`,
      [publicId, extension],
    );
    if (!rowCount) return res.status(404).end();
  } catch (err) {
    console.error('[media.serve.visibility]', err);
    return res.status(500).end();
  }

  res.sendFile(resolved, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Stops a crafted upload that survived sniffing from being interpreted
      // as something else by the browser.
      'X-Content-Type-Options': 'nosniff',
    },
  }, (err) => {
    if (!err || res.headersSent) return;
    res.status(404).end();
  });
});

export default router;
