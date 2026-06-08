import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../config/env.js';

export { UPLOADS_DIR };

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const name = `${Date.now()}_${safe}`;
    cb(null, name);
  },
});

const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.webp'];
const DOC_EXTS    = ['.pdf', '.doc', '.docx'];
const VIDEO_EXTS  = ['.mp4', '.mov', '.avi', '.webm'];

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if ([...IMAGE_EXTS, ...DOC_EXTS, ...VIDEO_EXTS].includes(ext)) cb(null, true);
  else cb(new Error('نوع الملف غير مدعوم'));
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB — covers 20-sec video
});

export { IMAGE_EXTS, VIDEO_EXTS };