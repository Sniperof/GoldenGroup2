import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';
import { acquireTx, commitTx, rollbackTx } from './_shared.js';
import type { MobileIntakeHandler } from './mobileIntakeRegistry.js';
import {
  consumeMobileIntakeIdentity,
  resolveMobileIntakeIdentity,
} from './mobileIntakeIdentity.js';

export async function executeMobileIntake(input: {
  handler: MobileIntakeHandler;
  body: Record<string, unknown>;
  appAccount?: AppAccountClaims;
  /** `X-Device-Id` header — the unverified tier's identifier (DEC-016). */
  deviceId?: string | null;
  /** Client address, second layer above the fingerprint. */
  ip?: string | null;
  idempotencyKey?: string | null;
  db?: PoolClient;
}) {
  const tx = await acquireTx(input.db);
  try {
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const requestHash = hashPayload(input.body);
    if (idempotencyKey && !input.appAccount && typeof input.body.handle === 'string') {
      const replay = await findVisitorReplay(
        tx.client,
        input.handler.requestType,
        input.body.handle.trim(),
        idempotencyKey,
        requestHash,
      );
      if (replay) {
        await commitTx(tx);
        return replay;
      }
    }
    const identity = await resolveMobileIntakeIdentity({
      db: tx.client,
      appAccount: input.appAccount,
      handle: input.body.handle,
      deviceId: input.deviceId,
      ip: input.ip,
      allowUnverified: input.handler.allowsUnverifiedIntake === true,
    });
    const identityKey = mobileIdentityKey(identity);
    if (idempotencyKey) {
      await tx.client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [`${input.handler.requestType}:${identity.kind}:${identityKey}`, idempotencyKey],
      );
      const replay = await findReplay(
        tx.client,
        input.handler.requestType,
        identity.kind,
        identityKey,
        idempotencyKey,
        requestHash,
      );
      if (replay) {
        await commitTx(tx);
        return replay;
      }
    }
    const result = await input.handler.submit(input.body, identity, tx.client);
    if (idempotencyKey) {
      const publicRefNumber = result && typeof result === 'object'
        ? String((result as Record<string, unknown>).publicRefNumber ?? '')
        : '';
      const { rows } = await tx.client.query<{ id: number }>(
        `SELECT id FROM service_requests WHERE public_ref_number = $1`,
        [publicRefNumber],
      );
      if (!rows[0]) throw Object.assign(new Error('idempotency_request_not_found'), { status: 500 });
      await tx.client.query(
        `INSERT INTO service_request_intake_idempotency
           (request_type, identity_kind, identity_key, idempotency_key, request_hash, service_request_id)
         VALUES ($1, $2, $3, $4::uuid, $5, $6)`,
        [input.handler.requestType, identity.kind, identityKey, idempotencyKey, requestHash, rows[0].id],
      );
    }
    await consumeMobileIntakeIdentity(tx.client, identity);
    await commitTx(tx);
    return result;
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!key) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw Object.assign(new Error('invalid_idempotency_key'), {
      status: 400,
      details: { code: 'invalid_idempotency_key' },
    });
  }
  return key;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function hashPayload(body: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(body))).digest('hex');
}

function mobileIdentityKey(identity: Awaited<ReturnType<typeof resolveMobileIntakeIdentity>>): string {
  if (identity.kind === 'customer') return String(identity.account.appAccountId);
  if (identity.kind === 'visitor') return identity.phone;
  return identity.deviceId;
}

async function findReplay(
  db: PoolClient,
  requestType: string,
  identityKind: 'customer' | 'visitor' | 'unverified',
  identityKey: string,
  idempotencyKey: string,
  requestHash: string,
) {
  const { rows } = await db.query<{
    request_hash: string;
    public_ref_number: string;
    status: string;
    review_required_flag: boolean;
  }>(
    `SELECT i.request_hash, sr.public_ref_number, sr.status, sr.review_required_flag
       FROM service_request_intake_idempotency i
       JOIN service_requests sr ON sr.id = i.service_request_id
      WHERE i.request_type = $1
        AND i.identity_kind = $2
        AND i.identity_key = $3
        AND i.idempotency_key = $4::uuid`,
    [requestType, identityKind, identityKey, idempotencyKey],
  );
  if (!rows[0]) return null;
  if (rows[0].request_hash !== requestHash) {
    throw Object.assign(new Error('idempotency_key_payload_mismatch'), {
      status: 409,
      details: { code: 'idempotency_key_payload_mismatch' },
    });
  }
  return {
    publicRefNumber: rows[0].public_ref_number,
    status: rows[0].status,
    reviewRequired: rows[0].review_required_flag,
    idempotentReplay: true,
  };
}

async function findVisitorReplay(
  db: PoolClient,
  requestType: string,
  handle: string,
  idempotencyKey: string,
  requestHash: string,
) {
  if (!handle) return null;
  const { rows } = await db.query<{ phone: string }>(
    `SELECT phone FROM otp_verifications WHERE handle = $1 AND purpose = 'service_request'`,
    [handle],
  );
  if (!rows[0]) return null;
  await db.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [`${requestType}:visitor:${rows[0].phone}`, idempotencyKey],
  );
  return findReplay(db, requestType, 'visitor', rows[0].phone, idempotencyKey, requestHash);
}
