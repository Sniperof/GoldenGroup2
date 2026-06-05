# خطة التنفيذ الشاملة لقرارات DEC-003 و DEC-004 و DEC-005

> التاريخ 2026-05-31
> الحالة مسودة تنفيذية
> المراجع decisions/DEC-003, decisions/DEC-004, decisions/DEC-005
> النطاق Migrations، Backend، Frontend، Constitution، Tests

## القسم الأول: مراجعة الوضع الحالي مقابل القرارات

### ما تم التحقق منه فعلياً في الكود

عبر فحص migrations والكود، تبين أن بعض ما اعتُبر فجوة في النقاش يوجد فعلياً.

`task_type_config`. الجدول موجود منذ migration 106 ويحتوي كل العشرين نوع مهمة seeded. الحقول الموجودة task_type, task_family, arabic_label, scheduling_pattern, window_basis, planning_window_days, contract_required, allow_multiple, has_due_date, display_order, is_active. هذا يُغلق فعلياً G04 المفترض.

`location_basis` على task_type_config. أُضيف في migration 113 بقيمتين client أو contract. يُحدد المنطقة الجغرافية للمهمة. ملاحظة حرجة: 'contract' يشير إلى contracts.installation_geo_unit_id لكن بعد قرار DEC-002 (فصل العقد عن الجهاز)، عنوان التركيب انتقل لـ installed_devices. لذلك location_basis = 'contract' حالياً يقرأ من مكان قديم.

`open_tasks.due_date`. موجود منذ migration 055 (لا يحتاج إنشاء، يحتاج إعادة تسمية فقط في الكود والدستور).

`open_tasks.expected_date`. موجود منذ migration 102.

`open_tasks.expected_time`. غير موجود (يحتاج migration جديد).

`system_settings`. الجدول غير موجود (يحتاج إنشاء).

`contact_targets.target_stage` و `source_type`. موجودان كأعمدة بـ CHECK constraint يقبل 'lead' فقط. غير مستخدمين فعلياً لاتخاذ قرار.

آخر migration حالياً هو 213. أي migration جديد يبدأ من 214.

### Drift بين الكود والدستور

ملف client-snapshot.md يستخدم اسم classification للحقل، الاسم الفعلي candidate_status.

ملف tasks.md §7.4 يقول task_type_config غير موجود، لكنه موجود فعلياً.

ملف tasks.md يذكر due_date كمصطلح، القرار الجديد ينتقل لـ required_date كاسم دلالي. الحقل الفعلي يبقى due_date إلا إذا قررنا migration إعادة تسمية.

ملف visit-detail-page-constitution.md يذكر `customer_snapshot` كـ JSONB يحتاج migration، يحتاج تأكيد أنه فعلاً غير موجود قبل التنفيذ.

### قرار مهم خلال التنفيذ

`due_date` كاسم حقل في DB. هل نُجري migration لإعادة تسمية إلى `required_date`، أم نبقي الاسم في DB ونغيّر فقط في الدستور والـ UI؟ تأثير إعادة التسمية على الكود كبير (الكثير من الـ queries، الـ types، الـ frontend). أقترح الإبقاء على due_date في DB والاكتفاء بتغيير المصطلح في الواجهات والدستور. هذا اختصار في حقل اسم لكنه يمنع كسر widespread. القرار النهائي يتم عند التنفيذ.

## القسم الثاني: تنظيم المهام حسب الـ Domain

### Domain: Database / Migrations

التركيز على schema changes وإضافة جداول وأعمدة جديدة.

