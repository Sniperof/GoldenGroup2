# TASK: إصلاح عرض السجل التاريخي — إضافة حالة التركيب والسحب

## المشكلة

سجل المشتريات بـ `ClientProfile.tsx` (PurchaseHistoryTab) ما بيعرض معلومات مهمة:

1. **حالة التركيب** (`is_installed`) — ما ظاهرة أبداً
2. **حالة سحب القطعة القديمة** (`old_part_removed`) — بس بتظهر لما تكون `true`، لما تكون `false` أو `null` ما بيظهر شي

## الهدف

كل ريكورد لازم يوضح بوضوح:
- **للأجهزة:** الجهاز تلقائياً مركّب (ما لازم نعرض حالة)
- **للقطع والاكسسوارات:** هل رُكّبت؟ (`is_installed: true/false`)
- **للقطع المستبدلة (طوارئ):** هل سُحبت القطعة القديمة؟ (`old_part_removed: true/false/null`)

---

## الملف المطلوب: `packages/web/src/pages/ClientProfile.tsx`

### التعديل على PurchaseHistoryTab (~line 1468-1484)

**النص الحالي:**
```jsx
<div className="flex items-center gap-4 mt-1 flex-wrap">
    {r.quantity > 1 && (
        <span className="text-xs text-slate-500">الكمية: {r.quantity}</span>
    )}
    {r.unitPrice != null && r.quantity > 1 && (
        <span className="text-xs text-slate-500">سعر الوحدة: {r.unitPrice.toLocaleString('ar-SY')} ل.س</span>
    )}
    {r.paymentTypeLabel && (
        <span className="text-xs text-slate-500">{r.paymentTypeLabel}</span>
    )}
    {r.warrantyUntil && (
        <span className="text-xs text-slate-500">الكفالة حتى: {r.warrantyUntil}</span>
    )}
    {r.oldPartRemoved === true && (
        <span className="text-xs text-emerald-600 font-medium">✓ سُحبت القطعة القديمة</span>
    )}
</div>
```

**النص الجديد:**
```jsx
<div className="flex items-center gap-3 mt-1.5 flex-wrap">
    {/* الكمية */}
    {r.quantity > 1 && (
        <span className="text-[11px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">
            الكمية: {r.quantity}
        </span>
    )}
    
    {/* سعر الوحدة (إذا كمية > 1) */}
    {r.unitPrice != null && r.quantity > 1 && (
        <span className="text-[11px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">
            سعر الوحدة: {r.unitPrice.toLocaleString('ar-SY')} ل.س
        </span>
    )}
    
    {/* طريقة الدفع */}
    {r.paymentTypeLabel && (
        <span className="text-[11px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">
            {r.paymentTypeLabel}
        </span>
    )}
    
    {/* الكفالة */}
    {r.warrantyUntil && (
        <span className="text-[11px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">
            الكفالة حتى: {r.warrantyUntil}
        </span>
    )}
    
    {/* حالة التركيب — للقطع والاكسسوارات (مش للأجهزة) */}
    {r.itemType !== 'device' && r.isInstalled === true && (
        <span className="text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-medium">
            ✓ مركّب
        </span>
    )}
    {r.itemType !== 'device' && r.isInstalled === false && (
        <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md font-medium">
            ⏳ غير مركّب
        </span>
    )}
    
    {/* حالة سحب القطعة القديمة — للقطع الطارئة بس */}
    {r.itemType === 'emergency_part' && r.oldPartRemoved === true && (
        <span className="text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-medium">
            ✓ سُحبت القطعة القديمة
        </span>
    )}
    {r.itemType === 'emergency_part' && r.oldPartRemoved === false && (
        <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md font-medium">
            ⏳ لم يتم سحب القطعة القديمة
        </span>
    )}
    {r.itemType === 'emergency_part' && r.oldPartRemoved === null && (
        <span className="text-[11px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
            — حالة السحب غير محددة
        </span>
    )}
</div>
```

---

## Deliverables

- [ ] `ClientProfile.tsx` — إضافة حالة التركيب (`is_installed`) للقطع والاكسسوارات
- [ ] `ClientProfile.tsx` — إظهار حالة السحب (`old_part_removed`) بكل الحالات (true/false/null) للقطع الطارئة
- [ ] Build passed
- [ ] Test: عرض /customers/21/purchase-history — التركيب والسحب ظاهرين
