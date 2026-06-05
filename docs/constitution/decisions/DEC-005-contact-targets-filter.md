# قرار معماري: توحيد فلتر جهات الاتصال ودورة حياتها

> رقم القرار DEC-005
> التاريخ 2026-05-31
> الحالة معتمد
> الأولوية حرجة
> يكمل DEC-003 و DEC-004
> الكيانات المتأثرة contact_targets, open_tasks, clients, telemarketing_call_logs, route_assignments

## 1 الملخص التنفيذي

هذا القرار يحسم الفلسفة الكاملة لـ contact_targets كأهداف يومية للتواصل الهاتفي. يحدد من يدخل القائمة، ومتى يدخل، وأي فريق يستلمه، وما الذي يحصل أثناء وبعد المكالمة، ومتى يخرج.

أبرز التحولات. توحيد contact_targets لكل أنواع المهام بدل أن يكون marketing فقط. تغيير grain الكيان من زبون فقط إلى زبون مع موقع عمل. إغلاق يدوي مع شبكة أمان CRON. آلية cooldown على مستوى الزبون. حذف حقول غير مستخدمة (target_stage و source_type). انعكاس تصحيح أن المهام مرتبطة بعنوان الجهاز لا العقد.

## 2 المبادئ التأسيسية

### المبدأ الأول: الفلتر من الأسفل للأعلى (Bottom-up)

النظام يبدأ من المهام المفتوحة المؤهلة ويصعد للزبون، ليس العكس. الزبون يظهر في قائمة الاتصالات إذا له على الأقل open_task واحدة جاهزة. لا توجد منطقة فحص "هل هذا الزبون يستحق تواصل" منفصلة عن المهام.

أثر هذا المبدأ. لا فلتر "بدون عقود" على مستوى الزبون. لو زبون عنده عقد لكن أيضاً عنده مهمة device_demo لجهاز ثاني، يظهر بـ contact_target بشكل صحيح.

### المبدأ الثاني: عنوان العمل هو عنوان الجهاز لا العقد

تصحيح مفاهيمي أساسي. المهام الميدانية ترتبط بعنوان الجهاز (installed_devices.installation_geo_unit_id) وليس بعنوان العقد. العقد كيان مالي تجاري، الجهاز كيان مادي بموقع محدد. لو زبون عنده جهازان في عنوانين مختلفين، عنده موقعا عمل مختلفان.

تأثير على task_type_config. حقل location_basis يأخذ القيم client أو device (وليس contract كما كان مفترضاً سابقاً). للمهام التي ليس لها جهاز بعد مثل device_demo، الموقع = عنوان الزبون. للمهام المرتبطة بجهاز محدد مثل maintenance و delivery و installation و collection، الموقع = عنوان الجهاز.

### المبدأ الثالث: مصطلح required_date بدل due_date

كلمة استحقاق في العرف المحلي مرتبطة بالالتزامات المالية فقط. لتجنب سوء الفهم، الحقل يُعاد تسميته إلى required_date (التاريخ المطلوب). يصلح لكل أنواع المهام (صيانة دورية، تسليم، تركيب، تحصيل). due_date يبقى مصطلحاً خاصاً بالمحاسبة فقط.

### المبدأ الرابع: تاريخان منفصلان

required_date يحدده النظام أو المدير ويعكس "متى يجب أن تُنفذ المهمة من وجهة نظر الشركة". expected_date يحدده الزبون عبر طلبه ويعكس "متى وعد الزبون بالاستعداد".

قاعدة الحساب. إذا expected_date موجود، يُستخدم لتحديد موعد ظهور contact_target. إذا فارغ، يُستخدم required_date. إذا الاثنان فارغان، المهمة بدون موعد محدد وتظهر في كل خطة تشمل منطقتها.

### المبدأ الخامس: نافذة N واحدة (نافذة الظهور فقط)

قيمة N لكل task_type تعني "كم يوم قبل التاريخ المطلوب أو المتوقع تظهر المهمة في contact_targets". لا تقسيم لنوافذ متعددة. تُحفظ في task_type_config.lead_window_days.

للمهام بدون تاريخ، N لا ينطبق. للمهام بحالة needs_follow_up، تظهر فقط يوم expected_date بالضبط (lead_window = 0 افتراضياً لأن وعد الزبون يحترم بدقة).

### المبدأ السادس: المهام الفائتة تبقى تظهر

لا اختفاء صامت لمهمة فاتها التاريخ. تبقى تظهر في contact_targets مع علامة "متأخرة" بأولوية عرض عالية. هذا أهم مبدأ تشغيلي للحماية من ضياع المهام.

## 3 القرارات

### D24: توحيد contact_targets لكل أنواع المهام

contact_targets يتوسع ليشمل marketing و service و collection. كان محصوراً بـ marketing فقط.

