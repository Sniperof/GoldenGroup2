# جلسة العمل — الأجهزة والعقود
**التاريخ:** 20 مايو 2026
**الموضوع:** تحليل وتخطيط وتنفيذ 6 تاسكات على Golden CRM (Staging)
**الملفات المعدّلة:** 10 ملفات + 6 migrations

---

## التاسكات المكتملة (6/6)

### التاسك 1 — نظام الحسم الزمني + الجهاز البارز
- **الجدول:** `device_discounts` (حملات موسمية بتواريخ بداية/نهاية)
- **التعديل:** `is_offer_included` → `is_featured` (جهاز بارز بالقائمة)
- **الوظيفة:** العرض بيختار من الحسومات الفعّالة حالياً

### التاسك 2 — ثنائية اللغة
- `nameEn` صار **إجباري** (نفس أهمية `nameAr`)
- `descriptionEn` حقل جديد (وصف إنكليزي اختياري)
- `brand` بقى shadow بـ DB بس ما بيتحدث تلقائياً

### التاسك 3 — فصل الخدمات
- من `تعليم تسليم` (قيمة واحدة مجتمعة) → 4 قيم منفصلة
- الترتيب: **تسليم → تركيب → صيانة → تعليم**
- بدون migration (الموظفين بيعدّلوا يدوياً)

### التاسك 4 — حقل الرمز
- `code` (الرمز) — حقل نصي اختياري للـ SKU الداخلي
- مثال: `GW-7H-2025`

### التاسك 5 — نموذج الدفع الموحد
- **الجداول:** `contract_payment_entries` + `contract_installments`
- **8 طرق دفع:** نقدي، شام كاش، سيرياتيل كاش، أم تي أن كاش، الهرم، حوالة بنكية، مقايضة، دولار
- **التحويل:** رقم حوالة **إجباري**
- **المقايضة:** اسم + قيمة **إجباريين**
- **الأقساط:** قابلة للتعديل قبل التوثيق، مقفلة بعده
- **التحقق:** مجموع الدفعات = الإجمالي (± 1)

### التاسك 6 — تطوير العقد
- **اختيار الحسم:** dropdown بالحسومات الفعّالة عند اختيار الجهاز
- **بنود العقد:** جدول (جهاز تلقائي + ملحقات من `spare_parts` + رسوم خدمة يدوية)
- **أنواع البيع:** استبدال / احتفاظ / بيع مباشر
- **مصادر البيع:** مهمة عرض جهاز (مع رقم مهمة) / تطبيق / وسائل تواصل
- **حالات العقد:** نشط / ملغي / مؤقت

---

## الملفات المعدّلة

```
migrations/
  122_device_discounts.sql
  123_rename_is_featured.sql
  124_device_bilingual.sql
  125_device_code.sql
  126_contract_enhancements.sql
  127_contract_payments.sql

packages/api/routes/
  deviceModels.ts
  contracts.ts

packages/shared/
  types.ts

packages/web/src/lib/
  api.ts

packages/web/src/pages/
  DeviceManagement.tsx
  DeviceDetail.tsx
  contracts/ContractForm.tsx
  contracts/ContractDetail.tsx

packages/web/src/components/clients/
  DeviceOfferModal.tsx
```

---

## Prompt Files (للرجوع)

كل تاسك له ملف Prompt محفوظ بـ `apps/staging/`:

```
TASK1_PROMPT.md  → الحسم الزمني + isFeatured
TASK2_PROMPT.md  → ثنائية اللغة
TASK3_PROMPT.md  → فصل الخدمات
TASK4_PROMPT.md  → حقل الرمز
TASK5_PROMPT.md  → نموذج الدفع الموحد
TASK6_PROMPT.md  → تطوير العقد
```

---

## كيف تبدأ محادثة جديدة

1. **امسح الـ Memory:**
   - قل لـ Hermes: "امسح الميموري"
   - هيك بتمسح كل الذكريات المؤقتة

2. **امسح المحادثة:**
   - بـ Telegram: استخدم "Clear History" أو "Delete Chat"
   - بـ CLI/Terminal: اكتب `/new` أو `/clear`

3. **ابدأ من جديد:**
   - قل "مرحبا" أو اطرح سؤال جديد
   - Hermes بيبدأ بذاكرة نظيفة
   - **المعلومات المهمة** (Golden CRM server, ports, workflow rules) بتضل محفوظة بالـ Memory الدائمة

---

## ملاحظات مهمة

- **Production:** `/opt/golden-crm/app/GoldenGroup2` — **لا تلمسه**
- **Staging:** `/opt/golden-crm/apps/staging` — port 3001
- **Database:** `golden_crm_staging`
- **Build:** `pnpm --filter @golden-crm/api build` + `pnpm --filter @golden-crm/web build`
- **Restart:** `pm2 restart golden-crm-staging`
- **Hermes = محلل/مدير فقط** — لا ينفذ كود مباشرة بدون موافقة صريحة
