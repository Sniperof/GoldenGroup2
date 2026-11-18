// Financial read-model for the contract detail page.
//
// The page used to compute its numbers inline, and several were wrong:
// refunds counted as paid, a cancelled contract kept showing its voided
// balance as a live debt, USD-linked schedules showed two different
// "remaining" figures, and "n × first installment" hid uneven schedules.
// Everything the page shows about money is derived here, in one place.

export type ContractStatus = 'draft' | 'active' | 'completed' | 'cancelled' | 'discarded' | string;

export interface FinancePaymentEntry {
  amountSyp: number | string;
  entryType?: string | null;
  installmentId?: number | null;
}

export interface FinanceInstallment {
  installmentNumber?: number;
  dueDate?: string | null;
  amountSyp: number | string;
  paidAmount?: number | string | null;
  remainingBalance: number | string;
  status?: string | null;
  confirmed?: boolean;
  usdDue?: { dueTodaySyp?: number | null } | null;
}

export interface FinanceInput {
  status: ContractStatus;
  paymentType?: string | null;
  basePrice?: number | string | null;
  finalPrice?: number | string | null;
  downPayment?: number | string | null;
  installmentsCount?: number | null;
  discountAmount?: number | null;
  paymentEntries: FinancePaymentEntry[];
  installments: FinanceInstallment[];
}

export type InstallmentDisplayStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'voided' | 'planned';

