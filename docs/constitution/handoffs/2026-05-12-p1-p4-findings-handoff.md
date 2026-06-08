# Handoff — نتائج جلسة التدقيق p1–p4

> الحالة: مرجع دستوري نهائي
> التاريخ: 2026-05-12
> اللغة: عربية موحّدة
> الغرض: تثبيت ما ثبت فعلياً في p1–p4 كعقد دائم، وتحديد الـ gaps المفتوحة التي تحتاج قراراً لاحقاً.

---

## 1) ما الذي انتهى (مُثبَت ومُغلَق)

### p1 — إصلاح `GET /contact-targets/marketing`
**الحالة: مُصلَح**

- **المشكلة**: `GET /contact-targets/marketing` كان يُمرّر معاملاً واحداً (`$1 = branchId`) لاستعلام يحتاج اثنين (`$2 = ACTIVE_OPEN_TASK_STATUSES`). PostgreSQL يرفع خطأ `pg_analyze_and_rewrite_varparams` في كل طلب.
- **الإصلاح**: `packages/api/routes/contactTargets.ts:129` — إضافة `ACTIVE_OPEN_TASK_STATUSES` كـ `$2`.
- **أثر الفلتر**: الاستعلام بدون الفلتر كان سيُعيد 11 سجلاً (بما فيها زبائن بمهام مغلقة)، مع الفلتر: 6 سجلات صحيحة.
- **الأدلة**: `.hermes-evidence/p1-contact-targets-marketing/`

---

### p2 — توثيق lifecycle الموعد كـ state machine رسمية
**الحالة: موثَّق — state machine مُعتمدة**

الـ lifecycle يشمل 6 جداول متوازية:
```
contact_targets       → 'new' → 'queued' → 'contacted' → 'booked' (terminal)
task_list_items       → 'pending' → 'called' → 'booked' (terminal)
open_tasks            → 'open' → 'in_contact_list' → 'scheduled' → completed/needs_reschedule/cancelled
telemarketing_appts   → immutable بعد الإنشاء
marketing_visits      → 'scheduled' → 'in_visit' → 'ended'* → 'completed'/'cancelled'/'needs_reschedule'
marketing_visit_tasks → 'pending' → 'completed'/'not_completed'
```

**المُثبَت في DB:**
- `contact_target.status` يبقى `'booked'` للأبد — لا كود يُحدّثه بعد اكتمال الزيارة.
- `'ended'` في `marketing_visits` — لا يوجد سجل واحد في staging. المسار الفعلي يتخطاه.
- `legacy 'booked' outcome` — صفر سجل في DB. الـ canonical الوحيد: `'booked_marketing_appointment'`.

**الأدلة**: `.hermes-evidence/p2-marketing-appointment-lifecycle/`

---

### p3 — توثيق عقد `POST /telemarketing/appointments`
**الحالة: موثَّق — عقد فعلي مُثبَت**

**الحد الأدنى المطلوب فعلياً في الباكند:**
```
✅ taskListId + taskListItemId (موجودان، مصرَّح بالوصول)
✅ لا تعارض في الوقت (teamKey + date + timeSlot)
✅ branch context
```

**ما لا يشترطه الباكند:**
```
✗ وجود open_task (appointment fcc7ccc9 في staging: completed بدون أي open_task)
✗ نوع مهمة محدد (أي task_type مقبول — كلها device_demo بسبب fallback فقط)
✗ open_task في حالة 'in_contact_list' (التحديث صامت عند الفشل)
```

**bypass paths المُثبَتة:**
1. Direct API call — يتجاوز UI gate كلياً
2. legacy upsert path (`POST /task-lists/upsert`) — ينتج items بـ `open_task_id=NULL`

**الأدلة**: `.hermes-evidence/p3-telemarketing-appointments-contract/`

---

### p4 — توحيد الـ drift المصطلحي
**الحالة: موثَّق — mapping نهائي**

| المصطلح | التصنيف | المعنى الدستوري |
|---------|---------|----------------|
| `marketingTargets` / `GET /planning/marketing-targets` | **legacy — تاريخي** | استعلام محسوب: جهات اتصال لديها مهمة نشطة ضمن نطاق الفريق |
| `contact_targets` (DB table + API) | **canonical** | سجل دائم: دورة حياة الجهة كهدف اتصال |
| `PlanningContactTargets` (page + URL) | **صحيح دستورياً** | صفحة تحوّل ملخص الخطة إلى قائمة اتصال قابلة للتنفيذ |
| `telemarketing_appointments` | **legacy prefix — يبقى تقنياً** | سجل الحجز الimmutable |
| `marketing_visits` | **canonical** | بطاقة التنفيذ الميداني |

**أهم تعارض:** `planningMarketingTargets.ts` يُقيّد بـ `device_demo` في 4 مواضع بينما الدستور يقول "بغض النظر عن نوع المهمة".

**الأدلة**: `.hermes-evidence/p4-term-drift-normalization/`

---

## 2) الـ Gaps المفتوحة (تحتاج قراراً لاحقاً)

### Gap-A — `device_demo` filter مقابل الدستور
**الخطورة: 🔴 عالية — تعارض سلوكي**
**الموقع**: `packages/api/services/planningMarketingTargets.ts` — سطور 380، 390، 417، 556
**المرجع الدستوري**: `planning-contact-targets.md §PC-G001`

