# PROMPT v2: تصميم صفحة تفاصيل العقد — HTML/Tailwind دقيق

> **⚠️ هذا البرومptz بديل عن v1. لا تستخدم v1 — استخدم هاد فقط.**

## القاعدة الذهبية
**انسخ الـ HTML/Tailwind بالظبط. لا تخترع. لا تبسّط. لا ترجّع لـ ASCII art.**

---

## 1️⃣ الإعدادات العامة

```tsx
// Wrapper للصفحة بالكامل
<div className="min-h-screen bg-slate-50 pb-20">
  
  // Navbar
  <div className="sticky top-0 z-50 bg-gradient-to-r from-sky-600 to-sky-500 shadow-md">
    <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <button className="text-white/80 hover:text-white text-sm">← رجوع</button>
      <h1 className="text-white font-bold text-lg">تفاصيل العقد</h1>
      <div className="w-8"></div>
    </div>
  </div>

  // Content
  <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
    
    // === GROUPS GO HERE ===
    
  </div>
</div>
```

**قواعد CSS صارمة:**
- كل card: `bg-white rounded-2xl shadow-sm border border-gray-100 p-5`
- العناوين داخل card: `text-base font-bold text-slate-800 mb-4`
- الخطوط العادية: `text-sm text-slate-600`
- الأرقام: `font-mono text-slate-700` — Western numerals فقط
- العنوان الرمادي (label): `text-xs font-medium text-slate-400`
- الفواصل: `<div className="h-px bg-gray-100 my-4"></div>`
- الـ badges: `px-2 py-0.5 rounded-full text-xs font-bold`

---

## 2️⃣ المجموعة 1: رأس العقد (Contract Header)

**الحقول:** `contract_number`, `contract_type`, `status`, `branch_id`, `contract_date`, `created_at`

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  // Top line: number
  <div className="text-sm font-mono text-sky-600 mb-2">#CNT-2026-0045</div>
  
  // Title + badges row
  <div className="flex items-center gap-3 flex-wrap mb-3">
    <h2 className="text-xl font-black text-slate-800">عقد بيع وتركيب — صافي</h2>
    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">نشط</span>
    <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">🏢 فرع دمشق</span>
  </div>
  
  // Divider
  <div className="h-px bg-gray-100 my-3"></div>
  
  // Dates row
  <div className="flex gap-6 text-sm text-slate-500">
    <div>
      <span className="text-slate-400 text-xs">تاريخ العقد:</span>
      <span className="font-mono text-slate-700 mr-1">2026-05-20</span>
    </div>
    <div>
      <span className="text-slate-400 text-xs">تاريخ الإنشاء:</span>
      <span className="font-mono text-slate-700 mr-1">2026-05-20 14:30</span>
    </div>
  </div>
</div>
```

**قواعد status badge:**
- `draft` → `bg-amber-100 text-amber-700`
- `active` → `bg-emerald-100 text-emerald-700`
- `completed` → `bg-blue-100 text-blue-700`
- `cancelled` → `bg-red-100 text-red-700`

---

## 3️⃣ المجموعة 2: هوية المشتري (CRITICAL — اقرأ هذا القسم 3 مرات)

**الهدف:** card واحدة بتدمج MiniClientSnapshot + Standard ClientSnapshot + Legal Identity.

### الجزء أ: MiniSnapshot Header (الأهم)

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  
  // === MINISNAPSHOT HEADER ===
  // هذا الجزء يجب أن يظهر في سطر واحد على Mobile أيضاً
  <div className="flex items-center gap-3">
    
    // Avatar: دائري، لون حسب dataQuality
    // Complete=emerald, Partial=amber, Minimal=red, null=slate
    <div className="w-12 h-12 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
      <svg className="text-emerald-600" width="28" height="28" viewBox="0 0 64 64">
        <circle cx="32" cy="20" r="12" className="fill-current" opacity="0.9" />
        <path d="M14 56c0-9.941 8.059-18 18-18s18 8.059 18 18H14z" className="fill-current" opacity="0.75" />
      </svg>
    </div>
    
    // Name + badge + mobile
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base font-bold text-slate-800">أحمد محمد علي (أبو شهاب)</span>
        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">OP</span>
      </div>
      <div className="text-sm text-slate-500 mt-0.5">
        <span className="font-mono">0991234567</span>
        <span className="mx-1 text-slate-300">·</span>
        <span>فيلات غربية — بناية 5</span>
      </div>
    </div>
  </div>
```

### الجزء ب: Standard Snapshot (العنوان الكامل + المهنة)