| رقم | المهمة | المرجع |
|---|---|---|
| DB-01 | إنشاء جدول system_settings | DEC-005 D26, D29 |
| DB-02 | إضافة cooldown fields على clients | DEC-005 D29 |
| DB-03 | إضافة do_not_contact على clients | DEC-005 D29 |
| DB-04 | إضافة expected_time على open_tasks | DEC-004 D22 |
| DB-05 | إضافة creation_origin + assigned_by + assigned_at + assigned_via على open_tasks | DEC-004 D13 |
| DB-06 | إضافة origin_type + origin_id على field_visits | DEC-003 D3 |
| DB-07 | إضافة appointment_booked_at + booked_by_telemarketer_id + telemarketer_notes + answered_by على field_visits | DEC-003 |
| DB-08 | إضافة customer_snapshot JSONB على field_visits | DEC-003 D12 |
| DB-09 | إضافة cancellation_reason_id + cancellation_notes على field_visits | DEC-003 |
| DB-10 | إضافة location_missing_reason + started_by + ended_by على visit_geo_logs | DEC-004 D17 |
| DB-11 | تحديث field_visits.status CHECK constraint (7 حالات، حذف 3) | DEC-004 D18 |
| DB-12 | تحديث field_visits.visit_type CHECK (marketing/service/mixed) | DEC-003 D4 |
| DB-13 | تحديث visit_type على contact_targets ليقبل marketing/service/collection/mixed | DEC-005 D24 |
| DB-14 | إضافة work_location_geo_unit_id على contact_targets | DEC-005 D27 |
| DB-15 | إضافة closing_reason + closed_by + closed_at + team_key على contact_targets | DEC-005 D26 |
| DB-16 | حذف target_stage و source_type من contact_targets | DEC-005 D30 |
| DB-17 | تحديث UNIQUE constraint على contact_targets إلى (branch_id, target_id, work_location_geo_unit_id, date) | DEC-005 D27 |
| DB-18 | إعادة تسمية latest_appointment_id إلى latest_visit_id على contact_targets + تحديث FK | DEC-004 D23 |
| DB-19 | إضافة قيم جديدة لـ telemarketing_call_logs.outcome CHECK (customer_requested_followup) | DEC-004 D22 |
| DB-20 | إضافة صلاحية field_visits.reopen_closed | DEC-004 D11 |
| DB-21 | إضافة فئات system_lists الجديدة (visit_cancellation_reasons, location_missing_reasons, visit_task_reasons, customer_followup_reasons) | DEC-003 + DEC-004 |
| DB-22 | تعديل location_basis على task_type_config (مراجعة مع DEC-002 لتحديث الاستعلام بدل القيمة) | DEC-005 + DEC-002 |
| DB-23 | حذف جدول telemarketing_appointments بعد ترحيل الكود | DEC-003 D1 |
| DB-24 | حذف جدول visits legacy بعد إزالة المراجع | DEC-005 R1 |
| DB-25 | إضافة لـ task_type_config حقل contact_target_visit_type (marketing/service/collection) | DEC-005 D24 |
| DB-26 | إضافة لـ task_type_config حقل lead_window_days (إذا اختلف عن planning_window_days الحالي) | DEC-005 |

### Domain: Backend (API)

التركيز على endpoints جديدة، تعديل منطق قائم، حذف منطق legacy.

| رقم | المهمة | المرجع |
|---|---|---|
| BE-01 | تعديل closesContactTarget في telemarketingOutcomes.ts (false لكل النتائج عدا booked_marketing_appointment) | DEC-005 D26 |
| BE-02 | تعديل CLOSES_TARGET_OUTCOMES في telemarketing.ts للتفعيل التلقائي لـ cooldown على نتائج الرفض | DEC-005 D29 |
| BE-03 | إضافة endpoint POST /telemarketing/book-visit | DEC-003 D2 |
| BE-04 | إزالة endpoint POST /telemarketing/appointments | DEC-003 D1 |
| BE-05 | تحديث 5 ملفات backend تستخدم telemarketing_appointments للقراءة من field_visits | DEC-003 V-G003 |
| BE-06 | إضافة endpoint POST /open-tasks/:id/schedule-from-expected | DEC-004 D22 |
| BE-07 | تعديل syncAssignedTasks لدعم كل أنواع المهام (مش marketing فقط) | DEC-005 D24 |
| BE-08 | إضافة فحص cooldown_until و do_not_contact في syncAssignedTasks | DEC-005 D29 |
| BE-09 | حذف فلتر NOT EXISTS contracts من contactTargets.ts | DEC-005 |
| BE-10 | حذف فلتر NOT EXISTS visits legacy من contactTargets.ts و planningMarketingTargets.ts | DEC-005 R1 |
| BE-11 | تصحيح ON CONFLICT clause في telemarketing.ts ليطابق UNIQUE constraint الفعلي | DEC-005 ملاحظة 2 |
| BE-12 | إضافة منطق احتساب work_location_geo_unit_id من task_type_config.location_basis | DEC-005 D27 |
| BE-13 | إضافة endpoint POST /contact-targets/:id/close (للإغلاق اليدوي من التيليماركتر) | DEC-005 D26 |
| BE-14 | إضافة CRON job لتنظيف contact_targets يومياً | DEC-005 D26 |
| BE-15 | إضافة endpoint GET /telemarketing/customer/:customerId/all-targets-today (لنافذة الوعي عبر الفرق) | DEC-005 D28 |
| BE-16 | إضافة endpoint POST /field-visits/:id/tasks (cascading موسّع) | DEC-004 D7 |
| BE-17 | إزالة BR-2 trigger القديم في migration 050 (الموعد→الزيارة) | DEC-003 |
| BE-18 | إضافة منطق escalation 24h/48h لـ ended visits | DEC-004 D9 |
| BE-19 | إضافة منطق GPS validation و location_missing في start/end | DEC-004 D17 |
| BE-20 | إزالة endpoint PATCH /field-visits/:id/reschedule | DEC-004 D18 |
| BE-21 | تعديل POST /field-visits/:id/cancel لمنع الإلغاء بعد in_progress | DEC-004 D8 |
| BE-22 | إضافة منطق completed تلقائي عند تسجيل نتيجة آخر مهمة | DEC-004 D16 |
| BE-23 | إضافة فحص D18 الثلاثي في كل booking endpoints (day_schedule موجود + zone في route + التاريخ ≥ اليوم) | DEC-004 D18 |
| BE-24 | إضافة منطق last_waiting_status return عند إلغاء الزيارة أو not_completed | DEC-004 D10 |
| BE-25 | إضافة منطق role-aware permissions (مشرف قياسي / فني طوارئ) | DEC-004 D11 |
| BE-26 | endpoint POST /field-visits/:id/reopen (للإدارة العليا فقط) | DEC-004 D11 |
| BE-27 | إضافة منطق side table إلزامي لكل task_type عند تسجيل النتيجة | DEC-004 D15 |
| BE-28 | فلترة الزبائن المؤرشفين و do_not_contact في syncAssignedTasks | DEC-005 |
| BE-29 | إضافة منطق customer_requested_followup outcome (تحديث open_task لـ needs_follow_up + expected_date/time) | DEC-004 D22 |
| BE-30 | إضافة منطق صلاحية field_visits.reopen_closed | DEC-004 D11 |

