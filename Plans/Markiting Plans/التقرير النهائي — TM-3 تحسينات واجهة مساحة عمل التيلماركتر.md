التقرير النهائي — TM-3: تحسينات واجهة مساحة عمل التيلماركتر

1\. الملفات المعدّلة

packages/web/src/pages/TelemarketerWorkspace.tsx — الملف الرئيسي المعدّل

2\. كيف تم تنفيذ التنقل بين التواريخ

تم تغيير const \[date] = useState(getToday()) إلى const \[date, setDate] = useState(getToday())

أُضيفت دالة shiftDate(date, days) لإضافة/طرح أيام

أُضيفت دالة formatDateArabic(date) لعرض التاريخ بالعربية

تم فصل api.schedules.get(date) إلى useEffect مستقل يعمل عند تغيير date

أُضيفت أزرار التنقل (← اليوم →) في الشريط العلوي مع زر "اليوم" يعرض التاريخ بالعربية ويعود لليمين إن لم يكن اليوم الحالي

3\. كيف يتم معالجة selectedTeamKey القديم

useEffect يراقب availableTeams ويعيد ضبط selectedTeamKey إلى أول فريق صالح إن لم يعد الفريق المختار موجوداً في القائمة

عند تغيير الفريق يدوياً، يتم مسح selectedTaskId

عند تغيير التاريخ، يتم إعادة تحميل الجدول وستعمل آلية إعادة الضبط تلقائياً

4\. كيف تُحسب الأعداد

const counts = useMemo(() => ({

&#x20;   remaining: tasks.filter(t => t.status === 'pending').length,

&#x20;   booked: tasks.filter(t => t.status === 'booked').length,

&#x20;   contacted: tasks.filter(t => t.status === 'called' \&\& t.callOutcome !== 'rejected').length,

&#x20;   rejected: tasks.filter(t => t.callOutcome === 'rejected').length,

}), \[tasks]);

remaining: الحالة pending (لم يُتصل به بعد أو مشغول/لا يرد بأقل من 3 محاولات)

booked: الحالة booked

contacted: الحالة called مع نتيجة ليست rejected

rejected: نتيجة rejected

5\. كيف تعمل الفلاتر

statusFilter: نوع StatusFilter = 'all' | 'remaining' | 'booked' | 'contacted' | 'rejected'

دالة getStatusGroup(task) تصنف كل عنصر في مجموعته

filteredTasks يطبق الفلتر ثم البحث

أزرار الفلتر تظهر الاسم العربي والعدد: معلق (5)، محجوز (3)، إلخ

النقر على زر فلتر يفعّل هذا الفلتر

الفلاتر تؤثر فقط على عرض القائمة، لا على بطاقات الأعداد

6\. كيف يعمل البحث

حقل searchQuery يُفلتر حسب task.name و task.mobile و task.contactNumber

البحث يعمل مع الفلتر معاً (both applied)

ملف البحث يظهر في العمود 1 بين أزرار الفلتر والقائمة

7\. الحالات الفارغة المُضافة

الحالة	الرسالة

لا يوجد فرق للتاريخ المحدد	"لا يوجد جدول فرق لهذا التاريخ"

الفريق مختار لكن لا توجد قائمة اتصال	"لم يتم توليد قائمة الاتصال لهذا الفريق بعد"

توجد قائمة لكن لا نتائج مطابقة	"لا توجد نتائج مطابقة للبحث أو الفلتر"

توجد قائمة لكنها فارغة	"لا يوجد عملاء في قائمة الاتصال"

8\. نتائج فحص TypeScript

Web package: ✓ نجح بدون أخطاء

API package: ✓ نجح بدون أخطاء

9\. تأكيد: لم يتم إجراء أي تغييرات على

Backend أو migrations أو Visits أو VisitTasks أو FOP أو OP أو supervisor scope

10\. سلوك TM-2 محفوظ

taskListItemId: selectedTask.id في handleSaveOutcome

taskListItemId: selectedTask.id و taskListId: activeTaskList!.id في handleSaveAppointment

contactTargetId غير معروض في الواجهة



