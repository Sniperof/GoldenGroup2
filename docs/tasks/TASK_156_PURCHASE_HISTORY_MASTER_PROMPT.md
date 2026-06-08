# TASK 156: سجل المشتريات الموحد — النسخة النهائية

## الهدف
بناء قسم "سجل المشتريات" (Purchase History) يعرض كل ما اشتراه الزبون: أجهزة + قطع صيانة دورية + قطع صيانة طوارئ + اكسسوارات.

## الملفات للتعديل
1. `packages/api/routes/customerCalls.ts` — إضافة endpoint
2. `packages/web/src/lib/api.ts` — إضافة client method
3. `packages/web/src/pages/visits/VisitDetailPage.tsx` — إضافة القسم

---

## الجزء 1: Backend API

### Endpoint
```
GET /api/customers/:id/purchase-history
```

### مصادر البيانات (٣ مصادر — UNION ALL)

#### المصدر ١: الجهاز من العقد
```sql
SELECT
  'contract_device_' || c.id::text AS id,
  c.customer_id,
  c.branch_id,
  c.contract_date::text AS purchase_date,
  'contract' AS source_type,
  c.id::text AS source_id,
  'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
  'device' AS item_type,
  c.device_model_id AS item_id,
  c.device_model_name AS item_name,
  NULL::varchar AS item_code,
  1 AS quantity,
  c.base_price AS unit_price,
  c.base_price AS total_price,
  'SYP' AS currency,
  c.payment_type,
  TRUE AS is_installed,
  NULL::boolean AS old_part_removed,
  CASE
    WHEN c.is_golden_warranty = TRUE THEN 'golden_warranty'
    ELSE 'contract_warranty'
  END AS warranty_context,
  CASE
    WHEN c.is_golden_warranty = TRUE THEN c.golden_warranty_end_date
    ELSE c.contract_warranty_end_date
  END AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name,
  CASE
    WHEN c.base_price > c.final_price THEN jsonb_build_object(
      'originalPrice', c.base_price,
      'discountAmount', c.base_price - c.final_price,
      'finalContractPrice', c.final_price
    )
    ELSE NULL
  END AS discount_info,
  NULL::text AS notes
FROM contracts c
WHERE c.customer_id = $1
  AND c.device_model_id IS NOT NULL
```

**ملاحظة مهمة:** `total_price` = `base_price` (سعر الجهاز وحده)، مش `final_price` (الإجمالي كامل).

#### المصدر ٢: القطع من العقد
```sql
SELECT
  'contract_item_' || cli.id::text AS id,
  c.customer_id,
  c.branch_id,
  c.contract_date::text AS purchase_date,
  'contract' AS source_type,
  c.id::text AS source_id,
  'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
  CASE
    WHEN sp.maintenance_type = 'Periodic' THEN 'periodic_part'
    WHEN sp.maintenance_type = 'Emergency' THEN 'emergency_part'
    ELSE 'accessory'
  END AS item_type,
  cli.spare_part_id AS item_id,
  COALESCE(cli.description, sp.name, 'قطعة ملحقة') AS item_name,
  sp.code AS item_code,
  cli.quantity,
  cli.unit_price,
  cli.total_price,
  'SYP' AS currency,
  c.payment_type,
  cli.is_installed,
  NULL::boolean AS old_part_removed,
  'contract_warranty' AS warranty_context,
  c.contract_warranty_end_date AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name,
  NULL::jsonb AS discount_info,
  NULL::text AS notes
FROM contract_line_items cli
JOIN contracts c ON c.id = cli.contract_id
LEFT JOIN spare_parts sp ON sp.id = cli.spare_part_id
WHERE c.customer_id = $1
  AND cli.item_type = 'accessory'
```

**ملاحظة مهمة:** `cli.item_type = 'accessory'` فقط — لا `device` هنا (الجهاز بيجي من المصدر ١ بس).

