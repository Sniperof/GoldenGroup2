import type { PoolClient } from 'pg';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}
function identityKey(identity: MobileIntakeIdentity): string {
  if (identity.kind === 'customer') return String(identity.account.appAccountId);
  if (identity.kind === 'visitor') return identity.phone;
  return identity.deviceId;
}

export async function resolveAgentLicenseAttachments(body: Record<string, unknown>, identity: MobileIntakeIdentity, db: PoolClient) {
  if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
    return { attachments: [] as Record<string, unknown>[], uploadIds: [] as string[] };
  }
  const requested = body.attachments.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_attachment', { index });
    const item = raw as Record<string, unknown>;
    const uploadToken = typeof item.uploadToken === 'string' ? item.uploadToken.trim().toLowerCase() : '';
    const category = item.category === 'photo' || item.category === 'document' ? item.category : '';
    if (!uploadToken || !category || Object.keys(item).some((key) => key !== 'uploadToken' && key !== 'category')) {
      throw httpError(400, 'invalid_attachment', { index });
    }
    return { uploadToken, category };
  });
  if (new Set(requested.map((item) => item.uploadToken)).size !== requested.length) throw httpError(400, 'duplicate_attachment_token');
  const { rows } = await db.query<{ id: string; media_type: string; mime_type: string; public_url: string; byte_size: number }>(
    `SELECT id,media_type,mime_type,public_url,byte_size FROM service_request_mobile_uploads
      WHERE id=ANY($1::uuid[]) AND identity_kind=$2 AND identity_key=$3
        AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`,
    [requested.map((item) => item.uploadToken), identity.kind, identityKey(identity)],
  );
  if (rows.length !== requested.length) throw httpError(400, 'attachment_token_invalid_or_expired');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const photos = requested.filter((item) => item.category === 'photo').length;
  const documents = requested.length - photos;
  if (photos > 5 || documents > 5) throw httpError(400, 'attachment_count_exceeded', { maximumPhotos: 5, maximumDocuments: 5 });
  for (const item of requested) {
    const row = byId.get(item.uploadToken)!;
    if ((item.category === 'photo' && row.media_type !== 'image')
      || (item.category === 'document' && row.media_type !== 'document')) {
      throw httpError(400, 'attachment_media_category_mismatch');
    }
  }
  return {
    uploadIds: rows.map((row) => row.id),
    attachments: requested.map((item) => {
      const row = byId.get(item.uploadToken)!;
      return { url: row.public_url, mediaType: row.media_type, mimeType: row.mime_type,
        byteSize: row.byte_size, category: item.category };
    }),
  };
}
