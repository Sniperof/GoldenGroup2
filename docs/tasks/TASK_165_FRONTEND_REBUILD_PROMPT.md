# برومبت تنفيذ — إعادة بناء صفحة تفاصيل الزيارة

> **الهدف:** أعد بناء `VisitDetailPage.tsx` بالكامل + تعديل `ClientInfoCard.tsx`  
> **المرجع:** اقرأ `/opt/golden-crm/apps/staging/docs/tasks/TASK_165_FRONTEND_REBUILD_REFERENCE.md` — هاد ملف فيه كل التفاصيل الدقيقة  
> **النطاق:** Frontend فقط — الباك ايند جاهز ومش محتاج تعديل

---

## المطلوب

### ١) أعد بناء `packages/web/src/pages/visits/VisitDetailPage.tsx`

احذف الملف الحالي (٤٦٧ سطر القديم) واكتبه من جديد وفق الـ ٧ أقسام:

1. **Header** — اسم الزبون + حالة الزيارة + أزرار (بدء/إنهاء/إتمام)
2. **معلومات الموعد** — تاريخ التنفيذ، الموعد المتوقع، من ردّ، تاريخ/وقت الحجز، اسم التيلي، ملاحظاته، مصدر المياه، المحطة
3. **بيانات الزبون** — `<ClientInfoCard data={clientData} />`
4. **الفريق المسؤول** — مشرف/فني/متدرّب + الفريق الرديف (إذا موجود) + زر تغيير الفريق (بس إذا scheduled)
5. **لائحة أسماء الزبون** — اسم الزبون + عدد الأسماء المقترحة + زر إضافة
6. **مهام الزيارة** — كل مهمة مع الإجراء المناسب (عرض/تسليم/تركيب/تشغيل/صيانة)
7. **محصلة الزيارة** — حالة + أوقات + مدة + مواقع GPS + سبب إلغاء + ملاحظات ميدان

**ملاحظات:**
- استخدم `SectionCard` component (أو سوي component داخلي) لكل قسم — بطاقة بيضاء معاينة مع border
- التصميم: Tailwind, خلفية `bg-slate-50`, نصوص `text-sm` و `text-xs`
- كل بيانات من `api.fieldVisits.get(visitId)` — شوف هيكل الـ response بالمرجع
- الـ `station` جاهز من الـ API — ما تحسبه بالفرونت اند
- `canRecord` = `['in_progress', 'ended'].includes(visit.status)`

### ٢) عدّل `packages/web/src/components/ClientInfoCard.tsx`

تعديلات بسيطة:
- تأكد إن `branchName` بيجي من `data.branchName` وبيُعرض بقسم "بيانات الزبون"
- تأكد إن `rating` بيترجم: `'Committed'`→زبون ملتزم، `'NotCommitted'`→غير ملتزم، `'Undefined'`→غير محدد
- العنوان (`address`) لازم يقرأ `{ governorate, district, subDistrict, neighborhood, detailedAddress, gps }` ويعرضن صح
- ما تحذف شي موجود — بس أضف/عدّل

### ٣) إضافة Modals داخل `VisitDetailPage.tsx`

**ChangeTeamModal:**
- ٣ dropdowns: مشرف، فني، متدرّب
- يجيب موظفين الفرع من API (أو يستخدم البيانات المتاحة)
- يرسل `PATCH /field-visits/:id/team`
- يختفي إذا الزيارة مش `scheduled`

**GeneralTaskResultModal:**
- واحد modal عام لـ التسليم/التركيب/التشغيل
- زرين: نجاح / فشل + textarea ملاحظات
- يرسل `POST /field-visits/:visitId/tasks/:taskId/result` مع `{ outcome, notes }`

**DemoResultModal:**
- موجود حالياً بالكود — احتفظ فيه أو استخدمه

---

## الملفات اللي لازم تقراهن قبل التعديل

1. `/opt/golden-crm/apps/staging/docs/tasks/TASK_165_FRONTEND_REBUILD_REFERENCE.md` ← **المرجع الرئيسي**
2. `/opt/golden-crm/apps/staging/packages/web/src/components/ClientInfoCard.tsx`
3. `/opt/golden-crm/apps/staging/packages/web/src/lib/api.ts`

---

## قواعد صارمة

1. **لا تحذف** `NameCollectionModal` أو `DirectSuggestionForm`
2. **لا تغيّر** الـ API routes
3. **لا تلمس** الباك ايند — الباك ايند جاهز
4. **الصفحة لازم تبقى rtl** (`dir="rtl"`)
5. **بعد كل تعديل** شغّل `pnpm --filter @golden-crm/web build` وتأكد ما فيه errors

---

## التحقق

بعد التطبيق:
1. افتح أي زيارة — لازم تظهر الـ ٧ أقسام بالترتيب
2. جرّب "تغيير الفريق" — لازم يفتح modal
3. جرّب "بدء" → "إنهاء" → "تسجيل نتيجة" على مهمة
4. جرّب زيارة `ended` — أزرار "تسجيل نتيجة" لازم تضل ظاهرة
5. التقييم لازم يظهر عربي (زبون ملتزم / غير ملتزم / غير محدد)