visit_type على contact_target يأخذ القيم التالية. marketing عند مهام عرض جهاز. service عند مهام التسليم والتركيب والتشغيل والصيانة وغيرها من العائلات post-sale. collection عند مهام تحصيل الأقساط والذمم.

ملاحظة. بسبب D27 (تغيير grain إلى موقع)، السجل الواحد قد يحوي مهام من أنواع متعددة في الموقع نفسه. visit_type يصير حقل aggregate أو derived مثلاً يأخذ قيمة mixed عند تنوع.

### D25: قاعدة capability للفرق

فريق قياسي (TeamSlot في day_schedule) يدعم كل أنواع المهام تقنياً. capability ثابتة بدون تخصيص لكل route_assignment.

فريق طوارئ (EmergencySlot) يدعم emergency_maintenance فقط. السماح بـ periodic_maintenance تحت المناقشة لاحقاً.

تنازع فريقين قياسيين في نفس المنطقة. آلية أول من حُفظ له workScope يأخذ المهمة (موجودة في الكود الحالي عبر فلتر status IN ('open', 'needs_follow_up') في syncAssignedTasks). المدير ينصح بتوزيع مناطق مختلفة لكل فريق لكن التنازع يحل آلياً عبر DB state.

### D26: آلية الإغلاق

الإغلاق التلقائي يحدث في حالة واحدة فقط وهي حجز ناجح. عند نتيجة booked_marketing_appointment وإنشاء field_visit، contact_target ينتقل تلقائياً إلى closed.

الإغلاق اليدوي بواسطة التيليماركتر متاح عبر مسارين. الأول داخل نافذة تسجيل نتيجة المكالمة عبر خيار "إنهاء هدف اليوم". الثاني من شاشة قائمة الاتصالات عبر زر إغلاق مستقل.

الإغلاق اليدوي بواسطة المشرف يبقى متاح كما هو (موجود في الكود الحالي).

CRON الأمان يعمل يومياً في وقت قابل للضبط (الافتراضي 22:00) من system_settings.contact_target_cleanup_time. يغلق كل contact_targets التي تنطبق عليها الشروط contact_targets.status != 'closed' AND contact_targets.date < CURRENT_DATE. يضع closing_reason = 'auto_closed_by_cron'. يرجع open_tasks المرتبطة إلى last_waiting_status.

لا إغلاق تلقائي على نتائج الرفض. كل النتائج باستثناء حجز الموعد تترك contact_target مفتوحاً ليقرر التيليماركتر قرار الإغلاق يدوياً. السبب أن التيليماركتر قد تجرب رقم آخر للزبون بعد رفض من رقم.

تعديل closesContactTarget flag في telemarketingOutcomes.ts. كل النتائج تصبح closesContactTarget: false باستثناء booked_marketing_appointment (الذي يُعالج بواسطة منطق إنشاء الزيارة نفسه).

closing_reason كحقل جديد على contact_targets يأخذ القيم booked و manual_telemarketer و manual_supervisor و auto_closed_by_cron و cooldown_set.

### D27: grain جهة الاتصال

contact_target يصير على مستوى (زبون + موقع عمل + يوم) بدلاً من (زبون + يوم).

UNIQUE constraint جديد. UNIQUE (branch_id, target_id, work_location_geo_unit_id, date). يلاحظ حذف visit_type من المفتاح لأن السجل الواحد يجمع كل الأنواع في الموقع نفسه. حذف source_type من المفتاح لأن الحقل سيُحذف نهائياً (D30).

حقل جديد على contact_targets. work_location_geo_unit_id INTEGER FK إلى geo_units. يُحسب من المهام المرتبطة عبر task_type_config.location_basis. إن كان البasis = client يأخذ عنوان الزبون، إن كان device يأخذ عنوان الجهاز.

السلوك. زبون أحمد عنده 3 مواقع عمل (عنوانه + جهاز 1 + جهاز 2) قد يكون له حتى 3 contact_targets في يوم واحد، واحد لكل موقع، كل واحد يجمع كل المهام في موقعه.

### D28: الوعي عبر الفرق

نافذة مصغرة في TelemarketerWorkspace. عند عرض contact_target لزبون، نافذة جانبية تعرض كل contact_targets الأخرى لنفس الزبون داخل الفرع لليوم نفسه، مع حالتها ونتائج مكالماتها وزيارات المحجوزة. قراءة فقط.

علامة badge على بطاقة الزبون في القائمة الرئيسية. لو الزبون له contact_targets في فرق أخرى، تظهر علامة "+N فرق" تنبيهية.

التحديث live. عند حجز أو إغلاق contact_target في فريق آخر، المعلومة تتحدث في النافذة المصغرة مباشرة.