#### المصدر ٣: قطع الصيانة الطارئة
```sql
SELECT
  'emergency_' || vtepu.id::text AS id,
  fv.client_id AS customer_id,
  fv.branch_id,
  COALESCE(vtr.closed_at::date::text, fv.scheduled_date::text) AS purchase_date,
  'emergency_maintenance' AS source_type,
  vt.id::text AS source_id,
  'صيانة طارئة #' || vt.id::text AS source_label,
  'emergency_part' AS item_type,
  vtepu.spare_part_id AS item_id,
  COALESCE(vtepu.part_name_snapshot, sp.name, 'قطعة صيانة') AS item_name,
  sp.code AS item_code,
  vtepu.quantity,
  vtepu.unit_price,
  (vtepu.quantity * COALESCE(vtepu.unit_price, 0)) AS total_price,
  'SYP' AS currency,
  COALESCE(vtef.payment_method, 'maintenance_paid') AS payment_type,
  TRUE AS is_installed,
  vtepu.old_part_removed,
  CASE
    WHEN c.is_golden_warranty = TRUE
      AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.golden_warranty_end_date
      THEN 'golden_warranty'
    WHEN COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.contract_warranty_end_date
      THEN 'contract_warranty'
    ELSE 'no_warranty'
  END AS warranty_context,
  CASE
    WHEN c.is_golden_warranty = TRUE
      AND COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.golden_warranty_end_date
      THEN c.golden_warranty_end_date
    WHEN COALESCE(vtr.closed_at, fv.scheduled_date)::date <= c.contract_warranty_end_date
      THEN c.contract_warranty_end_date
    ELSE NULL
  END AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name,
  NULL::jsonb AS discount_info,
  NULL::text AS notes
FROM visit_task_emergency_parts_used vtepu
JOIN visit_tasks vt ON vt.id = vtepu.visit_task_id
JOIN field_visits fv ON fv.id = vt.field_visit_id
LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
LEFT JOIN visit_task_emergency_financials vtef ON vtef.visit_task_id = vt.id
LEFT JOIN spare_parts sp ON sp.id = vtepu.spare_part_id
LEFT JOIN contracts c ON c.id = vt.contract_id
WHERE fv.client_id = $1
```

### الـ Route Handler

```typescript
router.get(
  '/:id/purchase-history',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['id'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    try {
      const { rows: clientRows } = await pool.query(
        'SELECT id FROM clients WHERE id = $1',
        [customerId]
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: 'الزبون غير موجود' });
      }

      const { rows: records } = await pool.query(
        `(${SOURCE_1_SQL})
         UNION ALL
         (${SOURCE_2_SQL})
         UNION ALL
         (${SOURCE_3_SQL})
         ORDER BY purchase_date DESC NULLS LAST`,
        [customerId, customerId, customerId]
      );

      return res.json({
        customerId,
        records: records.map(r => ({
          ...r,
          purchaseDate: r.purchase_date,
          sourceType: r.source_type,
          sourceId: r.source_id,
          sourceLabel: r.source_label,
          itemType: r.item_type,
          itemName: r.item_name,
          itemCode: r.item_code,
          quantity: r.quantity,
          unitPrice: r.unit_price,
          totalPrice: r.total_price,
          currency: r.currency,
          paymentType: r.payment_type,
          isInstalled: r.is_installed,
          oldPartRemoved: r.old_part_removed,
          warrantyContext: r.warranty_context,
          warrantyUntil: r.warranty_until,
          deviceContext: {
            contractId: r.device_context_id,
            deviceModelName: r.device_context_name
          },
          discountInfo: r.discount_info,
          notes: r.notes
        })),
        summary: {
          totalPurchases: records.length,
          totalDevices: records.filter(r => r.item_type === 'device').length,
          totalParts: records.filter(r => r.item_type !== 'device').length
        }
      });
    } catch (err: any) {
      console.error('[customers] GET /:id/purchase-history error:', err);
      return res.status(500).json({ error: 'خطأ في جلب سجل المشتريات' });
    }
  }
);
```

---

## الجزء 2: API Client

في `packages/web/src/lib/api.ts` أضف ضمن `customers`:

```typescript
getPurchaseHistory: (customerId: number) =>
  request<any>(`/customers/${customerId}/purchase-history`),
```

---

## الجزء 3: Frontend — قسم سجل المشتريات

