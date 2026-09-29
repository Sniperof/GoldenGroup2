# Session Handoff — يوم ٢٣ مايو ٢٠٢٦

> Migration الزيارة الموحدة (marketing_visits -> field_visits) -- مكتمل 100%
> آخر تحديث: ٢٣/٥/٢٠٢٦ -- بعد حذف جداول marketing_visits من DB

---

## ما تم انجازو بهاي الجلسة

### ١. Migration الزيارة الموحدة -- مكتمل

| # | الشغل | الحالة |
|---|-------|--------|
| ١ | Backend: GET /field-visits/ + POST reschedule + POST cancel + demo result handler | Done |
| ٢ | API Client: api.fieldVisits.* | Done |
| ٣ | قائمة الزيارات: VisitsListPage.tsx | Done |
| ٤ | تفاصيل الزيارة: VisitDetailPage.tsx | Done |
| ٥ | Nav + Routes + Bridge UPSERT | Done |
| ٦ | نقل Permissions | Done |
| ٧ | حذف marketingVisits.ts backend + components + pages | Done |
| ٨ | حذف MarketingVisit types | Done |
| ٨.٥ | نهigrate ContractForm.tsx | Done |
| ٩ | حذف آخر methods من api.ts | Done |
| ١٠ | حذف الباقي من types.ts | Done |
| ١١ | Verify build | Done |
| ١٢ | تنظيف telemarketing.ts + openTasks.ts SQL | Done |
| ١٣ | حذف جداول marketing_visits + marketing_visit_tasks + marketing_visit_task_offers من DB | Done |

**النتيجة النهائية:**
- marketing_visits          Deleted (جدول + API + types + components)
- marketing_visit_tasks     Deleted
- marketing_visit_task_offers Deleted
- field_visits             Canonical (الكيان الوحيد)
- visit_tasks              Canonical (الكيان الوحيد للمهام)
- visit_task_results       Canonical (النتائج الموحدة)

### ٢. إصلاحات parallel

| الإصلاح | الملف | الوصف |
|---------|-------|-------|
| contact_targets ككيان يومي | Migration 151 + multiple files | كل يوم = جهة اتصال واحدة للزبون |
| AP-G006 | telemarketing.ts + planning | جهة مقفلة = ما بيصير مهمة جديدة اليوم |
| zone_id يتبع المهمة | planningMarketingTargets.ts | contract-basis -> عنوان العقد، client-basis -> عنوان الزبون |
| Type mismatch fix | planningMarketingTargets.ts | contact_target.date = $4 بدل $4::date |
| Bypass حذف | telemarketing.ts | !allTasksArePostSale محذوف (3 مواضع) |

---

## الملفات الدستورية المحدثة

| الملف | المحتوى |
|-------|---------|
| docs/constitution/features/unified-visit-model.md | Migration مكتمل -- 13/13 |
| docs/constitution/features/planning-contact-targets.md | جهة الاتصال ككيان يومي + zone_id حسب المهمة |
| docs/constitution/features/telemarketing-appointments.md | AP-G006 مغلقة |

---

## البرومptzات المنشأة