### Domain: Frontend (UI)

التركيز على شاشات وتعديلات واجهة.

| رقم | المهمة | المرجع |
|---|---|---|
| FE-01 | تعديل TelemarketerWorkspace لاستخدام POST /telemarketing/book-visit بدل /appointments | DEC-003 D2 |
| FE-02 | إضافة نافذة مصغرة cross-team awareness في TelemarketerWorkspace | DEC-005 D28 |
| FE-03 | إضافة علامة badge "+N فرق" على بطاقة الزبون في قائمة الاتصالات | DEC-005 D28 |
| FE-04 | إضافة خيار "إنهاء هدف اليوم" + sub-checkbox "تفعيل cooldown" في نافذة نتيجة المكالمة | DEC-005 D26 + D29 |
| FE-05 | إضافة زر إغلاق مستقل على بطاقة contact_target | DEC-005 D26 |
| FE-06 | إضافة قسم "حالة التواصل" في شاشة تفاصيل الزبون (إدارة do_not_contact + cooldown) | DEC-005 D29 |
| FE-07 | إضافة نتيجة جديدة customer_requested_followup في قائمة نتائج المكالمة + حقول expected_date/time | DEC-004 D22 |
| FE-08 | إضافة شاشة "متابعات اليوم" (Schedule-from-Expected) | DEC-004 D22 |
| FE-09 | إضافة شاشة "المهام خارج الخطة" لمدير الفرع | DEC-004 D13 |
| FE-10 | إضافة شاشة "زيارات بانتظار التوثيق" (pending documentation) | DEC-004 D9 |
| FE-11 | حذف UI لـ reschedule الزيارة | DEC-004 D18 |
| FE-12 | تعديل VisitDetailPage ليعكس lifecycle جديد (7 حالات) | DEC-004 D18 |
| FE-13 | إضافة UI لإضافة مهام داخل زيارة جارية (cascading) | DEC-004 D7 |
| FE-14 | تعديل start/end visit UI لجمع GPS + معالجة location_missing | DEC-004 D17 |
| FE-15 | إضافة زر "فتح المُقفل" مع modal سبب إلزامي للإدارة العليا | DEC-004 D11 |
| FE-16 | تحديث VisitTaskResultForm لكل task_type ليتضمن side table الإلزامي | DEC-004 D15 |
| FE-17 | إضافة UI لـ Origin display في تفاصيل الزيارة (تيليماركتر/يدوي/طارئ/نظام) | DEC-003 D3 |
| FE-18 | تعديل api.ts لإزالة appointments.* وإضافة fieldVisits.book + scheduleFromExpected + addTask + reopen | DEC-003 + DEC-004 |

