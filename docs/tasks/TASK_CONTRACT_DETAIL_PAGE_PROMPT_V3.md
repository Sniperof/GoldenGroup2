# PROMPT v3-final: صفحة تفاصيل العقد — بيانات حقيقية من API

> **⚠️ هذا البرومptz النهائي. لا تستخدم v1 أو v2.**
> **القاعدة:** كل حقل = `data.fieldName` من API. لا أمثلة وهمية. لا hardcoded values.

---

## 📡 مصدر البيانات

```typescript
const { data } = await api.contracts.get(Number(id));
```

**الـ API بيرجّع:**
- `data.contractNumber`, `data.contractType`, `data.status`, `data.branchName`, `data.contractDate`, `data.createdAt`
- `data.client` (object كامل من `clients` مع `clientSnapshot`)
- `data.customerName`, `data.buyerBirthDate`, `data.buyerMotherName`, `data.buyerNationalIdIssuedBy`, `data.buyerNationalIdIssueDate`, `data.buyerNationalIdBox`
- `data.deviceModelName`, `data.serialNumber`, `data.code`, `data.maintenancePlan`, `data.deviceStatus`
- `data.saleType`, `data.saleSubtype`, `data.saleSource`, `data.saleReferenceNumber`
- `data.basePrice`, `data.finalPrice`, `data.discount`, `data.paymentType`, `data.downPayment`, `data.installmentsCount`, `data.receiptNumber`
- `data.deliveryDate`, `data.installationDate`, `data.installationGeoPath`, `data.installationAddressText`, `data.installationLat`, `data.installationLng`
- `data.sourceVisit`, `data.sourceOpenTaskId`, `data.sourceTaskOfferId`, `data.closingEmployeeName`, `data.closingDate`, `data.noClosingReasonName`
- `data.invoiceNotes`
- `data.lineItems` (array), `data.paymentEntries` (array), `data.installments` (array), `data.dues` (array), `data.tasks` (array)

---

## 🎨 التصميم العام

```tsx
<div className="min-h-screen bg-slate-50 pb-20">
  <Navbar />
  <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
    <Group1Header />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Group2BuyerIdentity />
      <Group3Device />
    </div>
    <Group4Financial />
    <Group5DeliveryInstallation />
    <Group7Source />
    <Group8LineItems />
    <Group9Payments />
    <Group10Installments />
    <Group11Dues />
    <Group12Tasks />
    {data.invoiceNotes && <Group13Notes />}
  </div>
</div>
```

**قواعد CSS:**
- كل card: `bg-white rounded-2xl shadow-sm border border-gray-100 p-5`
- العنوان داخل card: `text-base font-bold text-slate-800 mb-4`
- الخطوط العادية: `text-sm text-slate-600`
- الأرقام: `font-mono text-slate-700`
- العنوان الرمادي (label): `text-xs font-medium text-slate-400`
- الفواصل: `<div className="h-px bg-gray-100 my-4"></div>`
- Western numerals فقط

---

## المجموعة 1: رأس العقد

```tsx
<Card>
  <div className="text-sm font-mono text-sky-600 mb-2">{data.contractNumber ?? '—'}</div>
  <div className="flex items-center gap-3 flex-wrap mb-3">
    <h2 className="text-xl font-black text-slate-800">{contractTitle(data.contractType, data.saleSubtype)}</h2>
    <StatusBadge status={data.status} />
    {data.branchName && <Chip cls="bg-slate-100 text-slate-600">🏢 {data.branchName}</Chip>}
  </div>
  <Divider />
  <div className="flex gap-6 text-sm text-slate-500 flex-wrap">
    <LabelVal label="تاريخ العقد" value={fmtDate(data.contractDate)} mono />
    <LabelVal label="تاريخ الإنشاء" value={fmtDateTime(data.createdAt)} mono />
  </div>
</Card>
```

