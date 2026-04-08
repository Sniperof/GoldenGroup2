import express from 'express';
import { upload } from '../storage/uploader.js';

const router = express.Router();

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    return;
  }

  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

export default router;