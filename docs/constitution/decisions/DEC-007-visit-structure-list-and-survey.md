# قرار معماري: هيكلة الزيارة الموحدة — لائحة الأسماء والاستبيان

> رقم القرار DEC-007
> التاريخ 2026-05-31
> الحالة معتمد
> الأولوية حرجة
> يكمل DEC-003 و DEC-004 و DEC-005 و DEC-006
> الكيانات المتأثرة field_visits, visit_tasks, visit_surveys (جديد), referral_sheets, visit_name_collections (يُحذف), system_lists, day_schedule

## 1 الملخص التنفيذي

هذا القرار يحسم البنية الأساسية لكل زيارة ميدانية. لكل زيارة شقّان دائمان مرتبطان بها مباشرة (وليس بالمهمة الفرعية visit_task). الأول لائحة أسماء referral_sheet اختيارية. الثاني استبيان visit_survey إلزامي بحقول ثابتة (11 حقلاً). كلاهما يُدخَل بعد بدء الزيارة وقبل اكتمالها. مرحلة complete لا تُدخَل يدوياً، بل تُحسب آلياً عند تحقق كل الشروط.

أبرز التحولات. نقل لائحة الأسماء من مستوى visit_task إلى مستوى field_visit. حذف جدول visit_name_collections والاعتماد على referral_sheets مباشرة. إنشاء جدول جديد visit_surveys بـ 11 حقلاً ثابتاً. اعتماد آلية مسؤول الفريق (مشرفة للقياسي، الفني للطوارئ) لتحديد ملكية اللائحة. توحيد completion guards.

## 2 المبادئ التأسيسية

### المبدأ الأول: شقّان لكل زيارة على مستوى الزيارة

كل field_visit يحوي بنيوياً جزأين أساسيين خارج visit_tasks.

اللائحة referral_sheet. اختيارية. يُسمح بزيارة بدون لائحة (target_candidates = 0) دون سبب صريح. تُولَّد تلقائياً عند بدء الزيارة بقيم افتراضية (target_candidates = 0) ويُمكن للمسؤول تعديل العدد لاحقاً.

الاستبيان visit_survey. إلزامي. لا تُكتمل الزيارة بدونه إلا بسبب skip معتمد من قائمة system_lists.

كلاهما مرتبط بـ field_visit_id مباشرة عبر FK مع قيد UNIQUE (واحد لكل زيارة).

### المبدأ الثاني: مسؤول الفريق مالك اللائحة والاستبيان

كل فريق له مسؤول واحد محدد.

الفريق القياسي (TeamSlot). المسؤول = المشرفة (supervisor field). توجد دائماً مشرفة واحدة لكل فريق قياسي.

فريق الطوارئ (EmergencySlot). المسؤول = الفني (technician field). فني واحد فقط لكل فريق طوارئ، لا يجوز التعدد.

عند إنشاء الزيارة، المسؤول يُحفظ كـ snapshot في الزيارة (من team membership في day_schedule). كل referral_sheet وكل visit_survey يحملان owner_user_id = المسؤول لحظة إنشاء الزيارة.

### المبدأ الثالث: الإدخال بعد بدء الزيارة فقط

لا يُسمح بإدخال بيانات اللائحة أو الاستبيان قبل بدء الزيارة (status = scheduled). الإدخال يفتح بعد start ويصبح متاحاً خلال in_progress و ended.

السبب. اللائحة قرار من الزبون أثناء الزيارة. الاستبيان قياسات تحتاج معدات الزيارة (Demo Kit, TDS meter). الإدخال المسبق يفقد معناه.

### المبدأ الرابع: complete مرحلة محسوبة لا يدوية

لا زر "إكمال الزيارة" يفتح ويُغلق يدوياً. الزيارة تنتقل تلقائياً إلى completed عند تحقق الشروط التالية مجتمعة.

الشرط الأول. كل visit_tasks المرتبطة لها visit_task_results موثقة.

الشرط الثاني. visit_survey موجود لـ field_visit_id إما مُعبَّأ كلياً أو في حالة skipped مع skip_reason.

الشرط الثالث. referral_sheet موجود لـ field_visit_id (target_candidates = 0 مقبول).

عند تحقق الثلاثة، النظام ينقل الزيارة آلياً من ended إلى completed. لا إجراء يدوي.

## 3 القرارات

### D40: إلغاء visit_name_collections والاعتماد على referral_sheets

الجدول visit_name_collections يُحذف بعد ترحيل البيانات (إن وُجدت في DB). الأسباب البنيوية.

الأول. ازدواج بيانات. proposed_count = referral_sheets.target_candidates. actual_count = COUNT(candidates) المرتبطة. status محسوبة من الاثنين. لا قيمة مضافة في الجدول الوسيط.

