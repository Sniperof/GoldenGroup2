/**
 * Uploads a single file to the server and returns its public URL.
 * Uses /api/upload (multer-backed) — no auth token required for uploads.
 */
export async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);

  const res = await fetch('/api/upload', { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'فشل رفع الملف' }));
    throw new Error(err.error || 'فشل رفع الملف');
  }
  const data = await res.json();
  return data.url as string;   // e.g. "/uploads/1712345678_photo.jpg"
}
