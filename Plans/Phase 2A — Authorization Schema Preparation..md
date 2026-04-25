\*\*تحليل موجز\*\*

أنشأت migration جديدة واحدة فقط: \[migrations/019\_authorization\_schema\_preparation.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/019\_authorization\_schema\_preparation.sql:1). وضعتها كملف مستقل لأن هذه المرحلة schema/data preparation فقط، ولا تحتاج أي تعديل في services أو read path.



اخترت `VARCHAR(16)` مع `CHECK` لـ `scope\_type` بدل enum. هذا محافظ أكثر، لا يضيف تعقيد migration إضافي، ويدعم القيم المطلوبة فقط: `GLOBAL`, `BRANCH`, `ASSIGNED`. وأبقيت القراءة الحالية كما هي تماماً؛ لم أنقل أي كود تشغيلي بعد إلى `role\_permission\_grants` أو `user\_branch\_assignments` حتى لا يتغير behavior في الإنتاج الآن.



\*\*التنفيذ\*\*

أضفت داخل migration:

\- إنشاء جدول `user\_branch\_assignments` مع:

&#x20; - `id`

&#x20; - `user\_id` FK إلى `hr\_users(id)`

&#x20; - `branch\_id` FK إلى `branches(id)`

&#x20; - `is\_primary default false`

&#x20; - `status default 'active'`

&#x20; - `created\_at`

&#x20; - `updated\_at`

&#x20; - `UNIQUE (user\_id, branch\_id)`

\- backfill محافظ من `hr\_users.branch\_id`:

&#x20; - أي مستخدم لديه `branch\_id` غير null يحصل على assignment واحد

&#x20; - `is\_primary = true`

&#x20; - `status = 'active'`



وأضفت أيضاً:

\- إنشاء جدول `role\_permission\_grants` مع:

&#x20; - `id`

&#x20; - `role\_id` FK إلى `roles(id)`

&#x20; - `permission\_id` FK إلى `permissions(id)`

&#x20; - `scope\_type`

&#x20; - `created\_at`

&#x20; - `updated\_at`

&#x20; - `UNIQUE (role\_id, permission\_id)`

&#x20; - `CHECK (scope\_type IN ('GLOBAL','BRANCH','ASSIGNED'))`

\- backfill محافظ من `role\_permissions`:

&#x20; - كل `(role\_id, permission\_id)` الحالية تُنسخ كـ grant واحدة

&#x20; - `scope\_type = 'GLOBAL'`

\- أضفت التعليق المطلوب:

&#x20; - `PHASE2\_REQUIRED: scope\_type defaults to GLOBAL during migration backfill and will be refined role-by-role in later phases`



\*\*تقرير بعد التنفيذ\*\*

الملفات التي أضفتها/عدلتها في هذه المرحلة:

\- \[migrations/019\_authorization\_schema\_preparation.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/019\_authorization\_schema\_preparation.sql:1)



ما الذي أصبح canonical الآن:

\- `user\_branch\_assignments` صار الجدول الجديد canonical schema-wise لتمثيل branch access

\- `role\_permission\_grants` صار الجدول الجديد canonical schema-wise لتمثيل permission + scope



ما الذي بقي legacy:

\- `hr\_users.branch\_id` بقي primary/legacy branch مؤقتاً

\- `role\_permissions` بقي المصدر التشغيلي الحالي للقراءة

\- `hr\_users.role` بقي legacy فقط كما هو



هل تم backfill بنجاح؟

\- من ناحية migration logic: نعم، الـ backfill موجود ومكتوب بشكل محافظ مع `ON CONFLICT DO NOTHING`

\- من ناحية التنفيذ الفعلي على قاعدة البيانات: لم أشغّل migration هنا، لذلك لا أستطيع الادعاء بأنها طُبقت بالفعل على DB في هذه الجلسة



ما الذي لم ألمسه عمداً:

\- لم أغير `buildAuthContext()`

\- لم أنقل read path إلى `role\_permission\_grants`

\- لم أفعّل branch authorization behavior من `user\_branch\_assignments`

\- لم أعدل routes أو business logic أو UI

\- لم أحذف أي جدول أو عمود legacy



هذا يبقي المرحلة ضمن `schema preparation` فقط، وقابلة للبناء عليها مباشرة في المرحلة التالية.