**دوال helpers:**
```typescript
function contractTitle(type: string, subtype?: string | null) {
  if (type === 'maintenance_contract') return 'عقد صيانة وتركيب';
  if (!subtype || subtype === 'definitive') return 'عقد بيع';
  if (subtype === 'temporary') return 'عقد بيع';
  if (subtype === 'free') return 'عقد بيع';
  return 'عقد بيع';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'bg-amber-100 text-amber-700', label: 'مسودة' },
    active: { cls: 'bg-emerald-100 text-emerald-700', label: 'نشط' },
    completed: { cls: 'bg-blue-100 text-blue-700', label: 'مكتمل' },
    cancelled: { cls: 'bg-red-100 text-red-700', label: 'ملغى' },
    temporary: { cls: 'bg-amber-100 text-amber-700', label: 'مؤقت' },
  };
  const m = map[status] ?? { cls: 'bg-slate-100 text-slate-600', label: status };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${m.cls}`}>{m.label}</span>;
}
```

---

## المجموعة 2: هوية المشتري

### الجزء أ: MiniSnapshot Header
```tsx
<div className="flex items-center gap-3">
  <ClientAvatar dataQuality={data.client?.dataQuality} />
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={() => navigate(`/clients/${data.client?.id}`)}
        className="text-base font-bold text-slate-800 hover:text-sky-600 hover:underline">
        {data.customerName ?? data.client?.name ?? '—'}
        {data.client?.nickname ? ` (${data.client.nickname})` : ''}
      </button>
    </div>
    <div className="text-sm text-slate-500 mt-0.5">
      {data.client?.mobile && <span className="font-mono">{data.client.mobile}</span>}
    </div>
  </div>
</div>
```

### الجزء ب: العنوان الكامل + المهنة
```tsx
<Divider />

{data.client?.geoPath?.length > 0 && (
  <div className="mb-4">
    <div className="text-xs font-medium text-slate-400 mb-1">📍 العنوان الكامل</div>
    <div className="text-sm text-slate-700">{data.client.geoPath.join(' → ')}</div>
    {data.client?.detailedAddress && (
      <div className="text-sm text-slate-500 mt-0.5">{data.client.detailedAddress}</div>
    )}
    {data.client?.lat && data.client?.lng && (
      <a href={`https://maps.google.com/?q=${data.client.lat},${data.client.lng}`}
        target="_blank" className="mt-2 text-xs text-sky-600 font-medium">🗺️ عرض على الخريطة</a>
    )}
  </div>
)}

<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
  <div>
    <div className="text-xs font-medium text-slate-400 mb-0.5">💼 المهنة</div>
    <div className={`text-sm ${data.client?.occupation ? 'text-slate-700' : 'text-slate-400 italic'}`}>
      {data.client?.occupation || 'غير محدد'}
    </div>
  </div>
  <div>
    <div className="text-xs font-medium text-slate-400 mb-0.5">💼 مهنة الزوج/ة</div>
    <div className={`text-sm ${data.client?.spouseOccupation ? 'text-slate-700' : 'text-slate-400 italic'}`}>
      {data.client?.spouseOccupation || 'غير محدد'}
    </div>
  </div>
</div>
```

### الجزء ج: الهوية القانونية
```tsx
<Divider />

<div>
  <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">📋 الهوية القانونية</div>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
    <LabelVal label="🆔 الرقم الوطني" value={data.client?.nationalId} mono />
    <LabelVal label="🎂 الميلاد" value={fmtDate(data.buyerBirthDate || data.client?.birthDate)} mono />
    <LabelVal label="👩‍👦 الأم" value={data.buyerMotherName || data.client?.motherName} />
    <LabelVal label="📋 القيد" value={data.buyerNationalIdIssuedBy || data.client?.nationalIdIssuedBy} />
    <LabelVal label="📅 تاريخ الإصدار" value={fmtDate(data.buyerNationalIdIssueDate || data.client?.nationalIdIssueDate)} mono />
    <LabelVal label="📦 الخانة" value={data.buyerNationalIdBox || data.client?.nationalIdBox} mono />
  </div>
