# PROMPT: تحسين تاب "الشبكة" (NetworkTab) بـ ClientProfile

> **الهدف:** تحسين تاب "الشبكة" ليصبح مصدرًا موثوقًا لكل معلومات الارتباط — وسطاء + أسماء مقترحة — بجداول واضحة.
> **القاعدة:** كل بيانات من `data.*` أو `client.*`. لا hardcoded values. Western numerals فقط.

---

## 📁 الملف المطلوب التعديل

```
packages/web/src/pages/ClientProfile.tsx
```

---

## 🔴 الوضع الحالي (المشاكل)

تاب `NetworkTab` الحالي (سطر ~818-908):

### القسم 1: "وسطاء الزبون"
- يستخدم `client.sourceChannel` + `client.referrerName` (legacy)
- بيعرض **كارت واحد بس** — لا جدول
- لا يستخدم `client.referrers` (JSONB)

### القسم 2: "الترشيحات الصادرة"
- يبحث بـ `clients.filter(c => c.referralEntityId === client.id)`
- يبحث بـ `candidates.filter(c => c.referralEntityId === client.id)`
- جدول فاضي حالياً لأن `referralEntityId` مش معبّى

---

## ✅ الوضع المطلوب (الجديد)

### القسم 1: "وسطاء الزبون" (Incoming Referrals)

جدول بعرض **كل الوسطاء** يلي ارتبطوا بالزبون الحالي.

| العمود | المصدر |
|--------|--------|
| # | index + 1 |
| اسم الوسيط | `referrer.name` |
| النوع | `referrer.type` → مترجم |
| تاريخ الاقتراح | `client.createdAt` (أول تاريخ معروف) |

**منطق البيانات:**
```typescript
const incomingReferrals = client.referrers ?? [];
// Fallback: إذا فاضي، استخدم referrerName legacy كـ صف واحد
if (incomingReferrals.length === 0 && client.referrerName && client.referrerName !== 'مجهول') {
  incomingReferrals = [{ name: client.referrerName, type: client.referrerType || 'unknown' }];
}
```

### القسم 2: "الأسماء المقترحة" (Outgoing Referrals)

جدول بعرض **كل الأسماء** يلي الزبون الحالي اقترحها.

| العمود | المصدر |
|--------|--------|
| # | index + 1 |
| الاسم | `ref.name` أو `ref.firstName + ref.lastName` |
| الرقم | `ref.mobile` أو primary contact |
| الحالة | computed |

**منطق البيانات:**
```typescript
// من جدول clients (زبائن تحوّلوا من referral)
const clientReferrals = clients.filter(c => c.referralEntityId === client.id);
// من جدول candidates (مرشحين)
const candidateReferrals = candidates.filter(c => c.referralEntityId === client.id);
const allOutgoing = [...clientReferrals, ...candidateReferrals];
```

**حالات الترشيح:**
- إذا `converted_to_lead_id` موجود → "تحوّل لزبون" (أخضر)
- إذا `status === 'Suggested'` → "مقترح" (رمادي)
- إذا `status === 'FollowUp'` → "قيد المتابعة" (أصفر)
- إذا `status === 'Contacted'` → "تم التواصل" (أزرق)
- إذا `status === 'Qualified'` → "مؤهل" (أزرق فاتح)
- إذا `status === 'Junk'` → "رفض" (أحمر)

---

## 🎨 التصميم المطلوب