الثاني. مستوى خاطئ. الجدول مرتبط بـ visit_task_id بينما اللائحة شأن الزيارة كلها.

الثالث. تعقيد دون حاجة. الـ endpoints الحالية في fieldVisits.ts (POST /visit-tasks/:taskId/name-collection و PUT /name-collections/:id/record-names) تُعاد كتابتها لتعمل مباشرة على referral_sheets.

التطبيق. migration لـ DROP TABLE visit_name_collections. تعديل endpoints. تعديل NameCollectionModal ليُعدِّل target_candidates مباشرة في referral_sheets. تحديث completion guard.

### D41: إنشاء referral_sheet يدوياً عبر زر "إضافة لائحة جديدة"

اللائحة لا تُولَّد آلياً عند بدء الزيارة. الزر "إضافة لائحة جديدة" يظهر بعد بدء الزيارة (status = in_progress). المسؤول يضغطه، يُدخل عدد الأسماء المستهدفة (target_candidates)، يحفظ. تُنشأ referral_sheet لحظة الحفظ بالقيم التالية.

referral_type = 'client' ثابت.

referral_entity_id = field_visit.client_id (معرف الزبون المُزار).

referral_name_snapshot = اسم الزبون لقطة من clients.full_name وقت الإنشاء.

referral_address_text = عنوان الزبون لقطة (للقراءة المستقبلية).

referral_origin_channel = 'visit' ثابت.

field_visit_id = field_visit.id (الربط).

owner_user_id = المسؤول حسب نوع الفريق. للقياسي = team_snapshot.supervisor_id. للطوارئ = team_snapshot.technician_id.

target_candidates = 0 افتراضياً.

status = 'New' افتراضياً (يتغير حسب target_candidates و actual count لاحقاً).

referral_date = field_visit.scheduled_date.

تحديث target_candidates لاحقاً عبر endpoint منفصل خلال in_progress أو ended. لا حاجة لإنشاء جديد، فقط UPDATE.

### D42: جدول visit_surveys

جدول جديد للاستبيان مع 11 حقلاً ثابتاً + حقول وصفية.

schema الكامل:

| الحقل | النوع | NULL | الوصف |
|---|---|---|---|
| id | SERIAL | NO | PK |
| field_visit_id | INTEGER | NO | FK UNIQUE إلى field_visits(id) ON DELETE CASCADE |
| is_skipped | BOOLEAN | NO DEFAULT FALSE | إذا تم تخطي الاستبيان |
| skip_reason | VARCHAR(255) | YES | قيمة من system_lists category='survey_skip_reasons'. NOT NULL إذا is_skipped=TRUE |
| filled_by_user_id | INTEGER | YES | FK إلى hr_users(id). NOT NULL إذا is_skipped=FALSE |
| filled_at | TIMESTAMPTZ | YES | وقت الإكمال |
| household_members_count | INTEGER | YES | عدد أفراد العائلة |
| drinking_water_source | TEXT | YES | مصدر مياه الشرب |
| tds_test_result | INTEGER | YES | نتيجة فحص TDS (ppm) |
| hardness_test_drops | INTEGER | YES | نتيجة فحص الكلس (عدد النقاط) |
| demo_kit_tds_result | INTEGER | YES | نتيجة شبك Demo Kit (ppm) |
| customer_opinion_water_source | TEXT | YES | رأي الزبون بمصدر مياهه |
| customer_opinion_demo_kit | TEXT | YES | رأي الزبون بنتيجة Demo Kit |
| customer_opinion_purification_idea | TEXT | YES | تقييم الزبون لفكرة أجهزة التنقية |
| customer_purchase_intent | BOOLEAN | YES | رغبة الزبون بالشراء |
| expected_payment_method | TEXT | YES | طريقة الدفع المتوقعة |
| area_evaluation | VARCHAR(50) | YES | قيمة من system_lists category='area_evaluation_options' |
| created_at | TIMESTAMPTZ | NO DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NO DEFAULT NOW() | |

قيد CHECK مركب. إما is_skipped = TRUE مع skip_reason غير NULL وكل الحقول الـ 11 الموضوعية NULL. أو is_skipped = FALSE مع كل الحقول الـ 11 غير NULL و filled_by_user_id غير NULL.

تطبيق نوع المقياس. tds_test_result و demo_kit_tds_result كلاهما قياس TDS بوحدة ppm، نطاق طبيعي 0 إلى 3000. hardness_test_drops عدد النقاط، نطاق طبيعي 0 إلى 30. household_members_count عدد صحيح موجب.

### D43: قيم area_evaluation_options الأربع

