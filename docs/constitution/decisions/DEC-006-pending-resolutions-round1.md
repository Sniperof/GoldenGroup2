# قرار معماري: حسم النقاط المعلقة من DEC-003 و DEC-004 و DEC-005 (الجولة الأولى)

> رقم القرار DEC-006
> التاريخ 2026-05-31
> الحالة معتمد
> الأولوية عالية
> يكمل DEC-003 و DEC-004 و DEC-005
> الكيانات المتأثرة contact_targets, open_tasks, field_visits, telemarketing_call_logs, clients, system_lists, system_settings, task_type_config, route_assignments, day_schedule

## 1 الملخص التنفيذي

هذا القرار يحسم تسع نقاط معلقة (P-DEC*) أُجلت عند توثيق DEC-003 و DEC-004 و DEC-005. النقاط المحسومة هنا خفيفة إلى متوسطة وتُمكّن البدء بمرحلة التنفيذ دون انتظار النقطتين الثقيلتين المتبقيتين (تصميم task_type_config الكامل و side tables لكل نوع مهمة).

أبرز التحولات. اعتماد فريق الطوارئ على نوع مهمة واحد فقط. مدير الفرع هو الجهة الوحيدة لفك cooldown اليدوي. needs_follow_up يمر بالمسار التشغيلي الكامل ولا يلتف على دور مدير الفرع. لا إغلاق قسري لزيارات بلا توثيق. إعادة تصميم outcomes التيلماركتر بتوحيد المتشابهات وتفصيل الأسباب في قوائم system_lists.

## 2 القرارات

### D31: capability فريق الطوارئ يقتصر على emergency_maintenance

(يحسم P-DEC005-01)

فريق الطوارئ (EmergencySlot) يستلم نوع مهمة واحد فقط هو emergency_maintenance. لا يستلم periodic_maintenance ولا غيره من الأنواع.

السبب. الصيانة الدورية مهمة مخططة لها نافذة زمنية واسعة عبر planning_window_days ولا تستفيد من سرعة استجابة فريق الطوارئ. توسيع نطاق فريق الطوارئ يُضعف تركيزه على الحالات العاجلة ويخلق تنافساً غير ضروري مع الفريق القياسي. الصيانة الدورية يتولاها الفريق القياسي حصراً يُبقي وضوح الأدوار.

تأثير على الكود. workScope لفريق الطوارئ يفلتر open_tasks حيث task_type = 'emergency_maintenance' فقط. لا توسيع للنوع.

### D32: فك cooldown اليدوي لمدير الفرع حصراً

(يحسم P-DEC005-06)

فك cooldown قبل انتهاء مدته الافتراضية صلاحية حصرية لمدير الفرع. التيلماركتر والمشرف لا يملكان هذه الصلاحية.

السبب. cooldown غالباً يُفعَّل بعد رفض صريح من الزبون (not_interested) أو قرار تشغيلي مدروس. فكه قبل المدة يعني تجاوز قرار سابق أو رغبة الزبون. مدير الفرع لديه رؤية شاملة لسجل الزبون. المشرف قد يُضغط لفك cooldown تحت تحقيق أهداف يومية.

تأثير على الكود. صلاحية جديدة permissions.cooldown_unlock مرتبطة بدور branch_manager. واجهة فك cooldown تظهر فقط لمن يملكها.

### D33: إغلاق contact_target يكفي لمنع إعادة الإنشاء في نفس اليوم

(يحسم P-DEC005-02)

لا حاجة لشرط استثناء إضافي يفحص وجود زيارة scheduled أو in_progress للزبون في نفس اليوم. آلية إغلاق contact_target نفسها (D26 من DEC-005) كافية. حجز الزيارة يُغلق contact_target تلقائياً. أي open_task جديد يصل بعد الإغلاق ينتظر اليوم التالي ليُولّد contact_target جديداً.

تأثير على الكود. لا فلاتر إضافية في syncAssignedTasks متعلقة بـ field_visits المجدولة لليوم. الفلتر يعتمد على contact_targets.status = 'closed' AND date = CURRENT_DATE.

### D34: call_log يرتبط بـ contact_target واحد محدد

(يحسم P-DEC005-05)

كل سجل مكالمة (call_log) يرتبط بـ contact_target واحد عبر FK مفرد. التيلماركتر يختار الـ contact_target المعني صراحةً قبل تسجيل نتيجة المكالمة.

السبب. المكالمة الفعلية مع الزبون تدور حول موقع أو مهمة محددة، والتيلماركتر يعرف لأي موقع يتصل. الربط المتعدد يُعقّد التقارير ويُصعّب احتساب closesContactTarget. إذا تطلب الموقف معالجة موقعين في نفس المكالمة، يُسجَّل call_log منفصل لكل واحد.