النطاق. كل contact_targets للزبون نفسه ضمن الفرع نفسه + التاريخ نفسه. لا يشمل فروع أخرى.

endpoint جديد. GET /telemarketing/customer/:customerId/all-targets-today يجلب كل contact_targets المرتبطة بالزبون لليوم.

### D29: cooldown على مستوى الزبون

cooldown يطبق على مستوى الزبون كاملاً، يحجبه من كل contact_targets مهما كان نوع المهمة.

حقول جديدة على clients. cooldown_until من نوع DATE يحفظ تاريخ انتهاء فترة التهدئة. cooldown_reason نصي يحفظ السبب. cooldown_set_by FK إلى hr_users. cooldown_set_at TIMESTAMPTZ.

المدة الافتراضية يحددها الأدمن. الحقل system_settings.default_cooldown_days قيمته الافتراضية المبدئية 7 أيام قابلة للتعديل.

حالات التفعيل التلقائي. عند تسجيل نتيجة من إحدى القيم not_interested و other_company_not_interested و seen_offer_not_interested، النظام يضع cooldown_until = CURRENT_DATE + default_cooldown_days تلقائياً.

حالات التفعيل اليدوي. عند الإغلاق اليدوي لـ contact_target، يظهر خيار اختياري لتفعيل cooldown، يستخدمه التيليماركتر بعد محاولات فاشلة متعددة أو المشرف لأسباب تشغيلية.

فك Cooldown اليدوي. من شاشة تفاصيل الزبون، زر "إلغاء فترة التهدئة" يحتاج صلاحية مشرف أو أعلى.

انتهاء Cooldown آلياً. لا CRON خاص. الفلتر في syncAssignedTasks يفحص الشرط cooldown_until IS NULL OR cooldown_until < CURRENT_DATE. بعد فوات التاريخ، الزبون مؤهل تلقائياً.

الدمج مع do_not_contact. الحقل clients.do_not_contact (BOOLEAN) يُعامل كحظر دائم. الفلتر يفحص الاثنين معاً، أي منهما يحجب يحجب. شاشة تفاصيل الزبون تعرض الحالتين في قسم موحد بعنوان "حالة التواصل" مع زرين منفصلين لإدارة كل واحد.

التفاعل مع expected_date. لا تأثير متبادل. expected_date يحدد متى تظهر مهمة بعينها. cooldown يحجب كل المهام. عند نتيجة customer_requested_followup، النظام يحفظ expected_date على المهمة ولا يفعل cooldown. الزبون يبقى مؤهلاً لمهام أخرى قبل expected_date للمهمة المحددة.

### D30: حذف target_stage و source_type

كلا الحقلان يُحذفان نهائياً من contact_targets. CHECK constraints تُزال. INSERT statements في الكود تُعدل لإزالة الحقلين.

السبب. كلا الحقلان يحملان قيمة lead فقط دائماً، لا تُغير، لا تُقرأ، لا تُستخدم في فلتر. وجودهما يخلق ازدواجية مع classification (حالياً candidate_status على clients) و creation_origin (على open_tasks).

البديل للتقارير. للحصول على تصنيف الزبون يُستخدم JOIN على clients.candidate_status (مع التذكر أن NULL يعني Lead بحسب الواجهة). لمعرفة مصدر المهمة يُستخدم JOIN على open_tasks.creation_origin من قرار D13.

### D-customer-filters: فلاتر الزبون المحدودة

في syncAssignedTasks الفلاتر على مستوى الزبون تقتصر على الحالات التي تعكس "غير قابل للتواصل". do_not_contact = TRUE. is_archived = TRUE (إن وُجد الحقل). is_candidate = TRUE. cooldown_until > CURRENT_DATE.

ما لا يطبق. NOT EXISTS contracts (يُحذف، الفلتر السابق الخاطئ). NOT EXISTS visits (يُحذف، الـ legacy bug). أي فلتر آخر يفترض حالة معينة للزبون مبني على وجود مهمة أو عدمها.

## 4 ملاحظات على الكود الفعلي

أثناء التحقق من الكود لتثبيت هذا القرار، رُصدت ملاحظات تشغيلية تحتاج معالجة.

الأولى. ملف client-snapshot.md في الدستور يستخدم اسم classification للحقل على clients، لكن الاسم الفعلي في الكود candidate_status. drift توثيقي يحتاج تصحيح لاحق في ملف منفصل.

الثانية. في telemarketing.ts (السطر 174 تقريباً) الـ ON CONFLICT clause يستخدم الأعمدة (branch_id, target_type, target_id, visit_type, source_type) وهي UNIQUE constraint القديمة. لكن migration 154 غيّر الـ UNIQUE الفعلي إلى (branch_id, target_type, target_id, visit_type, source_type, date, zone_id). هذا قد يُسبب فشل ON CONFLICT في حالات معينة. bug يحتاج فحص منفصل.

