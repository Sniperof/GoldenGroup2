// ============================================================
// serviceRequests/_shared.ts — types, audit helper, ref generator
// ============================================================
// Constitution source:
//   §٠.٧.أ — SR-YYYYMMDD-NNNN ref number format (atomic generation)
//   §٠.١٧ — audit log event types + payload shape
//
// Conventions:
//   - All service exports accept an optional `db?: PoolClient` for tx
//     composition (same pattern as visitCompletion.ts).
//   - Business-rule failures return `{ ok: false, code, ... }` rather
//     than throwing. Only DB-level errors bubble.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../../db.js';

// ---------------- canonical enums (mirror DB CHECK constraints) ----------------

export const SR_STATUSES = [
  'received',
  'in_review',
  'awaiting_customer_info',
  'resolved_at_intake',
  'rejected',
  'promoted',
  'cancelled',
] as const;
export type ServiceRequestStatus = (typeof SR_STATUSES)[number];

export const SR_TERMINAL_STATUSES: ServiceRequestStatus[] = [
  'resolved_at_intake',
  'rejected',
  'promoted',
  'cancelled',
];

export const SR_ACTIVE_STATUSES: ServiceRequestStatus[] = [
  'received',
  'in_review',
  'awaiting_customer_info',
];

export const SR_CHANNELS = [
  'phone',
  'internal_button',
  'client_detail_button',
  'admin_manual',
  'mobile_app',
  'website',
  'whatsapp',
] as const;
export type ServiceRequestChannel = (typeof SR_CHANNELS)[number];

export const SR_TRIAGER_PRESENT_CHANNELS: ServiceRequestChannel[] = [
  'phone',
  'internal_button',
  'client_detail_button',
  'admin_manual',
];

export const SR_AUDIT_EVENT_TYPES = [
  'request_created',
  'status_changed',
  'claimed_by_operator',
  'claim_transferred',
  'review_required_flag_set',
  'duplicate_flag_set',
  'party_linked',
  'linkage_changed',
  'candidate_created',
  'priority_changed',
  'escalated_to_audit_admin',
  'rejected_decision',
  'promoted_to_task',
  'merged_into_existing_task',
  'cancelled_by_admin',
  'customer_info_requested',
  'customer_info_received',
  'internal_note_added',
  'archived',
  'unarchived',
  'request_reopened',
  'problem_added',
  'problem_edited',
  'problem_status_changed',
  'problem_resolution_recorded',
  'problem_soft_deleted',
  'problem_restored',
  'problem_audit_admin_override',
] as const;
export type ServiceRequestAuditEventType = (typeof SR_AUDIT_EVENT_TYPES)[number];

export type ActorRole = 'operator' | 'audit_admin' | 'system' | 'customer';

// ---------------- generic result envelope ----------------

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message?: string; details?: Record<string, unknown> };

// ---------------- tx helper (mirrors visitCompletion pattern) ----------------

export interface TxScope {
  client: PoolClient;
  release: () => void;
  /** When false, the caller owns BEGIN/COMMIT/ROLLBACK. */
  ownsTx: boolean;
}

export async function acquireTx(db?: PoolClient): Promise<TxScope> {
  if (db) return { client: db, release: () => {}, ownsTx: false };
  const client = await pool.connect();
  await client.query('BEGIN');
  return { client, release: () => client.release(), ownsTx: true };
}

export async function commitTx(scope: TxScope): Promise<void> {
  if (scope.ownsTx) await scope.client.query('COMMIT');
}

export async function rollbackTx(scope: TxScope): Promise<void> {
  if (scope.ownsTx) await scope.client.query('ROLLBACK');
}

// ---------------- audit log helper ----------------

export interface AppendAuditInput {
  serviceRequestId: number | bigint;
  eventType: ServiceRequestAuditEventType;
  actorUserId: number | null;
  actorRole: ActorRole;
  payload?: Record<string, unknown>;
  note?: string | null;
}

export async function appendAudit(
  db: PoolClient,
  input: AppendAuditInput,
): Promise<void> {
  await db.query(
    `INSERT INTO service_request_audit_log
       (service_request_id, event_type, event_payload, actor_user_id, actor_role, note)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [
      input.serviceRequestId,
      input.eventType,
      JSON.stringify(input.payload ?? {}),
      input.actorUserId,
      input.actorRole,
      input.note ?? null,
    ],
  );
}

// ---------------- public_ref_number generator (٠.٧.أ) ----------------

/**
 * Generates the next SR-YYYYMMDD-NNNN ref atomically.
 *
 * Strategy: SELECT MAX of today's suffix + 1, inside the same transaction
 * as the INSERT. Race protection relies on the UNIQUE index
 * (service_requests_public_ref_unique_active). On collision the caller
 * should retry once (rare — only when two operators submit in the same ms).
 *
 * Per SR-REF-04: NNNN capped at 9999/day. Beyond that we raise.
 */
export async function generatePublicRefNumber(db: PoolClient): Promise<string> {
  const { rows } = await db.query<{ ref: string }>(`
    SELECT 'SR-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
           lpad((COALESCE(
             (SELECT MAX(SUBSTRING(public_ref_number FROM 13 FOR 4)::int)
                FROM service_requests
               WHERE public_ref_number LIKE 'SR-' || to_char(NOW(), 'YYYYMMDD') || '-%'),
             0
           ) + 1)::text, 4, '0') AS ref
  `);
  const ref = rows[0]?.ref;
  if (!ref) throw new Error('failed_to_generate_public_ref_number');
  // SR-REF-04 guard
  const tail = parseInt(ref.slice(-4), 10);
  if (tail > 9999) {
    throw new Error('public_ref_number_daily_cap_exceeded');
  }
  return ref;
}

// ---------------- small util ----------------

export function isTerminal(status: ServiceRequestStatus): boolean {
  return SR_TERMINAL_STATUSES.includes(status);
}

export function isTriagerPresent(channel: ServiceRequestChannel): boolean {
  return SR_TRIAGER_PRESENT_CHANNELS.includes(channel);
}
