# TASK 158: سجل المشتريات الموحد — Backend + Frontend

## الهدف
بناء قسم "سجل المشتريات" ضمن صفحة تفاصيل الزيارة (`VisitDetailPage.tsx`) يعرض كل مشتريات الزبون (أجهزة + قطع) من كل المصادر، بشكل مرتب وموحد.

## ملاحظة مهمة
- **Backend API موجود مسبقاً** — انكب من Working Directory (uncommitted). لازم نعيد بناء `GET /api/customers/:id/purchase-history`
- **Frontend** — قسم جديد بـ `VisitDetailPage.tsx`
- **التصميم** — نستعير `PartCard` ونمط العرض من TASK_157

---

## الجزء الأول: Backend API

### Endpoint
```
GET /api/customers/:id/purchase-history
```

### مصادر البيانات (٣ مصادر)

| # | المصدر | الجداول | نوع الشي |
|---|--------|---------|----------|
| 1 | عقد البيع | `contracts` | الجهاز الأساسي |
| 2 | قطع العقد | `contract_line_items` + `spare_parts` | قطع وملحقات |
| 3 | صيانة طارئة | `visit_task_emergency_parts_used` + `spare_parts` | قطع استبدال |

### هيكل الريكورد (كل ريكورد = صف بالقائمة)

```typescript
interface PurchaseHistoryRecord {
  id: string;                    // معرف فريد (ch_ + رقم تسلسلي)
  purchaseDate: string;          // YYYY-MM-DD
  sourceType: 'contract' | 'emergency_maintenance';
  sourceId: string;              // رقم العقد أو المهمة
  sourceLabel: string;           // "عقد #45" أو "صيانة طارئة #892"

  // نوع واسم القطعة
  itemType: 'device' | 'part' | 'accessory';
  itemName: string;              // "RO 7 مراحل" أو "مضخة طوارئ"
  itemCode?: string;             // "PMP-001" (للقطع فقط)
  partType?: 'periodic' | 'emergency' | 'accessory'; // من spare_parts.maintenance_type
  serialNumber?: string;         // للأجهزة فقط

  // الكمية والسعر
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discountAmount?: number;       // قيمة الحسم إن وجد
  priceBeforeDiscount?: number;  // السعر قبل الحسم

  // الدفع
  paymentType: 'cash' | 'installment' | 'maintenance_paid';
  contractStatus?: 'active' | 'cancelled' | 'temporary'; // للعقود فقط
  saleSubtype?: 'definitive' | 'temporary' | 'free';   // نوع عقد البيع

  // سياق الجهاز (لأي جهاز تابع؟)
  deviceContext?: {
    contractId: number;
    deviceModelName: string;
  };

  // للقطع المستبدلة
  oldPartRemoved?: boolean;      // هل سُحبت القطعة القديمة؟
  isInstalled?: boolean;         // هل رُكّبت؟
}
```

### SQL: المصدر الأول (الجهاز من العقد)

```sql
SELECT
  'ch_' || c.id::text || '_device' AS id,
  c.contract_date AS purchase_date,
  'contract' AS source_type,
  c.id::text AS source_id,
  'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
  'device' AS item_type,
  c.device_model_name AS item_name,
  NULL AS item_code,
  NULL AS part_type,
  c.serial_number,
  1 AS quantity,
  c.base_price AS unit_price,
  c.final_price AS total_price,
  COALESCE(c.base_price - c.final_price, 0) AS discount_amount,
  c.base_price AS price_before_discount,
  c.payment_type,
  c.status AS contract_status,
  c.sale_subtype,
  jsonb_build_object('contractId', c.id, 'deviceModelName', c.device_model_name) AS device_context,
  NULL AS old_part_removed,
  TRUE AS is_installed
FROM contracts c
WHERE c.customer_id = $1
  AND c.device_model_id IS NOT NULL
```

### SQL: المصدر الثاني (قطع العقد)

