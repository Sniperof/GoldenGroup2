# TASK: تحسين قسم "قطع وملحقات العقد" (Contract Line Items Enhancement)

## الملف المستهدف

`packages/web/src/pages/ClientProfile.tsx` — قسم ContractsTab → drawer العقد → قائمة القطع والملحقات

## ما لازم يتعمل

### ١. حذف الـ checkbox

الـ checkbox الحالي بيعمل `handleToggleInstallation` — ما لها فايدة واضحة بالنسبة للمستخدم. **احذف الـ checkbox بالكامل**.

### ٢. تغيير العنوان

من:
```
قائمة القطع والملحقات (التثبيت الفردي)
```

إلى:
```
قطع وملحقات الجهاز
```

### ٣. Summary card

أضف فوق القائمة بطاقة ملخّص:

```
┌─────────────────────────────────────────────────────────────┐
│  مركّب: ٣  │  باقي: ٢  │  إجمالي: ٥ قطع                  │
└─────────────────────────────────────────────────────────────┘
```

### ٤. تقسيم القائمة لقسمين

**القسم الأول: قطع مركّبة** ✅
- لون رمادي فاتح `bg-slate-50`
- النص `line-through text-slate-400`
- أيقونة ✅ خضراء

**القسم الثاني: بانتظار التركيب** ⏳
- لون مُبرز `bg-amber-50 border-amber-200`
- النص `text-amber-700`
- أيقونة ⏳ صفراء

### ٥. معلومات كل قطعة

كل قطعة/ملحق بيعرض:

| المعلومة | المصدر | مثال |
|----------|--------|------|
| **اسم القطعة** | `description` أو `spare_parts.name` | "فلتر كربون" |
| **رمز القطعة** | `spare_parts.code` | "FLT-001" |
| **الكمية** | `quantity` | "٢ قطع" |
| **السعر** | `unit_price` × `quantity` | "٩٠,٠٠٠ ل.س" |
| **تاريخ الشراء** | `contracts.contract_date` | "٢٠٢٦/٠٥/١٥" |
| **مصدر الشراء** | `contracts.contract_number` | "عقد #١٩" |
| **حالة التركيب** | `is_installed` | ✅ مركّب / ⏳ بانتظار التركيب |
| **تم التبديل** | `old_part_removed` (للقطع المستبدلة فقط) | ✅ تم التبديل |

**ملاحظة:** تاريخ الشراء ومصدر الشراء لكل قطعة = نفس تاريخ/مصدر **العقد** (لأن كل القطع بالعقد اشتراها بنفس اليوم).

### ٦. عدم عرض "الجهاز الأساسي"

الجهاز الرئيسي (`item_type = 'device'`) **ما يظهر** بهالقائمة — الجهاز معروض فوق ببطاقة منفصلة. هالقائمة = **بس القطع والملحقات**.

---

## التعديلات المطلوبة بالـ Code

### A. حذف الـ checkbox + handleToggleInstallation

**النص الحالي (~سطر 1331-1359):**
```jsx
{selectedContractDetails.lineItems.map((item: any) => {
    const label = item.description || (item.itemType === 'device' ? 'الجهاز الأساسي' : 'قطعة ملحقة');
    const isInstalled = !!item.isInstalled;
    const isUpdating = lineItemUpdatingId === item.id;

    return (
        <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div className="flex items-center gap-3">
                <input
                    type="checkbox"
                    id={`item-${item.id}`}
                    checked={isInstalled}
                    disabled={isUpdating}
                    onChange={() => handleToggleInstallation(item.id, isInstalled)}
                    className="w-4.5 h-4.5 text-sky-600 border-slate-300 rounded focus:ring-sky-500 cursor-pointer disabled:opacity-50"
                />
                <label
                    htmlFor={`item-${item.id}`}
                    className={`text-xs font-bold cursor-pointer select-none transition-colors ${isInstalled ? 'text-slate-400 line-through' : 'text-slate-700'}`}
                >
                    {label}
                    <span className="text-[10px] text-slate-400 font-medium mr-2">({item.quantity} قطع)</span>
                </label>
            </div>
            {isUpdating && <Loader2 className="w-4 h-4 animate-spin text-sky-600" />}
        </div>
    );
})}
```

