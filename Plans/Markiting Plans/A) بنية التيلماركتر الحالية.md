\*\*A) بنية التيلماركتر الحالية\*\*

الجداول الحالية:



`telemarketing\_task\_lists`

\- الوظيفة: رأس قائمة الاتصال اليومية لفريق معيّن.

\- الحقول الأساسية: `id`, `team\_key`, `date`, `created\_at`, `branch\_id`.

\- فيه `branch\_id`: نعم، أضيف لاحقاً في migration 014.

\- فيه `date`: نعم.

\- فيه `team\_key`: نعم.

\- لا يحتوي `assigned\_user\_id` أو `telemarketer\_id`.

\- لا يحتوي `supervisor\_id`.

\- unique الحالي: `team\_key + date` فقط، وليس `branch\_id + team\_key + date`.



`telemarketing\_task\_list\_items`

\- الوظيفة: عناصر الاتصال داخل القائمة.

\- الحقول الأساسية: `id`, `task\_list\_id`, `entity\_type`, `entity\_id`, `name`, `mobile`, `contact\_number`, `contact\_label`, `address\_text`, `geo\_unit\_id`, `status`, `call\_outcome`.

\- لا يحتوي `branch\_id` مباشرة، يعتمد على `task\_list\_id -> telemarketing\_task\_lists`.

\- لا يحتوي `date` مباشرة، يعتمد على القائمة.

\- لا يحتوي `team\_key` مباشرة.

\- لا يحتوي `assigned caller`.

\- لا يحتوي `supervisor\_id`.

\- لا يحتوي `contact\_target\_id`.

\- يمكن معرفة العميل عبر `entity\_type = client` و `entity\_id`.

\- لا يمكن معرفة أن العنصر Lead إلا بإعادة حساب خارجي أو ربطه بجدول `contact\_targets`.

\- يمكن معرفة الحالة: `pending`, `called`, `booked`.

\- يمكن معرفة آخر نتيجة محفوظة على العنصر من `call\_outcome`، لكنها نتيجة واحدة مختصرة وليست سجل المحاولات.



`telemarketing\_call\_logs`

\- الوظيفة: سجل محاولات الاتصال.

\- الحقول: `id`, `entity\_type`, `entity\_id`, `task\_list\_id`, `team\_key`, `outcome`, `contact\_label`, `contact\_number`, `notes`, `timestamp`, `called\_by`, `communication\_method`, `branch\_id`.

\- فيه `branch\_id`: نعم حسب migration 014، لكن route الحالي في insert لا يمرره.

\- فيه `task\_list\_id`: نعم.

\- فيه `team\_key`: نعم.

\- لا يحتوي `task\_list\_item\_id`.

\- لا يحتوي `contact\_target\_id`.

\- `called\_by` موجود، لكن في الواجهة يُرسل حالياً `1` كـ mock وليس المستخدم الحقيقي.

\- يسمح نظرياً بأكثر من محاولة لنفس العميل لأن كل محاولة row مستقل.



`telemarketing\_appointments`

\- الوظيفة: مواعيد محجوزة بعد الاتصال.

\- الحقول: `id`, `entity\_type`, `entity\_id`, `customer\_name`, `customer\_address`, `customer\_mobile`, `team\_key`, `date`, `time\_slot`, `occupation`, `water\_source`, `notes`, `created\_at`, `created\_by`, `branch\_id`.

\- لا يحتوي `task\_list\_item\_id`.

\- لا يحتوي `contact\_target\_id`.

\- لا يحتوي `visit\_type`.

\- لا يحتوي `source\_type/source\_id`.

\- حالياً هو appointment مستقل عن visit، وهذا جيد مرحلياً، لكنه غير مربوط كفاية بمصدره.



\*\*B) الإسناد اليومي\*\*

النظام يدعم جزئياً فكرة قائمة يومية:

\- `telemarketing\_task\_lists.date` موجود.

\- `team\_key` موجود.

\- يمكن عرض قائمة يوم محدد لفريق محدد.

\- يمكن الرجوع ليوم سابق أو لاحق نظرياً من البيانات، لكن `TelemarketerWorkspace` حالياً مثبت على `getToday()` ولا يوجد date picker.



الفجوات:

\- لا يوجد `assigned\_to` أو `caller\_user\_id` على القائمة أو العنصر.

\- لا توجد قائمة “ما لدي أنا اليوم” حسب المستخدم الحالي.

