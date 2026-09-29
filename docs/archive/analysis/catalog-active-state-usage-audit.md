# تدقيق استخدام حالة فعالية كتالوج الأجهزة وقطع الغيار

> **التاريخ:** 2026-07-02  
> **الفرع:** `devices-spare-parts-fix`  
> **مرجع القرار:** `docs/constitution/decisions/DEC-012-catalog-active-state.md`  
> **نطاق المرحلة:** فحص وتصنيف فقط، بلا تغيير تنفيذي على قاعدة البيانات أو API أو الواجهة.

---

## 1. خلاصة المرحلة الثانية

المشكلة ليست فقط إضافة عمود `is_active`. نقطة الخطورة أن نفس قوائم الكتالوج الحالية تستخدم في سياقات مختلفة:

- سياقات بيع أو عرض أو عقد جديد: يجب أن ترى السجلات الفعالة فقط.
- سياقات إدارة الكتالوج: يجب أن ترى الفعال وغير الفعال، مع فلتر وشارة حالة.
- سياقات صيانة جهاز قائم أو مهمة مفتوحة: يجب أن ترى السجلات غير المحذوفة حتى لو كانت inactive، لأن التعطيل لا يلغي التاريخ ولا يمنع خدمة الأصل الموجود.
- سياقات تاريخية: يجب ألا تختفي snapshots أو الروابط القديمة بسبب تعطيل الكتالوج.

لذلك لا يجوز تطبيق فلتر عام مثل `WHERE is_active = TRUE` على كل استعلامات `device_models` و`spare_parts`. يجب أن يكون الفلتر مبنياً على سياق الاستخدام.

---

## 2. قاعدة التصنيف المعتمدة

| التصنيف | المعنى | السلوك المطلوب لاحقاً |
|---|---|---|
| `new_commercial_use` | بيع جديد، عرض جديد، عقد جديد، ملحقات عقد جديد | إظهار/قبول `is_active = true` فقط. |
| `catalog_management` | شاشة إدارة الأجهزة والقطع والأسعار والخصومات | إظهار active و inactive غير المحذوفة، مع شارة وفلتر. |
| `existing_device_service` | صيانة أو تركيب أو نتيجة مهمة لجهاز قائم | إظهار active و inactive غير المحذوفة، مع تحذير عند inactive. |
| `history_or_snapshot` | عروض ومهام وسجلات مركبة سابقاً | لا فلترة على `is_active`، ويجب الحفاظ على الاسم/السعر/الكود snapshot. |
| `operational_assignment` | ربط موديلات الأجهزة بنطاقات تشغيلية مثل الأقسام | إظهار inactive لحماية الإعدادات القائمة، ومنع توسيع استخدامه الجديد إلا بعد إعادة تفعيله أو قرار صريح. |

---

## 3. أثر API الحالي

| الموقع | السلوك الحالي | التصنيف | الأثر المطلوب في مرحلة التنفيذ |
|---|---|---|---|
| `packages/api/routes/deviceModels.ts:287` | `GET /device-models` يرجع كل غير المحذوف `deleted_at IS NULL` | endpoint مشترك | إضافة `isActive` للـ response وخيار صريح مثل `includeInactive`. لا يعتمد عليه كسلوك واحد لكل الشاشات. |
| `packages/api/routes/deviceModels.ts:370` | `GET /device-models/for-sale` يرجع كل غير المحذوف | `new_commercial_use` | يجب أن يصبح active-only دائماً. |
| `packages/api/routes/spareParts.ts:187` | `GET /spare-parts` يرجع كل غير المحذوف | endpoint مشترك | إضافة `isActive` وخيار صريح حسب السياق. لا يصلح كفلتر عام active-only. |
| `packages/api/routes/deviceModels.ts:485` | إنشاء جهاز جديد بلا حالة فعالية | `catalog_management` | القيمة الافتراضية `is_active = true`. يمكن السماح بتعيينها من شاشة الإدارة لاحقاً. |
| `packages/api/routes/spareParts.ts:247` | إنشاء قطعة جديدة بلا حالة فعالية | `catalog_management` | القيمة الافتراضية `is_active = true`. |
| `packages/api/routes/deviceModels.ts:578` | تعديل جهاز لا يتعامل مع الفعالية | `catalog_management` | إضافة إمكانية تغيير `is_active` دون المساس بـ `deleted_at`. |
| `packages/api/routes/spareParts.ts:321` | تعديل قطعة لا يتعامل مع الفعالية | `catalog_management` | إضافة إمكانية تغيير `is_active` دون المساس بـ `deleted_at`. |
| `packages/api/routes/deviceModels.ts:638` | الحذف يكتب `deleted_at` | حذف منطقي | يبقى كما هو، ولا يستخدم كتعطيل. |
| `packages/api/routes/spareParts.ts:369` | الحذف يكتب `deleted_at` | حذف منطقي | يبقى كما هو، ولا يستخدم كتعطيل. |

