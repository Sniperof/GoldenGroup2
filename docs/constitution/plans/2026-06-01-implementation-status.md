# سجل تنفيذ DEC-003 → DEC-007 — Phases 0-8

> **التاريخ:** 2026-06-01
> **الحالة:** ⏳ Phase 9 (Legacy Removal) و Phase 10 (Constitution Sync) قيد التنفيذ
> **النطاق:** منظومة المهمة + جهة الاتصال + الزيارة + التيلماركتر
> **المراجع:**
> - `decisions/DEC-003-visit-task-unification.md`
> - `decisions/DEC-004-visit-task-lifecycle-refinement.md`
> - `decisions/DEC-005-contact-targets-filter.md`
> - `decisions/DEC-006-pending-resolutions-round1.md`
> - `decisions/DEC-007-visit-structure-list-and-survey.md`
> - `plans/2026-05-31-execution-plan.md` (الخطة الأصلية)

---

## 0. الملخص التنفيذي

تم تنفيذ 9 مراحل (0-8) على مدى التطوير، حلّت 5 قرارات معمارية كاملة عبر 16 migration جديدة و~20 ملف backend/frontend جديد أو معدّل. النموذج الموحّد للزيارة (DEC-003) عامل end-to-end، آلية cooldown (DEC-005 D29) فعّالة، الاستبيان المركزي (DEC-007 D42) متكامل، والتصعيد الثلاثي (DEC-006 D38) يعمل.

**ما تأجّل صراحةً:**
- **Phase 9 (Legacy Removal):** يحتاج 14 يوم تشغيل ناجح على staging قبل تطبيق DROP لـ `telemarketing_appointments` و `marketing_visits` و `visit_name_collections`. migrations الإسقاط جاهزة (152 و 230) ومحمية بـ safety guards.
- **Frontend switch إلى `bookVisit`:** `useTelemarketingStore.createAppointment` يبقى يستدعي `/appointments` legacy. التبديل النهائي يتم بعد تأكيد staging.
- **حسم P-DEC* المتبقية (5 نقاط معلقة):** قيم seed للفئات الست، 20 نوع مهمة، side tables، task_type_config schema الكامل، شاشة سجلات الأسماء.

---

## 1. جدول المراحل والـ commits

| المرحلة | Commit | المهام الرئيسية | DEC + sections |
|---|---|---|---|
| **0 Foundation** | `62afae5` | جدول `system_settings` + 6 مفاتيح، 7 فئات system_lists جديدة، صلاحيتا `field_visits.reopen_closed` + `clients.cooldown_unlock` | DEC-005 D26/D29 + DEC-006 D32/D37/D38 + DEC-004 D11 |
| **1 Schema Extensions** | `a26c22e`<br>`7e09804` | حقول cooldown على clients، `creation_origin` على open_tasks (مع backfill)، حقول `field_visits` الموحدة، `visit_geo_logs` actor/reason، `contact_targets` grain v2، `task_type_config.contact_target_visit_type` | DEC-003 D3 + DEC-004 D13/D17/D22/D23 + DEC-005 D24/D26/D27/D29 + DEC-007 D47 |
| **2 Outcomes Cleanup** | `ad71ad7` | حذف 4 outcomes + إضافة `customer_requested_followup` + توحيد `closesContactTarget=false` + `contact_target_id` NOT NULL | DEC-005 D26 + DEC-006 D34/D39 |
| **3 Cooldown + Closing** | `380a836` | systemSettings helper بـ TTL، endpoints set/clear cooldown + do_not_contact، `POST /contact-targets/:id/close`، auto-cooldown على `not_interested`، CRON تنظيف يومي، ContactControlCard في ClientProfile | DEC-005 D26/D29 + DEC-006 D32 |
| **4 Unified Visit Booking** | `50d334a` | `services/visitBooking.ts` بـ D18 + team snapshot + insert موحد، `POST /book-visit` + `POST /schedule-from-expected` + `POST /:id/tasks` (cascading)، refactor planningMarketingTargets يقرأ field_visits | DEC-003 D1/D2/D3 + DEC-004 D7/D18/D22 + DEC-007 D47 |
| **5 needs_follow_up** | `24f2daa` | نافذة يوم واحد ثابتة لـ needs_follow_up، solo team مقيد بـ emergency_maintenance، `GET /attempt-alerts`، AttemptAlertsCard | DEC-005 D24 + DEC-006 D31/D36/D37 |
| **6 Surveys + Sheets** | `c441b02` | migration 230 (drop visit_name_collections مع bridge)، `services/visitCompletion.ts` بـ checkAndCompleteVisit، 6 endpoints (referral-sheet ×3 + survey ×3)، VisitSurveyModal + ReferralSheetModal | DEC-007 D40-D46 + P-DEC007-04 |
| **7 Lifecycle + Escalation** | `7fcd958` | migration 231 (status 7-states)، migration 232 (visit_type 3 values)، `services/visitEscalationJob.ts` بـ CRON ثلاثي، L2 guard في start، GPS validation، `POST /reopen`، `GET /escalation-alerts` | DEC-003 D4 + DEC-004 D11/D17/D18 + DEC-006 D38 |
| **8 Frontend Consolidation** | `1f7817e`<br>`49c531c`<br>`28aa144` | VisitDetailPage بـ 7 states + 3 أزرار + reopen، SupervisorAlertsPage في `/supervisor/alerts`، ScheduleFromExpectedModal، drawer link، route ordering fix | كل الـ DECs |