```sql
SELECT
  'ch_' || c.id::text || '_item_' || cli.id::text AS id,
  c.contract_date AS purchase_date,
  'contract' AS source_type,
  c.id::text AS source_id,
  'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
  'part' AS item_type,
  COALESCE(cli.description, sp.name, 'قطعة ملحقة') AS item_name,
  sp.code AS item_code,
  CASE
    WHEN sp.maintenance_type = 'Periodic' THEN 'periodic'
    WHEN sp.maintenance_type = 'Emergency' THEN 'emergency'
    ELSE 'accessory'
  END AS part_type,
  NULL AS serial_number,
  cli.quantity,
  cli.unit_price,
  cli.total_price,
  0 AS discount_amount,
  cli.unit_price AS price_before_discount,
  c.payment_type,
  c.status AS contract_status,
  c.sale_subtype,
  jsonb_build_object('contractId', c.id, 'deviceModelName', c.device_model_name) AS device_context,
  NULL AS old_part_removed,
  cli.is_installed
FROM contract_line_items cli
JOIN contracts c ON c.id = cli.contract_id
LEFT JOIN spare_parts sp ON sp.id = cli.spare_part_id
WHERE c.customer_id = $1
  AND cli.item_type = 'accessory'  -- << مهم: لا نجلب device هنا
```

### SQL: المصدر الثالث (صيانة طارئة)

```sql
SELECT
  'ch_em_' || vepu.id::text AS id,
  COALESCE(vtr.closed_at::date::text, fv.scheduled_date::text) AS purchase_date,
  'emergency_maintenance' AS source_type,
  vt.id::text AS source_id,
  'صيانة طارئة #' || vt.id::text AS source_label,
  'part' AS item_type,
  COALESCE(vepu.part_name_snapshot, sp.name, 'قطعة صيانة') AS item_name,
  sp.code AS item_code,
  CASE
    WHEN sp.maintenance_type = 'Periodic' THEN 'periodic'
    WHEN sp.maintenance_type = 'Emergency' THEN 'emergency'
    ELSE 'accessory'
  END AS part_type,
  NULL AS serial_number,
  vepu.quantity,
  vepu.unit_price,
  (vepu.unit_price * vepu.quantity) AS total_price,
  0 AS discount_amount,
  vepu.unit_price AS price_before_discount,
  'maintenance_paid' AS payment_type,
  NULL AS contract_status,
  NULL AS sale_subtype,
  jsonb_build_object('contractId', vt.contract_id, 'deviceModelName', c.device_model_name) AS device_context,
  vepu.old_part_removed,
  TRUE AS is_installed
FROM visit_task_emergency_parts_used vepu
JOIN visit_tasks vt ON vt.id = vepu.visit_task_id
LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
LEFT JOIN field_visits fv ON fv.id = vt.field_visit_id
LEFT JOIN spare_parts sp ON sp.id = vepu.spare_part_id
LEFT JOIN contracts c ON c.id = vt.contract_id
WHERE fv.client_id = $1
```

### API Route (أضف لـ `packages/api/routes/customerCalls.ts`)

