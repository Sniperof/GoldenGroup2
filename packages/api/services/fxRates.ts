// ============================================================
// fxRates.ts — central exchange rate + USD-linked installments (migr 493)
// ============================================================
// Rate = SYP per 1 USD, set by management, one for all branches, append-only
// history (exchange_rates). The rate in effect on a day is the latest row
// whose effective_from <= that day (latest recorded wins on the same date).
//
// Contract installments confirmed under the USD link carry a fixed
// amount_usd = round(amount_syp / contract snapshot, 2). Collection converts
// the remaining USD with the rate of the payment day, rounded to the nearest
// fx_collection_rounding_unit. The installment is still settled at its
// ORIGINAL SYP; the gap goes to branch_fx_differences.
//
// Pieces here are generic on purpose (rate lookup, rounding, dues, ledger
// row) so later receivable kinds can reuse them.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import pool from '../db.js';
import { getSystemSettingBoolean, getSystemSettingNumber } from './systemSettings.js';
import {
  DEFAULT_FX_ROUNDING_UNIT,
  computeUsdDue,
  fullPaymentBounds,
  rateChangePct,
  round2,
  round6,
  usdFromSyp,
} from '@golden-crm/shared';

type Db = Pool | PoolClient;

export const FX_ROUNDING_SETTING_KEY = 'fx_collection_rounding_unit';

/**
 * Global USD-link switch (owner decision 2026-11-19): management decides for
 * ALL new installment schedules — contracts and deferred maintenance alike —
 * whether they are fixed in USD (on) or stay plain SYP (off). The decision is
 * frozen per schedule at its first confirmation: a schedule already linked
 * stays linked, a SYP schedule stays SYP, whatever the switch says later.
 */
export const USD_LINK_SETTING_KEY = 'fx_installments_usd_link_enabled';

export async function isUsdLinkEnabled(): Promise<boolean> {
  return getSystemSettingBoolean(USD_LINK_SETTING_KEY, true);
}

export class FxRateMissingError extends Error {
  status = 400;
  code = 'fx_rate_missing';
  constructor(message = 'لا يوجد سعر صرف معتمد ساري المفعول اليوم — يجب على الإدارة إدخال سعر الصرف أولاً.') {
    super(message);
    this.name = 'FxRateMissingError';
  }
}

export interface ExchangeRateRow {
  id: number;
  rate: number;
  effectiveFrom: string;
}

/** Today's date in Damascus (YYYY-MM-DD), from the DB clock. */
export async function todayDamascus(db: Db = pool): Promise<string> {
  const { rows } = await db.query(
    `SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS d`,
  );
  return rows[0].d;
}

/** Rate in effect on `date` (default: today in Damascus), or null. */
export async function getRateOn(db: Db = pool, date?: string | null): Promise<ExchangeRateRow | null> {
  const { rows } = await db.query(
    `SELECT id, rate, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM exchange_rates
      WHERE effective_from <= COALESCE($1::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
      ORDER BY effective_from DESC, id DESC
      LIMIT 1`,
    [date ?? null],
  );
  if (!rows[0]) return null;
  return { id: Number(rows[0].id), rate: Number(rows[0].rate), effectiveFrom: rows[0].effective_from };
}

/**
 * D5: the collection day = the day the collection result is recorded (today in
 * Damascus), whatever the visit's start or scheduled day. Returned as YYYY-MM-DD.
 * Kept as a function (with the visit id) so callers need not change.
 */
export async function getVisitCollectionDay(db: Db, _fieldVisitId?: number | null): Promise<string> {
  // Owner decision (2026-11-13): the collection day is the day the result is
  // RECORDED (today, Damascus). The visit's start day was wrong for visits that
  // stay open across days or receive tasks pulled in later (task 60542: visit
  // started 12/11, task pulled and paid 13/11 → priced at 12/11's rate).
  return todayDamascus(db);
}

export async function requireRateToday(db: Db = pool): Promise<ExchangeRateRow> {
  const r = await getRateOn(db, null);
  if (!r) throw new FxRateMissingError();
  return r;
}

export async function getRoundingUnit(): Promise<number> {
  const n = await getSystemSettingNumber(FX_ROUNDING_SETTING_KEY, DEFAULT_FX_ROUNDING_UNIT);
  return n >= 0 ? n : DEFAULT_FX_ROUNDING_UNIT;
}

// ── USD cash at the central rate (owner decision, after migr 494) ──────────