export interface ContractFinance {
  /** Collections minus refunds. */
  netPaid: number;
  /** Paid at signing (entries not tied to an installment), net of their refunds. */
  signingPaid: number;
  /** What the summary shows as the down payment, or null when there is none. */
  downPaymentShown: number | null;
  /** Fees / additions on top of the base price (final − base + discount). */
  extras: number;
  /** Text for the installments line, or null when not an installment contract. */
  installmentsSummary: string | null;
  /**
   * Remaining balance as the page presents it.
   *  - live:    the real open debt (open installment balances, at today's due for
   *             USD-linked ones, plus any unpaid signing amount)
   *  - planned: a draft — the schedule is not a debt yet
   *  - voided:  a cancelled contract — the balance was written off (amount = voided)
   */
  remaining: { kind: 'live' | 'planned' | 'voided'; amount: number };
  /** Sum of today's due across open installments (USD-linked at today's rate). */
  openInstallmentsDue: number;
  /** final ≠ signing + installments, or a completed contract that still shows a balance. */
  mismatch: { kind: 'schedule' | 'completed_with_balance'; recorded: number } | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function isRefund(e: FinancePaymentEntry): boolean {
  return e.entryType === 'refund';
}

function signedAmount(e: FinancePaymentEntry): number {
  return isRefund(e) ? -num(e.amountSyp) : num(e.amountSyp);
}

export function fmtAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function isPastDue(dueDate: string | null | undefined, today: Date): boolean {
  if (!dueDate) return false;
  const due = String(dueDate).slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  return due < todayKey;
}

/** Status a schedule row should show, given the contract it belongs to. */
export function installmentDisplayStatus(
  inst: FinanceInstallment,
  contractStatus: ContractStatus,
  today: Date = new Date(),
): InstallmentDisplayStatus {
  const remaining = num(inst.remainingBalance);
  if (contractStatus === 'draft') return 'planned';
  if (remaining <= 0) return 'paid';
  if (contractStatus === 'cancelled' || contractStatus === 'discarded') return 'voided';
  // Overdue is about the date, whether or not something was already paid —
  // a partially paid installment past its due date is overdue too.
  if (isPastDue(inst.dueDate, today)) return 'overdue';
  return num(inst.paidAmount) > 0 || inst.status === 'partial' ? 'partial' : 'pending';
}

/** Today's due for one open installment (USD-linked → today's rate). */
export function installmentDueToday(inst: FinanceInstallment): number {
  const remaining = num(inst.remainingBalance);
  if (remaining <= 0) return 0;
  const usd = inst.usdDue?.dueTodaySyp;
  return usd != null ? num(usd) : remaining;
}

function summarizeInstallments(input: FinanceInput, finalPrice: number, signing: number): string | null {
  if (input.paymentType !== 'installment') return null;
  const amounts = input.installments.map((i) => num(i.amountSyp));
  if (amounts.length === 0) {
    const count = num(input.installmentsCount);
    if (count <= 0) return null;
    return `${count} × ${fmtAmount((finalPrice - signing) / count)} ل.س (تقديري)`;
  }
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  // Rounding residue lands on the last installment; that still reads as equal.
  const body = amounts.slice(0, -1);
  const equalBody = body.length === 0 || body.every((a) => a === body[0]);
  if (min === max || (equalBody && Math.abs(amounts[amounts.length - 1] - (body[0] ?? max)) <= 5)) {
    return `${amounts.length} × ${fmtAmount(amounts[0])} ل.س`;
  }
  return `${amounts.length} أقساط — من ${fmtAmount(min)} إلى ${fmtAmount(max)} ل.س`;
}

export function computeContractFinance(input: FinanceInput, today: Date = new Date()): ContractFinance {
  const finalPrice = num(input.finalPrice);
  const basePrice = num(input.basePrice);
  const entries = input.paymentEntries ?? [];
  const installments = input.installments ?? [];

  const netPaid = entries.reduce((s, e) => s + signedAmount(e), 0);
  const signingPaid = entries
    .filter((e) => e.installmentId == null)
    .reduce((s, e) => s + signedAmount(e), 0);

  const declaredDown = num(input.downPayment);
  const downPaymentShown = declaredDown > 0 ? declaredDown : signingPaid > 0 ? signingPaid : null;

  const extras = Math.max(0, finalPrice - basePrice + num(input.discountAmount));

  const installmentsTotal = installments.reduce((s, i) => s + num(i.amountSyp), 0);
  // What the contract expected at signing = price − scheduled installments.
  // (cash: the whole price; installment: the down payment)
  const signingDue = Math.max(0, finalPrice - installmentsTotal);
  const signingOpen = Math.max(0, signingDue - Math.max(0, signingPaid));
  const openInstallmentsDue = installments.reduce((s, i) => s + installmentDueToday(i), 0);
  const liveRemaining = signingOpen + openInstallmentsDue;

  let remaining: ContractFinance['remaining'];
  if (input.status === 'draft') {
    remaining = { kind: 'planned', amount: Math.max(0, finalPrice - netPaid) };
  } else if (input.status === 'cancelled' || input.status === 'discarded') {
    const frozenOpen = installments.reduce((s, i) => s + Math.max(0, num(i.remainingBalance)), 0);
    remaining = { kind: 'voided', amount: signingOpen + frozenOpen };
  } else {
    remaining = { kind: 'live', amount: liveRemaining };
  }

  let mismatch: ContractFinance['mismatch'] = null;
  const recorded = Math.max(0, signingPaid) + installmentsTotal;
  if (input.paymentType === 'installment' && installments.length > 0 && input.status !== 'draft') {
    // Signing that never reached the agreed down payment, while the schedule
    // was built as if it had: the recorded plan does not add up to the price.
    const plannedDown = declaredDown > 0 ? declaredDown : signingPaid;
    if (Math.abs(plannedDown + installmentsTotal - finalPrice) > 1) {
      mismatch = { kind: 'schedule', recorded: plannedDown + installmentsTotal };
    }
  }
  if (!mismatch && input.status === 'completed' && remaining.amount > 1) {
    mismatch = { kind: 'completed_with_balance', recorded };
  }

  return {
    netPaid,
    signingPaid,
    downPaymentShown,
    extras,
    installmentsSummary: summarizeInstallments(input, finalPrice, Math.max(declaredDown, signingPaid)),
    remaining,
    openInstallmentsDue,
    mismatch,
  };
}
