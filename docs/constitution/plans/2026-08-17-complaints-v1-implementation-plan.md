# خطة تنفيذ Complaints V1

> **الحالة:** منفذة برمجياً — غير مطبقة على قاعدة البيانات وغير منشورة
> **المرجع:** DEC-018 + `features/complaints.md` + API contract

## 1. حدود الخطة

تبني الخطة دومين شكاوى مستقلاً للموبايل وCRM. لا تعدل Service Request Registry ولا تضيف `request_type` ولا تعيد استخدام جداول أو حالات أو صلاحيات الطلبات.

## 2. المرحلة 0 — تثبيت العقود

- مراجعة واعتماد المستندات الأربعة وربطها بفهرس الدستور.
- جرد نقاط الزيارة والجهاز والهوية والميديا التي ستُقرأ فقط.
- تثبيت أكواد الأنواع والتصنيفات والحالات والأولويات والنتائج في shared types.
- تثبيت مصفوفة transition × permission × scope.

مخرج المرحلة: اختبارات عقد ثابتة تمنع drift قبل بناء المسارات.

## 3. المرحلة 1 — قاعدة البيانات والصلاحيات

- Migration للجداول المذكورة في الدستور مع FKs وCHECK constraints والفهارس.
- مولد ذري للمرجع `CMP-YYYYMMDD-NNNN` بلا إعادة استخدام.
- append-only guards للتدقيق والحالات والحلول والتحديثات والصور.
- permissions catalog و`role_permission_grants` مع allowed scopes المعتمدة.
- تحديث inventory و`صلاحيات_النظام.xlsx` بالأخضر للإضافات.
- إعدادات كشف التكرار والإساءة مع قيم افتراضية وحدود تحقق.

تحقق DB: ترحيل داخل transaction ثم rollback، مع تقرير صريح بأنه dry-run وليس نشراً.

## 4. المرحلة 2 — نواة الدومين

- `complaintRepository` للقراءة والكتابة المقيّدة.
- `complaintPolicy` لتقييم GLOBAL/BRANCH/ASSIGNED على `handlingBranchId` و`assignedUserId`.
- `complaintTransitionService` المصدر الوحيد لتغيير الحالة.
- خدمات requester snapshot والربط والتعيين والنتائج والتحديثات والتدقيق.
- كاشف التكرار الحتمي وخدمة إعداداته.
- حارس حدود الإساءة.

لا يبدأ أي route قبل نجاح اختبارات النواة والسياسة.

## 5. المرحلة 3 — الصور الخاصة

- إعادة استخدام `processUpload` ونظام `MEDIA_DIR` المتشعب وسجل `media_files`؛ يمنع بناء pipeline صور ثانٍ.
- Migration تضيف `media_files.visibility` بقيمتي `public/private` وافتراضي `public` لحماية التوافق الخلفي.
- Migration توسع `media_files_owner_type_ck` بقيمة `complaint_attachment`.
- توسيع خدمة التخزين لتسجيل private media وإرجاع مرجع داخلي بلا `/m` URL.
- مساحة رفع token مؤقتة مستقلة عن service request uploads، وتشير إلى `media_files.id` وهوية المرسل والانتهاء.
- تحقق magic bytes والحجم والعدد والهوية عبر pipeline الجديد، مع WebP/thumbnail/EXIF stripping.
- `complaint_attachments.media_file_id` FK، بلا public URL أو storage path.
- استهلاك upload tokens ذرياً مع إنشاء الشكوى.
- تعديل `/m` ليخدم `visibility=public` فقط ويرفض private بمعرفة `public_id` نفسها.
- endpoint تنزيل مصرح به يعيد `private, no-store` وخيار quarantine مدقق.
- cleanup للرفع المؤقت المنتهي وغير المستهلك.

لا يوجد مسار رفع CRM ولا تعديل مرفقات بعد الإنشاء.

## 6. المرحلة 4 — Intake الموبايل

- options endpoint.
- create validator مغلق لـ`complaint.mobile.v1`.
- optional App Auth بلا downgrade عند Bearer غير صالح.
- unverified identity بـ`X-Device-Id` وreview flag.
- OTP visitor proof عند توفره.
- visit/device ownership checks وsnapshots.
- create response والرسالة العامة الأولى.
- قائمة وتفاصيل `/me` للمسجل.
- visitor tracking عبر complaint-bound OTP handle.

## 7. المرحلة 5 — CRM API