### Domain: Constitution Documentation

التركيز على تحديث ملفات الدستور لتعكس التنفيذ الفعلي.

| رقم | المهمة | المرجع |
|---|---|---|
| DOC-01 | تصحيح client-snapshot.md (تغيير classification إلى candidate_status) | drift |
| DOC-02 | تحديث tasks.md §7.4 لإزالة إشارة "task_type_config غير موجود" | drift |
| DOC-03 | إضافة task_type_config schema الكامل في domains/tasks.md | DEC-005 |
| DOC-04 | تحديث domains/clients.md (إن وُجد) لإضافة cooldown + do_not_contact | DEC-005 D29 |
| DOC-05 | كتابة domain ملف جديد للـ system_settings | DEC-005 |
| DOC-06 | تحديث domains/installed-devices.md لتأكيد دور installation_geo_unit_id | DEC-005 + DEC-002 |
| DOC-07 | تحديث features/visit-detail-page-constitution.md ليطابق DEC-003 + DEC-004 | DEC-003 + DEC-004 |
| DOC-08 | إضافة ملف plan للتنفيذ نفسه (هذا الملف) | — |

## القسم الثالث: التنفيذ بمراحل

كل مرحلة لازم تكتمل بالكامل قبل البدء بالمرحلة التالية لتجنب التراجعات.

### المرحلة 1: الأساسيات (Foundation)

الهدف. إنشاء الجداول والإعدادات اللازمة لكل ما بعدها. لا تغييرات في منطق قائم.

المهام المتضمنة. DB-01 (system_settings)، DB-25 (contact_target_visit_type على task_type_config)، DB-26 (lead_window_days إن لزم)، DB-21 (system_lists الجديدة)، DB-20 (permission field_visits.reopen_closed).

التحقق من الإكمال. الجداول والحقول الجديدة موجودة وقابلة للاستعلام. seed data للقيم الافتراضية محفوظ. permissions مسجلة. لا تأثير على الكود الحالي.

الزمن المتوقع. يوم عمل واحد.

### المرحلة 2: حقول الزبون (Customer Foundation)

الهدف. إضافة حقول إدارة التواصل على الزبون.

المهام المتضمنة. DB-02 (cooldown fields)، DB-03 (do_not_contact)، DOC-04 (دستور clients).

التحقق من الإكمال. جدول clients يحتوي الحقول الجديدة بقيم افتراضية (NULL أو FALSE). لا تغيير في الكود الفعلي. التطبيق يعمل كما كان.

الزمن المتوقع. نصف يوم عمل.

### المرحلة 3: حقول المهمة المفتوحة

الهدف. توسيع open_tasks ليدعم القرارات الجديدة.

المهام المتضمنة. DB-04 (expected_time)، DB-05 (creation_origin + assigned_*).

التحقق من الإكمال. الحقول الجديدة على open_tasks بقيم افتراضية. كل المهام القائمة تحصل على creation_origin افتراضي. الكود القائم يعمل بدون تعديل.

الزمن المتوقع. يوم عمل واحد.

### المرحلة 4: حقول الزيارة الميدانية

الهدف. توسيع field_visits ليدعم النموذج الموحد.

المهام المتضمنة. DB-06 (origin)، DB-07 (booking metadata)، DB-08 (customer_snapshot)، DB-09 (cancellation)، DB-10 (geo_logs extras).

التحقق من الإكمال. كل الحقول الجديدة موجودة بقيم افتراضية أو NULL مناسبة. الزيارات القائمة لا تُكسر. الكود القائم لا يتأثر.

الزمن المتوقع. يوم عمل واحد.

### المرحلة 5: تحديث contact_targets schema

الهدف. تحويل grain جهة الاتصال للنموذج الجديد.

تحذير. هذه مرحلة حساسة جداً. UNIQUE constraint يتغير. حقول تُحذف. لازم data migration دقيق.

المهام المتضمنة. DB-13 (visit_type expansion)، DB-14 (work_location_geo_unit_id)، DB-15 (closing fields)، DB-18 (rename latest_appointment_id)، DB-17 (UNIQUE update)، DB-16 (drop target_stage + source_type).