```tsx
<div className="space-y-10 max-w-5xl">

  {/* ══ القسم 1: وسطاء الزبون ═══════════════════════════════════════════ */}
  <section>
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <Share2 className="w-5 h-5 text-indigo-500" />
      </div>
      <div>
        <h3 className="text-lg font-black text-slate-800">وسطاء الزبون</h3>
        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الوسطاء: {incomingReferrals.length}</p>
      </div>
    </div>

    <Card className="overflow-hidden">
      {incomingReferrals.length > 0 ? (
        <>
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-gray-100 text-xs font-black text-slate-500">
            <span className="col-span-1">#</span>
            <span className="col-span-5">اسم الوسيط</span>
            <span className="col-span-3">النوع</span>
            <span className="col-span-3">تاريخ الاقتراح</span>
          </div>
          {/* Rows */}
          {incomingReferrals.map((ref, i) => (
            <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-50 hover:bg-slate-50/50 items-center text-sm">
              <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
              <span className="col-span-5 font-bold text-slate-800">{ref.name}</span>
              <span className="col-span-3">
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${typeBadgeClass(ref.type)}`}>
                  {referrerTypeLabel(ref.type)}
                </span>
              </span>
              <span className="col-span-3 font-mono text-xs text-slate-500">{fmtDate(client.createdAt)}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="px-6 py-12 text-center">
          <Share2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-bold">لا يوجد وسطاء مسجّلين لهذا الزبون.</p>
        </div>
      )}
    </Card>
  </section>

  {/* ══ القسم 2: الأسماء المقترحة ═══════════════════════════════════════ */}
  <section>
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
        <Users className="w-5 h-5 text-emerald-500" />
      </div>
      <div>
        <h3 className="text-lg font-black text-slate-800">الأسماء المقترحة</h3>
        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الأسماء: {allOutgoing.length}</p>
      </div>
    </div>

    <Card className="overflow-hidden">
      {allOutgoing.length > 0 ? (
        <>
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-gray-100 text-xs font-black text-slate-500">
            <span className="col-span-1">#</span>
            <span className="col-span-4">الاسم</span>
            <span className="col-span-3">الرقم</span>
            <span className="col-span-4">الحالة</span>
          </div>
          {/* Rows */}
          {allOutgoing.map((ref, i) => (
            <div key={ref.id ?? i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-50 hover:bg-slate-50/50 items-center text-sm">
              <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
              <span className="col-span-4 font-bold text-slate-800">
                {ref.name || `${ref.firstName || ''} ${ref.lastName || ''}`.trim()}
              </span>
              <span className="col-span-3 font-mono text-slate-500" dir="ltr">
                {ref.mobile || ref.contacts?.find((c: any) => c.isPrimary)?.number || ref.contacts?.[0]?.number || '--'}
              </span>
              <span className="col-span-4">
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${outgoingStatusBadge(ref).cls}`}>
                  {outgoingStatusBadge(ref).label}
                </span>
              </span>
            </div>
          ))}
        </>
      ) : (
        <div className="px-6 py-12 text-center">
          <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-bold">لم يقم هذا الزبون بترشيح أي أشخاص حتى الآن.</p>
        </div>
      )}
    </Card>
  </section>

</div>
```

---

## 🧮 Helpers المطلوبة

```typescript
// ترجمة نوع الوسيط
function referrerTypeLabel(type: string): string {
  const map: Record<string, string> = {
    client: 'زبون',
    employee: 'موظف',
    personal: 'شخصي',
    customer: 'عميل',
    unknown: 'غير محدد',
  };
  return map[type?.toLowerCase()] ?? type ?? 'غير محدد';
}

// لون badge حسب نوع الوسيط
function typeBadgeClass(type: string): string {
  const map: Record<string, string> = {
    client: 'bg-sky-100 text-sky-700',
    employee: 'bg-violet-100 text-violet-700',
    personal: 'bg-amber-100 text-amber-700',
    customer: 'bg-emerald-100 text-emerald-700',
    unknown: 'bg-slate-100 text-slate-500',
  };
  return map[type?.toLowerCase()] ?? 'bg-slate-100 text-slate-500';
}

// حالة الترشيح الصادر
function outgoingStatusBadge(ref: any): { cls: string; label: string } {
  if (ref.convertedToLeadId || ref.isCandidate === false) {
    return { cls: 'bg-emerald-100 text-emerald-700', label: 'تحوّل لزبون' };
  }
  const statusMap: Record<string, { cls: string; label: string }> = {
    Suggested: { cls: 'bg-slate-100 text-slate-600', label: 'مقترح' },
    FollowUp: { cls: 'bg-amber-100 text-amber-700', label: 'قيد المتابعة' },
    Contacted: { cls: 'bg-sky-100 text-sky-700', label: 'تم التواصل' },
    Qualified: { cls: 'bg-blue-100 text-blue-700', label: 'مؤهل' },
    Junk: { cls: 'bg-red-100 text-red-700', label: 'رفض' },
    New: { cls: 'bg-slate-100 text-slate-600', label: 'جديد' },
  };
  return statusMap[ref.status] ?? { cls: 'bg-slate-100 text-slate-500', label: ref.status ?? 'غير محدد' };
}
```

---

## ⚠️ ملاحظات تنفيذية

1. **لا تعدل على `contracts.ts`** — هاد frontend فقط.
2. **لا تعدل على `ClientProfile.tsx` كامل** — فقط `NetworkTab` function (استبدلها بالكامل).
3. **تأكد من `client.referrers`** موجود بالـ Client type — إذا مش موجود، أضفه:
   ```typescript
   referrers?: Array<{ id?: number; name: string; type: string }>;
   ```
4. **الـ fallback** لـ `referrerName` legacy ضروري لحد ما migration 184 يشتغل.
5. **Western numerals فقط** — لا أرقام عربية-هندية.
6. **التواريخ** YYYY-MM-DD.

---

## 🧪 فحص بعد التنفيذ

بعد التنفيذ، افتح بروفايل الزبون "عماد الحجي" (ID 23):

**المتوقع:**
- ✅ قسم "وسطاء الزبون" يظهر جدول — اسم الوسيط "سعيد العمراني"، نوع "زبون"
- ✅ قسم "الأسماء المقترحة" يظهر جدول — أو رسالة "لم يقم..." إذا فاضي

**التحقق من DB:**
```sql
SELECT id, name, referrers FROM clients WHERE id = 23;
-- Expected: [{"id": 18, "name": "سعيد العمراني", "type": "client"}]
```

---

## 📋 ملخّص التغييرات

| # | التعديل |
|---|---------|
| استبدال `NetworkTab` بالكامل | جداول واضحة لوسطاء + أسماء مقترحة |
| إضافة helpers | `referrerTypeLabel`, `typeBadgeClass`, `outgoingStatusBadge` |
| fallback legacy | إذا `referrers` فاضي، استخدم `referrerName` |

> **تذكير:** `git commit` قبل التنفيذ!
