/**
 * Uploads one file to the unified media store and returns its short URL.
 *
 * Replaces two older habits:
 *   - `uploadFile()` → /api/upload, which is unauthenticated and trusts the
 *     filename extension;
 *   - FileReader.readAsDataURL, which inlined the whole file as base64 into a
 *     jsonb column (device and branch photos).
 *
 * The server decides the type from the file's bytes, re-encodes images to WebP,
 * strips EXIF (phone photos carry GPS), and returns /m/<id>.webp plus a
 * thumbnail URL for list screens.
 *
 * Note: authFetch() is not used here because it forces a JSON Content-Type,
 * while multipart requires the browser to set its own boundary.
 */

export interface UploadedMedia {
  id: string;
  kind: 'image' | 'video' | 'document';
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  mimeType: string;
}

export async function uploadMedia(file: File): Promise<UploadedMedia> {
  const body = new FormData();
  body.append('file', file);

  const token = localStorage.getItem('hr_token');
  const res = await fetch('/api/media', {
    method: 'POST',
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'فشل رفع الملف');
  }
  return res.json() as Promise<UploadedMedia>;
}