الثالثة. الكود يقرأ FROM telemarketing_appointments في عدة أماكن (contactTargets.ts السطر 91 خصوصاً). يجب التحديث ليقرأ من field_visits بعد تطبيق DEC-003.

الرابعة. الكود يحتوي فلتر NOT EXISTS FROM visits في contactTargets.ts السطر 117 (جدول visits قديم legacy غير field_visits). يجب حذف هذا الفلتر بالكامل.

## 5 التأثير على الكود

### migrations مطلوبة

تعديلات على contact_targets. حذف العمودين target_stage و source_type. حذف CHECK constraints المرتبطة بهما. إضافة work_location_geo_unit_id INTEGER FK إلى geo_units. إضافة closing_reason VARCHAR. تحديث UNIQUE constraint إلى (branch_id, target_id, work_location_geo_unit_id, date). توسيع visit_type CHECK constraint ليقبل marketing و service و collection و mixed.

تعديلات على clients. إضافة cooldown_until DATE. cooldown_reason TEXT. cooldown_set_by INTEGER FK. cooldown_set_at TIMESTAMPTZ. do_not_contact BOOLEAN DEFAULT FALSE.

تعديلات على open_tasks. إعادة تسمية due_date إلى required_date (إن لم يكن قد تم) أو إضافة required_date إن لم يكن موجوداً.

إنشاء system_settings جديد. إضافة جدول system_settings (إن لم يكن موجوداً) بمفاتيح default_cooldown_days و contact_target_cleanup_time.

إنشاء task_type_config. الجدول الذي ذُكر كفجوة G04 سابقاً. الحقول المقترحة task_type, task_family, contact_target_visit_type, location_basis, lead_window_days, contract_required, has_required_date, allow_multiple.

### Backend

تعديل telemarketingOutcomes.ts. كل closesContactTarget يصير false باستثناء booked_marketing_appointment.

توسيع syncAssignedTasks. ليقبل أنواع المهام متعددة (مش marketing فقط). يفحص cooldown_until و do_not_contact.

endpoint جديد POST /contact-targets/:id/close. للإغلاق اليدوي من التيليماركتر.

endpoint جديد GET /telemarketing/customer/:customerId/all-targets-today. للنافذة المصغرة.

CRON job جديد. ينفذ يومياً في وقت قابل للضبط، يغلق contact_targets القديمة ويرجع المهام.

### Frontend

نافذة مصغرة cross-team awareness في TelemarketerWorkspace.

علامة badge على بطاقة الزبون في القائمة الرئيسية.

خيار اختياري داخل نافذة نتيجة المكالمة وهو "إنهاء هدف اليوم" مع subcheckbox "تفعيل cooldown".

زر إغلاق مستقل على بطاقة contact_target.

شاشة تفاصيل الزبون تضيف قسم "حالة التواصل" مع إدارة do_not_contact و cooldown.

## 6 التأثير على الدستور

| الملف | التحديث |
|---|---|
| domains/telemarketing.md | إعادة كتابة قسم contact_targets كاملاً ليعكس D24-D30 |
| domains/tasks.md | إعادة تسمية due_date إلى required_date في كل المراجع، إضافة expected_time field reference، إضافة قسم cooldown |
| domains/visits.md | إشارة إلى DEC-005 |
| domains/planning.md | تحديث وصف syncAssignedTasks ليشمل التوسعة لكل visit_types |
| components/client-snapshot.md | flag drift في تسمية classification مقابل candidate_status (للتصحيح لاحقاً) |

## 7 القرارات المعلقة (لـ DEC-006 لاحقاً)

P-DEC005-01. هل periodic_maintenance يُسند لفريق طوارئ أم قياسي فقط؟

P-DEC005-02. استبعاد زبون عنده زيارة مجدولة بنفس اليوم من contact_targets، نعم أم لا؟

P-DEC005-03. تفاعل expected_date مع contact_targets، هل يظهر تلقائياً عند حلول expected_date أم يحتاج Schedule-from-Expected (D22) صراحة؟

P-DEC005-04. تصميم task_type_config schema كامل.

P-DEC005-05. كيف نتعامل مع call_log الذي يحل أكثر من contact_target واحد (سجل واحد بربط متعدد أم سجل لكل contact_target).

P-DEC005-06. صلاحية فك cooldown، هل المشرف وحده أم مدير الفرع أيضاً؟

## 8 المراجع

decisions/DEC-003-visit-task-unification.md
decisions/DEC-004-visit-task-lifecycle-refinement.md
domains/telemarketing.md
domains/tasks.md
domains/planning.md
domains/visits.md
features/unified-visit-model.md
