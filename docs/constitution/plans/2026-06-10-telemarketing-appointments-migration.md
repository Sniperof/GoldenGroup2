# خطة ترحيل `telemarketing_appointments` — 2026-06-10

> **الحالة:** ⏳ قيد التنفيذ — Phase 0 + 1 في الجلسة 2026-06-10.
> **قرارات صاحب المنتج (Ibrahim، 2026-06-10):**
> 1. ❌ لا ندعم حجز candidates — يُحوَّل لزبون أولاً
> 2. 🗑️ Phase 5 (DROP بعد الأرشفة) ضمن النطاق
> 3. 📦 ترحيل الـ 3 صفوف التاريخية إلى field_visits
> 4. 🔑 إبقاء صلاحية `telemarketing.appointments.book` بالاسم الحالي
>
> **نتائج الفحوصات الفنية (2026-06-10):**
> - ✅ `customer_snapshot` يحوي occupation + waterSource (lib/snapshots.ts:127-128) → P-OPEN-01 محلول
> - ✅ `open_task_devices` يتعبأ 100% (24/24 device_demo) → fallback في openTasks آمن للحذف
> - ⚠️ المسار `else` في useTelemarketingStore.ts:138 يُسلَك حصراً عند entityType='candidate' — لا candidates في DB
> **المرجعيات:** DEC-003 D2 (book-visit endpoint canonical)، handoff 2026-05-12 §77، domains/telemarketing.md §2.4.
> **الـ owner المقترَح:** هذا الفريق / Claude session.
> **الزمن المتوقع:** 8–10 أيام عمل موزَّعة على 4 مراحل + 14 يوم soak.

---

## 1. السياق والمبرّر

جدول `telemarketing_appointments` صُمِّم كـ "سجل حجز ميداني" قبل DEC-003. بعد DEC-003 D2:

- المسار الجديد للحجز: `POST /telemarketing/book-visit` يكتب مباشرة في `field_visits + visit_tasks` (مع `origin_type='telemarketing'`).
- المسار القديم: `POST /telemarketing/appointments` ما زال مفعّلاً ويكتب في الجدول القديم.

**الوضع الحالي مختلط** — endpointan متوازيان، 3 صفوف حيّة على staging، 6 مواضع في الكود تقرأ من الجدول القديم، dashboard يدمج المصدرين.

**الهدف:** تحويل الجدول إلى سجل **read-only audit** ثم — بعد قرار صاحب المنتج — إما تجميده مكاناً، أو DROP بعد أرشفة آمنة.

---

## 2. الواقع الحالي (Inventory)

### 2.1 الكتابات (Writes) — يجب إزالتها كلها

| الموضع | النوع | الوصف |
|---|---|---|
| `packages/api/routes/telemarketing.ts:2150` (`POST /appointments`) | INSERT | المسار القديم للحجز — ما زال يقبل طلبات |
| `packages/api/routes/telemarketing.ts:2324` | INSERT (ضمن /appointments) | السطر الفعلي للإدراج |
| `packages/api/routes/clients.ts:1689` | UPDATE → 'cancelled' | عند soft-delete زبون، يُعلَّم مواعيده |
| `packages/web/src/hooks/useTelemarketingStore.ts:147` | استدعاء `api.telemarketing.createAppointment` | المسار الذي يصل لـ /appointments القديم |

### 2.2 القراءات (Reads) — يجب لها بدائل

| الموضع | الاستخدام | البديل المقترَح |
|---|---|---|
| `routes/telemarketing.ts:866` (`GET /snapshot`) | جلب المواعيد لعرضها للتيليماركتر | استبدال بـ `SELECT FROM field_visits WHERE origin_type='telemarketing'` مع mapping للحقول |
| `routes/openTasks.ts:3583` (fallback chain) | جلب الجهاز المطلوب من `requested_device_*` عند فقدان `open_task_devices` | بعد ضمان `open_task_devices` يتعبأ دائماً (GAP فرعي)، حذف الـ fallback. مؤقتاً: نقل القراءة إلى `field_visits.customer_snapshot->>'requestedDeviceModelId'` |
| `routes/contactTargets.ts:101` (LATERAL `latestAppointment`) | عرض «آخر موعد للزبون» في dashboard الـ targets | استبدال بـ LATERAL على `field_visits` بنفس الفلتر |
| `services/planningMarketingTargets.ts:644` (نفس النمط) | نفس الـ LATERAL في dashboard الـ planning | نفس الاستبدال |