ملاحظة مهمة: endpoints المشتركة يجب ألا تغير معناها بشكل مفاجئ قبل تحديث كل المستهلكين. التنفيذ الآمن هو جعل wrapper في الواجهة يطلب السياق صراحة، مثل:

- `deviceModels.list({ branchId, includeInactive })`
- `spareParts.list({ includeInactive })`
- أو helpers أوضح: `listForSale`, `listForManagement`, `listForService`.

---

## 4. تصنيف استخدامات الواجهة

| الموقع | الاستخدام | التصنيف | قرار المرحلة اللاحقة |
|---|---|---|---|
| `packages/web/src/pages/DeviceManagement.tsx:824` | إدارة الأجهزة | `catalog_management` | يجب أن يعرض active و inactive، مع فلتر وشارة وتبديل حالة. |
| `packages/web/src/pages/DeviceManagement.tsx:825` | إدارة قطع الغيار | `catalog_management` | نفس سلوك الإدارة. |
| `packages/web/src/pages/DeviceDetail.tsx:121` و `:196` | صفحة تفاصيل جهاز من الكتالوج | `catalog_management` / `history_or_snapshot` | يجب ألا تنكسر عند تعطيل الجهاز. الأفضل لاحقاً endpoint `GET /device-models/:id` أو list مع `includeInactive=true`. |
| `packages/web/src/pages/DeviceDetail.tsx:122` | قطع متوافقة في تفاصيل الجهاز | `catalog_management` | يجب عرض active و inactive مع تمييز الحالة. |
| `packages/web/src/pages/contracts/ContractForm.tsx:285` | اختيار جهاز لعقد | `new_commercial_use` | active-only للعقد الجديد. في التعديل يجب عدم مسح بند عقد محفوظ إذا صار الجهاز inactive. |
| `packages/web/src/pages/contracts/ContractForm.tsx:287` | ملحقات/قطع ضمن عقد | `new_commercial_use` | active-only عند إضافة ملحق جديد. البنود المحفوظة يجب أن تبقى snapshot. |
| `packages/web/src/components/clients/DeviceOfferModal.tsx:410` | عرض جهاز مرتبط بعميل | `new_commercial_use` | active-only. |
| `packages/web/src/components/clients/StandaloneDeviceOffersModal.tsx:81` | عرض جهاز مستقل | `new_commercial_use` | active-only. |
| `packages/web/src/taskTypes/device_demo/DeviceDemoResultModal.tsx:280` | نتيجة ديمو قد تتحول إلى عرض/بيع | `new_commercial_use` | اختيار جديد active-only، مع إبقاء العروض السابقة ظاهرة عبر snapshot. |
| `packages/web/src/pages/clientProfile/DevicesTab.tsx:239` | إضافة جهاز خارجي قائم لزبون | `existing_device_service` مع بوابة إنشاء | إذا كان المقصود تسجيل جهاز قائم فعلاً، يمكن عرض inactive مع تحذير. إذا كان بيعاً جديداً فيجب active-only. يحتاج نص/تحقق يوضح السياق. |
| `packages/web/src/taskTypes/device_delivery/DeviceInstallationResultModal.tsx:203` | قطع مستخدمة في تركيب/تسليم جهاز قائم | `existing_device_service` | يجب السماح برؤية inactive غير المحذوفة لأن الجهاز قائم، مع تحذير. |
| `packages/web/src/components/emergency/result-phases/MaintenanceActionsForm.tsx:415` | قطع صيانة طارئة/دورية | `existing_device_service` | يجب السماح برؤية inactive غير المحذوفة إذا كانت متوافقة أو مرتبطة بالتاريخ، مع تحذير. |
| `packages/web/src/pages/Departments.tsx:103` | توفر أجهزة حسب الأقسام | `operational_assignment` | عرض inactive لحماية الربط القائم، مع منع اختيار inactive كربط جديد إلا بقرار واضح أو إعادة تفعيل. |
| `packages/web/src/pages/jobs/TrainingCourses.tsx:80` | ربط دورة تدريبية بجهاز | `history_or_snapshot` / مرجعي | يفضل عرض inactive مع شارة لأن التدريب قد يكون على موديل قديم. |

---

## 5. نقاط backend التاريخية والمفتوحة