```tsx
  // === DIVIDER ===
  <div className="h-px bg-gray-100 my-4"></div>
  
  // === FULL ADDRESS (4 مستويات + تفصيلي) ===
  <div className="mb-4">
    <div className="text-xs font-medium text-slate-400 mb-1">📍 العنوان الكامل</div>
    <div className="text-sm text-slate-700">
      دمشق → المزة → فيلات غربية → بناية 5
    </div>
    <div className="text-sm text-slate-500 mt-0.5">
      شقة 4، طابق 2، بناية 5، فيلات غربية
    </div>
    <button className="mt-2 text-xs text-sky-600 font-medium hover:text-sky-700 flex items-center gap-1">
      🗺️ عرض على الخريطة
    </button>
  </div>
  
  // === OCCUPATION (دايماً تظهر) ===
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
    <div>
      <div className="text-xs font-medium text-slate-400 mb-0.5">💼 المهنة</div>
      <div className="text-sm text-slate-700">مهندس برمجيات</div>
    </div>
    <div>
      <div className="text-xs font-medium text-slate-400 mb-0.5">💼 مهنة الزوج/ة</div>
      <div className="text-sm text-slate-700">طبيبة أطفال</div>
    </div>
  </div>
```

**قاعدة:** إذا `occupation` فاضي → اعرض `"غير محدد"` بـ `text-slate-400 italic`. لا تخبّي الحقل.

### الجزء ج: الهوية القانونية

```tsx
  // === DIVIDER ===
  <div className="h-px bg-gray-100 my-4"></div>
  
  // === LEGAL IDENTITY ===
  <div>
    <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">📋 الهوية القانونية</div>
    
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
      <div>
        <span className="text-slate-400 text-xs">🆔 الرقم الوطني:</span>
        <span className="font-mono text-slate-700 mr-1">950545481212</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">الجنس:</span>
        <span className="text-slate-700 mr-1">ذكر</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">🎂 الميلاد:</span>
        <span className="font-mono text-slate-700 mr-1">1985-03-15</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">👩‍👦 الأم:</span>
        <span className="text-slate-700 mr-1">فاطمة حسن</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">📋 السجل المدني:</span>
        <span className="text-slate-700 mr-1">دمشق</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">🏛️ جهة الإصدار:</span>
        <span className="text-slate-700 mr-1">نفوس المزة</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">📅 تاريخ الإصدار:</span>
        <span className="font-mono text-slate-700 mr-1">2010-06-20</span>
      </div>
      <div>
        <span className="text-slate-400 text-xs">📦 الصندوق:</span>
        <span className="font-mono text-slate-700 mr-1">123</span>
      </div>
    </div>
  </div>
```

**قاعدة:** كل الأرقام Western numerals فقط. التواريخ YYYY-MM-DD. ما في أرقام هندية أبداً.

### الجزء د: الملكية

```tsx
  // === DIVIDER ===
  <div className="h-px bg-gray-100 my-4"></div>
  
  // === OWNERSHIP ===
  <div className="flex items-center justify-between text-sm">
    <div>
      <span className="text-slate-400 text-xs">المسؤول:</span>
      <span className="text-slate-700 mr-1">أحمد علي — سوبرفايزر</span>
    </div>
    <div>
      <span className="text-slate-400 text-xs">المصدر:</span>
      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs mr-1">SocialMedia</span>
    </div>
  </div>
  
</div> // end card
```

---

## 4️⃣ المجموعة 3: الجهاز والصيانة

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-4">🖥️ الجهاز والصيانة</div>
  
  <div className="space-y-3">
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-500">الموديل:</span>
      <span className="text-sm font-bold text-slate-800">Golden Pro X7</span>
    </div>
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-500">الرقم التسلسلي:</span>
      <span className="text-sm font-mono text-slate-700">SN-987654321</span>
    </div>
    <div className="h-px bg-gray-100"></div>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <span className="text-xs text-slate-400 block mb-1">خطة الصيانة</span>
        <span className="text-sm text-slate-700">سنوية (12 شهر)</span>
      </div>
      <div>
        <span className="text-xs text-slate-400 block mb-1">حالة الجهاز</span>
        <span className="text-sm text-slate-700">جديد</span>
      </div>
    </div>
  </div>