فئة system_list جديدة باسم area_evaluation_options بأربع قيم.

ممتازة، order = 1.
جيدة، order = 2.
متوسطة، order = 3.
ضعيفة، order = 4.

تُحفظ كصفوف في جدول system_lists عبر migration seed.

### D44: completion guards الجديدة للزيارة

POST /field-visits/:id/complete يفحص ثلاث شروط بترتيب صارم. أي فشل يرد خطأ مع رسالة محددة.

الشرط الأول. كل visit_tasks مع field_visit_id = :id يجب أن يكون لها visit_task_results بـ final_decision غير NULL. لو وُجدت مهمة بدون نتيجة، الرد 400 مع رسالة "X مهمة لم تُسجَّل نتيجتها".

الشرط الثاني. يوجد visit_surveys بـ field_visit_id = :id. لو غير موجود، الرد 400 مع رسالة "لم يُدخَل الاستبيان أو سبب التخطي".

لا شرط ثالث للائحة. اللائحة اختيارية بالكامل (D41 يجعل إنشاءها يدوياً، وعدم وجودها مقبول للزيارة المكتملة).

الشروط القديمة المُلغاة. شرط visit_name_collections يُحذف (الجدول نفسه يُحذف).

### D45: غياب visit_name_collections من completion guard

شرط القديم في POST /field-visits/:id/complete كان "لا يوجد visit_name_collections بحالة pending أو partial". هذا الشرط يُلغى لأن. اللائحة اختيارية (D40 يحذف الجدول، D41 يُولِّد referral_sheet دائماً). actual_count لم يعد محسوباً ضمن الزيارة (الزبون لا يدخل أسماءً مباشرة، فقط العدد كوعد). تعقب اكتمال الأسماء يحدث في شاشة Proposed Names Records منفصلة لاحقاً، لا في سياق الزيارة.

### D46: توقيت فتح إدخال اللائحة والاستبيان

كلاهما يُفتح للإدخال بعد POST /field-visits/:id/start فقط (الزيارة status = in_progress). يبقيان متاحين خلال ended. يُغلقان عند completed.

الواجهة في FieldVisitDetailPage تعرض زرين منفصلين. "تعديل عدد اللائحة" (يفتح فورم لـ target_candidates). "تعبئة الاستبيان أو تخطيه" (يفتح فورم الاستبيان أو dropdown سبب التخطي).

كلا الزرين معطلان (disabled) إذا status = scheduled. مفعّلان من start إلى end.

### D47: ملكية اللائحة والاستبيان من team snapshot

عند إنشاء field_visit، team snapshot يُحفظ ضمن الزيارة (من DEC-004 D12). هذا snapshot يحوي. للقياسي supervisor_id. للطوارئ technician_id.

عند توليد referral_sheet (D41) أو إنشاء visit_survey، owner_user_id (للائحة) أو filled_by_user_id (للاستبيان عند الاكتمال) يُملأ من team snapshot بحسب نوع الفريق.

إذا تغيّر الفريق لاحقاً (D11 من DEC-004 يُغطي إعادة التعيين)، الملكية القديمة تبقى في records الأصلية ولا تُحدَّث retroactively. تطبيق تتبع الفريق الجديد ضمن سجل reassignment يكفي للمراجعة.

## 4 ملاحظات على الكود الحالي

الأولى. EmergencySlot في packages/shared/types.ts يحوي technician مفرد (number | null) وtelemarketers اختيارية و trainee اختياري. يطابق D47 (فني واحد فقط).

الثانية. NameCollectionModal الحالية تستقبل actual_count فقط، لا target_candidates. تحتاج إعادة تصميم. D40 و D41 يجعلانها تُعدِّل target_candidates مباشرة في referral_sheets.

الثالثة. POST /visit-tasks/:taskId/name-collection يستخدم visit_task_id كمدخل. يحتاج تغيير المسار إلى POST /field-visits/:id/referral-sheet (مستوى زيارة).

الرابعة. completion guard في POST /field-visits/:id/complete يفحص visit_name_collections حالياً. يحتاج تعديل لـ D44 و D45.

الخامسة. لا يوجد UI أو endpoint للاستبيان حالياً. كل شيء بناء جديد.

## 5 التأثير على الكود

### migrations مطلوبة

migration A. إنشاء جدول visit_surveys بالكامل (D42).

migration B. seed قيم area_evaluation_options الأربع في system_lists.

migration C. seed قيم survey_skip_reasons الأولية (تأجيلها لجلسة seed values، لكن إدراج فئة فارغة + قيمة "أخرى" كحد أدنى).

migration D. ترحيل بيانات visit_name_collections إلى referral_sheets إن وُجدت (في staging قد تكون فارغة).