خطوات التنفيذ.
1. إضافة الحقول الجديدة كـ nullable أو بقيم افتراضية.
2. تشغيل data migration لتعبئة work_location_geo_unit_id من المهام المرتبطة.
3. تشغيل data migration لتعبئة latest_visit_id من telemarketing_appointments.latest_appointment_id حيث ممكن.
4. تحديث الكود ليستخدم الأعمدة الجديدة (المرحلة التالية).
5. بعد التحقق من عمل الكود الجديد، حذف UNIQUE القديم وإضافة UNIQUE الجديد.
6. أخيراً حذف الأعمدة المُهملة target_stage و source_type.

التحقق من الإكمال. كل contact_targets القائمة عندها work_location_geo_unit_id غير فارغ. الـ UNIQUE الجديد يعمل. كود الـ INSERT الجديد لا يفشل.

الزمن المتوقع. يومان عمل (التغيير + data migration + التحقق).

### المرحلة 6: تحديث field_visits و visit_geo_logs CHECK constraints

الهدف. تطبيق lifecycle الجديد.

المهام المتضمنة. DB-11 (status CHECK)، DB-12 (visit_type CHECK).

تحذير. تغيير CHECK constraint يحتاج التأكد أن لا توجد بيانات حالية تخالف القيود الجديدة. مثلاً لا يجب وجود زيارات بحالة postponed_by_company قبل تطبيق الـ CHECK الجديد.

خطوات التنفيذ.
1. data migration: ترحيل أي زيارات بحالات قديمة محذوفة إلى حالات جديدة مكافئة. مثلاً postponed_by_customer + scheduled_date < CURRENT_DATE → cancelled. needs_reschedule → cancelled.
2. تحديث CHECK constraint.
3. التحقق من عدم وجود انتهاكات.

الزمن المتوقع. يوم عمل.

### المرحلة 7: tasks_type_config update

الهدف. تحديث location_basis ليتسق مع DEC-002 (فصل العقد عن الجهاز).

المهام المتضمنة. DB-22.

خطوات التنفيذ.
1. مراجعة كل استعلام يستخدم location_basis = 'contract'.
2. تغيير الاستعلام ليقرأ من installed_devices.installation_geo_unit_id بدلاً من contracts.installation_geo_unit_id.
3. اختياري: إعادة تسمية القيمة من 'contract' إلى 'device' لوضوح أكبر، مع تحديث كل المراجع.

الزمن المتوقع. يوم عمل.

### المرحلة 8: منطق الـ Backend الأساسي

الهدف. تحديث المنطق الجوهري بدون كسر الواجهة.

المهام المتضمنة. BE-01 و BE-02 (outcomes flags)، BE-07 (syncAssignedTasks توسيع)، BE-08 (cooldown filters)، BE-09 (drop contracts filter)، BE-10 (drop visits filter)، BE-11 (ON CONFLICT fix)، BE-12 (work_location calc)، BE-28 (archived filter).

ترتيب التنفيذ الحرج. BE-01 و BE-02 معاً (تغيير flags + manual تفعيل cooldown). BE-09 و BE-10 معاً (إزالة فلاتر قديمة). BE-07 و BE-08 و BE-12 معاً (توسيع syncAssignedTasks).

التحقق من الإكمال. اختبارات لـ syncAssignedTasks تشمل كل أنواع المهام. اختبارات للفلاتر الجديدة على الزبون. مكالمة بنتيجة not_interested تفعل cooldown بشكل صحيح.

الزمن المتوقع. ثلاثة أيام عمل.

### المرحلة 9: endpoints جديدة و legacy removal

الهدف. تحويل التيليماركتر للنموذج الجديد، إزالة الـ legacy.

المهام المتضمنة. BE-03 (book-visit)، BE-04 (drop appointments)، BE-05 (update 5 files)، BE-06 (schedule-from-expected)، BE-13 (close contact target)، BE-15 (cross-team endpoint)، BE-16 (add visit task)، BE-17 (drop BR-2 trigger)، BE-20 (drop reschedule)، BE-21 (restrict cancel)、BE-22 (auto completed)، BE-23 (D18 booking check)، BE-26 (reopen endpoint)、BE-30 (reopen permission check).

ترتيب التنفيذ الحرج. BE-05 لازم تكتمل قبل BE-04 (لا نحذف appointments قبل توقف القراءة منه). BE-23 (D18 check) قبل BE-03 (book-visit يعتمد على الفحص).

الزمن المتوقع. خمسة أيام عمل.

### المرحلة 10: CRON و escalation

الهدف. آليات التشغيل الذاتية.

المهام المتضمنة. BE-14 (CRON contact_targets)، BE-18 (escalation 24h/48h)、BE-19 (GPS validation).