</div>
```

---

## 5️⃣ المجموعة 4: الملخص المالي (FULL WIDTH)

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-4">💰 الملخص المالي</div>
  
  // Top row: sale info
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
    <div>
      <span className="text-xs text-slate-400 block">نوع البيع</span>
      <span className="text-slate-700 font-medium">صافي</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block">الفئة</span>
      <span className="text-slate-700">فلتر منزلي</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block">المصدر</span>
      <span className="text-slate-700">متجر</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block">المرجع</span>
      <span className="font-mono text-slate-700">REF-001</span>
    </div>
  </div>
  
  <div className="h-px bg-gray-100 my-4"></div>
  
  // Price breakdown
  <div className="space-y-2">
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">السعر الأساسي</span>
      <span className="font-mono text-slate-700">2,500,000 ل.س</span>
    </div>
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">الخصم (10% — خصم عيد)</span>
      <span className="font-mono text-red-600">-250,000 ل.س</span>
    </div>
    <div className="h-px bg-gray-200 my-2"></div>
    <div className="flex justify-between">
      <span className="text-slate-800 font-bold">السعر النهائي</span>
      <span className="font-mono text-slate-800 font-black text-lg">2,250,000 ل.س</span>
    </div>
  </div>
  
  <div className="h-px bg-gray-100 my-4"></div>
  
  // Payment
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
    <div>
      <span className="text-xs text-slate-400 block mb-1">طريقة الدفع</span>
      <span className="text-slate-700 font-medium">دفعة + أقساط</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block mb-1">الدفعة الأولى</span>
      <span className="font-mono text-slate-700">500,000 ل.س</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block mb-1">الأقساط</span>
      <span className="font-mono text-slate-700">10 × 175,000 ل.س</span>
    </div>
  </div>
  
  <div className="h-px bg-gray-100 my-4"></div>
  
  // Receipt
  <div className="flex justify-between items-center text-sm">
    <span className="text-slate-500">رقم الإيصال</span>
    <span className="font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded">REC-2026-0045</span>
  </div>
</div>
```

---

## 6️⃣ المجموعة 5: التركيب والتوصيل

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-4">📍 التركيب والتوصيل</div>
  
  <div className="grid grid-cols-2 gap-4 mb-4">
    <div>
      <span className="text-xs text-slate-400 block mb-1">📅 تاريخ التوصيل</span>
      <span className="font-mono text-slate-700">2026-05-25</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block mb-1">🔧 تاريخ التركيب</span>
      <span className="font-mono text-slate-700">2026-05-26</span>
    </div>
  </div>
  
  <div className="h-px bg-gray-100 my-3"></div>
  
  <div>
    <span className="text-xs text-slate-400 block mb-1">📍 عنوان التركيب</span>
    <div className="text-sm text-slate-700">
      دمشق → المزة → فيلات غربية → بناية 5
    </div>
    <div className="text-sm text-slate-500 mt-0.5">شقة 4، طابق 2</div>
    <button className="mt-2 text-xs text-sky-600 font-medium">🗺️ عرض على الخريطة</button>
  </div>
</div>
```

---

## 7️⃣ المجموعة 6: الضمان

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-4">🛡️ الضمان</div>
  
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span className="text-sm text-slate-700">ضمان Golden:</span>
      <span className="text-sm font-bold text-slate-800">نشط</span>
      <span className="text-xs text-slate-500">(حتى 2027-05-20)</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-slate-400"></span>
      <span className="text-sm text-slate-700">ضمان العقد:</span>
      <span className="font-mono text-sm text-slate-700">حتى 2028-05-20</span>
    </div>
  </div>
</div>
```

---

## 8️⃣ المجموعة 7: مصدر العقد

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-4">🔗 مصدر العقد وإغلاقه</div>
  
  <div className="space-y-2 mb-4">
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-400">📌 مصدر الزيارة:</span>
      <a href="/visits/90145" className="text-sky-600 font-mono hover:underline">#90145</a>
      <span className="text-xs text-slate-400">→</span>
    </div>
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-400">📋 المهمة المفتوحة:</span>
      <a href="/tasks/1234" className="text-sky-600 font-mono hover:underline">#1234</a>
    </div>
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-400">💼 عرض المهمة:</span>
      <a href="/offers/5678" className="text-sky-600 font-mono hover:underline">#5678</a>
    </div>
  </div>
  
  <div className="h-px bg-gray-100 my-3"></div>
  
  <div className="grid grid-cols-2 gap-4 text-sm">
    <div>
      <span className="text-xs text-slate-400 block mb-1">👤 موظف الإغلاق</span>
      <span className="text-slate-700">خالد عمر — سوبرفايزر</span>
    </div>
    <div>
      <span className="text-xs text-slate-400 block mb-1">📅 تاريخ الإغلاق</span>
      <span className="font-mono text-slate-700">2026-05-20</span>
    </div>
  </div>