الدستور: "بغض النظر عن نوع المهمة نفسها"
الكود: `AND open_tasks.task_type = 'device_demo'`

**الخيارات:**
- Option A: إزالة الفلتر من SQL (4 مواضع) — يُوافق الدستور
- Option B: تحديث الدستور ليعكس الـ MVP constraint

**القرار**: لازم يصدر من المنتج قبل أي تعديل.

---

### Gap-B — `contact_target.status` لا يتحدث بعد اكتمال الزيارة
**الخطورة: 🟡 متوسطة — تأثير تراكمي**
**المرجع الدستوري**: `telemarketing-appointments.md §AP-L007`، `planning-contact-targets.md §PC-G004`

السجلات تبقى `'booked'` حتى بعد `completed`/`cancelled`. هذا يجعل `GET /contact-targets/marketing` تُعيدها لقوائم لاحقة.

**الخيار**: إضافة تحديث لـ `contact_target.status` في نهاية `applyTaskOutcome` و`applyTaskResult`.

**القرار**: يحتاج مراجعة تأثير على صفحات التخطيط أولاً.

---

### Gap-C — `open_task` validation في `POST /telemarketing/appointments`
**الخطورة: 🟡 متوسطة — UI gate فقط**
**المرجع الدستوري**: `telemarketing-appointments.md §AP-R001`

الـ UI يشترط `opensAppointment=true` (مرتبط بـ `booked_marketing_appointment` outcome). الباكند لا يحتوي guard مكافئاً.

**الخيار**: إضافة validation في `POST /telemarketing/appointments` للتحقق من وجود `open_task` فعلي.

**القرار**: هل يُقبل أن الحجز يعمل بدون مهمة (للتشغيل اليدوي)؟ قرار منتج.

---

### Gap-D — `task_type` validation في الحجز
**الخطورة: 🔴 حرجة — مسار ميت عند تسجيل النتيجة**
**المرجع الدستوري**: `telemarketing-appointments.md §AP-G002`، `§AP-G004`

إذا حُجز موعد بـ `task_type ≠ 'device_demo'`:
- ✅ الحجز يعمل
- ✅ `marketing_visit_task` تُنشأ بالـ type الخاطئ
- ❌ `PATCH /:id/result` (legacy) يُعيد 404
- ⚠️ `PATCH /:visitId/tasks/:taskId/outcome` يقبل لكن outcomes غير منطقية

**الخيار**: إضافة validation `task_type ∈ ['device_demo']` في الباكند — أو إصلاح legacy endpoint.

**القرار**: مرتبط بـ Gap-A (هل نوسّع أم نُقيّد).

---

### Gap-E — `telemarketing.md` domain constitution فارغ
**الخطورة: 🟢 منخفضة — توثيق فقط**

`docs/constitution/domains/telemarketing.md` هو draft فارغ يحتاج إكمالاً.

**الخيار**: ملء الدستور بناءً على ما ثبت في p2–p4.

---

## 3) الـ Legacy المُعترف به (يبقى كما هو)

| العنصر | السبب |
|--------|--------|
| `marketingTargets` كاسم function/API | تاريخي — موثَّق في `planning.md §9.3` |
| `telemarketing_` prefix في table/API | تاريخي — AP-G001 — migration غير مبرر |
| `booked` outcome code | يُعالَج بـ `normaliseOutcomeCode()` — لا يُكتَب جديداً |
| `in_call_list` في transition guards | كود يتعامل معه لكن لا يكتبه — legacy DB records |
| `assigned` في `ACTIVE_OPEN_TASK_STATUSES` | حالة قديمة — صفر سجل في DB — لا ضرر من إبقائها |
| `PATCH /:id/result` (legacy) | `@deprecated` في الكود — يبقى للتوافق الخلفي |

---

## 4) الملفات الدستورية المُحدَّثة في هذه الجلسة

| الملف | التحديث |
|-------|---------|
| `docs/constitution/features/planning-contact-targets.md` | PC-G001 → decision pending + code locations؛ إضافة PC-G003 (p1 fix)؛ إضافة PC-G004 (booked terminal) |
| `docs/constitution/features/telemarketing-appointments.md` | AP-R001 → توثيق السلوك الفعلي؛ إعادة كتابة قسم 9 بـ gaps مُصنَّفة |
| `docs/constitution/handoffs/2026-05-12-p1-p4-findings-handoff.md` | هذا الملف — handoff نهائي شامل |
| `packages/shared/types.ts` | إضافة `ContactTargetStatus` type (p2) |
| `packages/web/src/pages/planning/PlanningContactTargets.tsx` | إزالة `'cancelled'` الوهمية من labels (p2) |
| `packages/api/routes/contactTargets.ts` | إصلاح `[branchId, ACTIVE_OPEN_TASK_STATUSES]` (p1) |

---

## 5) كيف نكمل من هنا

ترتيب الأولوية للقرارات اللازمة:

1. **Gap-D أولاً** — `task_type` validation — مرتبط بمشكلة حالية (مسار ميت)
2. **Gap-A ثانياً** — `device_demo` filter — قرار تشغيلي يؤثر على نطاق التخطيط
3. **Gap-B ثالثاً** — `contact_target.status` — تأثير تراكمي على قوائم لاحقة
4. **Gap-C رابعاً** — API validation لـ open_task — قرار UX/policy
5. **Gap-E أخيراً** — إكمال `telemarketing.md` domain constitution