migration E. DROP TABLE visit_name_collections بعد ترحيل آمن.

migration F. تعديل referral_sheets. إضافة قيد UNIQUE على field_visit_id إن أُريد منع تعدد اللوائح لزيارة واحدة. ضمان NOT NULL field_visit_id لكل referral_sheet جديدة من نوع client + visit.

### Backend

تعديل packages/api/routes/fieldVisits.ts.

حذف POST /visit-tasks/:taskId/name-collection و PUT /name-collections/:id/record-names.

إضافة POST /field-visits/:id/referral-sheet/target يُحدِّث target_candidates في referral_sheet المرتبط بالزيارة.

إضافة POST /field-visits/:id/survey لإنشاء أو تحديث visit_survey بكل الحقول.

إضافة POST /field-visits/:id/survey/skip لتسجيل skip_reason.

تعديل POST /field-visits/:id/start ليُولِّد referral_sheet تلقائياً (D41) إن لم يكن موجوداً.

تعديل POST /field-visits/:id/complete بالـ guards الجديدة (D44 D45).

إضافة منطق تحويل automatic للحالة من ended إلى completed عند تحقق الشروط (يمكن جعله trigger DB أو فحص في كل update).

### Frontend

تعديل packages/web/src/components/NameCollectionModal.tsx. تحويلها لـ modal يُعدِّل target_candidates على referral_sheets، تقرأ field_visit_id من السياق.

إنشاء VisitSurveyModal جديدة بـ 11 حقلاً + checkbox "تخطي الاستبيان" يكشف dropdown skip_reason.

تعديل packages/web/src/pages/FieldVisitDetailPage (أو ما يكافئها) لإظهار الزرين الجديدين بشروط D46.

حذف زر "إكمال الزيارة" اليدوي. عرض شارة تلقائية "الزيارة مكتملة" عند الانتقال الآلي إلى completed.

### system_lists

إضافة الفئات الثلاث الجديدة.

area_evaluation_options. 4 قيم ثابتة (D43).

survey_skip_reasons. قيم تُحسم في جلسة seed values لاحقة. مبدئياً قيمة "أخرى" فقط.

(الفئات الأخرى المعتمدة في DEC-006 تظل في خطتها.)

## 6 التأثير على الدستور

domains/visits.md. إعادة كتابة قسم البنية. حذف ذكر visit_name_collections. إضافة قسم visit_surveys كامل. تحديث completion guards. تحديث ERD diagram.

domains/field-visits.md. تحديث نفسه (يبدو مكافئاً).

features/unified-visit-model.md. إضافة قسم "الشقّان الأساسيان" يصف اللائحة والاستبيان. تحديث lifecycle لتوضيح الـ automatic completed.

components/client-snapshot.md. ملاحظة عابرة أن snapshot يُستخدم لتعبئة referral_name_snapshot.

GAPS-TRACKER.md. حل GAP-031 جزئياً (الأسماء لا تُدخَل ضمن الزيارة أصلاً، فلا حاجة لتحويلها لـ candidates من الزيارة، الإدخال في شاشة منفصلة).

## 7 القرارات المعلقة بعد DEC-007

P-DEC007-01. قيم survey_skip_reasons الفعلية (مع P-DEC006-01 الكبرى).

P-DEC007-02. هل يحتاج visit_survey الحقول الـ 11 إلزامياً كاملة، أم بعضها يمكن تركه فارغاً إذا غير قابل للقياس (مثلاً Demo Kit لم يُستخدم).

P-DEC007-03. آلية فتح "شاشة سجلات الأسماء المقترحة" المنفصلة لإدخال candidates للائحة. ليست ضمن نطاق DEC-007 لكن مرتبطة.

P-DEC007-04. محسومة. الانتقال الآلي completed في طبقة التطبيق عبر helper checkAndCompleteVisit(visitId) يُستدعى بعد كل save لـ task result أو survey أو survey skip.

## 8 المراجع

decisions/DEC-003-visit-task-unification.md
decisions/DEC-004-visit-task-lifecycle-refinement.md
decisions/DEC-005-contact-targets-filter.md
decisions/DEC-006-pending-resolutions-round1.md
domains/visits.md
domains/field-visits.md
features/unified-visit-model.md
packages/shared/types.ts (TeamSlot, EmergencySlot)
packages/api/routes/fieldVisits.ts
packages/web/src/components/NameCollectionModal.tsx
migrations/001_core_tables.sql (referral_sheets schema)
migrations/082_visit_name_collections.sql (يُحذف)
migrations/111_referral_sheets_target_candidates.sql
migrations/166_answered_by_and_visit_referral_sheets.sql
