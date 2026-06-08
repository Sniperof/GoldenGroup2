# برومبت إصلاح تصميم صفحة تفاصيل الزيارة

> **النطاق:** `VisitDetailPage.tsx` + `ClientInfoCard.tsx` فقط  
> **الباك ايند جاهز:** لا تلمس أي ملف باك ايند  
> **اللغة:** عربية موحدة — لا خليط لغات

---

## قائمة الإصلاحات (بالترتيب)

---

### ١) الأرقام الغربية (Western Numerals)

**في كل مكان بالصفحة:** التواريخ، الأوقات، الأرقام، العدادات، المبالغ — الكل لازم يكون أرقام غربية (1, 2, 3) لا هندية (١، ٢، ٣).

**الحل:**
```typescript
// بدل
new Date(ts).toLocaleDateString('ar-SY')

// استخدم
new Date(ts).toLocaleDateString('ar-SY', { numberingSystem: 'latn' })

// أو للوقت
new Date(ts).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' })
```

أو احسب التاريخ يدوياً:
```typescript
function formatDateWestern(ts: string) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // أو بالعربي: يوم شهر سنة
}
```

> **قاعدة صارمة:** أي `toLocaleString` أو `toLocaleDateString` أو `toLocaleTimeString` لازم يكون فيه `numberingSystem: 'latn'`.

---

### ٢) الهيدر (Header) — مستطيل واضح بالأول

**أعلى الصفحة (بعد شريط العنوان اللزق) لازم يكون فيه مستطيل واضح بيحتوي على:**

```
┌─────────────────────────────────────────────────────────────┐
│  محطة العمل: [اسم المحطة]          الموعد: [الوقت المتوقع]  │
│                                                             │
│  التاريخ: [تاريخ التنفيذ]                                   │
└─────────────────────────────────────────────────────────────┘
```

**التفاصيل:**
- مستطيل بسيط بـ `bg-white` + `border` + `rounded-xl` + `p-4`
- يظهر بشكل بارز تحت الـ Header مباشرة
- "محطة العمل" على اليمين → `visit.station?.name`
- "الموعد" على اليسار → `appointmentInfo?.scheduledTime`
- "التاريخ" تحتهن → `appointmentInfo?.scheduledDate` (بصيغة يوم/شهر/سنة بأرقام غربية)
- إذا أي قيمة فاضية → ما تظهر السطر

---

### ٣) قسم معلومات الموعد

**يحتوي على (بـ InfoRow):**
- تاريخ التنفيذ
- الموعد المتوقع للوصول
- من ردّ على الاتصال
- تاريخ حجز الموعد
- وقت حجز الموعد
- اسم التيليماركتر
- ملاحظات التيليماركتر
- مصدر المياه

> **ملاحظة:** مصدر المياه **هون فقط** — احذفها من قسم "بيانات الزبون".

---

### ٤) قسم بيانات الزبون (ClientInfoCard)

**تعديلات على `ClientInfoCard.tsx`:**

#### أ) احذف "مصدر المياه" من ClientInfoCard
السطر اللي بيعرض `waterSource` — احذفه بالكامل من `ClientInfoCard.tsx`. مصدر المياه بس بقسم "معلومات الموعد".

#### ب) المهنة ومهنة الزوج/الزوجة
- `occupation` — لازم تظهر. إذا فاضي بالـ DB → اعرض "غير محدد"
- `spouseOccupation` — لازم تظهر. إذا فاضي → اعرض "غير محدد"
- لا تخفي الـ InfoRow إذا القيمة null — اعرض "غير محدد" بدلاً من الإخفاء

#### ج) العنوان — إعادة تصميم
**العنوان لازم يظهر بشكل واضح ومترابط:**

```
📍 عنوان الزبون:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
دمشق ← المنطقة ← الناحية ← الحي
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
العنوان التفصيلي: شارع الثورة - بجانب المدرسة
📍 [عرض على الخريطة]
```

**التنفيذ:**
- اعرض الـ ٤ مستويات (محافظة → منطقة → ناحية → حي) بسطر واحد مفصول بـ " ← "
- **العنوان التفصيلي** لازم يكون بارز وواضح — مش مخفي بـ InfoRow صغير
- رابط الخريطة تحت العنوان التفصيلي
- إذا `neighborhood` null → اعرض بس المحافظة + المنطقة + الناحية

**هيكل العنوان المطلوب:**
```tsx
<div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
  <div className="flex items-center gap-2 mb-2">
    <MapPin className="w-4 h-4 text-slate-400" />
    <span className="text-xs font-bold text-slate-500">عنوان الزبون</span>
  </div>
  
  {/* Hierarchy */}
  <p className="text-sm font-bold text-slate-800 mb-2">
    {[addr?.governorate, addr?.district, addr?.subDistrict, addr?.neighborhood]
      .filter(Boolean).join(' ← ')}
  </p>
  
  {/* Detailed address */}
  {addr?.detailedAddress && (
    <p className="text-sm text-slate-600 mb-2">
      {addr.detailedAddress}
    </p>
  )}
  
  {/* Map link */}
  {gpsLink && (
    <a href={gpsLink} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-sky-600 font-semibold">
      <MapPin className="w-3.5 h-3.5" />
      عرض على الخريطة
    </a>
  )}
</div>
```

