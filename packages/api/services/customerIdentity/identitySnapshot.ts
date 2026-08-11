// ============================================================
// services/customerIdentity/identitySnapshot.ts
// ============================================================
// Resolves WHO an authenticated app customer is, from the record — never from
// the request body.
//
// Why this exists: a logged-in customer submitting `for_self` used to supply
// their own name and phone in the form, and the server linked the resulting
// request's beneficiary to their client record while storing whatever the body
// said. Nothing checked that the two agreed, so a request could carry another
// person's name, phone and address under a verified customer's client link,
// with no mismatch signal for the reviewer (template §7 defines those flags;
// they are not built).
//
// The template already says which way this resolves: prefill is UX, not source
// of truth (§2.7), and prefilled profile data is not an authorization control
// (§12.6). So identity is DERIVED here and the body's identity fields are
// refused outright — refused, not ignored, so a mobile build that still sends
// them finds out instead of silently losing them.
//
// The result is a SNAPSHOT, written onto the request at submit time. It is not
// a pointer: §5.1/3 forbids the stored snapshot from changing when the linked
// record is later edited, so the request stays a witness to what was true the
// day it was sent.
//
// Deliberately queries `clients`/`app_accounts` directly and imports no service
// module: `appAccounts/*` already depends on `serviceRequests/*`, so a value
// import in the other direction would close a cycle.
// ============================================================

import pool from '../../db.js';
import { normalizePhone } from '../../utils/contactValidation.js';

export interface CustomerIdentitySnapshot {
  appAccountId: number;
  clientId: number;
  firstName: string;
  fatherName: string | null;
  lastName: string;
  name: string;
  primaryPhone: string;
  primaryPhoneHasWhatsapp: boolean;
  secondaryPhone: string | null;
  secondaryPhoneHasWhatsapp: boolean;
}

interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

interface ContactEntry {
  number?: unknown;
  value?: unknown;
  mobile?: unknown;
  type?: unknown;
  status?: unknown;
  isPrimary?: unknown;
  hasWhatsApp?: unknown;
}

function contactNumber(entry: unknown): string {
  if (typeof entry === 'string') return normalizePhone(entry);
  if (!entry || typeof entry !== 'object') return '';
  const c = entry as ContactEntry;
  const raw = c.number ?? c.value ?? c.mobile;
  return typeof raw === 'string' ? normalizePhone(raw) : '';
}

/**
 * Picks the WhatsApp flag recorded for a given number, and the best secondary
 * number to carry onto the request. Pure — exported for tests.
 *
 * "Best" = the first active, non-primary entry whose number differs from the
 * account's login number. Inactive entries are skipped: a retired number must
 * not be handed to a field team as a contact.
 */
export function pickContactDetails(
  contacts: unknown,
  primaryPhone: string,
): { primaryHasWhatsapp: boolean; secondaryPhone: string | null; secondaryHasWhatsapp: boolean } {
  const list = Array.isArray(contacts) ? contacts : [];
  let primaryHasWhatsapp = false;
  let secondaryPhone: string | null = null;
  let secondaryHasWhatsapp = false;

  for (const entry of list) {
    const number = contactNumber(entry);
    if (!number) continue;
    const meta = (entry && typeof entry === 'object' ? entry : {}) as ContactEntry;
    const active = meta.status === undefined || meta.status === 'active';
    const hasWhatsapp = meta.hasWhatsApp === true;

    if (number === primaryPhone) {
      if (hasWhatsapp) primaryHasWhatsapp = true;
      continue;
    }
    if (!active || secondaryPhone !== null) continue;
    secondaryPhone = number;
    secondaryHasWhatsapp = hasWhatsapp;
  }

  return { primaryHasWhatsapp, secondaryPhone, secondaryHasWhatsapp };
}

/**
 * Loads the identity snapshot for an authenticated app customer.
 *
 * Throws 409 `customer_profile_incomplete` when the linked client record has no
 * usable name. That is a real state — `clients.first_name`/`last_name` are
 * nullable — and it must surface as a named, actionable failure rather than a
 * request stored with an empty beneficiary name.
 */
export async function resolveCustomerIdentitySnapshot(
  claims: { appAccountId: number; clientId: number; phone: string },
  db: Queryable = pool,
): Promise<CustomerIdentitySnapshot> {
  const { rows } = await db.query(
    `SELECT first_name, father_name, last_name, contacts
       FROM clients
      WHERE id = $1 AND deleted_at IS NULL`,
    [claims.clientId],
  );
  if (rows.length === 0) {
    throw httpError(404, 'linked_client_record_not_found');
  }
  const row = rows[0] as {
    first_name: string | null;
    father_name: string | null;
    last_name: string | null;
    contacts: unknown;
  };

  const firstName = (row.first_name ?? '').trim();
  const lastName = (row.last_name ?? '').trim();
  const missing = [!firstName && 'firstName', !lastName && 'lastName'].filter(Boolean) as string[];
  if (missing.length) {
    throw httpError(409, 'customer_profile_incomplete', { missing });
  }

  const fatherName = (row.father_name ?? '').trim() || null;
  const primaryPhone = normalizePhone(claims.phone);
  const contact = pickContactDetails(row.contacts, primaryPhone);

  return {
    appAccountId: claims.appAccountId,
    clientId: claims.clientId,
    firstName,
    fatherName,
    lastName,
    name: [firstName, fatherName, lastName].filter(Boolean).join(' '),
    primaryPhone,
    primaryPhoneHasWhatsapp: contact.primaryHasWhatsapp,
    secondaryPhone: contact.secondaryPhone,
    secondaryPhoneHasWhatsapp: contact.secondaryHasWhatsapp,
  };
}