### 2.3 الـ Snapshots المُجمَّدة (المعطيات الحرجة)

أعمدة "snapshot" لحظة الحجز، **لا يمكن استرجاعها** من الجداول الحديثة بدقة:

| العمود | البديل في field_visits | الفجوة |
|---|---|---|
| `customer_name` | `fv.customer_snapshot->>'name'` | ✅ موجود |
| `customer_address` | `fv.customer_snapshot->>'address'` | ⚠️ يحتاج تأكيد الموجود |
| `customer_mobile` | `fv.customer_snapshot->>'mobile'` | ⚠️ يحتاج تأكيد |
| `occupation` | غير محفوظ في field_visits | ❌ **فجوة** — قرار: نضيفه أم نقبل فقده |
| `water_source` | غير محفوظ في field_visits | ❌ **فجوة** — قرار: نضيفه أم نقبل فقده |
| `team_key` | `fv.team_snapshot` (شكل مختلف) | ⚠️ mapping لازم |
| `time_slot` | `fv.scheduled_time` | ✅ متاح |

**قرار مفتوح (P-OPEN-01):** هل نُحدِّث `customer_snapshot` ليشمل `occupation` و `water_source`؟ أم نعتبرها بيانات تاريخية تبقى فقط في الجدول القديم؟

### 2.4 الـ Frontend — وحدة الاستدعاء الوحيدة المتبقية

```ts
// useTelemarketingStore.ts:147
saved = await api.telemarketing.createAppointment(payload);
```

يقع في مسار شرطي — **متى يُسلَك؟** يحتاج فحصاً دقيقاً قبل الإزالة (الكود يحتوي على شرط `if (...)` يحدد متى يذهب لـ book-visit ومتى للقديم).

---

## 3. التصميم المستهدف

```
الـ Source of Truth الوحيد للحجوزات:
  POST /api/telemarketing/book-visit
       ↓
  INSERT field_visits (origin_type='telemarketing', customer_snapshot JSONB كامل)
  INSERT visit_tasks (one per requested task)

dashboards:
  contact_targets dashboard:    LATERAL JOIN field_visits WHERE origin_type='telemarketing'
  planning dashboard:           LATERAL JOIN field_visits WHERE origin_type='telemarketing'
  open task device fallback:    field_visits.customer_snapshot->>'requestedDeviceModelId'

الـ Legacy:
  GET /api/telemarketing/appointments       → 410 Gone (or removed)
  POST /api/telemarketing/appointments      → 410 Gone (or removed)
  telemarketing_appointments table          → read-only audit (Phase 4)
                                            → DROP (Phase 5, optional)
```

---

## 4. الخطة المرحلية

### المرحلة 1 — تحضير + إغلاق الكتابة (2 يوم)

**هدف:** إيقاف كل INSERT جديد على `telemarketing_appointments` بدون كسر سلوكي.

| المهمة | الملف | الإجراء |
|---|---|---|
| M1.1 | `useTelemarketingStore.ts:138-148` | تحليل الشرط `if (...)`. كل المسارات تُحوَّل لـ `/book-visit` (إن وُجد سياق لا يمكن تحويله، يُوثَّق ويُرفع كـ blocker) |
| M1.2 | `api.telemarketing.createAppointment` | إزالته من `lib/api.ts` |
| M1.3 | `routes/telemarketing.ts:2150` | `POST /appointments` يصبح 410 Gone |
| M1.4 | `routes/clients.ts:1689` | الـ UPDATE → 'cancelled' يبقى مؤقتاً (آمن، يكتفي بتعليم الموجود). يُحذف في المرحلة 4 |
| M1.5 | اختبار smoke | حجز موعد جديد من UI → يُكتَب في field_visits فقط، لا صف جديد في الجدول القديم |
| M1.6 | تحقق DB | `SELECT MAX(created_at) FROM telemarketing_appointments` يجب أن يثبت ولا يتقدم |

**معيار النجاح:** 0 INSERT جديدة على الجدول خلال 24 ساعة بعد deploy.

### المرحلة 2 — ترحيل القراءات (3 أيام)

**هدف:** كل dashboard / fallback يقرأ من field_visits بدل الجدول القديم.