التحقق من الإكمال. CRON يعمل بنجاح، يغلق contact_targets القديمة، يرجع المهام. escalation يرسل إشعارات في الوقت المحدد. GPS missing يطلب سبب من قائمة.

الزمن المتوقع. ثلاثة أيام عمل.

### المرحلة 11: حذف الـ legacy الفعلي

الهدف. تنظيف نهائي.

المهام المتضمنة. DB-23 (drop telemarketing_appointments)، DB-24 (drop visits legacy).

شرط. كل المراجع في الكود مزالة. اختبارات تشغيل كاملة بدون أي خطأ. data migration للسجلات المهمة محفوظة في field_visits.

الزمن المتوقع. يوم عمل (مع التحقق).

### المرحلة 12: الواجهة الأمامية

الهدف. تحديث UI ليعكس كل القرارات.

المهام المتضمنة. كل FE-01 إلى FE-18.

ترتيب التنفيذ الحرج. FE-18 (تعديل api.ts) قبل أي شاشة تعتمد على endpoints الجديدة. FE-01 (تحديث TelemarketerWorkspace book) من أول الأولويات.

الزمن المتوقع. ثمانية أيام عمل (متفرقة على مكونات متعددة).

### المرحلة 13: التوثيق النهائي

الهدف. اتساق الدستور مع التنفيذ.

المهام المتضمنة. DOC-01 إلى DOC-08.

الزمن المتوقع. يومان عمل.

## القسم الرابع: الشروط العامة قبل تنفيذ أي مهمة

### الشرط الأول: قراءة المراجع

قبل أي مهمة، لازم قراءة ما يلي.

- ملف القرار المرتبط (DEC-003 أو DEC-004 أو DEC-005).
- ملف الدومين المرتبط في docs/constitution/domains.
- أي ملف feature في docs/constitution/features يتعلق بالمهمة.
- ملفات الكود الفعلي المتأثرة (الملفات المذكورة في المهمة).

### الشرط الثاني: التحقق من حالة DB الحالية

قبل أي migration.
- التأكد من آخر migration رقم مطبق.
- فحص schema الحالي للجدول المعني.
- فحص أي migrations سابقة تتعامل مع نفس الحقول.
- البحث عن drift بين الوصف في الدستور والـ schema الفعلي.

### الشرط الثالث: تحديد التبعيات

- ما هي الـ tables التي تشير إلى هذا الجدول (FKs)؟
- ما هي الـ queries في الكود التي تستخدم هذه الحقول؟
- هل هناك tests تعتمد على البنية الحالية؟
- هل هناك migrations مستقبلية موجودة في المسودات تعتمد على ما سنغيره؟

### الشرط الرابع: خطة rollback

- لكل تغيير في DB، صياغة DOWN migration واضحة.
- لكل تغيير في كود، التأكد من إمكانية الرجوع عبر git revert.
- البيانات المُحوَّلة محفوظة قبل التحويل (snapshot أو backup table).

### الشرط الخامس: التحقق على بيئة staging أولاً

- لا تشغيل أي migration مباشرة على production.
- التشغيل على staging أولاً، تشغيل اختبارات تحقق، التأكد من سلامة البيانات.
- بعد 24-48 ساعة من النجاح على staging، التطبيق على production.

### الشرط السادس: التواصل قبل التنفيذ

- إعلام صاحب المنتج بالمهمة قبل البدء.
- مشاركة خطة التنفيذ التفصيلية.
- الحصول على موافقة صريحة على نقاط حرجة (migrations كبيرة، حذف بيانات).

## القسم الخامس: شروط خاصة للمهام الحرجة

### المهام الحرجة جداً تحتاج تحضير إضافي

#### المرحلة 5 (تحديث contact_targets schema)

شرط إضافي. توقيف syncAssignedTasks مؤقتاً أثناء data migration لـ work_location_geo_unit_id. فترة التوقف لازم تكون خارج ساعات العمل.

شرط إضافي. backup كامل لـ contact_targets قبل التشغيل.

شرط إضافي. اختبار النموذج الجديد على staging مع بيانات مماثلة لـ production في الحجم.

#### BE-04 (drop /telemarketing/appointments endpoint)

شرط إضافي. التحقق من أن frontend لا يستدعي هذا الـ endpoint. grep في كل client code.

شرط إضافي. تجربة /book-visit الجديد بكل سيناريوهاته قبل حذف القديم.