/** True for a non-barter payment entry whose currency is USD (any casing). */
export function isUsdCashEntry(currency: unknown, method: unknown): boolean {
  return String(currency ?? '').toUpperCase() === 'USD' && method !== 'barter';
}

/**
 * New USD payment entries never carry a typed rate: the rate is the central
 * rate in effect today and amount_syp = USD × that rate (whole SYP). SYP and
 * barter entries pass through untouched. No rate in effect → FxRateMissingError.
 * `cache` lets a loop look the rate up once.
 */
export async function lockUsdEntryToCentralRate<T extends { currency?: any; method?: any; amountValue?: any; exchangeRate?: any; amountSyp?: any }>(
  db: Db,
  entry: T,
  cache?: { rate?: number | null },
): Promise<T> {
  if (!isUsdCashEntry(entry.currency, entry.method)) return entry;
  let rate = cache?.rate;
  if (rate === undefined) {
    rate = (await getRateOn(db, null))?.rate ?? null;
    if (cache) cache.rate = rate;
  }
  if (!rate) {
    throw new FxRateMissingError('لا يوجد سعر صرف مركزي معتمد اليوم — لا يمكن تسجيل دفعة بالدولار. الدفعات بالليرة غير متأثرة.');
  }
  const usd = Number(entry.amountValue) || 0;
  return { ...entry, exchangeRate: rate, amountSyp: Math.round(usd * rate) };
}

// ── Contract signing (down payment) in USD ──────────────────────────────────
//
// Owner decision 2026-11-17 (replaces D1 "signing payments are SYP only"):
// the down payment may be received in USD, converted at the CONTRACT's rate —
// the same rate the contract is saved with, so one contract carries one rate:
//   contract already has usd_rate_snapshot → that rate;
//   otherwise                              → today's central rate (the rate the
//                                            schedule will be snapshotted at
//                                            when it is confirmed on save).
// When the snapshot is (re)taken on a draft, existing USD signing entries are
// re-priced to it (repriceDraftUsdSigningEntries), so the two never diverge.

/** The rate a USD signing entry of this contract is converted at. */
export async function resolveContractSigningRate(db: Db, contractId: number | null): Promise<number> {
  if (contractId != null) {
    const { rows } = await db.query('SELECT usd_rate_snapshot FROM contracts WHERE id = $1', [contractId]);
    const snap = rows[0]?.usd_rate_snapshot;
    if (snap != null && Number(snap) > 0) return Number(snap);
  }
  const today = await getRateOn(db, null);
  if (!today?.rate) {
    throw new FxRateMissingError('لا يوجد سعر صرف معتمد اليوم — لا يمكن تسجيل دفعة أولى بالدولار. الدفعات بالليرة غير متأثرة.');
  }
  return Number(today.rate);
}

/**
 * Prices a signing entry server-side: USD cash → exchangeRate = contract rate,
 * amountSyp = USD × rate (whole SYP), refRate/refUsd pinned to the same rate
 * (the BEFORE INSERT reference trigger would otherwise stamp the day's central
 * rate). SYP and barter entries pass through with no reference override.
 * The client's typed rate / SYP equivalent is never trusted.
 */
export function priceContractSigningEntry<T extends { currency?: any; method?: any; amountValue?: any; exchangeRate?: any; amountSyp?: any }>(
  entry: T,
  contractRate: number | null,
): T & { refRate: number | null; refUsd: number | null } {
  if (!isUsdCashEntry(entry.currency, entry.method)) {
    return { ...entry, refRate: null, refUsd: null };
  }
  if (!contractRate) throw new FxRateMissingError();
  const usd = Math.round((Number(entry.amountValue) || 0) * 100) / 100;
  return {
    ...entry,
    currency: 'USD',
    amountValue: usd,
    exchangeRate: contractRate,
    amountSyp: Math.round(usd * contractRate),
    refRate: contractRate,
    refUsd: usd,
  };
}

/**
 * Re-prices a DRAFT contract's USD signing entries to `rate` (no-op for any
 * other status: an approved contract's received money is history).
 */