### المكان
`VisitDetailPage.tsx` — ضمن قسم بيانات الزبون (بعد `ClientInfoCard`).

### الاستدعاء

```typescript
const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
const [purchaseLoading, setPurchaseLoading] = useState(false);

useEffect(() => {
  if (visit?.customerSnapshot?.customerId) {
    setPurchaseLoading(true);
    api.customers.getPurchaseHistory(visit.customerSnapshot.customerId)
      .then(res => setPurchaseHistory(res.records || []))
      .catch(() => setPurchaseHistory([]))
      .finally(() => setPurchaseLoading(false));
  }
}, [visit?.customerSnapshot?.customerId]);
```

### تصميم القسم

#### العنوان + الملخص
```jsx
<div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
  <div className="flex items-center justify-between">
    <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
      <ShoppingCart className="w-4 h-4 text-slate-400" />
      سجل المشتريات
    </h4>
    {purchaseHistory.length > 0 && (
      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
        {purchaseHistory.length} مشتريات
      </span>
    )}
  </div>

  {/* ملخص */}
  {purchaseHistory.length > 0 && (
    <div className="flex items-center gap-2 flex-wrap">
      {(() => {
        const devices = purchaseHistory.filter(r => r.itemType === 'device');
        const parts = purchaseHistory.filter(r => r.itemType !== 'device');
        const total = purchaseHistory.reduce((s, r) => s + Number(r.totalPrice || 0), 0);
        return [
          { label: 'أجهزة', value: devices.length, color: 'blue' },
          { label: 'قطع', value: parts.length, color: 'emerald' },
          { label: 'الإجمالي', value: Number(total).toLocaleString('ar-SY', { numberingSystem: 'latn' }) + ' ل.س', color: 'slate' }
        ].map(s => (
          <div key={s.label} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg bg-${s.color}-50 border border-${s.color}-200`}>
            <span className={`text-xs font-bold text-${s.color}-700`}>{s.value}</span>
            <span className={`text-[10px] text-${s.color}-600`}>{s.label}</span>
          </div>
        ));
      })()}
    </div>
  )}