\- التيلماركتر لا يرى حسب كونه داخل الفريق فعلياً؛ الصفحة تعرض فرق جدول اليوم وتسمح بالاختيار.

\- المشرفة لا تملك مساراً خاصاً لرؤية Leads المسندة لها داخل workspace.

\- منع تكرار نفس Lead في أكثر من فريق بنفس اليوم موجود في endpoint الجديد `generate-from-plan` فقط، وليس في endpoint القديم `upsert`.

\- unique `team\_key + date` لا يشمل `branch\_id`، وهذا خطر في multi-branch إذا تكرر نفس `team\_key/date` بين فروع.



\*\*C) Telemarketer Workspace الحالي\*\*

الصفحة: `packages/web/src/pages/TelemarketerWorkspace.tsx`



تعرض:

\- فرق اليوم من `api.schedules.get(date)`.

\- قائمة اتصال الفريق المختار من `useTelemarketingStore.getTaskList(teamKey, date)`.

\- تفاصيل العميل/المرشح.

\- سجل الرحلة: إنشاء العميل، عقود، زيارات، صيانة، Call logs.

\- تسجيل نتيجة اتصال.

\- جدولة موعد.

\- أجندة الفريق لليوم.



مصادر البيانات:

\- `api.telemarketing.snapshot()`

\- `api.schedules.get(date)`

\- `api.clients`, `contracts`, `visits`, `maintenanceRequests`, `employees`

\- لا تزال تستخدم `candidates` أيضاً.



قيود حالية:

\- التاريخ ثابت على اليوم: `const \[date] = useState(getToday())`.

\- لا يوجد أمس/غداً.

\- لا يوجد فلتر حسب current user.

\- لا يوجد route guard خاص بالتيلماركتر.

\- لا يوجد backend permission على endpoints التيلماركتنغ.

\- الصفحة تعتمد على branch جزئياً فقط؛ snapshot backend لا يفلتر صراحة بالفرع في الاستعلام الحالي.

\- `calledBy` و `createdBy` مرسلان كـ `1` في الواجهة، وهذا غير آمن.

\- يمكن للمشرفة استخدامها تقنياً إذا دخلت الصفحة، لكن لا يوجد فلتر يمنع Leads غير مسندة لها.



\*\*D) توليد قائمة الاتصال الحالي\*\*

يوجد مساران:



المسار القديم:

\- `useTelemarketingStore.generateTaskList`

\- يستدعي `POST /api/telemarketing/task-lists/upsert`

\- الواجهة ترسل `items` خام.

\- backend يحذف كل items للقائمة ثم يعيد إدخالها.

\- هذا خطر لأنه قد يمس عناصر لها `call\_outcome` أو `booked`.



المسار الجديد:

\- `POST /api/telemarketing/task-lists/generate-from-plan`

\- يستقبل `date + teamKey` فقط.

\- يعيد استخدام `getPlanningMarketingTargets`.

\- يأخذ Leads الصحيحة فقط: داخل النطاق ومسندة لمشرفة الفريق.

\- ينشئ/يحدّث القائمة.

\- لا يحذف العناصر الموجودة.

\- يمنع إدخال نفس Lead في قائمة فريق آخر لنفس `branch/date`.

\- يرجع `skipped` مع `already\_queued\_today`.

\- يحدّث `contact\_targets.status` إلى `queued` إذا كان `contactTargetId` متاحاً.



الفجوات:

\- `telemarketing\_task\_list\_items` لا يحتوي `contact\_target\_id`.

\- لا يوجد `visit\_type` أو `task\_bundle`.

\- لا يوجد source tracking داخل item.

\- endpoint القديم لا يزال موجوداً وخطر إذا بقي مستخدماً لاحقاً.



\*\*E) تنفيذ الاتصال\*\*

تسجيل الاتصال الحالي:

\- يتم من `OutcomeRecorderModal`.

\- يرسل `createCallLog`.

\- بعدها يحدّث item عبر `PATCH /task-lists/:taskListId/items/:itemId`.

\- status يصبح:

&#x20; - `booked` إذا outcome = booked

&#x20; - `called` إذا rejected أو بعد 3 محاولات

&#x20; - يبقى `pending` لنتائج مثل busy/no\_answer قبل 3 محاولات



المشاكل:

\- `call\_logs` لا ترتبط بـ `task\_list\_item\_id`.

\- `call\_logs` لا ترتبط بـ `contact\_target\_id`.

