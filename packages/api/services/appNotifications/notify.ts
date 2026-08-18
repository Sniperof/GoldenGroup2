// ============================================================
// services/appNotifications/notify.ts
// ============================================================
// DEC-019 Phase 5 — the facade operational code calls.
//
// Two rules make it safe to drop into flows that already work:
//
//  1. NOTHING THROWS. A notification is a courtesy on top of an operation that
//     has its own reason to succeed. A bug here must never roll back a service
//     request transition or a warranty activation, so every helper swallows and
//     logs. The cost of that choice is that a broken notification is invisible
//     except in the log — which is the right trade against breaking operations.
//
//  2. Each helper resolves what it needs from an id. Call sites pass what they
//     already have in scope and stay one line long, which keeps the diff in
//     long-lived operational files to a minimum.
//
// Rows are created on the caller's handle so they roll back with the operation.
// The returned pushes must be dispatched AFTER the caller commits.
// ============================================================

import { createNotifications, type PreparedPush, type Queryable } from './notificationService.js';
import type { NotifiableRequestStatus } from './notificationCatalog.js';

/** Terminals that notify (D-N2). Reopen is an administrative correction. */
const NOTIFIABLE_REQUEST_STATUSES = new Set<string>([
  'promoted', 'completed', 'rejected', 'cancelled',
]);

/**
 * DEC-019 D-N3. The result of an account-creation request cannot travel this
 * channel by construction: a push token is registered after sign-in, so the
 * person waiting to learn whether their account was approved has no device
 * registered to receive it. That message stays on the OTP/SMS path.
 */
const EXCLUDED_REQUEST_TYPES = new Set<string>(['account_creation']);

function swallow(label: string, err: unknown): PreparedPush[] {
  console.error(`[notify:${label}]`, err);
  return [];
}

export async function notifyServiceRequestStatusChanged(
  db: Queryable,
  input: {
    serviceRequestId: number | string;
    clientId: number | null;
    requestType: string | null;
    status: string;
  },
): Promise<PreparedPush[]> {
  try {
    if (!NOTIFIABLE_REQUEST_STATUSES.has(input.status)) return [];
    if (EXCLUDED_REQUEST_TYPES.has(input.requestType ?? '')) return [];
    // A request raised by a visitor who was never linked to a client has no
    // inbox to land in. Not an error: the request itself is perfectly valid.
    if (input.clientId == null) return [];

    return await createNotifications({
      type: 'service_request_status_changed',
      clientId: input.clientId,
      destinationId: input.serviceRequestId,
      vars: {
        requestId: input.serviceRequestId,
        status: input.status as NotifiableRequestStatus,
      },
      db,
    });
  } catch (err) {
    return swallow('service_request_status_changed', err);
  }
}

export async function notifyWarrantyActivated(
  db: Queryable,
  input: { deviceId: number },
): Promise<PreparedPush[]> {
  try {
    // The caller has a device; the recipient is its owner. Resolving here keeps
    // the customer lookup out of the warranty route.
    const { rows } = await db.query(
      'SELECT customer_id FROM installed_devices WHERE id = $1',
      [input.deviceId],
    );
    const clientId = rows[0]?.customer_id ?? null;
    if (clientId == null) return [];

    return await createNotifications({
      type: 'warranty_activated',
      clientId: Number(clientId),
      destinationId: input.deviceId,
      vars: {},
      db,
    });
  } catch (err) {
    return swallow('warranty_activated', err);
  }
}

interface VisitRow {
  client_id: number | null;
  scheduled_date: string | null;
}

/**
 * Loads the recipient and the date for a visit notification. Returns null when
 * the visit has no client — a visit can exist against a prospect who is not a
 * customer record yet, and that is not an error worth logging.
 *
 * `scheduled_date` is formatted in SQL rather than in JS: node-pg turns a DATE
 * into a local-midnight Date object, and re-serializing that shifts the day for
 * anyone not on UTC — on a message whose whole content is which day to be home.
 */
async function loadVisit(db: Queryable, visitId: number): Promise<VisitRow | null> {
  const { rows } = await db.query(
    `SELECT client_id, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
       FROM field_visits WHERE id = $1`,
    [visitId],
  );
  const row = rows[0];
  if (!row || row.client_id == null) return null;
  return row as VisitRow;
}

export async function notifyVisitScheduled(
  db: Queryable,
  input: { visitId: number },
): Promise<PreparedPush[]> {
  try {
    const visit = await loadVisit(db, input.visitId);
    if (!visit) return [];
    return await createNotifications({
      type: 'visit_scheduled',
      clientId: Number(visit.client_id),
      destinationId: input.visitId,
      vars: { date: visit.scheduled_date },
      db,
    });
  } catch (err) {
    return swallow('visit_scheduled', err);
  }
}

export async function notifyVisitCancelled(
  db: Queryable,
  input: { visitId: number },
): Promise<PreparedPush[]> {
  try {
    const visit = await loadVisit(db, input.visitId);
    if (!visit) return [];
    return await createNotifications({
      type: 'visit_cancelled',
      clientId: Number(visit.client_id),
      destinationId: input.visitId,
      vars: { date: visit.scheduled_date },
      db,
    });
  } catch (err) {
    return swallow('visit_cancelled', err);
  }
}

export async function notifyVisitCompleted(
  db: Queryable,
  input: { visitId: number },
): Promise<PreparedPush[]> {
  try {
    const visit = await loadVisit(db, input.visitId);
    if (!visit) return [];
    return await createNotifications({
      type: 'visit_completed',
      clientId: Number(visit.client_id),
      destinationId: input.visitId,
      vars: {},
      db,
    });
  } catch (err) {
    return swallow('visit_completed', err);
  }
}

/**
 * DEC-019 D-N16 — a published complaint update.
 *
 * The recipient is the ONE account that filed the complaint, never the household
 * (D-N12's fan-out is wrong here): a customer record can be shared by relatives,
 * and someone else's complaint about a technician is not their business.
 *
 * Complaints filed by a visitor (`visitor_otp` / `unverified_device`) have no
 * account at all — those people track their complaint by reference number and
 * OTP, which is the pull-based path DEC-018 designed. Nothing to send.
 */
export async function notifyComplaintPublicUpdate(
  db: Queryable,
  input: { publicUpdateId: number },
): Promise<PreparedPush[]> {
  try {
    const { rows } = await db.query(
      `SELECT u.public_status, u.message, u.is_system,
              c.id AS complaint_id, c.public_ref_number, c.requester_app_account_id
         FROM complaint_public_updates u
         JOIN complaints c ON c.id = u.complaint_id
        WHERE u.id = $1`,
      [input.publicUpdateId],
    );
    const row = rows[0];
    if (!row) return [];
    if (row.requester_app_account_id == null) return [];

    // The intake row ('received', system-written) is created in the same request
    // that submits the complaint — the person is looking at the confirmation
    // screen as it is written. Telling them again is noise, and it would make
    // every single complaint start with a redundant push.
    if (row.is_system === true && row.public_status === 'received') return [];

    return await createNotifications({
      type: 'complaint_update',
      appAccountId: Number(row.requester_app_account_id),
      destinationId: row.complaint_id,
      vars: { refNumber: String(row.public_ref_number), message: String(row.message) },
      extraData: { public_status: String(row.public_status) },
      db,
    });
  } catch (err) {
    return swallow('complaint_update', err);
  }
}
