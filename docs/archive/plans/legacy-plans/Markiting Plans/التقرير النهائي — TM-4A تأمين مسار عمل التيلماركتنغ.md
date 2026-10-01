التقرير النهائي — TM-4A: تأمين مسار عمل التيلماركتنغ

1\. الملفات المعدّلة

الملف	التغيير

packages/api/services/telemarketingScope.ts	جديد — مساعد النطاق

packages/api/routes/telemarketing.ts	إعادة كتابة شاملة مع حماية النطاق

packages/web/src/lib/api.ts	snapshot يقبل date اختياري

packages/web/src/hooks/useTelemarketingStore.ts	loadData(date?) يقبل التاريخ

packages/web/src/pages/TelemarketerWorkspace.tsx	تمرير date إلى loadData

packages/web/src/layout/MainLayout.tsx	telemarketer.view → telemarketing.lists.view

2\. تفاصيل تنفيذ مساعد النطاق

الملف telemarketingScope.ts يحتوي على:



getCurrentEmployeeId(hrUserId) — يربط hr\_users.id بـ employees.id عبر employee\_id

parseTeamKeyIndex(teamKey) — يوزع team\_X إلى فهرس

loadDaySchedule(date) — يجلب جدول اليوم

getTeamFromSchedule(date, schedule, teamKey) — يجلب فريق محدد

isEmployeeTelemarketerInTeam(employeeId, team) — يتحقق من عضوية التيلماركتر

canAccessTaskList(authContext, taskList) — يتحقق من صلاحية الوصول لقائمة مهام

canGenerateForTeam(authContext, date, teamKey) — يتحقق من صلاحية توليد القوائم

3\. كيف يتم تحديد هوية الموظف الحالي

يتم استخدام req.authContext.userId (= hr\_users.id) ثم الاستعلام عن hr\_users.employee\_id WHERE id = $userId AND is\_active = TRUE. هذا يربط مستخدم المصادقة بسجل الموظف الخاص به.



4\. كيف يتم التحقق من عضوية فريق التيلماركتر

isEmployeeTelemarketerInTeam(employeeId, team)

تتحقق مما إذا كان employeeId موجوداً في team.telemarketers\[]. الدالة canAccessTaskList تسمح أيضاً بالوصول إذا كان الموظف هو المشرف (team.supervisor) أو الفني (team.technician).



5\. كيف تم تصفية الـ snapshot

يقبل GET /telemarketing/snapshot?date=YYYY-MM-DD اختيارياً

دائماً يقوم بتصفية حسب actingBranchId (فيُرجع فقط بيانات الفرع المعني)

بالنسبة للتيلماركتر: يحدد الفرق المتاحة من جدول اليوم ويُرجع فقط قوائم المهام والمواعيد وسجلات المكالمات الخاصة بتلك الفرق

بالنسبة للمشرف/المدير: يُرجع جميع بيانات الفرع

بالنسبة للمشرف العام: يُرجع كل شيء بدون تصفية

6\. كيف تعمل صلاحيات سجل المكالمات

يتطلب taskListId في مسار سجل المكالمات الرئيسي

يستخدم verifyTaskListAccess للتحقق من:

فرع قائمة المهام يطابق actingBranchId

إذا كان المستخدم تيلماركتر، يجب أن يكون عضواً في الفريق لذلك التاريخ

يُرجع 403 إذا لم يكن مصرحاً به

7\. كيف تعمل صلاحيات المواعيد

نفس منطق سجل المكالمات باستخدام verifyTaskListAccess

فحص تعارض المواعيد أصبح الآن مقيّداً بالفرع: team\_key + date + time\_slot + branch\_id

8\. كيف تعمل صلاحيات generate-from-plan

يستخدم canGenerateForTeam(authContext, date, teamKey)

يرفض الوصول إذا كان المستخدم تيلماركتر (دور الموظف = 'telemarketer')

يتحقق من أن الفريق موجود في الجدول لذلك التاريخ

يتطلب سياق فرع

المشرف العام والنطاق العالمي مسموحان دائماً

9\. كيف تم تمرير معامل التاريخ للواجهة الأمامية

api.telemarketing.snapshot(date?) يبني ?date=YYYY-MM-DD في عنوان URL

useTelemarketingStore.loadData(date?) يمرر التاريخ إلى API

TelemarketerWorkspace يستدعي loadData(date) في useEffect الذي يعتمد على date

10\. كيف تم إصلاح عدم تطابق صلاحيات القائمة/المسار

تم تغيير can('telemarketer.view') إلى can('telemarketing.lists.view') في MainLayout.tsx

هذا يتطابق الآن مع صلاحيات requirePermission('telemarketing.lists.view') الخاصة بالواجهة الخلفية

مسار /telemarketer لا يزال يستخدم ProtectedRoute (التحقق من الرمز المميز فقط)

11\. نتائج فحص TypeScript

حزمة واجهة برمجة التطبيقات: ✓ مرت بنجاح بدون أخطاء

حزمة الويب: ✓ مرت بنجاح بدون أخطاء

12\. ما تم تأجيله

قائمة "مكالمات العملاء الخاصة بالمشرف" الخاصة بالمشرف (TM-4B/TM-5)

إجراء مكالمات مباشرة من جانب المشرف

assigned\_caller\_id على عناصر قائمة المهام

قيد فريد branch\_id في قائمة المهام

إنشاء زيارة

إنشاء مهمة زيارة device\_demo

إزالة إدخال القديم