</div>
```

---

## 9️⃣ المجموعة 8: ملاحظات الفاتورة

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
  <div className="text-base font-bold text-slate-800 mb-3">📝 ملاحظات الفاتورة</div>
  <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700 min-h-[3rem]">
    العميل طلب تركيب إضافي لمياه الحديقة.
    تم الاتفاق على زيارة متابعة بعد 3 أشهر.
  </div>
  <button className="mt-2 text-xs text-sky-600 font-medium hover:text-sky-700">تعديل</button>
</div>
```

---

## 🔟 المجموعة 9: بيانات تشغيلية (grey, small)

```tsx
<div className="bg-white/50 rounded-xl border border-gray-100 p-4 text-xs text-slate-400">
  <div className="flex gap-4 flex-wrap">
    <span>معرف العقد: <span className="font-mono text-slate-500">#45</span></span>
    <span>الفرع: <span className="text-slate-500">فرع دمشق</span></span>
    <span>أنشأه: <span className="text-slate-500">أحمد علي — مدير مبيعات</span></span>
    <span>تاريخ الإنشاء: <span className="font-mono text-slate-500">2026-05-20 14:30</span></span>
  </div>
</div>
```

---

## 📱 التخطيط العام (Page Layout)

```tsx
<div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
  
  // 1. Header — full width
  <Group1Header />
  
  // 2. Two columns: Identity + Device
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <Group2BuyerIdentity />
    <Group3Device />
  </div>
  
  // 3. Financial — full width
  <Group4Financial />
  
  // 4. Two columns: Installation + Warranty
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <Group5Installation />
    <Group6Warranty />
  </div>
  
  // 5. Source — full width
  <Group7Source />
  
  // 6. Notes — full width
  <Group8Notes />
  
  // 7. Metadata — grey, small
  <Group9Metadata />
  
</div>
```

**قواعد الـ Grid:**
- Desktop (md+): 2 columns للـ Identity+Device و Installation+Warranty
- Tablet/Mobile: 1 column stacked
- كل group بـ `space-y-4` بين Cards

---

## ⚠️ قواعد صارمة (اكسرها = كارثة)

1. **Western numerals فقط** — `0991234567` مش `٠٩٩١٢٣٤٥٦٧`
2. **التواريخ:** YYYY-MM-DD — `1985-03-15`
3. **الأسعار:** بفواصل آلية + "ل.س" — `2,250,000 ل.س`
4. **المهنة + مهنة الزوج/ة:** دايماً تظهر — `text-slate-400 italic` إذا "غير محدد"
5. **العنوان:** 4 مستويات geo + `detailedAddress`
6. **الروابط:** `<a>` بـ `text-sky-600 hover:underline`
7. **الحالة (status):** badge ملوّن دايماً ظاهر
8. **المسؤول/ين:** `ownershipDisplay` = اسم أول مسؤول + "+N"
9. **الـ classification:** badge جانب الاسم (LEAD grey / OP blue / FOP green)
10. **لا تستخدم جدول HTML (`<table>`)** — استخدم `div` + `flex`/`grid` فقط
11. **لا تستخدم `dir="rtl"`** — التطبيق كله RTL، كل `div` بـ `mr-1` (margin-right)

---

## 🧪 Visual QA Checklist

قبل التسليم، تأكد من:
- [ ] كل card بـ `bg-white rounded-2xl shadow-sm border border-gray-100 p-5`
- [ ] MiniSnapshot header ظاهر بـ Group 2
- [ ] الهوية القانونية بقسم منفصل تحت divider
- [ ] الأرقام Western numerals فقط — ابحث عن `٠١٢٣٤٥٦٧٨٩`
- [ ] التواريخ YYYY-MM-DD — ابحث عن آذار/نيسان/أيار
- [ ] الروابط شغالة وقابلة للنقر
- [ ] الـ badges ملوّنة حسب القيمة
- [ ] المهنة + مهنة الزوج/ة تظهر ("غير محدد" إذا فاضي)
- [ ] الصفحة responsive — جرب mobile width (375px)
- [ ] لا يوجد overflow أفقي
- [ ] لا يوجد `<table>` HTML

---

## 📁 ملفات للقراءة

- `docs/constitution/components/client-snapshot.md` (المستوى الثاني — Standard Snapshot)
- `docs/constitution/domains/contracts.md` (حقول العقد)
- `packages/api/routes/contracts.ts` (API endpoints)