تأثير على الكود. حقل telemarketing_call_logs.contact_target_id NOT NULL FK إلى contact_targets. الواجهة تُلزم اختياره. الربط بـ client_id يبقى للتقارير العامة فقط.

### D35: needs_follow_up يمر بالمسار التشغيلي الكامل

(يحسم P-DEC005-03)

المهام بحالة needs_follow_up تخضع لنفس الدورة الكاملة. مدير الفرع يُدرجها ضمن workScope. الفريق يستلمها عبر syncAssignedTasks. تظهر في contact_targets يوم expected_date. لا تجاوز لخطوة تخصيص المنطقة والفريق.

التمييز عن open. على بطاقة contact_target يظهر مؤشر صريح يقرأ "متابعة من موعد متوقع" يعكس قيمة origin = expected_followup. سجل المكالمات السابقة مرئي للتيلماركتر لقراءة السياق.

المسارات المتاحة. الأول مكالمة تأكيد ثم حجز عبر النتيجة العادية. الثاني زر اختصار Schedule-from-Expected ينشئ الزيارة مباشرة بدون مكالمة عند تقدير التيلماركتر أن المكالمة السابقة كافية.

ما لا يحدث. لا إغفال لمعلومة أن المهمة جاءت من expected_date. لا تجاوز لمدير الفرع. لا ظهور مزدوج (في contact_targets وفي شاشة منفصلة في نفس الوقت).

### D36: نافذة قبلية يوم واحد لـ needs_follow_up

(يحسم P-DEC004-02)

needs_follow_up tasks تظهر في contact_targets يوماً واحداً قبل expected_date تماماً، وتبقى ظاهرة كمتأخرة بعد فوات التاريخ.

السبب التشغيلي. الجدولة الفعلية للزيارة تحدث قبل يوم من تنفيذها (التيلماركتر يتصل اليوم لحجز موعد الغد). إظهار needs_follow_up يوماً واحداً قبل expected_date يُمكّن من جدولة زيارة في expected_date نفسه. صفر يوم قبل يجعل الجدولة مستحيلة (لا يمكن جدولة زيارة اليوم في اليوم نفسه). أكثر من يوم ينتهك وعد الزبون بالموعد.

ملاحظة منهجية. هذه القيمة (يوم واحد) ثابتة لحالة needs_follow_up بغض النظر عن task_type_config.lead_window_days للحالة open. السبب أن expected_date وعد دقيق من الزبون يحترم بدقة، بينما lead_window_days للحالة open هو نافذة استكشافية للتيلماركتر.

تأثير على الكود. منطق contact_targets generation يفحص الحالة. لو status = 'needs_follow_up' يطبق نافذة يوم واحد. لو status = 'open' يطبق lead_window_days من task_type_config.

### D37: لا سقف تلقائي لمحاولات الاتصال

(يحسم P-DEC003-03)

لا سقف عددي يُغلق open_task قسرياً بعد عدد محاولات معين. الإغلاق يبقى يدوياً بالكامل بقرار التيلماركتر أو المشرف.

أداة الرقابة. تنبيه في لوحة المشرف عند تجاوز open_task عتبة محاولات قابلة للضبط من system_settings.attempt_alert_threshold بقيمة افتراضية مبدئية 5 محاولات. التنبيه إعلامي لا يمنع المحاولات الإضافية.

السبب. الحد العددي يفشل في حالات حقيقية. زبون صعب الوصول قيمته عالية قد يستحق 15 محاولة. زبون آخر يجب التوقف بعد 3 محاولات. القرار سياقي لا عددي.

حالة الكود. حقل attempt_count موجود على open_tasks ويُزاد مع كل call_made. لا منطق إغلاق قسري حالياً. لا تعديل مطلوب في DB. المطلوب فقط system_settings entry جديد ولوحة مراقبة جديدة للمشرف.

### D38: لا إغلاق قسري للزيارة، تصعيد إشعارات ثلاثي

(يحسم P-DEC004-03)

الزيارة بحالة in_progress (أي بدأت ميدانياً ولم تُوثَّق نتيجتها بعد) لا تُغلق قسرياً مهما طال الوقت. الإغلاق يبقى موكولاً لتوثيق بشري.

آلية التصعيد. ثلاث مراحل قابلة للضبط من system_settings.

المرحلة الأولى. بعد 24 ساعة من بدء الزيارة بدون توثيق. تنبيه للفني المسؤول وفنيي الفريق.

المرحلة الثانية. بعد 48 ساعة. تنبيه للمشرف. منع الفني من بدء أي زيارة جديدة حتى يوثق السابقة.

المرحلة الثالثة. بعد 72 ساعة. تصعيد لمدير الفرع.