شرط إضافي. الإبقاء على endpoint القديم لأسبوع كـ deprecated مع log warning قبل حذفه نهائياً.

#### DB-23 و DB-24 (drop telemarketing_appointments + visits)

شرط إضافي. snapshot كامل للجدولين قبل الحذف.

شرط إضافي. التحقق التام عبر grep أن لا يوجد مرجع متبقي في الكود.

شرط إضافي. مرور 14 يوم على الأقل من توقف الاستخدام قبل الحذف الفعلي.

#### المرحلة 7 (task_type_config location_basis update)

شرط إضافي. مراجعة DEC-002 بالكامل لفهم كيف انفصل العقد عن الجهاز.

شرط إضافي. التحقق من أن installed_devices.installation_geo_unit_id موجود ومُحدَّث لكل الأجهزة القائمة.

شرط إضافي. اختبار الاستعلام الجديد للتأكد من أنه يعطي نفس نتائج الاستعلام القديم (في الحالات السليمة).

#### BE-07 (توسيع syncAssignedTasks)

شرط إضافي. اختبار شامل لـ service و collection على staging قبل production.

شرط إضافي. التحقق أن الـ first-come-first-served آلية تعمل مع الأنواع الجديدة.

شرط إضافي. اختبار تنازع فريقين على نفس الزبون في نفس المنطقة بأنواع مهام متعددة.

## القسم السادس: مؤشرات الجودة والقبول

### معايير قبول كل مرحلة

كل مرحلة لازم تحقق التالي قبل الانتقال للتالية.

#### الاختبار البرمجي
- تشغيل كل الـ unit tests و integration tests الموجودة بدون فشل.
- إضافة tests جديدة للمنطق الجديد.
- coverage للمنطق الحرج لا يقل عن 80%.

#### الاختبار التشغيلي
- سيناريو end-to-end لكل قرار رئيسي يعمل على staging.
- اختبار يدوي للسيناريوهات الحرجة.

#### الاختبار البياناتي
- التحقق أن بيانات production لا تنتهك القيود الجديدة.
- التحقق أن data migrations لم تفقد سجلات.

#### التوثيق
- الدستور محدّث ليعكس التنفيذ الفعلي.
- تعليقات في الكود واضحة عند التغييرات الكبيرة.
- changelog منفصل لكل مرحلة.

### معايير الفشل (Rollback Triggers)

في حال حصول أي من التالي، rollback فوري.

- تعطل أكثر من 5% من سيناريوهات حرجة على staging.
- فقدان بيانات أثناء migration.
- زمن استجابة API يتجاوز الحدود المقبولة (تقدير زيادة أكثر من 50% عن المعدل).
- خطأ في فلتر يؤدي إلى ظهور زبائن لم يجب ظهورهم (مثلاً في cooldown).

## القسم السابع: التقدير الزمني الإجمالي

| المرحلة | الوصف | الزمن |
|---|---|---|
| 1 | Foundation tables | يوم |
| 2 | Customer foundation | نصف يوم |
| 3 | Open tasks fields | يوم |
| 4 | Field visits fields | يوم |
| 5 | Contact targets schema (حرج) | يومان |
| 6 | CHECK constraints update | يوم |
| 7 | task_type_config update | يوم |
| 8 | Backend core logic | ثلاثة أيام |
| 9 | New endpoints + legacy removal | خمسة أيام |
| 10 | CRON + escalation + GPS | ثلاثة أيام |
| 11 | Legacy DB drop | يوم |
| 12 | Frontend | ثمانية أيام |
| 13 | Documentation finalization | يومان |

**الإجمالي. حوالي 30 يوم عمل (6 أسابيع) لمهندس واحد، أو 15 يوم لمهندسَين متوازيَين مع التنسيق.**

ملاحظة. التقديرات لا تشمل وقت المراجعة، الاختبار اليدوي الموسع، أو الـ feedback iterations.

## القسم الثامن: المخاطر والتخفيف

### مخاطر تقنية

**خطر**. data migration كبيرة لـ contact_targets قد تفشل أو تؤدي لفقدان سجلات.
**التخفيف**. تشغيل على staging أولاً، backup كامل، إمكانية rollback، تنفيذ في نافذة منخفضة الحمل.

**خطر**. توسيع syncAssignedTasks قد يُبطئ الـ planning يومياً بسبب زيادة عدد المهام المُسندة.
**التخفيف**. profiling قبل وبعد التغيير، تحسين الـ queries، indexing مناسب.