**النص الجديد:** انظر "الشكل النهائي" تحت.

### B. إضافة summary + تقسيم القائمة

**الشكل النهائي للقسم:**

```jsx
<div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
    <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
        <Wrench className="w-4 h-4 text-slate-400" />
        قطع وملحقات الجهاز
    </h4>

    {/* ── Summary ── */}
    {selectedContractDetails?.lineItems && (
        <div className="flex items-center gap-3 flex-wrap">
            {[
                { label: 'مركّب', value: installedCount, color: 'emerald' },
                { label: 'باقي', value: pendingCount, color: 'amber' },
                { label: 'الإجمالي', value: totalCount, color: 'slate' },
            ].map((stat) => (
                <div key={stat.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-${stat.color}-50 border border-${stat.color}-200`}>
                    <span className={`text-xs font-bold text-${stat.color}-700`}>{stat.value}</span>
                    <span className={`text-[10px] text-${stat.color}-600`}>{stat.label}</span>
                </div>
            ))}
        </div>
    )}

    {/* ── Pending Items ── */}
    {pendingItems.length > 0 && (
        <div className="space-y-2">
            <h5 className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                بانتظار التركيب ({pendingItems.length})
            </h5>
            {pendingItems.map((item) => (
                <PartCard item={item} contract={selectedContract} installed={false} />
            ))}
        </div>
    )}

    {/* ── Installed Items ── */}
    {installedItems.length > 0 && (
        <div className="space-y-2">
            <h5 className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                مركّب ({installedItems.length})
            </h5>
            {installedItems.map((item) => (
                <PartCard item={item} contract={selectedContract} installed={true} />
            ))}
        </div>
    )}

    {(!selectedContractDetails?.lineItems || selectedContractDetails.lineItems.length === 0) && (
        <p className="text-xs text-slate-400 font-bold text-center py-4">لا توجد قطع أو ملحقات مسجلة.</p>
    )}
</div>
```

### C. كومبوننت PartCard

```jsx
function PartCard({ item, contract, installed }: { item: any; contract: any; installed: boolean }) {
    const label = item.description || item.name || 'قطعة ملحقة';
    const code = item.code || item.sparePartCode;
    const qty = item.quantity || 1;
    const price = item.unitPrice != null ? Number(item.unitPrice) : null;
    const totalPrice = price != null ? price * qty : null;

    return (
        <div className={`flex items-start justify-between p-4 rounded-2xl border transition-colors ${
            installed
                ? 'bg-slate-50 border-slate-100'
                : 'bg-amber-50 border-amber-200'
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
                        installed
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-amber-100 text-amber-700'
                    }`}>
                        {installed ? '✓ مركّب' : '⏳ بانتظار التركيب'}
                    </span>
                </div>

                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-500">الكمية: {qty}</span>
                    {totalPrice != null && (
                        <span className="text-[11px] text-slate-500">
                            السعر: {totalPrice.toLocaleString('ar-SY')} ل.س
                            {qty > 1 && price != null && (
                                <span className="text-slate-400"> ({price.toLocaleString('ar-SY')} × {qty})</span>
                            )}
                        </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                        تاريخ الشراء: {contract.contractDate || '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                        المصدر: عقد #{contract.contractNumber || contract.id}
                    </span>
                    {/* old_part_removed — للقطع المستبدلة فقط */}
                    {item.oldPartRemoved === true && (
                        <span className="text-[11px] text-emerald-600 font-medium">✓ تم تبديل القطعة القديمة</span>
                    )}
                </div>
            </div>
        </div>
    );
}
```

---

## Deliverables

- [ ] حذف الـ checkbox من `ContractsTab`
- [ ] تغيير العنوان لـ "قطع وملحقات الجهاز"
- [ ] إضافة summary cards (مركّب/باقي/إجمالي)
- [ ] تقسيم القائمة: بانتظار التركيب ↑ + مركّب ↓
- [ ] عرض تاريخ الشراء ومصدر الشراء لكل قطعة
- [ ] عرض old_part_removed إذا موجود
- [ ] عدم عرض الجهاز الأساسي بهالقائمة
- [ ] Build passed
- [ ] Test: افتح عقد → تأكد من الشكل الجديد