السبب. الإغلاق القسري يُتلف بيانات حقيقية لا يمكن استرجاعها (نوع المشكلة، الحل، الجباية، نتيجة المهمة). التصعيد يحفّز التوثيق دون فقدان البيانات.

تأثير على الكود. CRON job جديد يفحص field_visits بحالة in_progress وعمرها. system_settings keys جديدة لكل من العتبات الثلاث (افتراضي 24، 48، 72 ساعة). منطق technician.startVisit يفحص هل لدى الفني زيارة معلقة منذ أكثر من 48 ساعة ويمنع البدء.

### D39: إعادة تصميم outcomes التيلماركتر و system_lists المرتبطة

(يحسم P-DEC004-01 جزئياً مع التركيز على فئات outcomes)

عدد outcomes ينخفض من 19 إلى 16 عبر دمج المتشابهات. الأسباب الفرعية تُفصل في قوائم system_lists.

outcomes المحذوفة. other_company_not_interested. seen_offer_not_interested. other_company_callback. seen_offer_callback.

outcomes الجديدة المضافة. customer_requested_followup (من DEC-004 D14) يحل محل other_company_callback و seen_offer_callback مع سبب من customer_followup_reasons.

outcomes المحتفظ بها مع تعديل دلالي. not_interested تستوعب الآن "غير مهتم نهائياً" بكل أسبابه. الأسباب اختيارية من not_interested_reasons لأغراض التقارير لا للمنطق.

فئات system_lists الجديدة الخمس.

customer_followup_reasons. تُستخدم عند customer_requested_followup. إلزامية.

visit_cancellation_reasons. تُستخدم عند إلغاء زيارة scheduled قبل بدئها (D8 من DEC-004). إلزامية.

location_missing_reasons. تُستخدم عند استثناء GPS أثناء الزيارة (D17 من DEC-004). إلزامية.

cooldown_manual_reasons. تُستخدم عند تفعيل cooldown يدوياً (D29 من DEC-005). إلزامية.

visit_not_completed_reasons. تُستخدم عند توثيق زيارة بنتيجة not_completed (D16 من DEC-004). إلزامية.

not_interested_reasons. تُستخدم اختياراً عند not_interested لأغراض التقارير. اختيارية.

فئات system_lists المحذوفة من الكود الحالي.

telemarketing_rejection_reason. مغطاة بـ outcomes الجديدة المتمايزة. القيم الست تُهجَّر للحذف.

telemarketing_reschedule_reason. تُستبدل بـ customer_followup_reasons. القيم الخمس تُهجَّر لقيم الفئة الجديدة.

فئات system_lists المحتفظ بها بلا تغيير.

emergency_unresolved_reason. خاصة بنتيجة زيارة الطوارئ. لا علاقة بـ outcomes التيلماركتر.

no_closing_reasons. خاصة بإغلاق العقد. لا تأثر.

ملاحظة معلقة. القيم الفعلية لكل فئة من الفئات الست الجديدة لم تُحسم نهائياً ضمن هذا القرار. القيم المقترحة في DEC-006 ملاحق سيكون نقطة نقاش لاحقة (P-DEC006-01). الأهم هنا اعتماد هيكل الفئات.

## 3 ملاحظات معلقة من فحص الكود

أثناء فحص telemarketingOutcomes.ts لاتخاذ D39 رُصدت ملاحظات.

الأولى. yes/no flags الحالية closesContactTarget و opensAppointment تحتاج مراجعة بعد حذف outcomes المتعددة. النتائج الأربع المحذوفة كانت تُحدد closesContactTarget بقيم متفاوتة. customer_requested_followup الجديد يحمل closesContactTarget=false ثابت.

الثانية. legacy codes rejected و booked لا تزال موجودة في OUTCOME_MAP لـ backward compatibility. normaliseOutcomeCode يحوّلها. تنظيف نهائي بعد التأكد من خلو DB من هذه القيم.

الثالثة. address_updated و new_number outcomes تستخدم requiresNotes=true (ملاحظات نصية). لا حاجة لقائمة system_list لهما. سلوك مختلف عن outcomes الأخرى التي تحتاج قائمة معيارية.

## 4 التأثير على الكود

### migrations مطلوبة

تعديلات على system_lists. حذف صفوف category IN ('telemarketing_rejection_reason', 'telemarketing_reschedule_reason'). إدراج 5 فئات جديدة (customer_followup_reasons، visit_cancellation_reasons، location_missing_reasons، cooldown_manual_reasons، visit_not_completed_reasons) بقيم seed أولية لاحقاً. إدراج فئة سادسة اختيارية not_interested_reasons.

تعديلات على system_settings (إنشاء الجدول إن لم يكن موجوداً). إضافة مفاتيح. attempt_alert_threshold INTEGER DEFAULT 5. visit_undocumented_alert_hours_l1 INTEGER DEFAULT 24. visit_undocumented_alert_hours_l2 INTEGER DEFAULT 48. visit_undocumented_alert_hours_l3 INTEGER DEFAULT 72. (سبق توثيق default_cooldown_days و contact_target_cleanup_time في DEC-005).