export async function repriceDraftUsdSigningEntries(db: Db, contractId: number, rate: number): Promise<number> {
  const res = await db.query(
    `UPDATE contract_payment_entries p
        SET exchange_rate = $2,
            amount_syp    = ROUND(p.amount_value * $2::numeric),
            ref_rate      = $2,
            ref_usd       = ROUND(p.amount_value, 2)
       FROM contracts c
      WHERE c.id = p.contract_id
        AND p.contract_id = $1
        AND c.status = 'draft'
        AND p.installment_id IS NULL
        AND p.entry_type = 'collection'
        AND upper(p.currency) = 'USD'
        AND p.method <> 'barter'
        AND p.exchange_rate IS DISTINCT FROM $2`,
    [contractId, rate],
  );
  // SYP signing entries keep their SYP; only their USD reference follows the
  // contract rate, so the statement shows the down payment and the signing
  // charge at the same rate.
  await db.query(
    `UPDATE contract_payment_entries p
        SET ref_rate = $2,
            ref_usd  = ROUND(p.amount_syp / $2::numeric, 2)
       FROM contracts c
      WHERE c.id = p.contract_id
        AND p.contract_id = $1
        AND c.status = 'draft'
        AND p.installment_id IS NULL
        AND p.entry_type = 'collection'
        AND upper(COALESCE(p.currency, 'SYP')) = 'SYP'
        AND p.ref_rate IS DISTINCT FROM $2`,
    [contractId, rate],
  );
  return res.rowCount ?? 0;
}

// ── Contract snapshot ───────────────────────────────────────────────────────

/**
 * Snapshot today's rate on the contract and compute amount_usd for every
 * CONFIRMED installment (server-side; client USD is never trusted). No-op when
 * the contract has no confirmed installment. Throws FxRateMissingError when no
 * rate is in effect. Re-running (e.g. a replaced schedule confirmed again)
 * re-takes the snapshot so one contract always carries one rate.
 */
export async function snapshotContractUsdRate(db: Db, contractId: number): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM contract_installments WHERE contract_id = $1 AND confirmed = TRUE`,
    [contractId],
  );
  if (!(Number(rows[0]?.n) > 0)) return null;
  if (!(await isUsdLinkEnabled())) {
    // Switch off: this (new) schedule is a plain SYP schedule — no snapshot,
    // no amount_usd, and no exchange rate required.
    await db.query(`UPDATE contracts SET usd_rate_snapshot = NULL, usd_rate_snapshot_at = NULL WHERE id = $1`, [contractId]);
    await db.query(`UPDATE contract_installments SET amount_usd = NULL WHERE contract_id = $1`, [contractId]);
    return null;
  }
  const rate = await requireRateToday(db);
  await db.query(
    `UPDATE contracts SET usd_rate_snapshot = $2, usd_rate_snapshot_at = NOW() WHERE id = $1`,
    [contractId, rate.rate],
  );
  await db.query(
    `UPDATE contract_installments
        SET amount_usd = ROUND(amount_syp / $2::numeric, 2)
      WHERE contract_id = $1 AND confirmed = TRUE`,
    [contractId, rate.rate],
  );
  // One contract, one rate: a USD down payment follows the snapshot.
  await repriceDraftUsdSigningEntries(db, contractId, Number(rate.rate));
  return rate.rate;
}

/**
 * Schedule confirmation on a DRAFT (owner decision D2/D4):
 *  - nothing newly confirmed            → no-op (never re-snapshot silently;
 *    a draft confirmed before the USD link existed stays legacy);
 *  - contract already carries a snapshot → newly confirmed rows reuse it;
 *  - no snapshot yet                     → take today's rate (refused when none)
 *    and fix amount_usd on every confirmed row.
 * Linking a legacy confirmed draft = unconfirm (unconfirmContractSchedule) + confirm.
 */
export async function confirmContractScheduleUsd(db: Db, contractId: number, newlyConfirmed: number): Promise<number | null> {
  const { rows } = await db.query('SELECT usd_rate_snapshot FROM contracts WHERE id = $1', [contractId]);
  const existing = rows[0]?.usd_rate_snapshot != null ? Number(rows[0].usd_rate_snapshot) : null;
  if (newlyConfirmed <= 0) return existing;
  if (existing == null) return snapshotContractUsdRate(db, contractId);
  await db.query(
    `UPDATE contract_installments
        SET amount_usd = ROUND(amount_syp / $2::numeric, 2)
      WHERE contract_id = $1 AND confirmed = TRUE AND amount_usd IS NULL`,
    [contractId, existing],
  );
  return existing;
}

export class ScheduleUnconfirmError extends Error {
  status = 409;
  code = 'schedule_has_payments';
  constructor(message: string) { super(message); this.name = 'ScheduleUnconfirmError'; }
}

/**
 * «إلغاء تأكيد الجدول» (D2): draft only (caller checks). Refused when any
 * installment already has a payment entry. Clears amount_usd and the snapshot.
 */
export async function unconfirmContractSchedule(db: Db, contractId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM contract_payment_entries p
       JOIN contract_installments i ON i.id = p.installment_id
      WHERE i.contract_id = $1`,
    [contractId],
  );
  if (Number(rows[0]?.n) > 0) {
    throw new ScheduleUnconfirmError('لا يمكن إلغاء تأكيد الجدول — توجد دفعات مسجَّلة على أقساطه.');
  }
  const res = await db.query(
    'UPDATE contract_installments SET confirmed = FALSE, amount_usd = NULL WHERE contract_id = $1',
    [contractId],
  );
  await db.query(
    'UPDATE contracts SET usd_rate_snapshot = NULL, usd_rate_snapshot_at = NULL WHERE id = $1',
    [contractId],
  );
  return res.rowCount ?? 0;
}