```typescript
// ── GET /api/customers/:id/purchase-history ───────────────────────────────────

router.get(
  '/:id/purchase-history',
  requirePermission('clients.view'),
  async (req, res) => {
    const customerId = parseInt(req.params['id'] as string, 10);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'معرّف الزبون غير صالح' });
    }

    try {
      // التحقق من وجود الزبون
      const { rows: clientRows } = await pool.query(
        'SELECT id FROM clients WHERE id = $1',
        [customerId]
      );
      if (clientRows.length === 0) {
        return res.status(404).json({ error: 'الزبون غير موجود' });
      }

      // جلب البيانات من المصادر الثلاثة
      const { rows: devices } = await pool.query(/* SQL المصدر الأول */, [customerId]);
      const { rows: parts } = await pool.query(/* SQL المصدر الثاني */, [customerId]);
      const { rows: emergencyParts } = await pool.query(/* SQL المصدر الثالث */, [customerId]);

      // دمج + ترتيب
      const allRecords = [...devices, ...parts, ...emergencyParts]
        .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());

      return res.json({
        customerId,
        records: allRecords,
        summary: {
          totalPurchases: allRecords.length,
          totalDevices: devices.length,
          totalParts: parts.length + emergencyParts.length,
          totalSpent: allRecords.reduce((sum, r) => sum + Number(r.total_price || 0), 0)
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

## الجزء الثاني: Frontend — قسم سجل المشتريات

### المكان
`packages/web/src/pages/visits/VisitDetailPage.tsx` — ضمن القسم الخاص ببيانات الزبون.

### البيانات
نقرأ من `visit.customerSnapshot?.customerId` → نستدعي `api.customers.getPurchaseHistory(customerId)`.

### تصميم القسم

```
┌──────────────────────────────────────────────────────────────┐
│  🛒 سجل المشتريات                              (3 مشتريات) │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ ملخص ──────────────────────────────────────────────┐   │
│  │  أجهزة: 1  │  قطع: 2  │  الإجمالي: 1,340,000 ل.س   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ عقد #45 ─ 2026/05/15 ─ بيع قطعي ─ نقدي ─ نشط ───┐   │
│  │  🔧 RO 7 مراحل  (رقم تسلسلي: SN-12345)              │   │
│  │     السعر: 1,250,000 ل.س                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ عقد #45 ─ 2026/05/15 ─ بيع قطعي ─ نقدي ───┐          │
│  │  ⚙️ فلتر كربون  [FLT-001] — قطعة صيانة دورية        │   │
│  │     الكمية: 2  │  السعر: 90,000 ل.س  │  مركّب ✅      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ صيانة طارئة #892 ─ 2026/08/20 ───┐                   │
│  │  ⚡ مضخة طوارئ  [PMP-001] — قطعة صيانة طوارئ       │   │
│  │     الكمية: 1  │  السعر: 350,000 ل.س  │  تبديل ✅     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### الألوان حسب النوع

| النوع | اللون | الأيقونة |
|-------|-------|----------|
| جهاز | 🔵 أزرق | `Smartphone` |
| قطعة صيانة دورية | 🟢 أخضر | `Wrench` |
| قطعة صيانة طوارئ | 🟠 برتقالي | `Zap` |
| اكسسوار | 🟣 بنفسجي | `Puzzle` |

### الكومبوننت: `PurchaseHistorySection`