| الملف | الغرض |
|-------|-------|
| TASK_PHASE1_FIELD_VISIT_REASSIGN_PROMPT.md | اعادة اسناد الفريق |
| TASK_PHASE2_VISIT_UNIFICATION_PROMPT.md | توحيد الزيارة |
| TASK_PHASE3_UNIFY_RESULTS_PROMPT.md | توحيد النتائج |
| TASK_FIX_TEAM_PROPAGATION_FINAL_PROMPT.md | تصحيح انتقال الفريق |
| TASK_FIX_SOLO_TEAM_VALIDATION_PROMPT.md | منع مشرف لفريق طوارئ |
| TASK_FIX_CONTACT_TARGET_DAILY_PROMPT.md | جهة الاتصال = يوم واحد |
| TASK_REMOVE_POSTSALE_BYPASS_PROMPT.md | حذف !allTasksArePostSale |
| TASK_FIX_DATE_TYPE_MISMATCH_PROMPT.md | VARCHAR = date type fix |
| TASK_ZONE_ID_TASK_AWARE_PROMPT.md | zone_id يتبع نوع المهمة |
| TASK_BLOCK_CLOSED_CONTACT_FROM_SYNC_PROMPT.md | منع اسناد للمقفل |
| TASK_UNIFIED_DELIVERY_RESULT_UI_PROMPT.md | ربط نتيجة التسليم بالـ endpoint الموحد |
| TASK_CLEANUP_TEST_DATA_PROMPT.md | حذف داتا اختبار |
| TASK_UNIFIED_VISIT_MIGRATION_PROMPT.md | المراحل 1-5 migration |
| TASK_UNIFIED_VISIT_MIGRATION_PHASES_6_7_8_PROMPT.md | مراحل 6-7-8 |
| TASK_UNIFIED_VISIT_MIGRATION_PHASES_9_10_VERIFY_PROMPT.md | مراحل 9-10 + verify |
| TASK_FINALIZE_CONTRACT_FORM_AND_DELETE_LEGACY_PROMPT.md | نهigrate ContractForm + حذف الباقي |
| TASK_CLEAN_BACKEND_SQL_BEFORE_DROP_PROMPT.md | تنظيف SQL قبل DB drop |

---

## الـ State الحالي

### ما شغال:
- /field-visits -- قائمة الزيارات (كل الأنواع)
- /field-visits/:id -- تفاصيل الزيارة + كل المهام
- POST /field-visits/:id/tasks/:id/result -- تسجيل نتيجة أي مهمة
- Planning + sync + generate-from-plan + telemarketer workspace

### ما تم اختبارو:
- device_demo -- عرض جهاز
- device_delivery -- تسليم جهاز
- device_installation -- تركيب جهاز
- emergency_maintenance -- صيانة طارئة
- Contact targets = كيان يومي
- Zone ID = يتبع نوع المهمة

### ما باقي للاختبار:
- device_activation -- تفعيل جهاز (ندرة)
- ادوار permissions الجديدة (field_visits.*) بـ admin panel
- ContractForm مع fieldVisits (تم النهigration بس محتاج test حقيقي)

---

## شو لازم نشتغل بالجلسة الجاي؟

### الأولوية العالية (High Priority)

| # | الموضوع | السبب |
|---|---------|-------|
| ١ | **تعميم المهام** -- نبدأ بـ device_activation | المستخدم صرح: "نبدأ مرحلة مرحلة" -- أولى المهام المتبقية |
| ٢ | **اختبار device_activation** | لازم نتأكد إن الـ unified endpoint بيشتغل لكل أنواع المهام |

### الأولوية المتوسطة (Medium Priority)

| # | الموضوع | السبب |
|---|---------|-------|
| ٣ | **اختبار ContractForm مع fieldVisits** | تم النهigration بس محتاج verification حقيقي |
| ٤ | **تنظيف open_tasks legacy** | هل لازم ندمج open_tasks مع visit_tasks؟ ولا يبقوا منفصلين؟ |

### الأولوية المنخفضة (Low Priority)

| # | الموضوع | السبب |
|---|---------|-------|
| ٥ | **تنظيف permissions القديمة** | marketing_visits.* roles بـ DB -- لازم يتنظفوا يدوياً |
| ٦ | **تنظيف migration files القديمة** | ملفات migration يلي بتخص marketing_visits -- ممكن تحذف من سجل المigrations |

---

## ملاحظات تقنية للجلسة الجاي

- الكود كامل بيستخدم field_visits -- ما في marketing_visits anywhere
- السيرفر شغال (pm2 restart golden-crm-staging)
- الـ DB نظيف من الجداول legacy
- أي مهمة جديدة (device_activation, repair, أي شي) = تضاف على visit_tasks مباشرة
- الـ unified endpoint: POST /field-visits/:visitId/tasks/:taskId/result

---

## Contact
- User: Ibrahim Obaid
- Project: Golden CRM (Staging)
- Date: 2026-05-23
