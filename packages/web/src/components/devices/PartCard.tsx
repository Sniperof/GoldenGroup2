// Moved from packages/web/src/pages/ClientProfile.tsx (legacy ContractsTab).
// Behavior is intentionally unchanged — see the redesign plan: the part
// installation toggle still lives here; the section that hosts the card
// owns the action wiring.

interface Props {
  item: any;
  contract: any;
  installed: boolean;
}

export function PartCard({ item, contract, installed }: Props) {
  const label = item.description || item.name || 'قطعة ملحقة';
  const code = item.code || item.sparePartCode;
  const qty = item.quantity || 1;
  const price = item.unitPrice != null ? Number(item.unitPrice) : null;
  const totalPrice = price != null ? price * qty : null;

  return (
    <div className={`flex items-start p-4 rounded-2xl border transition-colors ${
      installed ? 'bg-slate-50 border-slate-100' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${installed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {label}
          </span>
          {code && (
            <span className="text-[10px] text-slate-400 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
              {code}
            </span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            installed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-100 text-amber-700'
          }`}>
            {installed ? '✓ مركّب' : '⏳ بانتظار التركيب'}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500">الكمية: {qty}</span>
          {totalPrice != null && (
            <span className="text-[11px] text-slate-500">
              السعر: {totalPrice.toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
              {qty > 1 && price != null && (
                <span className="text-slate-400"> ({price.toLocaleString('ar-SY', { numberingSystem: 'latn' })} × {qty})</span>
              )}
            </span>
          )}
          <span className="text-[11px] text-slate-400">
            تاريخ الشراء: {contract?.contractDate ? new Date(contract.contractDate).toLocaleDateString('ar-SY') : '—'}
          </span>
          <span className="text-[11px] text-slate-400">
            المصدر: عقد #{contract?.contractNumber || contract?.id}
          </span>
          {item.oldPartRemoved === true && (
            <span className="text-[11px] text-emerald-600 font-medium">✓ تم تبديل القطعة القديمة</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default PartCard;
