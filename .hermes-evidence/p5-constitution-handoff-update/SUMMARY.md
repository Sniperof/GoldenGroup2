# P5 — تحديث الدساتير والـ Handoff

## ما الذي استقر دستورياً بعد p1–p4

### المُثبَت والمُغلَق

| الـ Finding | الحالة الدستورية | المرجع |
|------------|-----------------|--------|
| `GET /contact-targets/marketing` كان مكسوراً | **مُصلَح** — `PC-G003` | p1 |
| `contact_target.status` يبقى `'booked'` terminal | **gap موثَّق** — `PC-G004` | p2 |
| `POST /appointments` لا يشترط `open_task` | **موثَّق في `AP-R001`** | p3 |
| `task_type` غير مقيَّد في الحجز | **gap موثَّق** — `AP-G002` | p3 |
| `marketingTargets` اسم legacy تاريخي | **canonical: legacy** — `planning.md §9.3` | p4 |
| `telemarketing_` prefix تاريخي | **canonical: legacy** — `AP-G001` | p4 |
| `device_demo` filter vs "بغض النظر" | **decision pending** — `PC-G001` | p4 |

---

## الـ Canonical Meanings المُعتمَدة

### `marketingTargets` / `GET /planning/marketing-targets`
- **canonical**: "العقد الحسابي للجهات ذات المهام" — استعلام ephemeral
- **legacy**: كلمة "marketing" — تاريخي، يبقى تقنياً
- **القيد الفعلي في الكود**: `device_demo` فقط (decision pending)

### `contact_targets` (DB + API)
- **canonical**: سجل دائم — دورة حياة الجهة كهدف اتصال
- **الحالات**: `new → queued → contacted → booked` (terminal) أو `closed`
- **gap**: لا يتحدث بعد اكتمال الزيارة

### `PlanningContactTargets` (page + URL)
- **canonical دستورياً**: صحيح — تعني "التخطيط لاستهداف جهات الاتصال ذات المهام"
- **ملاحظة برمجية**: تستدعي `marketingTargets` API وليس `contact_targets` API — مبرَّر دستورياً

### `telemarketing_appointments` (table + API)
- **canonical**: سجل الحجز الimmutable
- **legacy**: prefix `telemarketing_` — تاريخي، يبقى تقنياً
- **العلاقة**: `appointment.id → marketing_visit.id = 'mv_' + appointment.id`

### `marketing_visits` (table + API)
- **canonical**: بطاقة التنفيذ الميداني — الـ source of truth للفريق
- **الحالات**: `scheduled → in_visit → (ended*) → completed/cancelled/needs_reschedule`
- *`ended` موجود في الـ type لكن لا سجلات في DB — المسار الفعلي يتخطاه

---

## الـ Gaps المفتوحة

| Gap | الخطورة | الحالة |
|-----|---------|--------|
| `device_demo` filter في `planningMarketingTargets.ts` | 🔴 عالية | decision pending |
| `contact_target.status` لا يتحدث بعد الزيارة | 🟡 متوسطة | decision pending |
| `open_task` validation في الحجز (UI gate فقط) | 🟡 متوسطة | decision pending |
| `task_type` مسار ميت مع legacy endpoint | 🔴 حرجة | decision pending |
| `telemarketing.md` domain constitution فارغ | 🟢 منخفضة | todo |