**خطر**. CRON job قد يفشل بصمت أو يدخل في حلقة لا نهائية.
**التخفيف**. logging مكثف، حدود زمنية، تنبيهات عند الفشل، اختبار dry-run قبل التفعيل.

### مخاطر بشرية

**خطر**. التيليماركترز يستخدمون الواجهة القديمة بعد إطلاق الجديدة (عدم التواصل).
**التخفيف**. تدريب مسبق، فترة تجربة بالتوازي، إيقاف تدريجي للقديم.

**خطر**. مدراء الفروع يعتبرون التغييرات تعطيلاً لتدفقهم اليومي.
**التخفيف**. عرض مسبق على عينة، تعديل بناءً على التغذية الراجعة، تدريب.

### مخاطر منهجية

**خطر**. اكتشاف drift جديد بين الدستور والكود خلال التنفيذ.
**التخفيف**. مرحلة تحضير دستوري قبل المراحل الكبيرة، توثيق فوري لكل drift يُكتشف.

## القسم التاسع: ما الذي لا تشمله هذه الخطة

- لا تنفيذ NOT EXISTS visits filter في contactTargets.ts فعلياً قبل التأكد من ما يفترض أن يكون الفلتر (هل نريد فلترة الزبائن الذين عندهم زيارة سابقة في field_visits، أم لا فلترة على الإطلاق؟). تحتاج قرار منفصل.

- لا تنفيذ منطق "زبون عنده زيارة مجدولة بنفس اليوم" قبل حسم P-DEC005-02.

- لا تنفيذ Schedule-from-Expected window قبل حسم P-DEC005-03 و P-DEC004-02.

- لا تنفيذ side tables لـ كل الـ 20 نوع مهمة قبل حسم P-DEC005-05.

## القسم العاشر: نقاط حسم متبقية قبل التنفيذ الكامل

من القرارات المعلقة المسجلة في DEC-003 + DEC-004 + DEC-005.

P-DEC003-01. قائمة المهام المسموح إضافتها cascading أثناء in_progress (محسوم في DEC-004 D7 موسّع، يحتاج تحديث).

P-DEC003-02. مصير visit_tasks غير المكتملة عند إلغاء الزيارة (محسوم في DEC-004).

P-DEC003-03. حد المحاولات قبل التدخل الإداري (مفتوح، اختياري للمرحلة الأولى).

P-DEC004-01. قيم system_lists الجديدة (يحتاج جلسة).

P-DEC004-02. نافذة Schedule-from-Expected (يحتاج حسم).

P-DEC004-03. حد escalation العلوي (يحتاج حسم).

P-DEC004-04. الـ 20 نوع مهمة (موجودة في task_type_config بالفعل، يحتاج فقط مراجعة seed).

P-DEC004-05. side tables (يحتاج جلسة تصميم لكل نوع).

P-DEC005-01. periodic_maintenance لفريق طوارئ (يحتاج حسم).

P-DEC005-02. استبعاد زبون عنده زيارة بنفس اليوم (يحتاج حسم).

P-DEC005-03. تفاعل expected_date مع contact_targets (يحتاج حسم).

P-DEC005-04. task_type_config schema الكامل (موجود، يحتاج إضافة contact_target_visit_type).

P-DEC005-05. ربط call_log بـ multiple contact_targets (يحتاج تصميم).

P-DEC005-06. صلاحية فك cooldown (يحتاج حسم: مشرف فقط أم مدير الفرع أيضاً).

## القسم الحادي عشر: الخلاصة

هذه الخطة مبنية على 30 قراراً معتمداً عبر 3 سجلات قرار، وتغطي حوالي 80 مهمة تنفيذية مقسمة على 13 مرحلة.

الأهم في التنفيذ.
- الالتزام بالترتيب: لا قفز للأمام، لا تخطي مراحل.
- شروط التحقق قبل أي مهمة.
- backup و rollback دائماً جاهزَين.
- التواصل المستمر مع صاحب المنتج.
- التوثيق الفوري لأي drift أو اكتشاف.

النقاط المعلقة 13 قراراً صغيراً يحتاج حسم قبل أو خلال التنفيذ. بعضها لا يُعطّل البدء (مثل P-DEC005-05)، بعضها يُعطّل مراحل محددة (مثل P-DEC005-02 يعطل اكتمال syncAssignedTasks).

التوصية. البدء بالمرحلة 1 فوراً (لا تبعية لقرارات معلقة)، حسم القرارات المعلقة بالتوازي خلال أول أسبوعَين.