#### د) الوسيط (Referrers)
- الوسطاء **موجودين بـ ClientInfoCard** بس ممكن البيانات مش جاية من الـ API
- تأكد إن الـ component بيعرضن إذا `referrers.length > 0`
- **إذا فاضية** → اعرض "لا يوجد وسطاء مسجّلين" (ما تخفي القسم بالكامل)

#### ه) التقييم
- `Committed` → **زبون ملتزم** (أخضر)
- `NotCommitted` → **زبون غير ملتزم** (أحمر)
- `Undefined` أو null → **غير محدد** (رمادي)

---

### ٥) قسم الفريق المسؤول — بطاقات أفقية صغيرة

**بدل InfoRow (عنوان/قيمة) → بطاقات أفقية:**

```
┌────────────┐ ┌────────────┐ ┌────────────┐
│  👤        │ │  🔧        │ │  🎓        │
│  المشرف    │ │  الفني     │ │  المتدرّب  │
│  أحمد سالم │ │  خالد عودة│ │  —         │
└────────────┘ └────────────┘ └────────────┘
```

**التنفيذ:**
```tsx
<div className="grid grid-cols-3 gap-3">
  {['supervisor', 'technician', 'trainee'].map((role) => {
    const member = teamData.effective?.[role];
    const labels = { supervisor: 'المشرف', technician: 'الفني', trainee: 'المتدرّب' };
    return (
      <div key={role} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
        <p className="text-xs text-slate-400 font-medium mb-1">{labels[role]}</p>
        <p className="text-sm font-bold text-slate-800">
          {member?.name ?? '—'}
        </p>
      </div>
    );
  })}
</div>
```

**الفريق الرديف:**
إذا `teamData.reassigned` موجود → نظهر قسم فرعي بنفس التصميم (بطاقات أفقية) بعنوان "الفريق الرديف (الأصلي)" + تاريخ التغيير + من قام بالتغيير.

**زر تغيير الفريق:**
- فوق البطاقات (أو بجانب عنوان القسم)
- يظهر بس إذا `visit.status === 'scheduled'`
- لونه `indigo-600` بس بسيط

---

### ٦) قسم لائحة أسماء الزبون — تصميم بسيط

**بدل القسم الحالي المزوّق:**

```
┌──────────────────────────────────────────┐
│  👤 لائحة أسماء الزبون              [+]   │
├──────────────────────────────────────────┤
│  عدد الأسماء المقترحة: 5                  │
│  عدد اللوائح: 2                           │
└──────────────────────────────────────────┘
```

**التنفيذ:**
- بطاقة بسيطة — بيضاء + border
- عدد الأسماء بخط عريض
- زر "إضافة" صغير (أيقونة +) — بدل الزر الكبير المزوّق
- **لا progress bars**
- **لا ألوان متعددة**
- **لا أسماء أفراد** — بس العدد

---

### ٧) قسم مهام الزيارة — إزالة "إضافة اقتراح مباشر"

**حذف `DirectSuggestionForm` من قسم المهام بالكامل.**

السطر اللي بيستدعي `<DirectSuggestionForm ... />` ضمن loop المهام — **احذفه**.

**القسم لازم يبقى:**
- اسم المهمة
- العقد المرتبط (رقم + جهاز)
- حالة المهمة (badge)
- النتيجة (إذا موجودة)
- زر "تسجيل نتيجة" (إذا canRecord)
- مهمة التوصيل (name collection) — احتفظ فيها

> **لا إضافة اقتراحات مباشرة ضمن مهام الزيارة.**

---

### ٨) قسم محصلة الزيارة

**تصميم بسيط وواضح:**
- حالة الزيارة بـ badge ملوّن
- أوقات البدء والانتهاء بـ `font-mono` + أرقام غربية
- المدة بصياغة واضحة (ساعات ودقائق)
- مواقع GPS بروابط خريطة
- سبب الإلغاء (إذا موجود)
- ملاحظات الميدان (إذا موجودة)

---

## ملخص الملفات للتعديل

| الملف | التعديل |
|-------|---------|
| `packages/web/src/pages/visits/VisitDetailPage.tsx` | إعادة تصميم الأقسام (هيدر، فريق، أسماء، مهام) + أرقام غربية + حذف DirectSuggestionForm |
| `packages/web/src/components/ClientInfoCard.tsx` | حذف مصدر المياه + إعادة تصميم العنوان + بطاقات أفقية + مهنة الزبون/الزوج دائماً ظاهرة + الوسيط |

---

## قواعد صارمة

1. **أرقام غربية فقط** — أي تاريخ أو وقت أو رقم
2. **لا تحذف** `NameCollectionModal` — احتفظ فيه
3. **لا تحذف** modals النتائج (ChangeTeam, GeneralTaskResult, DemoResult, AddReferralSheet)
4. **لا تلمس** الباك ايند
5. **بعد التعديل** شغّل `pnpm --filter @golden-crm/web build` وتأكد ما فيه errors