/**
 * Maintenance schedule confirmation (migr 495): snapshot the central rate on
 * the costs row and fix amount_usd on the installments being confirmed.
 * One rate per schedule: if the schedule already carries a snapshot with
 * linked rows, new rows reuse it. No rate in effect -> FxRateMissingError.
 * Spot cash is never linked; only the deferred installments are.
 */
export async function snapshotMaintenanceUsdRate(db: Db, costsId: number, installmentIds: number[]): Promise<number | null> {
  const ids = installmentIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return null;
  const { rows } = await db.query(
    `SELECT c.usd_rate_snapshot,
            EXISTS (SELECT 1 FROM emergency_installments i
                     WHERE i.costs_id = c.id AND i.amount_usd IS NOT NULL) AS has_linked
       FROM emergency_result_costs c WHERE c.id = $1`,
    [costsId],
  );
  let rate: number;
  if (rows[0]?.usd_rate_snapshot != null && rows[0]?.has_linked) {
    rate = Number(rows[0].usd_rate_snapshot);
  } else if (!(await isUsdLinkEnabled())) {
    return null; // switch off: a new maintenance schedule stays plain SYP
  } else {
    rate = (await requireRateToday(db)).rate;
    await db.query(
      `UPDATE emergency_result_costs SET usd_rate_snapshot = $2, usd_rate_snapshot_at = NOW() WHERE id = $1`,
      [costsId, rate],
    );
  }
  await db.query(
    `UPDATE emergency_installments
        SET amount_usd = ROUND(amount_syp / $2::numeric, 2)
      WHERE id = ANY($1::int[]) AND costs_id = $3`,
    [ids, rate, costsId],
  );
  return rate;
}

export interface ContractFxInfo {
  snapshotRate: number | null;
  snapshotAt: string | null;
  currentRate: number | null;
  currentRateEffectiveFrom: string | null;
  /** Signed % change from snapshot to today's rate; null when either is missing. */
  changePct: number | null;
  roundingUnit: number;
  /** Global switch: whether a schedule confirmed now gets fixed in USD. */
  usdLinkEnabled: boolean;
}

export async function getContractFxInfo(db: Db, contractId: number): Promise<ContractFxInfo> {
  const [{ rows }, current, roundingUnit, usdLinkEnabled] = await Promise.all([
    db.query(`SELECT usd_rate_snapshot, usd_rate_snapshot_at FROM contracts WHERE id = $1`, [contractId]),
    getRateOn(db, null),
    getRoundingUnit(),
    isUsdLinkEnabled(),
  ]);
  const snapshotRate = rows[0]?.usd_rate_snapshot != null ? Number(rows[0].usd_rate_snapshot) : null;
  return {
    snapshotRate,
    snapshotAt: rows[0]?.usd_rate_snapshot_at ?? null,
    currentRate: current?.rate ?? null,
    currentRateEffectiveFrom: current?.effectiveFrom ?? null,
    changePct: snapshotRate != null && current ? rateChangePct(snapshotRate, current.rate) : null,
    roundingUnit,
    usdLinkEnabled,
  };
}

// ── Dues for USD-linked installments ────────────────────────────────────────

/** Receivable kinds that can be USD-linked. Golden warranty stays legacy. */
export type UsdLinkedKind = 'contract' | 'maintenance';