</div>
```

### الجزء د: الملكية
```tsx
{data.ownershipDisplay && (
  <>
    <Divider />
    <div className="flex items-center justify-between text-sm flex-wrap gap-2">
      <LabelVal label="المسؤول" value={data.ownershipDisplay} />
    </div>
  </>
)}
```

### الجزء هـ: الوسطاء (Referrers)
```tsx
{data.client?.referrersCount > 0 && (
  <>
    <Divider />
    <div>
      <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">🤝 الوسطاء</div>
      <div className="text-sm text-slate-700 mb-2">
        الوسطاء: <span className="font-mono font-bold">{data.client.referrersCount}</span>
      </div>
      {data.client.referrers?.length > 0 && (
        <div className="space-y-1.5">
          {data.client.referrers.map((ref: any, i: number) => (
            <div key={ref.id ?? i} className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">├─</span>
              <span className="text-slate-700">{ref.name}</span>
              <span className="text-xs text-slate-400">({ref.type === 'client' ? 'زبون' : ref.type === 'employee' ? 'موظف' : ref.type})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  </>
)}
```

---

## المجموعة 3: الجهاز والصيانة

```tsx
<Card>
  <CardTitle>🖥️ الجهاز والصيانة</CardTitle>
  <div className="space-y-3">
    {data.deviceModelName && (
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">الموديل:</span>
        <span className="text-sm font-bold text-slate-800">{data.deviceModelName}</span>
      </div>
    )}
    {data.code && (
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">الرمز:</span>
        <span className="text-sm font-mono text-slate-700">{data.code}</span>
      </div>
    )}
    {data.serialNumber && (
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">الرقم التسلسلي:</span>
        <span className="text-sm font-mono text-slate-700">{data.serialNumber}</span>
      </div>
    )}
    {(data.maintenancePlan || data.deviceStatus) && <div className="h-px bg-gray-100"></div>}
    <div className="grid grid-cols-2 gap-3">
      {data.maintenancePlan && (
        <div>
          <span className="text-xs text-slate-400 block mb-1">خطة الصيانة</span>
          <span className="text-sm text-slate-700">{data.maintenancePlan}</span>
        </div>
      )}
      {data.deviceStatus && (
        <div>
          <span className="text-xs text-slate-400 block mb-1">حالة الجهاز</span>
          <DeviceStatusBadge status={data.deviceStatus} />
        </div>
      )}
    </div>
  </div>
</Card>
```

---

## المجموعة 4: الملخص المالي

```tsx
{!isMaintenance && !isFree && (
  <Card>
    <CardTitle>💰 الملخص المالي</CardTitle>
    
    {/* Sale info */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
      {data.saleType && <LabelVal label="نوع البيع" value={data.saleType} />}
      {data.saleSubtype && <LabelVal label="الفئة" value={saleSubtypeLabel(data.saleSubtype)} />}
      {data.saleReferenceNumber && <LabelVal label="المرجع" value={data.saleReferenceNumber} mono />}
    </div>
    
    <Divider />
    
    {/* Price breakdown */}
    <div className="space-y-2">
      {data.basePrice && (
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">السعر الأساسي</span>
          <span className={`font-mono ${data.finalPrice && data.finalPrice < data.basePrice ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
            {fmtMoney(data.basePrice)}
          </span>
        </div>
      )}
      {data.discount && data.discount.amount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">الخصم ({data.discount.percentage}%)</span>
          <span className="font-mono text-red-600">-{fmtMoney(data.discount.amount)}</span>
        </div>
      )}
      <div className="h-px bg-gray-200 my-2"></div>
      <div className="flex justify-between">
        <span className="text-slate-800 font-bold">السعر النهائي</span>
        <span className="font-mono text-slate-800 font-black text-lg">{fmtMoney(data.finalPrice)}</span>
      </div>
    </div>
    
    <Divider />
    
    {/* Payment */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
      <LabelVal label="طريقة الدفع" value={data.paymentType === 'cash' ? 'نقدي' : data.paymentType === 'installment' ? 'أقساط' : data.paymentType} />
      {data.downPayment > 0 && <LabelVal label="الدفعة الأولى" value={fmtMoney(data.downPayment)} mono />}
      {data.paymentType === 'installment' && data.installmentsCount > 0 && (
        <LabelVal label="الأقساط" value={`${data.installmentsCount} × ${fmtMoney(Math.round((data.finalPrice - (data.downPayment || 0)) / data.installmentsCount))}`} mono />
      )}
    </div>
    
    <Divider />
    
    {/* Totals */}
    <div className="flex justify-between items-center text-sm">
      <div className="flex gap-6">
        <LabelVal label="المدفوع" value={fmtMoney(totalPaid)} valueCls="text-emerald-700 font-bold" mono />
        <LabelVal label="المتبقي" value={fmtMoney(remaining)} valueCls={remaining > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'} mono />
      </div>
      {data.receiptNumber && <LabelVal label="رقم الإيصال" value={data.receiptNumber} mono />}
    </div>
  </Card>
)}
```

**دوال helpers:**
```typescript
function saleSubtypeLabel(subtype: string) {
  const map: Record<string, string> = {
    definitive: 'عقد قطعي',
    temporary: 'عقد مؤقت',
    free: 'عقد مجاني',
  };
  return map[subtype] ?? subtype;
}
```

---

## المجموعة 5: التسليم والتركيب

> **ملاحظة:** تاريخ التسليم المتوقع (`deliveryDate`) وتاريخ التركيب المتوقع (`installationDate`) يُضافان ضمن مودل إنشاء العقد عند اختيار نوع العقد "عقد بيع".

```tsx
<Card>
  <CardTitle>📍 التسليم والتركيب</CardTitle>
  <div className="grid grid-cols-2 gap-4 mb-4">
    <LabelVal label="📅 تاريخ التسليم المتوقع" value={fmtDate(data.deliveryDate)} mono />
    <LabelVal label="🔧 تاريخ التركيب المتوقع" value={fmtDate(data.installationDate)} mono />
  </div>
  
  {(data.installationGeoPath?.length > 0 || data.installationAddressText || data.installationLat) && (
    <>
      <Divider />
      <div>
        <div className="text-xs text-slate-400 block mb-1">📍 عنوان التركيب</div>
        {data.installationGeoPath?.length > 0 && (
          <div className="text-sm text-slate-700">{data.installationGeoPath.join(' → ')}</div>
        )}
        {data.installationAddressText && (
          <div className="text-sm text-slate-500 mt-0.5">{data.installationAddressText}</div>
        )}
        {data.installationLat && data.installationLng && (
          <a href={`https://maps.google.com/?q=${data.installationLat},${data.installationLng}`}
            target="_blank" className="mt-2 text-xs text-sky-600 font-medium">🗺️ عرض على الخريطة</a>
        )}
      </div>
    </>
  )}
</Card>
```

---

## المجموعة 6: مصدر العقد وإغلاقه

```tsx
{(data.sourceVisit || data.sourceOpenTaskId || data.sourceTaskOfferId || data.closingEmployeeName || data.closingDate) && (
  <Card>
    <CardTitle>🔗 مصدر العقد وإغلاقه</CardTitle>
    <div className="space-y-2 mb-4">
      {data.sourceVisit && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">📌 مصدر الزيارة:</span>
          <button onClick={() => navigate(`/field-visits/${data.sourceVisit}`)} className="text-sky-600 font-mono hover:underline">#{data.sourceVisit}</button>
        </div>
      )}
      {data.sourceOpenTaskId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">📋 المهمة المفتوحة:</span>
          <button onClick={() => navigate(`/tasks/open`)} className="text-sky-600 font-mono hover:underline">#{data.sourceOpenTaskId}</button>
        </div>
      )}
      {data.sourceTaskOfferId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">💼 عرض المهمة:</span>
          <span className="text-sky-600 font-mono">#{data.sourceTaskOfferId}</span>
        </div>
      )}
    </div>
    {(data.closingEmployeeName || data.closingDate || data.noClosingReasonName) && (
      <>
        <Divider />
        <div className="grid grid-cols-2 gap-4 text-sm">
          {data.closingEmployeeName && <LabelVal label="👤 موظف الإغلاق" value={data.closingEmployeeName} />}
          {data.closingDate && <LabelVal label="📅 تاريخ الإغلاق" value={fmtDate(data.closingDate)} mono />}
          {!data.closingEmployeeName && data.noClosingReasonName && (
            <div>
              <span className="text-xs text-slate-400 block mb-1">سبب عدم الإغلاق</span>
              <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-bold">{data.noClosingReasonName}</span>
            </div>
          )}
        </div>
      </>
    )}
  </Card>
)}
```

---

## المجموعة 7: بنود العقد (Line Items)

```tsx
{data.lineItems?.length > 0 && (
  <Card className="!p-0 overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-100">
      <span className="text-base font-bold text-slate-800">📦 بنود العقد ({data.lineItems.length})</span>
    </div>
    <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
      style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
      <span>#</span><span>البيان</span><span>الكمية</span><span>سعر الوحدة</span><span>الإجمالي</span>
    </div>
    {data.lineItems.map((item: any, i: number) => (
      <div key={item.id ?? i} className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
        style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
        <span className="font-mono text-xs text-slate-400">{i + 1}</span>
        <span className="text-slate-700">{item.description ?? '—'}</span>
        <span className="text-slate-600">{item.quantity}</span>
        <span className="font-mono text-slate-600">{fmtMoney(item.unitPrice)}</span>
        <span className="font-mono font-bold text-slate-800">{fmtMoney(item.totalPrice)}</span>
      </div>
    ))}
    <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
      style={{ gridTemplateColumns: '2rem 2fr 4rem 1fr 1fr' }}>
      <span></span><span>المجموع</span><span></span><span></span>
      <span className="font-mono text-slate-800">
        {fmtMoney(data.lineItems.reduce((s: number, i: any) => s + Number(i.totalPrice), 0))}
      </span>
    </div>
  </Card>
)}
```

---

## المجموعة 8: دفعات العقد (Payment Entries)

```tsx
<Card className="!p-0 overflow-hidden">
  <div className="px-5 py-4 border-b border-gray-100">
    <span className="text-base font-bold text-slate-800">💳 دفعات العقد ({data.paymentEntries?.length ?? 0})</span>
  </div>
  {data.paymentEntries?.length === 0 ? (
    <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد دفعات مسجلة</div>
  ) : (
    <>
      <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
        style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
        <span>#</span><span>الطريقة</span><span>العملة</span><span>المبلغ</span><span>المكافئ ل.س</span><span>مرجع</span>
      </div>
      {data.paymentEntries.map((e: any, i: number) => (
        <div key={e.id ?? i} className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
          style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
          <span className="font-mono text-xs text-slate-400">{i + 1}</span>
          <span className="text-slate-700">{e.method}</span>
          <span className="text-slate-500">{e.currency}</span>
          <span className="font-mono text-slate-700">{e.amountValue} {e.currency === 'USD' ? '$' : 'ل.س'}</span>
          <span className="font-mono font-bold text-slate-800">{fmtMoney(e.amountSyp)}</span>
          <span className="font-mono text-slate-400 text-xs">{e.referenceNumber ?? '—'}</span>
        </div>
      ))}
      <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
        style={{ gridTemplateColumns: '2rem 1fr 4rem 1fr 1fr 5rem' }}>
        <span></span><span>المجموع</span><span></span><span></span>
        <span className="font-mono text-emerald-700">{fmtMoney(data.paymentEntries.reduce((s: number, e: any) => s + Number(e.amountSyp), 0))}</span>
        <span></span>
      </div>
    </>
  )}
</Card>
```

---

## المجموعة 9: جدول الأقساط (Installments)

```tsx
{data.paymentType === 'installment' && (
  <Card className="!p-0 overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-100">
      <span className="text-base font-bold text-slate-800">📆 جدول الأقساط ({data.installments?.length ?? 0})</span>
    </div>
    {data.installments?.length === 0 ? (
      <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد أقساط مسجلة</div>
    ) : (
      <>
        <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
          style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 5rem' }}>
          <span>#</span><span>تاريخ الاستحقاق</span><span>المبلغ</span><span>المدفوع</span><span>المتبقي</span><span>الحالة</span>
        </div>
        {data.installments.map((inst: any, i: number) => {
          const isOverdue = inst.status === 'pending' && inst.dueDate && new Date(inst.dueDate) < new Date();
          const statusMap: Record<string, { cls: string; label: string }> = {
            pending: { cls: 'bg-amber-100 text-amber-700', label: 'معلق' },
            paid: { cls: 'bg-emerald-100 text-emerald-700', label: 'مدفوع' },
            partial: { cls: 'bg-blue-100 text-blue-700', label: 'جزئي' },
            overdue: { cls: 'bg-red-100 text-red-700', label: 'متأخر' },
          };
          const sm = statusMap[isOverdue ? 'overdue' : inst.status] ?? statusMap.pending;
          return (
            <div key={inst.id ?? i} className={`grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center ${isOverdue ? 'bg-red-50/30' : ''}`}
              style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 1fr 5rem' }}>
              <span className="font-mono text-xs text-slate-400">{inst.installmentNumber}</span>
              <span className="font-mono text-slate-600">{fmtDate(inst.dueDate)}</span>
              <span className="font-mono font-bold text-slate-800">{fmtMoney(inst.amountSyp)}</span>
              <span className="font-mono text-emerald-700">{fmtMoney(inst.paidAmount)}</span>
              <span className="font-mono text-amber-700">{fmtMoney(inst.remainingBalance)}</span>
              <span><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sm.cls}`}>{sm.label}</span></span>
            </div>
          );
        })}
      </>
    )}
  </Card>
)}
```

---

## المجموعة 10: الذمم المالية (Dues)

```tsx
{data.dues?.length > 0 && (
  <Card className="!p-0 overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-100">
      <span className="text-base font-bold text-slate-800">💰 الذمم المالية ({data.dues.length})</span>
    </div>
    <div className="grid gap-x-3 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400"
      style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
      <span>#</span><span>تاريخ الاستحقاق</span><span>المبلغ الأصلي</span><span>المتبقي</span><span>الحالة</span>
    </div>
    {data.dues.map((due: any, i: number) => {
      const dueStatus: Record<string, { cls: string; label: string }> = {
        Pending: { cls: 'bg-amber-100 text-amber-700', label: 'معلق' },
        Partial: { cls: 'bg-blue-100 text-blue-700', label: 'جزئي' },
        Paid: { cls: 'bg-emerald-100 text-emerald-700', label: 'مدفوع' },
        Overdue: { cls: 'bg-red-100 text-red-700', label: 'متأخر' },
      };
      const ds = dueStatus[due.status] ?? { cls: 'bg-slate-100 text-slate-500', label: due.status };
      return (
        <div key={due.id ?? i} className="grid gap-x-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50/60 text-sm items-center"
          style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
          <span className="font-mono text-xs text-slate-400">{i + 1}</span>
          <span className="font-mono text-slate-600">{fmtDate(due.adjustedDate ?? due.scheduledDate)}</span>
          <span className="font-mono font-bold text-slate-800">{fmtMoney(due.originalAmount)}</span>
          <span className="font-mono text-amber-700">{fmtMoney(due.remainingBalance)}</span>
          <span><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${ds.cls}`}>{ds.label}</span></span>
        </div>
      );
    })}
    <div className="grid gap-x-3 px-5 py-3 bg-slate-50 text-xs font-bold text-slate-500"
      style={{ gridTemplateColumns: '2rem 1fr 1fr 1fr 5rem' }}>
      <span></span><span>إجمالي المتبقي</span><span></span>
      <span className="font-mono text-amber-700">{fmtMoney(data.dues.reduce((s: number, d: any) => s + Number(d.remainingBalance), 0))}</span>
      <span></span>
    </div>
  </Card>
)}
```

---

## المجموعة 11: المهام المرتبطة (Tasks)

```tsx
<Card className="!p-0 overflow-hidden">
  <div className="px-5 py-4 border-b border-gray-100">
    <span className="text-base font-bold text-slate-800">📋 المهام المرتبطة ({data.tasks?.length ?? 0})</span>
  </div>
  {data.tasks?.length === 0 ? (
    <div className="px-5 py-8 text-center text-sm text-slate-400">لا توجد مهام مرتبطة بهذا العقد</div>
  ) : (
    <div className="divide-y divide-slate-100">
      {data.tasks.map((t: any) => {
        const taskStatusMap: Record<string, { cls: string; label: string }> = {
          open: { cls: 'bg-sky-100 text-sky-700', label: 'مفتوحة' },
          assigned: { cls: 'bg-violet-100 text-violet-700', label: 'مسندة' },
          in_scheduling: { cls: 'bg-indigo-100 text-indigo-700', label: 'قيد الجدولة' },
          scheduled: { cls: 'bg-teal-100 text-teal-700', label: 'مجدولة' },
          in_execution: { cls: 'bg-amber-100 text-amber-700', label: 'قيد التنفيذ' },
          completed: { cls: 'bg-emerald-100 text-emerald-700', label: 'مكتملة' },
          closed: { cls: 'bg-slate-100 text-slate-600', label: 'مغلقة' },
          cancelled: { cls: 'bg-red-100 text-red-600', label: 'ملغاة' },
        };
        const ts = taskStatusMap[t.status] ?? { cls: 'bg-slate-100 text-slate-500', label: t.status };
        const isEmergency = t.taskFamily === 'emergency' || t.taskType === 'emergency_maintenance';
        const path = isEmergency ? `/tasks/emergency/${t.id}` : `/tasks/${t.taskType}/${t.id}`;
        return (
          <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50/60">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isEmergency ? 'bg-rose-100 text-rose-500' : 'bg-sky-100 text-sky-500'}`}>
                {isEmergency ? '⚡' : '🔧'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{t.taskLabel ?? t.taskType}</p>
                {t.dueDate && <p className="text-xs text-slate-400 font-mono">{fmtDate(t.dueDate)}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${ts.cls}`}>{ts.label}</span>
              <button onClick={() => navigate(path)} className="text-xs text-sky-600 hover:underline font-mono">#{t.id}</button>
            </div>
          </div>
        );
      })}
    </div>
  )}
</Card>
```

---

## المجموعة 12: ملاحظات الفاتورة

```tsx
{data.invoiceNotes && (
  <Card>
    <CardTitle>📝 ملاحظات الفاتورة</CardTitle>
    <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700 min-h-[3rem] whitespace-pre-line">
      {data.invoiceNotes}
    </div>
  </Card>
)}
```

---

## ⚠️ ملاحظات تنفيذية

### `createdBy` — غير موجود حالياً
حقل `created_by` **مش موجود** بجدول `contracts`. الموجود بس `created_at`.

**الحل:** إضافة `ALTER TABLE contracts ADD COLUMN created_by INTEGER REFERENCES hr_users(id);` + backfill

### تواريخ التسليم والتركيب (`deliveryDate`, `installationDate`)
هذول بيجوا من `contracts` مباشرة. **يجب إضافتهما لمودل إنشاء العقد** عند اختيار نوع العقد "عقد بيع".

### لا أمثلة وهمية
كل حقل لازم يجي من `data.*` أو `data.client.*`. لا تكتب "أحمد محمد علي" ولا "0991234567" — هدول أمثلة من البرومptz القديم.

---

## 🧪 Visual QA

- [ ] كل card بـ `bg-white rounded-2xl shadow-sm border border-gray-100 p-5`
- [ ] Western numerals فقط
- [ ] التواريخ YYYY-MM-DD
- [ ] لا `<table>` HTML — `div` + `grid` فقط
- [ ] Responsive (mobile → tablet → desktop)
- [ ] لا overflow أفقي
- [ ] كل البيانات من `data.*`
