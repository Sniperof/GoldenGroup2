# قرار معماري: الزيارة الميدانية الفورية (Field-Initiated Instant Visit)

> **رقم القرار:** DEC-011
> **التاريخ:** 2026-06-23
> **الحالة:** ✅ معتمد
> **الأولوية:** 🟠 مهمة
> **يكمل:** DEC-003/004 (الزيارة الموحدة + D17/D18) + DEC-005 (cooldown) + DEC-010 (سحب المهام)
> **الكيانات المتأثرة:** field_visits, visit_geo_logs, contact_targets, clients, day_schedules, route_assignments, permissions

---

## 1. ملخص المعضلة

المسار الوحيد لإنشاء زيارة اليوم يمرّ عبر التيليماركتر/المدير (`bookVisit()`)، ويشترط ≥١ مهمة مختارة وخانة وقت، ويُنشئ الزيارة `scheduled`. لا يوجد منفذ للفريق الميداني نفسه لبدء زيارة **خارج الخطة** لزبون يصادفه ضمن منطقته اليوم.

**إعادة تأطير جوهرية:** هذا لا يكاد يُرخي D18 — فـ `assertD18` يفحص (التاريخ ≥ اليوم + وجود `day_schedule` + وجود `route_assignment` للفريق)، **لا** أهلية الزبون. المشرفة العاملة اليوم تحقّق الثلاثة؛ الجديد الوحيد أن الزبون لم يكن في قائمة الأهداف المخططة.

**الملكية إقليمية:** لا يوجد حقل «مالك» لكل زبون؛ «زبون خاص بها» = زبون حيُّه (`clients.neighborhood`) ضمن مناطق مسار فريقها اليوم (نفس ما يستخدمه التخطيط).

---

## 2. القرارات المعتمدة (D-FI1 → D-FI10)

### D-FI1 — الطبيعة: زيارة فورية تبدأ الآن
تُنشأ الزيارة مباشرةً بحالة `in_progress` (لا `scheduled`)، مع التقاط GPS البدء وفق D17. ليست حجزاً لوقت لاحق.

### D-FI2 — نطاق الزبون صارم
يجوز الإنشاء فقط لزبون: في **فرع** المُنشئ، **و** حيُّه ضمن **مناطق مسار فريقها اليوم** (`route_assignments` → zones). توسعة «كل فروع الزبون» / «خارج مناطق اليوم» مؤجَّلة.

### D-FI3 — تبدأ فارغة، تُملأ بالسحب
الزيارة تُنشأ بلا مهام؛ تُضاف المهام عبر مسار السحب (DEC-010). إرفاق مهمة مكتفية ذاتياً (device_demo/emergency) عند الإنشاء **مؤجَّل** (جولة لاحقة). قيد v1: تعمل لزبون لديه مهام منتظرة؛ وإلا تبقى زيارة استبيان فقط.

### D-FI4 — الـ cooldown يَمنع (لا تحذير)
إذا كان الزبون ضمن فترة `clients.cooldown_until ≥ اليوم` أو `do_not_contact = TRUE` → **يُرفَض الإنشاء**. لا تجاوز ميداني.

### D-FI5 — إنشاء وإغلاق contact_target
الزيارة الفورية تُنشئ (أو تُحدِّث upsert على الحبيبة) `contact_target` وتُغلقه فوراً (`status='closed'`, `closing_reason='field_initiated_visit'`, `latest_visit_id`)، حتى يبقى تقرير التواصل اليومي والـ cooldown متماسكين في الاتجاهين.

### D-FI6 — الصلاحية
صلاحية جديدة `field_visits.create_instant` (نطاق `ASSIGNED`). المُنشئ = مسؤول الفريق (المشرفة للقياسي، الفني للطوارئ — D11).

### D-FI7 — اشتقاق الفريق
يُشتق فريق المُنشئ من `day_schedules` اليوم (الفريق الذي هو مشرفه/فنيّه/متدربه) → `teamKey` + `team_snapshot` + `team_responsible_user_id`.

### D-FI8 — المصدر
`origin_type = 'field_initiated'` (قيمة جديدة، أوضح من `manual`)، `origin_id = hr_users.id` للمُنشئ. تظهر في «المهام خارج الخطة» (D13).

### D-FI9 — الاكتمال موروث
يرث DEC-007 كما هو: الاستبيان إلزامي (مع skip + سبب)؛ الزيارة الفارغة تُكمَل بالاستبيان وحده.

### D-FI10 — الوقت
`scheduled_date = اليوم`، `scheduled_time = وقت الإنشاء الفعلي`.

---

## 3. التأثير على الكود

### 3.1 Migrations
| الملف | التغيير |
|---|---|
| `320_field_visits_origin_field_initiated.sql` | توسيع قيد `origin_type` ليشمل `field_initiated` |
| `321_field_visits_create_instant_permission.sql` | صلاحية `field_visits.create_instant` (ASSIGNED) |

> `contact_targets.closing_reason` حقل حرّ (varchar(50)) — القيمة `field_initiated_visit` لا تحتاج migration.

### 3.2 Backend
| العنصر | الحالة |
|---|---|
| `planningMarketingTargets.resolveTeamZoneIds(date, teamKey)` | 🆕 مُصدَّر — يعيد استخدام buildZoneIds |
| `visitBooking.createInstantVisit()` + `findTeamKeyForUserToday()` | 🆕 — الحُرّاس + الإنشاء in_progress + geo log + contact_target |
| `POST /field-visits/instant` | 🆕 (`field_visits.create_instant`) |

### 3.3 Frontend
- `components/fieldVisits/InstantVisitModal.tsx` — اختيار الزبون + GPS + إنشاء.
- زر «زيارة فورية» في `pages/visits/MyVisitsPage.tsx` (صفحة «زياراتي»)، خلف الصلاحية.
- `api.ts`: `fieldVisits.createInstant(...)`.

---

## 4. التأثير على الدستور

| الملف | التحديث |
|---|---|
| `domains/visits.md` | `V-R020` (الزيارة الفورية) + قيمة origin_type + نقطة API |
| `features/unified-visit-model.md` | `UV-R020` |
| `decisions/README.md` | إدراج DEC-011 |

---

## 5. غير المشمول

- إرفاق مهمة مكتفية ذاتياً عند الإنشاء (مؤجَّل — D-FI3).
- توسعة النطاق خارج فرع/مناطق اليوم (مؤجَّل — D-FI2).
- مسار `location_missing` الكامل في مودال الإنشاء (v1 يتطلّب GPS؛ سبب الغياب لاحقاً).

---

## 6. القرارات اللاحقة المعلّقة

- `P-DEC011-01`: إرفاق device_demo عند الإنشاء (إحياء الإنشاء المحصور بالمكتفية ذاتياً).
- `P-DEC011-02`: دعم `location_missing` + سبب في مودال الزيارة الفورية.
- `P-DEC011-03`: هل تُسجَّل visit_source خاصة بـ field_initiated؟

---

## 7. المراجع

- `decisions/DEC-003-visit-task-unification.md` / `DEC-004-...` (D17/D18)
- `decisions/DEC-005-contact-targets-filter.md` (cooldown)
- `decisions/DEC-010-visit-task-pull.md` (السحب — يملأ الزيارة الفورية)
- `services/visitBooking.ts` (`createInstantVisit`) · `services/planningMarketingTargets.ts` (`resolveTeamZoneIds`)
- `routes/fieldVisits.ts` (`POST /instant`) · `pages/visits/MyVisitsPage.tsx`