export interface InstallmentUsdState {
  kind: UsdLinkedKind;
  installmentId: number;
  /** Contract of the installment (maintenance: the task's contract, may be null). */
  contractId: number | null;
  /** Branch of record for the FX ledger: contracts.branch_id / the maintenance task's branch. */
  branchId: number | null;
  /** Maintenance only: the maintenance task owning the schedule. */
  openTaskId: number | null;
  amountSyp: number;
  remainingBalance: number;
  amountUsd: number;
  remainingUsd: number;
  contractRate: number;
}

export interface InstallmentUsdDue {
  amountUsd: number;
  remainingUsd: number;
  contractRate: number;
  dayRate: number | null;
  rawDueSyp: number | null;
  dueTodaySyp: number | null;
  roundingUnit: number;
  /** dueTodaySyp − remaining original SYP (signed). */
  differenceSyp: number | null;
  remainingBalanceSyp: number;
}

/**
 * USD state of installments that carry amount_usd (contract or maintenance).
 * Prior entries written by the USD path carry usd_settled; any other entry
 * (legacy path) counts at the installment's own SYP/USD ratio. Contract
 * refunds add back (maintenance entries have no refunds).
 */
export async function loadInstallmentUsdStates(
  db: Db,
  installmentIds: number[],
  lock = false,
  kind: UsdLinkedKind = 'contract',
): Promise<Map<number, InstallmentUsdState>> {
  const ids = [...new Set(installmentIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, InstallmentUsdState>();
  if (ids.length === 0) return out;
  const table = kind === 'contract' ? 'contract_installments' : 'emergency_installments';
  if (lock) {
    await db.query(
      `SELECT id FROM ${table} WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
  }
  const { rows } = kind === 'maintenance'
    ? await db.query(
      `SELECT i.id, ot.contract_id, ot.branch_id, ot.id AS open_task_id,
              i.amount_syp, i.remaining_balance, i.amount_usd, c.usd_rate_snapshot,
              COALESCE((
                SELECT SUM((CASE WHEN p.entry_type = 'refund' THEN -1 ELSE 1 END) * COALESCE(p.usd_settled,
                                    CASE WHEN i.amount_syp > 0 THEN p.amount_syp * i.amount_usd / i.amount_syp ELSE 0 END))
                  FROM emergency_payment_entries p
                 WHERE p.installment_id = i.id
              ), 0) AS usd_paid
         FROM emergency_installments i
         JOIN emergency_result_costs c ON c.id = i.costs_id
         JOIN open_tasks ot ON ot.id = c.open_task_id
        WHERE i.id = ANY($1::int[])
          AND i.amount_usd IS NOT NULL
          AND c.usd_rate_snapshot IS NOT NULL`,
      [ids],
    )
    : await db.query(
    `SELECT i.id, i.contract_id, c.branch_id, NULL::int AS open_task_id,
            i.amount_syp, i.remaining_balance, i.amount_usd,
            c.usd_rate_snapshot,
            COALESCE((
              SELECT SUM(
                       (CASE WHEN p.entry_type = 'refund' THEN -1 ELSE 1 END)
                       * COALESCE(p.usd_settled,
                                  CASE WHEN i.amount_syp > 0 THEN p.amount_syp * i.amount_usd / i.amount_syp ELSE 0 END)
                     )
                FROM contract_payment_entries p
               WHERE p.installment_id = i.id
            ), 0) AS usd_paid
       FROM contract_installments i
       JOIN contracts c ON c.id = i.contract_id
      WHERE i.id = ANY($1::int[])
        AND i.amount_usd IS NOT NULL
        AND c.usd_rate_snapshot IS NOT NULL`,
    [ids],
  );
  for (const r of rows) {
    const amountUsd = Number(r.amount_usd);
    const remainingBalance = Number(r.remaining_balance);
    let remainingUsd = round6(Math.max(0, amountUsd - Number(r.usd_paid)));
    if (remainingBalance <= 0) remainingUsd = 0;
    out.set(Number(r.id), {
      kind,
      installmentId: Number(r.id),
      contractId: r.contract_id != null ? Number(r.contract_id) : null,
      branchId: r.branch_id != null ? Number(r.branch_id) : null,
      openTaskId: r.open_task_id != null ? Number(r.open_task_id) : null,
      amountSyp: Number(r.amount_syp),
      remainingBalance,
      amountUsd,
      remainingUsd,
      contractRate: Number(r.usd_rate_snapshot),
    });
  }
  return out;
}

export function buildUsdDue(state: InstallmentUsdState, dayRate: number | null, roundingUnit: number): InstallmentUsdDue {
  const due = dayRate ? computeUsdDue({ remainingUsd: state.remainingUsd, dayRate, roundingUnit }) : null;
  return {
    amountUsd: state.amountUsd,
    remainingUsd: state.remainingUsd,
    contractRate: state.contractRate,
    dayRate,
    rawDueSyp: due ? round2(due.rawSyp) : null,
    dueTodaySyp: due ? due.dueTodaySyp : null,
    roundingUnit,
    differenceSyp: due ? round2(due.dueTodaySyp - state.remainingBalance) : null,
    remainingBalanceSyp: state.remainingBalance,
  };
}

/** Today's USD dues keyed by installment id of `kind` (USD-linked only). */
export async function getInstallmentUsdDues(
  db: Db,
  installmentIds: number[],
  kind: UsdLinkedKind = 'contract',
  onDate: string | null = null,
): Promise<Map<number, InstallmentUsdDue>> {
  const states = await loadInstallmentUsdStates(db, installmentIds, false, kind);
  const out = new Map<number, InstallmentUsdDue>();
  if (states.size === 0) return out;
  const [rate, unit] = await Promise.all([getRateOn(db, onDate), getRoundingUnit()]);
  for (const [id, s] of states) out.set(id, buildUsdDue(s, rate?.rate ?? null, unit));
  return out;
}

/**
 * Adds `usdDue` (or null) to each row, looked up by `key` (a contract
 * installment id). Rows whose installment is not USD-linked get usdDue = null.
 */
export async function attachUsdDues<T extends Record<string, any>>(
  db: Db,
  rows: T[],
  key: string = 'installmentId',
  kind: UsdLinkedKind = 'contract',
  onDate: string | null = null,
): Promise<Array<T & { usdDue: InstallmentUsdDue | null }>> {
  const ids = rows.map((r) => Number(r?.[key])).filter((n) => Number.isInteger(n) && n > 0);
  const dues = ids.length > 0 ? await getInstallmentUsdDues(db, ids, kind, onDate) : new Map();
  return rows.map((r) => ({ ...r, usdDue: dues.get(Number(r?.[key])) ?? null }));
}

/**
 * Rows that may point at a contract installment OR a maintenance installment
 * (task lists): usdDue comes from whichever key is set. Golden-warranty
 * installments are never linked.
 */
export async function attachReceivableUsdDues<T extends Record<string, any>>(
  db: Db,
  rows: T[],
  contractKey: string = 'installmentId',
  maintenanceKey: string = 'maintenanceInstallmentId',
  onDate: string | null = null,
): Promise<Array<T & { usdDue: InstallmentUsdDue | null }>> {
  const ids = (key: string) => rows.map((r) => Number(r?.[key])).filter((n) => Number.isInteger(n) && n > 0);
  const [contractDues, maintenanceDues] = await Promise.all([
    ids(contractKey).length > 0 ? getInstallmentUsdDues(db, ids(contractKey), 'contract', onDate) : Promise.resolve(new Map()),
    ids(maintenanceKey).length > 0 ? getInstallmentUsdDues(db, ids(maintenanceKey), 'maintenance', onDate) : Promise.resolve(new Map()),
  ]);
  return rows.map((r) => ({
    ...r,
    usdDue: contractDues.get(Number(r?.[contractKey])) ?? maintenanceDues.get(Number(r?.[maintenanceKey])) ?? null,
  }));
}

// ── Collection planning (pure) ──────────────────────────────────────────────

export interface UsdCollectionPartInput {
  /** Real SYP value of the part (USD parts: face × day rate). */
  collectedSyp: number;
  /** USD face value for a USD cash part; null for an SYP part. */
  usdFace: number | null;
}

export interface UsdCollectionPartPlan {
  collectedSyp: number;
  usdSettled: number;
  creditedSyp: number;
  differenceSyp: number;
}

export interface UsdCollectionPlan {
  collectedSyp: number;
  usdSettled: number;
  creditedSyp: number;
  differenceSyp: number;
  dueTodaySyp: number;
  rawDueSyp: number;
  parts: UsdCollectionPartPlan[];
  /** D8: a partial payment whose remaining dust closed the installment. */
  dustClosed: boolean;
}

/**
 * Splits a USD-linked collection into credited original SYP + FX difference.
 * Returns an Arabic error string when the amount does not fit the decision.
 *   paid_full    : collected within [min(raw,due), max(raw,due)] ± 0.5 —
 *                  credits exactly the remaining SYP and settles all remaining USD.
 *   paid_partial : collected < min(raw,due) − 0.5 — usd_settled = collected / day rate
 *                  (USD cash at face), credited proportionally to the remaining SYP.
 */
export function planUsdCollection(input: {
  decision: 'paid_full' | 'paid_partial';
  parts: UsdCollectionPartInput[];
  remainingUsd: number;
  remainingBalance: number;
  /** Rate snapshotted when the schedule was confirmed (SYP per 1 USD). */
  contractRate: number;
  dayRate: number;
  roundingUnit: number;
}): { ok: true; plan: UsdCollectionPlan } | { ok: false; error: string } {
  const { decision, parts, remainingUsd, remainingBalance, contractRate, dayRate, roundingUnit } = input;
  const due = computeUsdDue({ remainingUsd, dayRate, roundingUnit });
  const { lower, upper } = fullPaymentBounds(due);
  const collected = round2(parts.reduce((s, p) => s + p.collectedSyp, 0));
  if (!(collected > 0)) return { ok: false, error: 'قيمة الدفعة مطلوبة' };

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  if (decision === 'paid_full') {
    if (collected + 0.5 < lower) {
      return { ok: false, error: `الدفع الكامل يجب أن يساوي المستحق اليوم (${fmt(due.dueTodaySyp)} ل.س)` };
    }
    if (collected - 0.5 > upper) {
      return {
        ok: false,
        error: `المبلغ المحصَّل أكبر من المستحق اليوم (${fmt(due.dueTodaySyp)} ل.س) — يُعاد الفرق للزبون ولا يُسجَّل`,
      };
    }
  } else {
    if (collected + 0.5 >= lower) {
      return { ok: false, error: `الدفع الجزئي يجب أن يكون أقل من المستحق اليوم (${fmt(due.dueTodaySyp)} ل.س)` };
    }
  }

  // Owner rule: USD settled is converted back at the CONTRACT rate
  // (150 $ × 15,000 = 2,250,000), in whole cents / whole SYP. The cent-rounding
  // residue of amount_usd (e.g. 2,673,766 vs 178.25 × 15,000 = 2,673,750) is
  // only absorbed by the payment that closes the installment.
  const partUsd = parts.map((p) => (p.usdFace != null ? p.usdFace : p.collectedSyp / dayRate));
  let usdSettled: number;
  let credited: number;
  // D8 (dust): a partial payment leaving less than half a rounding unit (in SYP
  // at the day rate) closes the installment like a full payment; the remainder
  // goes to the FX ledger.
  const partialUsd = round2(partUsd.reduce((s, v) => s + v, 0));
  const dustClosed = decision === 'paid_partial'
    && roundingUnit > 0
    && partialUsd < remainingUsd
    && (remainingUsd - partialUsd) * dayRate < roundingUnit / 2;
  const closesFull = decision === 'paid_full' || dustClosed;
  if (closesFull) {
    usdSettled = round6(remainingUsd);
    credited = round2(remainingBalance);
  } else {
    usdSettled = partialUsd;
    if (!(usdSettled > 0) || usdSettled >= remainingUsd) {
      return { ok: false, error: 'الدفع الجزئي يجب أن يكون أقل من المتبقي بالدولار' };
    }
    credited = Math.round(usdSettled * contractRate);
    if (credited >= remainingBalance) credited = Math.max(0, Math.floor(remainingBalance) - 1);
  }

  // Per part: USD cash at face value; on a full payment the SYP parts share the
  // USD and SYP left after the USD parts, by their share of SYP cash. Each part
  // is credited its USD × contract rate; the last part takes the remainder so
  // the totals are exact.
  const usdFaceTotal = parts.reduce((s, p) => s + (p.usdFace ?? 0), 0);
  const sypCash = parts.reduce((s, p) => s + (p.usdFace == null ? p.collectedSyp : 0), 0);
  const partUsdAlloc = parts.map((p, idx) => {
    if (!closesFull) return partUsd[idx];
    if (p.usdFace != null) {
      return sypCash > 0 || usdFaceTotal <= 0 ? p.usdFace : usdSettled * (p.usdFace / usdFaceTotal);
    }
    return Math.max(0, usdSettled - usdFaceTotal) * (sypCash > 0 ? p.collectedSyp / sypCash : 0);
  });
  const out: UsdCollectionPartPlan[] = [];
  let usdLeft = usdSettled;
  let creditLeft = credited;
  parts.forEach((p, idx) => {
    const last = idx === parts.length - 1;
    const u = last ? round6(usdLeft) : Math.min(round6(usdLeft), round2(partUsdAlloc[idx]));
    const c = last ? round2(creditLeft) : Math.min(round2(creditLeft), Math.round(u * contractRate));
    usdLeft = round6(usdLeft - u);
    creditLeft = round2(creditLeft - c);
    const cs = round2(p.collectedSyp);
    out.push({ collectedSyp: cs, usdSettled: u, creditedSyp: c, differenceSyp: round2(cs - c) });
  });

  return {
    ok: true,
    plan: {
      collectedSyp: collected,
      usdSettled,
      creditedSyp: credited,
      differenceSyp: round2(collected - credited),
      dueTodaySyp: due.dueTodaySyp,
      rawDueSyp: round2(due.rawSyp),
      parts: out,
      dustClosed,
    },
  };
}

// ── FX differences ledger ───────────────────────────────────────────────────

export interface FxDifferenceInput {
  branchId: number;
  sourceKind?: 'contract_installment' | 'maintenance_installment';
  contractId: number | null;
  installmentId: number | null;
  paymentEntryId: number | null;
  /** Maintenance source (migr 495). */
  maintenanceInstallmentId?: number | null;
  maintenancePaymentEntryId?: number | null;
  openTaskId?: number | null;
  visitTaskResultId: number | null;
  contractRate: number;
  dayRate: number;
  usdSettled: number;
  collectedSyp: number;
  settledSyp: number;
  recordedBy: number | null;
}

/** Appends one row to branch_fx_differences (difference = collected − settled). */
export async function recordFxDifference(db: Db, d: FxDifferenceInput): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO branch_fx_differences
       (branch_id, source_kind, contract_id, installment_id, payment_entry_id, visit_task_result_id,
        contract_rate, day_rate, usd_settled, collected_syp, settled_syp, difference_syp, recorded_by,
        maintenance_installment_id, maintenance_payment_entry_id, open_task_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      d.branchId, d.sourceKind ?? 'contract_installment', d.contractId, d.installmentId,
      d.paymentEntryId, d.visitTaskResultId, d.contractRate, d.dayRate, d.usdSettled,
      round2(d.collectedSyp), round2(d.settledSyp), round2(d.collectedSyp - d.settledSyp), d.recordedBy,
      d.maintenanceInstallmentId ?? null, d.maintenancePaymentEntryId ?? null, d.openTaskId ?? null,
    ],
  );
  return Number(rows[0].id);
}

export { usdFromSyp };

// ── D7: deletion blocked by FX references (migr 496 RESTRICT) ──────────────

/**
 * Arabic message for a foreign-key violation caused by the FX ledger, the
 * exchange-rate history or a reversal link; null for any other error.
 */
export function fxReferenceDeleteMessage(err: any, subject: 'contract' | 'task' | 'user' | 'other' = 'other'): string | null {
  // 23503 foreign_key_violation (NO ACTION), 23001 restrict_violation (RESTRICT).
  if (err?.code !== '23503' && err?.code !== '23001') return null;
  const c = String(err?.constraint ?? '');
  const t = String(err?.table ?? '');
  const fx = c.startsWith('branch_fx_differences_') || t === 'branch_fx_differences';
  const rates = c === 'exchange_rates_created_by_fkey' || t === 'exchange_rates';
  const reversal = /reverses_entry_id/.test(c);
  if (!fx && !rates && !reversal) return null;
  if (subject === 'contract') {
    return 'لا يمكن حذف هذا العقد لوجود تحصيلات مسجَّلة عليه في حساب فروقات سعر الصرف. استخدم الإلغاء بدلاً من الحذف.';
  }
  if (subject === 'task') {
    return 'لا يمكن حذف هذه المهمة لوجود تحصيلات مسجَّلة عليها في حساب فروقات سعر الصرف. استخدم الإلغاء بدلاً من الحذف.';
  }
  if (subject === 'user' || rates) {
    return 'لا يمكن حذف هذا المستخدم لأنه سجّل أسعار صرف أو تحصيلات في حساب فروقات سعر الصرف. أوقف الحساب بدلاً من حذفه.';
  }
  return 'لا يمكن الحذف لوجود قيود مرتبطة في حساب فروقات سعر الصرف — هذه القيود لا تُحذف.';
}