```

#### بطاقة كل مشتري (PurchaseRecordCard)

```jsx
function PurchaseRecordCard({ record: r }: { record: any }) {
  const isDevice = r.itemType === 'device';
  const isEmergency = r.itemType === 'emergency_part';
  const isPeriodic = r.itemType === 'periodic_part';

  const typeLabels: Record<string, { label: string; color: string; icon: any }> = {
    device:         { label: 'جهاز', color: 'blue', icon: Smartphone },
    periodic_part:  { label: 'قطعة صيانة دورية', color: 'emerald', icon: Wrench },
    emergency_part: { label: 'قطعة صيانة طوارئ', color: 'orange', icon: Zap },
    accessory:      { label: 'اكسسوار', color: 'purple', icon: Puzzle }
  };

  const typeInfo = typeLabels[r.itemType] || typeLabels.accessory;
  const TypeIcon = typeInfo.icon;

  const warrantyLabels: Record<string, string> = {
    contract_warranty: 'كفالة العقد',
    golden_warranty: 'كفالة ذهبية',
    no_warranty: 'بدون كفالة'
  };

  const paymentLabels: Record<string, string> = {
    cash: 'نقدي',
    installment: 'أقساط',
    maintenance_paid: 'مدفوع صيانة',
    warranty_free: 'مجاني (كفالة)'
  };

  return (
    <div className={`rounded-2xl border p-4 ${
      isDevice ? 'bg-blue-50/50 border-blue-200' :
      isEmergency ? 'bg-orange-50/50 border-orange-200' :
      'bg-slate-50 border-slate-200'
    }`}>
      {/* الصف العلوي: المصدر + التاريخ */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TypeIcon className={`w-3.5 h-3.5 text-${typeInfo.color}-500`} />
          <span className="text-xs font-bold text-slate-700">{r.sourceLabel}</span>
          <span className="text-[10px] text-slate-400">{r.purchaseDate}</span>
        </div>
      </div>

      {/* الصف الأوسط: الاسم + الرمز + النوع */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-black text-slate-800">{r.itemName}</span>
        {r.itemCode && (
          <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
            {r.itemCode}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          r.itemType === 'device' ? 'bg-blue-50 text-blue-600' :
          r.itemType === 'periodic_part' ? 'bg-emerald-50 text-emerald-600' :
          r.itemType === 'emergency_part' ? 'bg-orange-50 text-orange-600' :
          'bg-purple-50 text-purple-600'
        }`}>
          {typeInfo.label}
        </span>
        {r.serialNumber && (
          <span className="text-[10px] text-slate-400">ر.ت: {r.serialNumber}</span>
        )}
      </div>

      {/* الصف السفلي: سعر + كمية + دفع + كفالة + تركيب + سحب */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* السعر الرئيسي */}
        <span className="text-xs font-black text-slate-700">
          {Number(r.totalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
        </span>

        {/* الحسم */}
        {r.discountInfo && (
          <>
            <span className="text-[10px] text-slate-400 line-through">
              {Number(r.discountInfo.originalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
            </span>
            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded">
              حسم: {Number(r.discountInfo.discountAmount).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
            </span>
          </>
        )}

        {/* الكمية */}
        {r.quantity > 1 && (
          <span className="text-[10px] text-slate-500">كمية: {r.quantity}</span>
        )}

        {/* نوع الدفع */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          r.paymentType === 'cash' ? 'bg-slate-100 text-slate-600' :
          r.paymentType === 'installment' ? 'bg-amber-50 text-amber-600' :
          r.paymentType === 'warranty_free' ? 'bg-emerald-50 text-emerald-600' :
          'bg-slate-100 text-slate-600'
        }`}>
          {paymentLabels[r.paymentType] || r.paymentType}
        </span>

        {/* الكفالة */}
        {r.warrantyContext && r.warrantyContext !== 'no_warranty' && (
          <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
            {warrantyLabels[r.warrantyContext]}
            {r.warrantyUntil && ` حتى ${r.warrantyUntil}`}
          </span>
        )}

        {/* حالة التركيب — للقطع بس */}
        {!isDevice && r.isInstalled === true && (
          <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded flex items-center gap-0.5">
            <CheckCircle2 className="w-3 h-3" /> مركّب
          </span>
        )}
        {!isDevice && r.isInstalled === false && (
          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded flex items-center gap-0.5">
            <Clock className="w-3 h-3" /> غير مركّب
          </span>
        )}

        {/* حالة السحب — للطوارئ بس */}
        {isEmergency && r.oldPartRemoved === true && (
          <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 rounded flex items-center gap-0.5">
            <CheckCircle2 className="w-3 h-3" /> تم سحب القديم
          </span>
        )}
        {isEmergency && r.oldPartRemoved === false && (
          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 rounded flex items-center gap-0.5">
            <AlertCircle className="w-3 h-3" /> لم يتم السحب
          </span>
        )}
      </div>
    </div>
  );
}
```

---

## ملاحظات تنفيذية

1. **الأرقام دائماً Western:** استخدم `toLocaleString('ar-SY', { numberingSystem: 'latn' })` في كل عرض أرقام
2. **الجهاز مرة واحدة:** المصدر ١ بيجيب الجهاز بس. المصدر ٢ بيجيب accessories بس (`item_type = 'accessory'`)
3. **source_label:** دائماً استخدم `COALESCE(contract_number, id::text)`
4. **total_price للجهاز:** `base_price` (مش `final_price`)
5. **الصيانة الطارئة:** `is_installed = TRUE` دائماً (لأن القطعة بـ emergency_parts_used = استُخدمت)
6. **لا تعدل:** `fieldVisits.ts`, `openTasks.ts`, `snapshots.ts`

---

## Deliverables

- [ ] `customerCalls.ts` — endpoint `GET /customers/:id/purchase-history`
- [ ] `api.ts` — `customers.getPurchaseHistory()`
- [ ] `VisitDetailPage.tsx` — قسم "سجل المشتريات" + `PurchaseRecordCard`
- [ ] Build passed
- [ ] Test: زيارة → سجل المشتريات يظهر (جهاز + قطع + طوارئ)
