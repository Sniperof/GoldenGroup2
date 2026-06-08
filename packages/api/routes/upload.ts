import express from 'express';
import { upload } from '../storage/uploader.js';

const router = express.Router();

/**
 * @swagger
 * /api/upload:
 *   post:
 *     tags: [System → Upload]
 *     summary: Upload a file (multipart/form-data)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file to upload
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   example: /uploads/filename.ext
 *       400:
 *         description: No file uploaded or invalid request
 *       500:
 *         description: Server error
 */
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    return;
  }

  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

export default router;