تعديلات على permissions. إضافة permission key اسمه cooldown_unlock مرتبطة بدور branch_manager.

تعديلات على telemarketing_call_logs. التأكد من وجود FK contact_target_id NOT NULL. لو لم يكن موجوداً، migration لإضافته.

### Backend

تعديل telemarketingOutcomes.ts. حذف 4 outcomes (other_company_not_interested، seen_offer_not_interested، other_company_callback، seen_offer_callback). إضافة customer_requested_followup. تحديث normaliseOutcomeCode لـ mapping legacy. تحديث requiresReason وحقل reasonsCategory لكل outcome يحتاج قائمة.

تعديل syncAssignedTasks لفريق الطوارئ. فلتر task_type = 'emergency_maintenance' فقط.

تعديل منطق contact_targets generation. تطبيق نافذة يوم واحد لـ needs_follow_up بدل lead_window_days العامة.

تعديل منطق close cooldown. فحص permissions.cooldown_unlock قبل السماح.

CRON job جديد لمراقبة الزيارات بدون توثيق. يفحص field_visits.status='in_progress' AND started_at قديم بحسب العتبات.

منطق startVisit في endpoint الفني. فحص هل لدى الفني زيارة بدون توثيق منذ > 48 ساعة. إن وجدت يمنع البدء برسالة واضحة.

### Frontend

تعديل OutcomeRecorderModal. حذف الخيارات المحذوفة. إضافة customer_requested_followup. إضافة dropdown ديناميكي يقرأ من system_lists بحسب reasonsCategory للـ outcome.

تعديل بطاقة contact_target. إضافة مؤشر "متابعة من موعد متوقع" عند origin = expected_followup.

تعديل بطاقة Telemarketer Workspace. عند اختيار contact_target قبل بدء مكالمة لتسجيل call_log عليه.

لوحة المشرف. تنبيه عند تجاوز attempt_alert_threshold لأي open_task.

لوحة الفني. منع بدء زيارة جديدة إذا توجد زيارة معلقة منذ > 48 ساعة. رسالة تشرح السبب.

شاشة تفاصيل الزبون. ظهور زر "فك Cooldown" فقط لمدير الفرع.

CRUD واجهة system_lists. إضافة الفئات الجديدة كأقسام في شاشة الأدمن. حذف القديمتين.

## 5 التأثير على الدستور

domains/telemarketing.md. تحديث قائمة outcomes الكاملة. إعادة كتابة قسم reasons لتعكس الفئات الجديدة. حذف إشارات لـ outcomes المحذوفة.

domains/visits.md. إضافة قسم تصعيد عدم التوثيق (D38). تحديث قسم إلغاء الزيارة لذكر visit_cancellation_reasons. تحديث قسم GPS لذكر location_missing_reasons. تحديث قسم not_completed لذكر visit_not_completed_reasons.

domains/tasks.md. تحديث قسم needs_follow_up لذكر النافذة القبلية يوم واحد ثابت (D36). توضيح المسار الكامل (D35).

domains/planning.md. تحديث وصف workScope لفريق الطوارئ بـ emergency_maintenance فقط (D31).

features/unified-visit-model.md. تحديث origin_type ليضمن expected_followup. تحديث lifecycle field_visits بإضافة آلية تصعيد عدم التوثيق.

components/system-settings.md. إنشاء أو تحديث ليشمل المفاتيح الجديدة.

components/permissions.md. إضافة cooldown_unlock.

## 6 القرارات المعلقة المتبقية بعد DEC-006

P-DEC006-01. القيم الفعلية (seed values) لكل فئة من الفئات الست الجديدة في system_lists. الفئات معتمدة هنا. القيم مفتوحة.

P-DEC004-05. تصميم side tables لكل من العشرين نوع مهمة. ثقيل ومستقل.

P-DEC005-04. تصميم schema كامل لـ task_type_config. ثقيل وأساسي. يحدد الأعمدة الكاملة المطلوبة على الجدول الموجود وأي حقول جديدة تحتاج إضافة.

## 7 المراجع

decisions/DEC-003-visit-task-unification.md
decisions/DEC-004-visit-task-lifecycle-refinement.md
decisions/DEC-005-contact-targets-filter.md
domains/telemarketing.md
domains/visits.md
domains/tasks.md
domains/planning.md
features/unified-visit-model.md
packages/shared/telemarketingOutcomes.ts
migrations/006_seed_system_lists.sql
migrations/098_telemarketing_rejection_reschedule_reasons.sql
migrations/135_seed_no_closing_reasons.sql