\- `called\_by` موجود لكنه mock = `1`.

\- لا توجد validation backend تمنع تسجيل نتيجة على عنصر لا يخص المستخدم.

\- لا توجد validation تمنع تسجيل نتيجة على Lead غير مسند للمشرفة.

\- يمكن معرفة محاولات العميل عبر `entity\_type/entity\_id`، لكن ليس بدقة كافية على مستوى item/contact target.

\- appointment ينشأ بعد booked، لكنه لا يعرف contact target أو source.



\*\*F) الصلاحيات الحالية\*\*

الموجود:

\- نظام permissions موجود عبر `permissions`, `role\_permission\_grants`, `requirePermission`.

\- routes كثيرة تستخدم `requirePermission`.

\- `planning/marketing-targets` يستخدم `planning.manage`.

\- routes التيلماركتنغ الحالية لا تستخدم `requirePermission`.

\- `/telemarketer` في frontend route محمي فقط بتسجيل الدخول العام، لا بصلاحية محددة.

\- `MarketingOperations` كذلك يعتمد غالباً على ظهور القائمة وليس route guard دقيق.



غير الموجود:

\- لا يوجد `telemarketing.\*` permission واضح.

\- لا يوجد فصل بين view/generate/call/book.

\- لا يوجد backend scope validation للتيلماركتر أو المشرفة.



نموذج صلاحيات مقترح:

\- `telemarketing.targets.view`

\- `telemarketing.lists.view`

\- `telemarketing.lists.generate`

\- `telemarketing.calls.create`

\- `telemarketing.appointments.create`

\- `telemarketing.calls.view\_history`

\- `telemarketing.appointments.view`



Scopes المقترحة:

\- مدير الفرع: `BRANCH`

\- التيلماركتر: `ASSIGNED` أو `TEAM`

\- المشرفة: `ASSIGNED`

\- الإدارة العليا: `GLOBAL/BRANCH`



\*\*G) صلاحية المشرفة في الاتصال\*\*

الخيار 1: نفس TelemarketerWorkspace مع فلترة صلاحيات

\- المزايا: لا نكرر تجربة الاتصال، نفس تسجيل النتيجة والموعد.

\- المخاطر: الصفحة حالياً تعرض فرق وقوائم، وليست مصممة بعد لـ “Leads المسندة لي”.

\- يحتاج: backend filtering حسب current user، وواجهة تعرض “قوائمي/أهدافي”.

\- الأنسب على المدى المتوسط.



الخيار 2: صفحة منفصلة للمشرفة

\- المزايا: تجربة أبسط: “زبائني المطلوب الاتصال بهم”.

\- المخاطر: تكرار منطق الاتصال والمواعيد.

\- مناسب إذا كانت المشرفة لا تعمل كـ telemarketer بل كمسار خاص.



الخيار 3: عمليات التسويق تسمح بتسجيل اتصال مباشر

\- المزايا: صفحة MarketingOperations تعرض Contact Targets عامة ويمكن إضافة action عليها.

\- المخاطر: قد تصبح الصفحة مزدحمة بين إدارة ومراجعة وتنفيذ.

\- مناسب كمرحلة مبكرة للمشرفات فقط، لكن يجب ضبط الصلاحيات والفلترة.



التوصية: استخدام نفس مكونات الاتصال، لكن ليس بالضرورة نفس layout الحالي. الأفضل بناء “Contact Work Queue” مشتركة تخدم التيلماركتر والمشرفة، مع اختلاف scope.



\*\*H) العلاقة مع Contact Targets\*\*

الوضع الحالي:

\- `contact\_targets` موجود.

\- `marketing-targets` يرجع `contactTargetId` إذا وجد.

\- `generate-from-plan` يحدّث `contact\_targets.status = queued`.

\- لكن `telemarketing\_task\_list\_items` لا يحتوي `contact\_target\_id`.

\- `call\_logs` لا يحتوي `contact\_target\_id`.

\- `appointments` لا يحتوي `contact\_target\_id`.



المطلوب لاحقاً:

\- إضافة `contact\_target\_id` إلى:

&#x20; - `telemarketing\_task\_list\_items`

&#x20; - `telemarketing\_call\_logs`

&#x20; - `telemarketing\_appointments`

\- تحديث status:

&#x20; - عند دخول قائمة: `queued` أو `in\_call\_list`

&#x20; - عند تسجيل اتصال: `contacted`

&#x20; - عند حجز موعد: `booked`

