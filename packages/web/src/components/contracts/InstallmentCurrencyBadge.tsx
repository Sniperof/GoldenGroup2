/**
 * Which currency an installment schedule was fixed in at confirmation
 * (migr 493/497): USD-linked or plain SYP. Shown on the contracts table, the
 * contract detail and the collection-task table so the two kinds are never
 * confused. Renders nothing when the schedule is not confirmed yet.
 */
export type InstallmentCurrency = 'USD' | 'SYP' | null | undefined;

export default function InstallmentCurrencyBadge({
  currency,
  compact = false,
  className = '',
}: {
  currency: InstallmentCurrency;
  /** Short label for dense table cells. */
  compact?: boolean;
  className?: string;
}) {
  if (currency !== 'USD' && currency !== 'SYP') return null;
  const usd = currency === 'USD';
  const label = compact ? (usd ? 'بالدولار $' : 'بالليرة') : usd ? 'أقساط بالدولار $' : 'أقساط بالليرة السورية';
  return (
    <span
      title={usd ? 'جدول الأقساط مثبَّت بالدولار — يُحصَّل بسعر صرف يوم الدفع' : 'جدول الأقساط مثبَّت بالليرة السورية'}
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${
        usd ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600'
      } ${className}`}
    >
      {label}
    </span>
  );
}
