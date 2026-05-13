# P4 — توحيد الـ Drift المصطلحي

## نظرة عامة

الـ drift بين المصطلحات الأربعة ليس عشوائياً — الدساتير **تُقرّ به صراحةً** وتُصنّفه كـ "أثر تاريخي". المشكلة أن الكود لم يُحدَّث ليعكس المعنى التشغيلي الجديد الذي تُعرّفه الدساتير.

---

## الـ Mapping الكامل

### 1. `marketingTargets` / `GET /planning/marketing-targets`

| الجانب | القيمة |
|--------|--------|
| **الاسم التقني الحالي** | `marketingTargets` في API client، `/planning/marketing-targets` في URL |
| **الاسم الدستوري الصحيح** | "العقد الحسابي لجهات الاتصال ذات المهام" |
| **ما يعبّر عنه فعلاً** | استعلام محسوب يُعيد العملاء ذوي المهام النشطة ضمن نطاق الفريق |
| **هل هو persistent?** | **لا** — ephemeral query |
| **موقف الدستور** | `planning.md §9.3`: "وهو اسم تقني تاريخي للعقد الحسابي فقط" |
| **الـ legacy** | كلمة "marketing" — المفهوم الآن أشمل من التسويق |

**قرار الدستور:** الاسم `marketingTargets` معترف به كـ legacy. المعنى التشغيلي الصحيح: "جهات اتصال لديها مهمة داخل نطاق العمل".

**الـ drift الحرج في الكود:**
```typescript
// planningMarketingTargets.ts:380, 417, 556
AND open_tasks.task_type = 'device_demo'  // ← الكود يقيّد بـ device_demo
```
```text
// planning-contact-targets.md §0, §4.3, §PC-G001:
"بغض النظر عن نوع المهمة نفسها"          // ← الدستور يرفض التقييد
```
هذا **تعارض بين الكود والدستور** وليس مجرد drift في الاسم.

---

### 2. `contactTargets` / `contact_targets` (جدول + API route)

| الجانب | القيمة |
|--------|--------|
| **الاسم التقني الحالي** | `contact_targets` (DB) ← `/api/contact-targets` (route) |
| **الاسم الدستوري الصحيح** | "جهة الاتصال المؤهلة" أو "contact target" |
| **ما يعبّر عنه فعلاً** | سجل **دائم** يتتبع دورة حياة علاقة الفرع بالعميل كهدف اتصال |
| **هل هو persistent?** | **نعم** — يُكتَب ويُقرَأ ويتطور |
| **موقف الدستور** | `planning-contact-targets.md §4.4`: التعريف واضح ومعتمد |

**الخلط الموجود:** الاسم `contactTargets` يُستخدم لـ **مفهومين مختلفين** في الكود:
- `contact_targets` (DB) = السجل الدائم
- نتيجة `GET /planning/marketing-targets` = الاستعلام اللحظي

الدستور يُعرّف "contact target" كالمفهوم العام (الجهة المؤهلة)، وكلا الكيانين يُعبّران عنه من زوايا مختلفة.

---

### 3. `planning-contact-targets` (feature doc + URL + component)

| الجانب | القيمة |
|--------|--------|
| **الاسم التقني الحالي** | `PlanningContactTargets` (component) + `/planning/contact-targets/:teamKey` (URL) |
| **الاسم الدستوري الصحيح** | "ملخص الخطة وجهات الاتصال ذات المهام" |
| **ما يعبّر عنه فعلاً** | صفحة تحوّل ملخص الخطة إلى قائمة اتصال قابلة للتنفيذ |
| **API الذي تستدعيه** | `api.planning.marketingTargets()` — **وليس** `api.contactTargets` |
| **موقف الدستور** | `planning-contact-targets.md §4.2`: التعريف واضح |

**الـ drift المحدد:**
الاسم `PlanningContactTargets` يُوحي بأن الصفحة تعرض سجلات `contact_targets` من DB.
فعلياً هي تعرض نتيجة استعلام `marketing-targets` (ephemeral) وتُمكّن توليد قائمة الاتصال.

لكن الدستور يُقرّ بهذا ويُعرّف الـ feature name كـ "PlanningContactTargets" أي "التخطيط لجهات الاتصال ذات المهام" — وهو وصف المفهوم وليس سجل الـ DB.
**→ اسم صحيح دستورياً، لكن مُضلّل برمجياً.**

---

### 4. `telemarketing-appointments` (feature doc + table + API)

| الجانب | القيمة |
|--------|--------|
| **الاسم التقني الحالي** | `telemarketing_appointments` (DB) + `POST /telemarketing/appointments` (API) |
| **الاسم الدستوري الصحيح** | "الموعد" / "سجل الحجز" — ضمن فيتشر "إدارة المواعيد" |
| **ما يعبّر عنه فعلاً** | سجل immutable يُنشأ عند حجز موعد زيارة بناءً على مكالمة تلمارك |
| **موقف الدستور** | `telemarketing-appointments.md §AP-G001`: "أثر تاريخي من التليماركتينغ" |

**ما يُقرّه الدستور صراحةً:**
```
AP-G001: الاسم والحقول الحالية ما تزال تحمل أثرًا تاريخيًا من التليماركتينغ.
          المعنى التشغيلي الحقيقي أوسع: حجز موعد لجهة اتصال تملك مهمة داخل قائمة العمل.
```

**الكيانات في السلسلة:**
```
telemarketing_appointment  → سجل الحجز (immutable)
    ↓ يُولّد
marketing_visit            → بطاقة التنفيذ الميداني
```
الاسمان صحيحان تقنياً — لكن `telemarketing_` prefix في الأول يُوحي بتقييد غير موجود.

---

## جدول المصطلحات الكامل

| المصطلح | الاسم canonical (دستورياً) | الاسم legacy | في DB | في Code | الـ Drift |
|---------|--------------------------|-------------|-------|---------|-----------|
| `marketingTargets` | "جهات اتصال ذات مهام" | ✅ legacy معترف به | لا | function + URL | كلمة "marketing" = historical |
| `contact_targets` (table) | "سجل الجهة المؤهلة" | الاسم صحيح | ✅ نعم | table + route | لا drift في الاسم |
| `/contact-targets/marketing` (API) | فيتشر "contact_targets" | route suffix "/marketing" = filter | ✅ فيها | route | "/marketing" يُقيّد المفهوم |
| `PlanningContactTargets` | "ملخص الخطة + استخراج الجهات" | الاسم صحيح دستورياً | لا | component + URL | يُوحي بـ DB record، فعلياً ephemeral query |
| `telemarketing_appointments` | "سجل الحجز" | "telemarketing" = historical | ✅ نعم | table + API | prefix تاريخي، المعنى أوسع |

---

## ما يجب أن يبقى legacy فقط (بلا تغيير)

1. **`marketingTargets`** كاسم function/endpoint — معترف به كتاريخي، لا تغيير دون migration شامل
2. **`booked` outcome code** — معالَج بـ `normaliseOutcomeCode()`، لا يُكتَب جديداً
3. **`telemarketing` prefix** في `telemarketing_appointments` — DB table، migration مكلف

## ما يجب توحيده الآن

1. **كود vs دستور**: `planningMarketingTargets.ts` يُقيّد بـ `device_demo` بينما الدستور يقول "بغض النظر عن نوع المهمة" — هذا تعارض سلوكي وليس مجرد drift في الاسم
2. **توثيق السلسلة**: `telemarketing_appointment → marketing_visit` تحتاج توثيقاً صريحاً في كود الباكند كـ comment