&#x20; - عند إغلاق/رفض نهائي: `closed` أو `cancelled`

\- `latest\_task\_list\_item\_id`, `latest\_call\_outcome`, `latest\_appointment\_id` في `contact\_targets` يجب تحديثها فعلياً.



أقل تعديل مستقبلي صحيح:

\- إضافة `contact\_target\_id` على items أولاً.

\- ثم جعل call logs والappointments يلتقطانها من item عند الإنشاء.



\*\*I) العلاقة مع الزيارة لاحقاً\*\*

المسار الصحيح لاحقاً:

Contact Target

→ Task List Item

→ Call Log

→ outcome = booked

→ Appointment

→ لاحقاً Visit(type=marketing, source=appointment/contact\_target)

→ VisitTask(type=device\_demo)



حالياً عند `booked`:

\- يتم إنشاء appointment فقط.

\- لا ينشأ visit، وهذا مطابق للقرار الحالي.

\- لكن appointment لا يحفظ `source\_type/source\_id`, `contact\_target\_id`, `visit\_type`.



البيانات التي يجب حفظها قبل الزيارة:

\- `contact\_target\_id`

\- `task\_list\_item\_id`

\- `source\_type = telemarketing\_appointment`

\- `visit\_type = marketing`

\- `task\_bundle = device\_demo` أو اشتقاقها من visit\_type/source

\- `created\_by/called\_by` الحقيقي



\*\*J) الفجوات الرئيسية\*\*

Priority 1:

\- telemarketing endpoints بلا permissions.

\- snapshot يعرض كل القوائم ولا يفلتر حسب branch/current user بشكل كاف.

\- `called\_by` و `created\_by` mock = 1.

\- لا يوجد assigned caller/team member validation.

\- المشرفة لا يوجد لها scope آمن لرؤية Leads المسندة لها فقط.

\- workspace لا يدعم اليوم/أمس/غداً.



Priority 2:

\- items/logs/appointments غير مرتبطة بـ contact\_targets.

\- endpoint القديم `upsert` يحذف ويعيد items وقد يكسر سجل الاتصال.

\- unique الحالي `team\_key + date` لا يشمل branch.

\- لا يوجد `task\_list\_item\_id` في call logs.

\- لا يوجد source tracking كافٍ للappointment.



Priority 3:

\- لا يوجد visit\_type محفوظ على appointment أو item.

\- لا يوجد task bundle محفوظ أو قابل للاشتقاق رسمياً.

\- لا يوجد تحويل appointment إلى Visit.

\- لا يوجد VisitTask `device\_demo`.



\*\*K) التوصية النهائية\*\*

لا نحتاج جدول daily assignments جديد فوراً إذا كان المقصود قائمة اتصال يومية للفريق. يمكن مبدئياً الاعتماد على:

\- `telemarketing\_task\_lists`

\- `telemarketing\_task\_list\_items`



لكن نحتاج تعديلات بنيوية صغيرة لاحقاً:

\- `contact\_target\_id` على items/logs/appointments.

\- `assigned\_caller\_hr\_user\_id` أو جدول توزيع إذا كان العنصر قد يسند لشخص محدد.

\- permissions جديدة.

\- backend filters حسب branch/user/scope.

\- date navigation في workspace.



هل نحتاج `assigned\_caller\_id`؟

\- نعم إذا المطلوب “ما قوائم الاتصال حسب الشخص المنفذ”.

\- إذا الاتصال يمكن أن ينفذه أي عضو مخول في الفريق، يمكن تأجيله، لكن `called\_by` الحقيقي ضروري فوراً.



هل نبدأ workspace أم backend؟

\- backend أولاً. لأن المشكلة الأساسية أمان وتتبع، وليست UI فقط.



أول خطوة تنفيذية صغيرة مقترحة:

1\. إضافة permissions للتيلماركتنغ وربط endpoints بها.

2\. تعديل snapshot ليقبل/يفلتر بـ `date` و`branch` وscope.

3\. استخدام current user الحقيقي في `called\_by` و`created\_by`.

4\. ربط items بـ `contact\_target\_id`.

5\. تعديل Workspace ليعرض date picker وفلاتر: اليوم/أمس/غداً، الفريق، الحالة.

6\. إضافة منطق supervisor scope: المشرفة ترى Leads المسندة لها فقط.

7\. لاحقاً ربط appointment بـ contact target ثم تجهيز إنشاء Marketing Visit.

