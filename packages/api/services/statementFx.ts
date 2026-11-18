// USD reference for a contract's NON-payment account-statement lines: the
// signing charge, installment charges, the «إجمالي دين العقد» line and the
// write-offs booked at cancellation. Payments keep their own reference
// (routes/clients.ts withPaymentFxReference). Owner request 2026-11-17: the
// statement shows every contract amount in USD as well.
//
//   - USD-linked installment charge → its fixed amount_usd at the contract rate;
//   - any other contract line       → amount ÷ contract rate (usd_rate_snapshot),
//                                     else ÷ the central rate in effect on the
//                                     line's date (never a future date);
//   - no rate at all (pre-feature history) → nothing (description unchanged).

function fxNum(n: unknown, digits = 0): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface StatementFxRow {
  kind?: string | null;
  source_type?: string | null;
  debit_amount?: unknown;
  credit_amount?: unknown;
  fx_contract_rate?: unknown;
  fx_installment_usd?: unknown;
  fx_date_rate?: unknown;
  /** «حسب إجمالي الدين» view: the one line carrying the whole contract value. */
  is_debt_total?: boolean | null;
}

export function contractLineFxReference(row: StatementFxRow): { usd: number; rate: number; label: string } | null {
  if (row.kind === 'payment') return null;
  if (!['contract', 'contract_installment'].includes(String(row.source_type))) return null;
  const contractRate = Number(row.fx_contract_rate) > 0 ? Number(row.fx_contract_rate) : null;
  const rate = contractRate ?? (Number(row.fx_date_rate) > 0 ? Number(row.fx_date_rate) : null);
  if (!rate) return null;
  const amount = Number(row.debit_amount) || Number(row.credit_amount) || 0;
  if (!(amount > 0)) return null;
  const rateLabel = contractRate != null ? 'بسعر العقد' : 'بسعر صرف';
  if (row.kind === 'charge' && row.source_type === 'contract_installment' && row.fx_installment_usd != null) {
    const usd = Number(row.fx_installment_usd);
    return { usd, rate, label: `قيمة القسط ${fxNum(usd, 2)} $ ${rateLabel} ${fxNum(rate)} ل.س/$` };
  }
  const usd = Math.round((amount / rate) * 100) / 100;
  if (row.is_debt_total && row.kind === 'charge' && row.source_type === 'contract') {
    // Owner 2026-11-18: the contract-total line states what the contract costs in USD.
    return { usd, rate, label: `قيمة العقد بالدولار: ${fxNum(usd, 2)} $ (${rateLabel} ${fxNum(rate)} ل.س/$)` };
  }
  return { usd, rate, label: `ما يعادل ${fxNum(usd, 2)} $ ${rateLabel} ${fxNum(rate)} ل.س/$` };
}