- list query scoped داخل SQL مع الفلاتر والترتيب.
- detail composer مع أقسام مقيدة بالصلاحيات.
- internal create بلا مرفقات.
- command endpoints لكل انتقال وإسناد وربط وملاحظة وتحديث.
- resolution records متعددة وcurrent resolution pointer.
- duplicate confirm/dismiss workflow.
- settings endpoints بصلاحيات GLOBAL.
- reports/export scoped داخل query.

## 8. المرحلة 6 — واجهة CRM

- Sidebar/route/permission gate للشكاوى.
- جدول وفلاتر وحالات empty/loading/error.
- صفحة التفاصيل ذات الأقسام المعتمدة.
- action bar مشتق من permissions وحالة الشكوى.
- نوافذ triage/assign/start/wait/resolve/close/reject/withdraw/reopen.
- أزرار إنشاء سياقية من العميل والزيارة والجهاز.
- إعدادات التكرار والإساءة.
- التقارير والتصدير.

إخفاء الواجهة UX فقط؛ الخادم يبقى الحماية.

## 9. المرحلة 7 — تسليم الموبايل

- تسليم API contract وأمثلة payload/error states.
- تنفيذ Home entry والزيارة والجهاز.
- نماذج الهوية الثلاثة وحدود الأنواع.
- upload-before-submit وإعادة المحاولة الآمنة.
- قائمة شكاوى المسجل وتفاصيله.
- tracking flow للزائر.
- لا محادثة ولا زر إعادة فتح ولا إشعارات.

## 10. الاختبارات الإلزامية

### الهوية والملكية

- unverified يقبل عام/فني ويرفض جهاز.
- OTP يقبل manual device.
- App Account لا يستطيع إرسال clientId أو زيارة/جهاز لغيره.
- invalid Bearer لا يسقط إلى unverified.
- tracking ref بلا OTP لا يكشف بيانات.
- زائر بلا محافظة يرفض، ومعرف SmartGeo غير فعال أو بمستوى/سلسلة آباء خاطئة يرفض.
- WhatsApp الثانوي بلا رقم ثانوي يرفض، وغياب علامتي WhatsApp يبقى صالحاً ويحفظ `null`.

### الصلاحيات والنطاق

- missing permission، wrong branch، unassigned subject.
- كل GLOBAL-only action يرفض BRANCH/ASSIGNED.
- branch list لا يرى unassigned central complaints.
- origin/target branch لا يوسع الرؤية.
- super-admin path صريح.

### الحالات

- كل انتقال موجب وسالب.
- close بلا resolution يرفض.
- duplicate outcome بلا أصل يرفض.
- reopen يحفظ الحل السابق.
- direct status update غير موجود.

### الصور

- MIME مزور، حجم/عدد زائد، token لهوية أخرى، token منتهي أو مستهلك.
- الموظف لا يملك upload endpoint.
- download خارج النطاق يرفض.
- EXIF GPS يزال.
- `/m/<private-public-id>` يرفض، بينما وسائط الأجهزة والفروع والبنرات العامة الحالية تبقى قابلة للقراءة.
- private upload لا يعيد public URL، والـGC يتعرف على ملكية `complaint_attachment`.

### التكرار والإساءة

- كل نمط كشف وحدوده وإيقافه.
- الاشتباه لا يغلق ولا يربط تلقائياً.
- تغيير الإعداد لا يعيد كتابة التاريخ.
- `429` لا ينشئ شكوى ولا يستهلك الصور.

### العرض العام

- public response لا يسرب الأولوية أو الإسناد أو الملاحظات أو التدقيق.
- الحالة الداخلية تطابق public status mapping.
- public resolution summary إلزامي وظاهر.

## 11. بوابات التسليم

- API and web typecheck.
- الاختبارات المختارة والجديدة ناجحة.
- Vite production build ناجح.
- permission inventory/audit ناجح.
- migration clean-chain وrollback dry-run ناجحان.
- `git diff --check` نظيف.
- اختبار HTTP/DB على staging قبل اقتراح الإنتاج.

## 12. خارج هذه الخطة

- سياسة تعارض المصالح للمشكو عليه.
- SLA وoverdue.
- صوت/فيديو/PDF.
- ملفات موظفين.
- سجل اتصالات.
- محادثة وإعادة مراجعة من التطبيق.
- إشعارات.
- سياسة احتفاظ طويلة الأجل.