| المهمة | الموضع | الإجراء |
|---|---|---|
| M2.1 | `routes/contactTargets.ts:101` (LATERAL `latestAppointment`) | إعادة كتابة باستخدام `field_visits` (origin_type='telemarketing'). الحقول: `id, scheduled_date AS "date", scheduled_time AS "timeSlot", team_snapshot->>'teamKey' AS "teamKey"` |
| M2.2 | `services/planningMarketingTargets.ts:644` | نفس الإعادة (كود مكرر تقريباً) |
| M2.3 | `routes/openTasks.ts:3583` | إذا قرَّر المنتج إبقاء fallback: استبدله بقراءة من `field_visits.customer_snapshot`. إذا قرَّر حذفه: حذف كامل (يفترض `open_task_devices` يتعبأ دائماً) |
| M2.4 | `routes/telemarketing.ts:866` (`GET /snapshot`) | إعادة كتابة الـ SELECT للقراءة من field_visits |
| M2.5 | اختبار dashboards | كل dashboard يعرض «آخر موعد» للزبون الذي حجز عبر /book-visit في الأسبوع الأخير |

**معيار النجاح:** صفر استعلام `SELECT FROM telemarketing_appointments` في تتبُّع pg_stat_statements بعد deploy.

**قرار مفتوح:** هل نُهاجِر الـ 3 صفوف الحالية إلى field_visits قبل البدء؟ أم نقبل أنها ستبقى مرئية فقط في صفحة "historic appointments" بعد المرحلة 4؟

### المرحلة 3 — Soak Window (14 يوم)

**هدف:** التأكد أن النظام يعمل بدون قراءة/كتابة على الجدول.

- يُترك الجدول كما هو
- مراقبة `pg_stat_user_tables.n_tup_ins/upd/del` على الجدول → يجب أن تبقى 0
- مراقبة الأخطاء في `staging-error.log`
- مراقبة الـ dashboards التي اعتمدت عليه — أي شكاوى مستخدمين؟

**معيار النجاح:** 14 يوم متتاليان بـ 0 writes و 0 reads مع 0 أخطاء.

### المرحلة 4 — التجميد read-only (1 يوم)

**هدف:** ضمان فيزيائي بأنه لا يمكن لأحد الكتابة فيه (حتى لو ترك كود مهمل أو DEV).

| الإجراء | الـ SQL |
|---|---|
| M4.1 | `REVOKE INSERT, UPDATE, DELETE ON telemarketing_appointments FROM golden_crm_staging` (مع IF EXISTS) — لكن الـ user هو نفسه الذي يقرأ، نحتاج user منفصل أو نتراجع لتعليق |
| M4.2 — بديل | إنشاء trigger `BEFORE INSERT/UPDATE/DELETE` يَرفع EXCEPTION |
| M4.3 | حذف السطر `UPDATE telemarketing_appointments SET status='cancelled'` من `routes/clients.ts:1689` (لم يعد لازماً) |
| M4.4 | كتابة `COMMENT ON TABLE telemarketing_appointments IS 'READ-ONLY AUDIT — frozen 2026-XX-XX. New bookings use field_visits.'` |
| M4.5 | إنشاء view `telemarketing_appointments_archive` للقراءة (إن لزم تسهيل وصول التقارير) |

**معيار النجاح:** محاولة INSERT تدوياً عبر psql ترفض.

### المرحلة 5 — DROP (اختياري، شهور لاحقاً)

**يُفعَّل فقط لو قرَّر صاحب المنتج التخلّي عن السجل التاريخي.**

- backup مستقل: `pg_dump --table=telemarketing_appointments → archive_2026_telemarketing_appointments.sql`
- migration ترفع نسخة كاملة إلى S3 / مجلد أرشيف خارج الـ DB
- `DROP TABLE telemarketing_appointments;`
- حذف الـ permissions `telemarketing.appointments.book` لو لم تعد مستخدمة (تحقق أولاً)

---

## 5. التبعيات والـ Blockers

| Blocker | الأثر | المالك |
|---|---|---|
| `customer_snapshot` لا يحوي `occupation`/`water_source` | إن قرَّرنا الحفاظ على هذه البيانات، نحتاج تعديل `field_visits` schema قبل المرحلة 2 | الـ Product |
| الشرط في `useTelemarketingStore.ts:138-148` غير مفهوم | المهمة M1.1 معطَّلة حتى يُفهَم متى يُسلَك المسار القديم | تحليل كود — جلسة فحص |
| `open_task_devices` ربما لا يتعبأ دائماً | M2.3 يحتاج فحصاً قبل إزالة الـ fallback | grep + اختبار |
| 3 صفوف حيّة وقرار هجرتها | M2.5 يعتمد على قرار P-OPEN-01 | الـ Product |