**Range:** `62afae5..28aa144` — 11 commits، ~3500 سطر مضاف صافٍ.

---

## 2. Migrations المضافة

| رقم | الملف | الغرض | الـ DEC |
|---|---|---|---|
| 217 | `system_settings.sql` | جدول + 6 مفاتيح | DEC-005 D26/D29 + DEC-006 D37/D38 |
| 218 | `system_lists_dec_categories.sql` | 7 فئات بـ "أخرى" كحد أدنى | DEC-004 D8/D15/D17/D22 + DEC-006 D39 |
| 219 | `permissions_foundation_extensions.sql` | `field_visits.reopen_closed` + `clients.cooldown_unlock` | DEC-004 D11 + DEC-006 D32 |
| 220 | `clients_cooldown_do_not_contact.sql` | 5 حقول cooldown + indexes | DEC-005 D29 |
| 221 | `open_tasks_creation_origin_assigned.sql` | `creation_origin` + `assigned_*` + `expected_time` + backfill + CHECK | DEC-004 D13/D22 |
| 222 | `field_visits_unified_fields.sql` | `origin_type`/`origin_id`/`team_responsible_user_id` + CHECK | DEC-003 D3 + DEC-004 D22 + DEC-007 D47 |
| 223 | `visit_geo_logs_actor_and_reason.sql` | `started_by`/`ended_by`/`location_missing_reason` | DEC-004 D17 |
| 224 | `contact_targets_grain_v2.sql` | rename `latest_appointment_id`→`latest_visit_id` + FK + grain fields | DEC-004 D23 + DEC-005 D26/D27 |
| 225 | `task_type_config_contact_target_visit_type.sql` | + backfill من task_family + CHECK | DEC-005 D24 |
| 226 | `telemarketing_call_logs_outcome_v2.sql` | CHECK جديد بـ 16+legacy outcomes + backfill | DEC-006 D39 |
| 227 | `drop_telemarketing_reason_lists.sql` | حذف فئتي system_lists القديمتين | DEC-006 D39 |
| 228 | `telemarketing_call_logs_contact_target_required.sql` | contact_target_id NOT NULL | DEC-006 D34 |
| 230 | `drop_visit_name_collections.sql` | safety guard + bridge backfill + DROP | DEC-007 D40 |
| 231 | `field_visits_status_7_states.sql` | data migration + CHECK 7 states | DEC-004 D18 |
| 232 | `field_visits_visit_type_3_values.sql` | data migration + CHECK 3 values | DEC-003 D4 |

> **ملاحظة:** migrations 214/215/216 (visit_surveys + area_evaluation_options + referral_sheets unique) كانت موجودة من جلسة سابقة وصُولِيَت في Phase 6.
> migration 229 رقم محجوز (انعطف الترقيم بسبب حذف اقتراح أولي لإسقاط marketing_visits — مؤجل لـ Phase 9 عبر migration 152 الجاهز).

---

## 3. الـ Services / Routes الجديدة

### Backend services
- `services/systemSettings.ts` — TTL caching للمفاتيح الستة
- `services/contactTargetsCleanupJob.ts` — CRON يومي 22:00 (قابل للضبط)
- `services/visitBooking.ts` — منطق unified booking + D18
- `services/visitCompletion.ts` — `checkAndCompleteVisit(visitId, userId?, db?)`
- `services/visitEscalationJob.ts` — CRON ربع ساعي + 3 مستويات + `hasBlockingUndocumentedVisit()`

### Backend endpoints جديدة
- `POST /clients/:id/cooldown` و `DELETE /:id/cooldown` و `PATCH /:id/do-not-contact`
- `POST /contact-targets/:id/close`
- `POST /telemarketing/book-visit` ⭐ (DEC-003 D2 canonical)
- `POST /open-tasks/:id/schedule-from-expected`
- `POST /field-visits/:id/tasks` (cascading)
- `POST /field-visits/:id/referral-sheet` + `PATCH /:id/referral-sheet/target` + `GET /:id/referral-sheet`
- `POST /field-visits/:id/survey` + `POST /:id/survey/skip` + `GET /:id/survey`
- `POST /field-visits/:id/reopen`
- `GET /open-tasks/attempt-alerts` (DEC-006 D37)
- `GET /field-visits/escalation-alerts` (DEC-006 D38)