```typescript
// داخل VisitDetailPage.tsx

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

### الشكل النهائي لكل صف

```jsx
function PurchaseRecordCard({ record }: { record: any }) {
  const isDevice = record.itemType === 'device';
  const isEmergency = record.sourceType === 'emergency_maintenance';

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${
      isDevice ? 'bg-blue-50 border-blue-200' :
      isEmergency ? 'bg-orange-50 border-orange-200' :
      'bg-slate-50 border-slate-200'
    }`}>
      {/* الصف العلوي: المصدر + التاريخ + نوع العقد + الدفع + الحالة */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{record.sourceLabel}</span>
          <span className="text-[10px] text-slate-400">{record.purchaseDate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {record.saleSubtype && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
              record.saleSubtype === 'definitive' ? 'bg-emerald-50 text-emerald-700' :
              record.saleSubtype === 'temporary' ? 'bg-amber-50 text-amber-700' :
              'bg-slate-50 text-slate-600'
            }`}>
              {record.saleSubtype === 'definitive' ? 'بيع قطعي' :
               record.saleSubtype === 'temporary' ? 'عقد مؤقت لمدة شهر' :
               'عقد مجاني'}
            </span>
          )}
          <span className="text-[10px] text-slate-500">
            {record.paymentType === 'cash' ? 'نقدي' :
             record.paymentType === 'installment' ? 'أقساط' :
             'مدفوع صيانة'}
          </span>
          {record.contractStatus && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              record.contractStatus === 'active' ? 'bg-emerald-50 text-emerald-600' :
              record.contractStatus === 'cancelled' ? 'bg-rose-50 text-rose-600' :
              'bg-slate-50 text-slate-500'
            }`}>
              {record.contractStatus === 'active' ? 'نشط' :
               record.contractStatus === 'cancelled' ? 'ملغى' :
               'مؤقت'}
            </span>
          )}
        </div>
      </div>

      {/* الصف الأوسط: اسم القطعة + الرمز + النوع + الرقم التسلسلي */}
      <div className="flex items-start gap-2">
        <span className="text-sm font-black text-slate-800">{record.itemName}</span>
        {record.itemCode && (
          <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
            {record.itemCode}
          </span>
        )}
        {record.partType && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            record.partType === 'periodic' ? 'bg-emerald-50 text-emerald-600' :
            record.partType === 'emergency' ? 'bg-orange-50 text-orange-600' :
            'bg-purple-50 text-purple-600'
          }`}>
            {record.partType === 'periodic' ? 'قطعة صيانة دورية' :
             record.partType === 'emergency' ? 'قطعة صيانة طوارئ' :
             'اكسسوار'}
          </span>
        )}
      </div>
      {record.serialNumber && (
        <p className="text-[11px] text-slate-400 mt-0.5">رقم تسلسلي: {record.serialNumber}</p>
      )}

      {/* الصف السفلي: كمية + سعر + حسم + سعر نهائي + حالة التركيب/التبديل */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <span className="text-[11px] text-slate-500">الكمية: {record.quantity}</span>
        {record.priceBeforeDiscount && record.discountAmount > 0 && (
          <>
            <span className="text-[11px] text-slate-400 line-through">
              {Number(record.priceBeforeDiscount).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
            </span>
            <span className="text-[11px] text-rose-500">
              -{Number(record.discountAmount).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
            </span>
          </>
        )}
        <span className="text-xs font-bold text-slate-700">
          {Number(record.totalPrice).toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
        </span>
        {record.isInstalled === true && (
          <span className="text-[10px] text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> مركّب
          </span>
        )}
        {record.oldPartRemoved === true && (
          <span className="text-[10px] text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> تم تبديل القطعة القديمة
          </span>
        )}
      </div>
    </div>
  );
}
```

---

## الجزء الثالث: API Client (`api.ts`)

أضف لـ `packages/web/src/lib/api.ts`:

```typescript
customers: {
  // ... existing methods ...
  getPurchaseHistory: (customerId: number) =>
    request<any>(`/customers/${customerId}/purchase-history`),
}
```

---

## قائمة الملفات للتعديل

| # | الملف | التعديل |
|---|-------|---------|
| 1 | `packages/api/routes/customerCalls.ts` | إضافة endpoint `GET /:id/purchase-history` |
| 2 | `packages/web/src/lib/api.ts` | إضافة `getPurchaseHistory` |
| 3 | `packages/web/src/pages/visits/VisitDetailPage.tsx` | إضافة قسم `سجل المشتريات` |

---

## ملاحظات تنفيذية

1. **الأرقام:** دائماً Western (1,250,000) — استخدم `numberingSystem: 'latn'`
2. **الترتيب:** حسب `purchaseDate DESC` (الأحدث أولاً)
3. **الجهاز:** يظهر مرة واحدة فقط (من `contracts` مباشرة)
4. **قطع العقد:** `item_type = 'accessory'` فقط — لا `device`
5. **source_label:** استخدم `COALESCE(contract_number, id::text)`
6. **old_part_removed:** موجود بـ `visit_task_emergency_parts_used` (Migration 156)
7. **لا تعدل:** `fieldVisits.ts`, `openTasks.ts`, `snapshots.ts`

---

## Deliverables

- [ ] Backend: `GET /api/customers/:id/purchase-history` يعمل
- [ ] Frontend: قسم "سجل المشتريات" بـ `VisitDetailPage.tsx`
- [ ] API Client: `api.customers.getPurchaseHistory()`
- [ ] Build passed
- [ ] Test: زيارة → سجل المشتريات يظهر العقود والقطع والصيانة
