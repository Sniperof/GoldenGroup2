// ============================================================
// mediaInspect.ts — decide what a file IS from its bytes
// ============================================================
// The legacy /api/upload trusts the filename extension, which is a client-
// supplied string: renaming evil.html to evil.png was enough to get it stored
// and served from our origin. Everything here reads magic bytes instead.
//
// Pure and buffer-only, so it is directly testable.
// ============================================================

import type { MediaKind } from './mediaStorage.js';

export interface InspectedMedia {
  kind: MediaKind;
  /** MIME of the ORIGINAL bytes; images are re-encoded to webp afterwards. */
  mimeType: string;
  extension: string;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function inspectMedia(buffer: Buffer): InspectedMedia | null {
  if (buffer.length < 12) return null;

  // ── images ──
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  }
  // Bare 'GIF87a'/'GIF89a' — accepted as an image; sharp flattens it to a
  // still webp, which is the intent for a catalogue photo.
  if (buffer.toString('ascii', 0, 3) === 'GIF') {
    return { kind: 'image', mimeType: 'image/gif', extension: 'gif' };
  }

  // ── documents ──
  if (buffer.toString('ascii', 0, 5) === '%PDF-') {
    return { kind: 'document', mimeType: 'application/pdf', extension: 'pdf' };
  }

  // ── video ──
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    const isQuickTime = brand.startsWith('qt');
    return {
      kind: 'video',
      mimeType: isQuickTime ? 'video/quicktime' : 'video/mp4',
      extension: isQuickTime ? 'mov' : 'mp4',
    };
  }
  // WebM / Matroska EBML header
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { kind: 'video', mimeType: 'video/webm', extension: 'webm' };
  }

  return null;
}