### Frontend components/pages جديدة
- `components/clients/ContactControlCard.tsx` — قسم "حالة التواصل"
- `components/fieldVisits/VisitSurveyModal.tsx` — 11 حقل + skip
- `components/fieldVisits/ReferralSheetModal.tsx` — target_candidates فقط
- `components/openTasks/ScheduleFromExpectedModal.tsx` — booking dialog
- `components/supervisor/AttemptAlertsCard.tsx`
- `pages/supervisor/SupervisorAlertsPage.tsx` — `/supervisor/alerts`

---

## 4. ما تأجّل بشفافية

| البند | السبب |
|---|---|
| **Drop `telemarketing_appointments`** | يحتاج 14 يوم تشغيل ناجح + حذف frontend caller `createAppointment` (Phase 9) |
| **Drop `marketing_visits`** | migration 152 جاهز، planningMarketingTargets لم يعد يقرأ منه (refactor Phase 4). جاهز للتطبيق في Phase 9 بعد verification |
| **Drop `visit_name_collections`** | migration 230 جاهز مع safety guard. تنفيذ في Phase 9 بعد التأكد staging |
| **`OUTCOME_MAP` legacy cleanup** | `rejected` و `booked` يبقون في الكود حتى backfill كامل في DB |
| **Frontend switch إلى bookVisit** | يتطلب verification أن staging به `day_schedule` + `route_assignments` للأيام المستهدفة (D18 enforcement) |
| **شاشة "سجلات الأسماء المنفصلة"** | P-DEC007-03 خارج النطاق — يحتاج تصميم منفصل |
| **Cross-team awareness widget (DEC-005 D28)** | Phase 10+ — صفحة مستقلة كبيرة |
| **شاشة "خارج الخطة" لمدير الفرع** | DEC-004 D13 — يمكن إنشاؤها لاحقاً باستخدام فلتر `creation_origin != 'branch_plan'` |
| **side tables لكل 20 نوع مهمة** | P-DEC004-05 ثقيل — منفصل |

---

## 5. القرارات المعلقة المتبقية (P-DEC*)

| الكود | الموضوع | الحالة بعد Phases 0-8 |
|---|---|---|
| P-DEC004-04 | تعريف 20 نوع مهمة | seeded في migration 106، تحتاج تأكيد بعض ال definitions |
| P-DEC004-05 | side tables لكل نوع | مفتوح |
| P-DEC005-04 | task_type_config schema الكامل | الحقول الموجودة تكفي للمنظومة الحالية، توسيع لاحق |
| P-DEC006-01 | قيم seed للفئات الست | حالياً "أخرى" فقط — يحتاج جلسة |
| P-DEC007-01 | survey_skip_reasons | "أخرى" فقط — مرتبط بـ P-DEC006-01 |
| P-DEC007-02 | إلزامية الـ 11 حقل | محسوم: 11 إلزامية أو skip كامل (CHECK في migration 214) |
| P-DEC007-03 | شاشة سجلات الأسماء المنفصلة | مفتوح — design pending |

---

## 6. كيف نستمر

### عند بدء جلسة جديدة:
1. اقرأ هذا الملف للوقوف على آخر حالة
2. اقرأ `git log --oneline 62afae5..HEAD` لمعرفة آخر commits
3. افحص `docs/constitution/GAPS-TRACKER.md` للـ gaps المتبقية

### المرحلة 9 (Legacy Removal) لاحقاً:
- شرط: 14 يوم تشغيل staging مستقر
- تطبيق migrations: 152, 230 (إن لم تُطبَّق بعد), 231, 232
- حذف frontend wrappers: `createAppointment`, `createNameCollection`, `recordNames`
- حذف backend endpoints: `/appointments`, `/visit-tasks/:taskId/name-collection`, `/name-collections/:id/record-names`, `/reschedule`
- grep شامل للتأكد من عدم وجود references
- backup DB قبل أي DROP TABLE

---

## 7. التحقق على staging قبل المرحلة 9

استعلامات سريعة للتحقق:

```sql
-- 1. system_settings مهيأ
SELECT key, value FROM system_settings WHERE key LIKE 'visit_%' OR key = 'default_cooldown_days';

-- 2. لا قيم status قديمة على field_visits
SELECT status, COUNT(*) FROM field_visits GROUP BY status;
-- يجب: scheduled, in_progress, ended, completed, not_completed, cancelled, closed فقط

-- 3. visit_surveys CHECK يعمل
SELECT COUNT(*) FROM visit_surveys WHERE is_skipped = TRUE AND skip_reason IS NULL;
-- يجب: 0

-- 4. لا قراءة من marketing_visits في الكود
-- grep -r "FROM marketing_visit" packages/api/  → يجب أن يعطي 0 نتائج

-- 5. cooldown يعمل
SELECT COUNT(*) FROM clients WHERE cooldown_until > CURRENT_DATE;

-- 6. CRON تصعيد يحفظ alerts
SELECT tier, COUNT(*) FROM visit_escalation_alerts GROUP BY tier;
```
