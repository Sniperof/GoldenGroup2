import { Router, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { storeMedia } from '../services/media/mediaService.js';
import { MAX_UPLOAD_BYTES } from '../services/media/mediaStorage.js';
import { toPublicAppError } from '../utils/appErrors.js';

const router = Router();

// Memory storage, not diskStorage: the bytes must be sniffed and re-encoded
// before anything is written, so multer must not put an unvalidated file on
// disk first (the legacy /api/upload does exactly that).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_UPLOAD_BYTES.video },   // per-kind caps applied after sniffing
}).single('file');

function fail(res: Response, err: unknown, label: string) {
  const { status, body, isInternal } = toPublicAppError(err);
  if (isInternal) console.error(`[${label}]`, err);
  return res.status(status).json(body);
}

/**
 * @swagger
 * tags:
 *   - name: Media
 *     description: Unified media store for device, branch and banner assets.
 */

/**
 * @swagger
 * /api/media:
 *   post:
 *     tags: [Media]
 *     summary: Upload one image, video or document
 *     description: >
 *       Staff-authenticated. The file type is decided from its magic bytes, not
 *       its filename. Images are re-encoded to WebP, capped at 2048px on the
 *       long edge, stripped of all metadata (phone photos carry GPS), and given
 *       a 400px thumbnail. Videos and PDFs are stored byte-for-byte.
 *
 *       The returned row is unowned until an entity save references its URL;
 *       an upload that is never referenced is reclaimed by the GC sweep, so
 *       abandoning a half-filled form leaks nothing.
 *
 *       Identical bytes already stored are de-duplicated to the existing file.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Stored file
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [id, url, kind]
 *               properties:
 *                 id: { type: string, example: aB3xK9pQmN2v }
 *                 kind: { type: string, enum: [image, video, document] }
 *                 url: { type: string, example: /m/aB3xK9pQmN2v.webp }
 *                 thumbUrl: { type: string, nullable: true, example: /m/aB3xK9pQmN2v_t.webp }
 *                 width: { type: integer, nullable: true }
 *                 height: { type: integer, nullable: true }
 *                 byteSize: { type: integer }
 *                 mimeType: { type: string }
 *       400: { description: Missing or unreadable file }
 *       401: { description: Not signed in }
 *       413: { description: File exceeds the per-kind limit }
 *       415: { description: Unsupported media type }
 */
router.post('/', requireAuth, (req, res) => {
  upload(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      const isTooLarge = (uploadErr as { code?: string }).code === 'LIMIT_FILE_SIZE';
      return res.status(isTooLarge ? 413 : 400).json({
        error: isTooLarge ? 'حجم الملف أكبر من المسموح' : 'تعذّر رفع الملف',
        details: { code: isTooLarge ? 'file_too_large' : 'upload_failed' },
      });
    }
    try {
      const stored = await storeMedia(req.file?.buffer as Buffer, {
        originalName: req.file?.originalname,
        uploadedBy: req.user?.id ?? null,
      });
      return res.status(201).json({
        id: stored.publicId,
        kind: stored.kind,
        url: stored.url,
        thumbUrl: stored.thumbUrl,
        width: stored.width,
        height: stored.height,
        byteSize: stored.byteSize,
        mimeType: stored.mimeType,
      });
    } catch (err) {
      return fail(res, err, 'media.upload');
    }
  });
});

export default router;
