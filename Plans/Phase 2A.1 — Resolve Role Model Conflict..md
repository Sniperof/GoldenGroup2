\*\*تحليل موجز\*\*

سأعدل ملفين فقط:

\- \[migrations/020\_role\_model\_conflict\_cleanup.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/020\_role\_model\_conflict\_cleanup.sql:1) كمهاجرة cleanup بنيوية

\- \[packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:298) لأن propagate logic كان ينسخ `role\_permissions` فقط ويترك `role\_permission\_grants` ناقصة



الافتراضات التي بنيت عليها:

\- أي `hr\_users.role\_id` يشير إلى role clone لها `template\_id` صالح يجب تحويله إلى template role المقابل

\- أسماء template والclone متطابقة أو لا يهمنا `hr\_users.role` النصي هنا لأنه legacy

\- لا نريد الآن hard-block على write paths التي قد تعيد كتابة clone IDs، لأن ذلك سيغير runtime behavior ويتجاوز هذه المرحلة



Edge cases المتوقعة:

\- إذا وُجد أكثر من primary branch assignment لنفس المستخدم، المهاجرة تُبقي أقدم صف primary وتحوّل الباقي إلى `is\_primary = false` قبل إنشاء الـ partial unique index

\- إذا وُجدت statuses عشوائية في `user\_branch\_assignments` فالمهاجرة تطبعها إلى `active` قبل إضافة الـ check constraint



\*\*التنفيذ\*\*

نفذت:

\- Migration جديدة تعيد توجيه `hr\_users.role\_id` من clone roles إلى template roles فقط عندما يكون:

&#x20; - `is\_template = false`

&#x20; - `template\_id IS NOT NULL`

&#x20; - والـ template الهدف موجود وفعلاً `is\_template = true`

\- إضافة `status` check constraint على `user\_branch\_assignments` بحيث القيم المقبولة فقط:

&#x20; - `active`

&#x20; - `inactive`

\- إضافة partial unique index يضمن primary واحد كحد أقصى لكل مستخدم:

&#x20; - `UNIQUE (user\_id) WHERE is\_primary = true`

\- تحديث دالة `clone\_role\_templates\_to\_branch(...)` داخل المهاجرة الجديدة لتنسخ أيضاً `role\_permission\_grants`

\- تحديث propagate route في `roles.ts` ليحذف/يعيد إدخال `role\_permission\_grants` عند مزامنة template إلى clones، حتى لا تبقى clones ناقصة grants بعد propagation



تحققت أيضاً من سلامة كود الـ API عبر `tsc --noEmit` ونجح.



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[migrations/020\_role\_model\_conflict\_cleanup.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/020\_role\_model\_conflict\_cleanup.sql:1)

\- \[packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:323)



ما الذي أصبح صحيحاً الآن:

\- بعد تطبيق migration، البيانات الحالية في `hr\_users.role\_id` ستُعاد توجيهها إلى template roles فقط حيث أمكن ذلك

\- branch clone seeding لم يعد يهمل `role\_permission\_grants`

\- propagate logic لم يعد يهمل `role\_permission\_grants`

\- `user\_branch\_assignments` صار عنده constraints أوضح وأقوى



هل صار `hr\_users.role\_id` منسجماً مع المودل المعتمد؟

\- نعم على مستوى \*\*البيانات الحالية بعد تطبيق migration\*\*

\- لكني \*\*لم ألمس write paths\*\* التي قد تسمح مستقبلاً بإسناد clone role IDs مرة أخرى، لأن ذلك كان سيوسع النطاق ويغيّر runtime behavior الحالي



هل أُصلحت branch clone logic؟

\- نعم، في مسارين:

&#x20; - branch creation عبر `clone\_role\_templates\_to\_branch(...)`

&#x20; - template propagation عبر `POST /role-templates/:id/propagate`



هل أضيفت constraints المطلوبة؟

\- نعم:

&#x20; - `user\_branch\_assignments\_status\_ck`

&#x20; - `idx\_user\_branch\_assignments\_one\_primary\_per\_user`



ما الذي لم ألمسه عمداً؟

\- لم أغيّر `buildAuthContext()`

\- لم أنقل read path إلى `role\_permission\_grants`

\- لم أفعّل branch authorization runtime

\- لم أعدّل business routes خارج propagate patch المحدود

\- لم أحذف أي legacy column/table

\- لم أقيّد runtime writes على `hr\_users.role\_id` بعد



Recommendation قصيرة للخطوة التالية:

\- أوصي أن تصبح `role\_permission\_grants` \*\*source of truth على template roles فقط\*\* على المدى التالي

\- لكن عملياً، إلى أن يتحول read path بالكامل ويختفي الاعتماد على clones، استمروا مؤقتاً في \*\*نسخ grants إلى clones\*\* لتجنب drift أو حالات branch creation الناقصة silently