| الموقع | الاستخدام | القرار |
|---|---|---|
| `packages/api/routes/openTasks.ts:1733` | جلب اسم جهاز عند إنشاء عناصر مهمة | إذا كانت المهمة تؤدي لعرض/بيع جديد يجب التحقق من active. إذا كانت snapshot تاريخية لا يطبق active filter. |
| `packages/api/routes/openTasks.ts:2911` | عرض pre-offers محفوظة مع اسم الجهاز | لا يطبق active filter. يفضل إرجاع `isActive` لاحقاً لإظهار تحذير فقط. |
| `packages/api/routes/openTasks.ts:4546` | أجهزة مركبة مرتبطة بمهمة قائمة | لا يطبق active filter. المهمة القائمة يجب أن تبقى قابلة للعرض والخدمة. |
| `packages/api/routes/installedDevices.ts:102` و `:249` | عرض أجهزة مركبة مع موديلها | لا يطبق active filter. تعطيل الموديل لا يخفي جهاز الزبون. |
| `packages/api/routes/installedDevices.ts:171` | إنشاء جهاز خارجي مرتبط بموديل | يحتاج قرار دقيق: إذا كان تسجيل أصل قائم، يسمح inactive مع تحذير؛ إذا كان إضافة كبيع/توريد جديد، يجب active-only. |
| `packages/api/routes/emergencyResult.ts:1383` | حفظ قطع نتيجة صيانة | يسمح بسياق خدمة جهاز قائم. يجب الاعتماد على snapshot وعدم حذف التاريخ بسبب inactive. |
| `packages/api/routes/emergencyResult.ts:1427` | تسجيل قطع مركبة على جهاز | يسمح بسياق خدمة جهاز قائم. |
| `packages/api/services/visitTaskResultReflection.ts` | عكس نتائج الزيارات إلى سجلات تشغيلية | يجب فصل validators: عروض/بيع جديد active-only، صيانة جهاز قائم تسمح inactive مع snapshot. |

---

## 6. أخطار يجب تجنبها في التنفيذ

1. تطبيق `AND is_active = TRUE` داخل كل joins على `device_models` أو `spare_parts` سيخفي تاريخاً ومهاماً مفتوحة.
2. جعل `GET /device-models` أو `GET /spare-parts` active-only افتراضياً قبل تحديث كل المستهلكين سيكسر شاشة الإدارة وتفاصيل الأجهزة وصيانة الأجهزة القائمة.
3. في `ContractForm` يوجد منطق يحمي line items في وضع التعديل عندما لا يكون `selectedDevice` موجوداً في lookup الحالي. عند جعل قائمة العقود active-only، يجب التأكد أن عقداً محفوظاً بجهاز صار inactive لا يمسح بنوده أو يصفر مجموعه.
4. بيانات staging التي تهجرت سابقاً على أن `Inactive = deleted_at` لا يمكن إصلاح معناها بمجرد إضافة عمود `is_active`. يلزم مصدر legacy أو جدول mapping يعيد التفريق بين inactive و deleted.
5. تعطيل قطعة غيار لا يعني عدم وجودها في المخزون. توفر المخزون بوابة مختلفة عن `is_active`.

---

## 7. توصية التنفيذ للمرحلة الثالثة

الترتيب المقترح لتقليل الأثر:

1. إضافة migration لعمودي `is_active BOOLEAN NOT NULL DEFAULT TRUE` في `device_models` و`spare_parts` مع indexes ملائمة للبحث غير المحذوف والفعال.
2. تعديل select serializers لإرجاع `isActive` في الجهاز والقطعة.
3. إضافة options صريحة إلى API wrappers في الواجهة بدلاً من تغيير معنى `list()` ضمناً.
4. تحويل شاشات الإدارة والتفاصيل أولاً إلى `includeInactive=true` حتى لا تختفي السجلات عند بدء الفلترة.
5. تحويل العقود والعروض وبيع الأجهزة إلى active-only.
6. تحويل الصيانة والتركيب والأجهزة القائمة إلى includeInactive مع شارة تحذير.
7. إضافة تحقق backend في مسارات الإنشاء التجاري الجديد يمنع inactive، مع ترك مسارات التاريخ والصيانة القائمة دون منع عام.
8. بعد ثبات السلوك، تعديل mapping التهجير: legacy `Inactive` يكتب `is_active=false` و`deleted_at=NULL`.

---

## 8. نتيجة المرحلة

هذه المرحلة لا تغير السلوك. النتيجة العملية هي خريطة أثر واضحة قبل التنفيذ:

- inactive ليس deleted.
- البيع الجديد active-only.
- الصيانة والتاريخ لا يختفيان.
- إضافة العمود آمنة فقط إذا تم تحديث كل مستهلك حسب سياقه.