---

## 6. الـ Rollback لكل مرحلة

| المرحلة | كيف نتراجع |
|---|---|
| 1 | `git revert` على commits المرحلة. الجدول لم يفقد أي بيانات (الكتابة فقط أُوقفت) |
| 2 | `git revert` على dashboards. القراءة كانت من الجدول، لا فقد لبيانات |
| 3 | لا تعديلات، لا rollback لازم |
| 4 | `DROP TRIGGER` أو `GRANT` المُلغى. الـ COMMENT بلا أثر سلوكي |
| 5 | غير قابل للتراجع بعد الـ DROP إلا من الـ backup. **توقَّف ولا تنفِّذ إلا بقرار صريح + backup مؤكَّد** |

---

## 7. التحقق التشغيلي (Verification Queries)

```sql
-- After Phase 1:
SELECT COUNT(*) FROM telemarketing_appointments
WHERE created_at > NOW() - INTERVAL '24 hours';
-- → expected: 0 new rows after the cutover

-- After Phase 2:
-- monitor pg_stat_statements for any query touching the table
SELECT query, calls FROM pg_stat_statements
WHERE query ILIKE '%telemarketing_appointments%'
ORDER BY calls DESC;
-- → expected: only the snapshot/archive views

-- After Phase 3 (during soak):
SELECT n_tup_ins, n_tup_upd, n_tup_del, last_seq_scan
FROM pg_stat_user_tables WHERE relname = 'telemarketing_appointments';
-- → ins/upd/del should be 0; seq_scan should be stable

-- After Phase 4:
BEGIN; INSERT INTO telemarketing_appointments (id, entity_type, entity_id, customer_name, team_key, date, time_slot)
VALUES ('test', 'client', 1, 'x', 'y', '2026-01-01', '10:00'); ROLLBACK;
-- → expected: ERROR
```

---

## 8. الـ Checklist قبل البدء

- [ ] الـ Product يوافق على P-OPEN-01 (هل نُحدِّث `customer_snapshot` لـ occupation/water_source أم نتركها تتلاشى مع الجدول؟)
- [ ] الـ Product يحدد ما إذا كانت المرحلة 5 (DROP) ضمن النطاق أم لا
- [ ] تحليل دقيق لـ `useTelemarketingStore.ts:138-148` (متى يَسلك /appointments بدل /book-visit؟)
- [ ] فحص شامل لـ `open_task_devices` يتعبأ دائماً (شرط M2.3)
- [ ] تأكيد أن `field_visits.customer_snapshot` يحوي `mobile`, `address`, `name` بشكل متّسق
- [ ] صلاحية `telemarketing.appointments.book` تبقى أو تُعاد تسميتها لـ `telemarketing.book_visit` بعد المرحلة 4

---

## 9. ربط بالدستور

- DEC-003 D2 — book-visit canonical endpoint
- handoff 2026-05-12 §77 — "legacy prefix، يبقى تقنياً"
- domains/telemarketing.md §2.4 — schema القديم
- domains/telemarketing.md §BR-2 — السلسلة الجديدة
- features/telemarketing-appointments.md §278 — تنبيه أن الـ prefix تاريخي

عند تنفيذ هذا الـ plan، يُحدَّث:
- handoff 2026-05-12 §77 → تغيير الحالة من "legacy prefix" إلى "frozen read-only (Phase 4)" أو "removed (Phase 5)"
- domains/telemarketing.md §2.4 → إضافة فقرة "Migration history"
- CROSS-REFERENCE.md §6 → نقل الجدول من "Legacy" إلى "Archived" أو إزالته كلياً

---

## 10. خاتمة

هذه ليست عملية cleanup، بل **هجرة ميزة كاملة** تتضمن:
- تغييرات backend (5 ملفات)
- تغييرات frontend (2 ملف)
- ميزات DB (trigger أو REVOKE)
- 14 يوم staging soak
- قرارات منتج (P-OPEN-01)

البدء يَستلزم موافقة صريحة من صاحب المنتج بعد قراءة هذه الخطة + الإجابة على الـ Checklist §8.
