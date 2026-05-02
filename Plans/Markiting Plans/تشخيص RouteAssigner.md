\*\*تشخيص RouteAssigner\*\*

لم أعدّل أي كود. التشخيص من الكود الحالي يقول إن سبب ظهور `-` مباشر وواضح: `RouteAssigner` لا يحمّل `countsByZone` إلا إذا كان نطاق العمل الحالي مطابقًا تمامًا للتعيين المحفوظ في `route\_assignments`. إذا لم يتحقق هذا الشرط، يتم ضبط `stationLeadCounts = null`، والجدول يعرض `-`.



\*\*A) RouteAssigner UI\*\*

مصدر المحطات هو `finalZones` في \[RouteAssigner.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/pages/planning/RouteAssigner.tsx:184).



يتم بناؤها من:

\- `composition`: مقاطع المسارات المختارة.

\- `extraZones`: المناطق الإضافية.

\- إزالة التكرار عبر `zones.some(z => z.id === s.id)`.



الحقل المستخدم كـ id لكل محطة هو:

`zone.id`



وهو رقم `number`، لأن:

\- نقاط المسار تستخدم `p.geoUnitId`.

\- المناطق الإضافية يتم تحويلها بـ `parseInt`.

\- `finalZones` معرف كـ `{ id: number; name: string; level: number }\[]`.



جدول المحطات يُعرض في \[RouteAssigner.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/pages/planning/RouteAssigner.tsx:413).



مكان ظهور `-` هو هنا:

`stationLeadCount ?? '-'`



والشرط الذي يجعلها `-` هو:

`stationLeadCounts` يساوي `null`.



عمليًا:

```ts

const stationLeadCount = stationLeadCounts ? (stationLeadCounts\[z.id] ?? 0) : null;

```



إذا `stationLeadCounts = null` تصبح القيمة `null`، ثم يعرض الجدول `-`.



يوجد state للعدادات:

`stationLeadCounts: Record<number, number> | null`



ويتم استدعاء endpoint:

`api.planning.marketingTargets(date, selectedTeam)`



والاستدعاء يعتمد على:

\- `date`

\- `selectedTeam` كـ `teamKey`



لكن الاستدعاء لا يحدث إلا إذا تحقق هذا الشرط:

```ts

selectedTeam \&\& finalZones.length > 0 \&\& hasPersistedAssignmentMatch

```



إعادة الجلب مرتبطة بـ:

\- التاريخ: نعم، داخل dependency array.

\- الفريق: نعم.

\- المسارات: نعم عبر `finalZones` و `hasPersistedAssignmentMatch`.

\- extraZones: نعم عبر `finalZones` و `hasPersistedAssignmentMatch`.

\- حفظ التعيين: غير مباشر، بعد الحفظ يتم تحديث `routeAssignments` لكن يتم أيضًا تصفير `stationLeadCounts`; بعدها المفروض effect يعيد الجلب إذا صار `hasPersistedAssignmentMatch = true`.



\*\*B) Endpoint العدادات\*\*

يوجد endpoint فعلي:

`GET /api/planning/marketing-targets?date=YYYY-MM-DD\&teamKey=team\_0`



تعريفه في \[planning.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/planning.ts:121).



شكل الاستجابة يحتوي:

\- `leads`

\- `candidates: \[]`

\- `countsByZone`

\- `counts`

\- `zoneIds`

\- `targetStationsCount`

\- `supervisorEmployeeId`

\- `supervisorHrUserId`



`countsByZone` يرجع كـ array:

```ts

\[{ zoneId, count }]

```



المفتاح هو `zoneId` وليس `id`.



الـ backend يرجع 0 للمحطات التي لا تحتوي Leads، لأنه يبني النتيجة هكذا:

```ts

zoneIds.map(zoneId => ({

&#x20; zoneId,

&#x20; count: countsByZoneMap.get(zoneId) ?? 0,

}))

```



إذن المشكلة ليست أن الـ endpoint يسقط محطات الصفر. هو يرجعها كـ `0` إذا وصل إلى مرحلة بناء `zoneIds`.



لكن نقطة مهمة: الـ endpoint يحسب من `route\_assignment` المحفوظ فقط:

```ts

const assignmentKey = `${date}\_${teamKey}`;

SELECT routes, extra\_zones FROM route\_assignments WHERE key = $1

```



أي أنه لا يعرف التركيبة الحالية غير المحفوظة في الواجهة.



\*\*C) سبب ظهور "-"\*\*

السبب المباشر في الواجهة:



`stationLeadCounts` يبقى `null`.



والسبب الأكثر احتمالًا لذلك:

`hasPersistedAssignmentMatch` يساوي `false`.



هذا يحدث إذا:

\- الفريق له `finalZones` ظاهرة في الواجهة لكنها غير محفوظة بعد.

\- أو المستخدم غيّر المسارات/extraZones بعد آخر حفظ.

\- أو شكل البيانات في `composition` لا يطابق حرفيًا شكل `savedAssignmentForCurrentKey.routes` عند المقارنة بـ `JSON.stringify`.

\- أو لا يوجد أصلًا `routeAssignments\[currentKey]` محمّل في state.

\- أو بعد الحفظ مباشرة يوجد لحظة/حالة لا يعاد فيها الجلب كما يتوقع المستخدم.



الكود الحالي لا يعرض `0` عندما لا يتم الجلب. هو يعرض `-`.



ليس السبب المرجح:

\- ليس mismatch بين `zoneId` و `id`، لأن الواجهة تحول `countsByZone` إلى Map باستخدام `entry.zoneId` ثم تبني object بمفاتيح `zone.id`.

\- ليس لأن endpoint لا يرجع zero counts، فالـ backend يملأ الصفر.

\- ليس لأن date/teamKey غير مرسلين عند الجلب، فالاستدعاء يرسلهما.

\- لكن قد لا يتم الاستدعاء أصلًا بسبب شرط `hasPersistedAssignmentMatch`.



\*\*D) السلوك المطلوب مقابل الحالي\*\*

الحالي:

\- إذا تم تحميل `countsByZone` بنجاح: المحطات تظهر `0` أو الرقم.

\- إذا لم يتم التحميل بسبب الشرط أو فشل الطلب: المحطات تظهر `-`.

\- إذا كان قيد التحميل ومع `stationLeadCounts === null`: تظهر `...`.

\- بعد انتهاء التحميل الفاشل أو عدم بدء التحميل: تظهر `-`.



المطلوب:

\- بعد نجاح endpoint يجب ألا تظهر `-`.

\- إذا count غير موجود لمحطة بعد نجاح التحميل، يجب عرض `0`.

\- إذا الفريق `solo`، يجب عرض `0` لكل محطة، لا `-`.

\- إذا لا توجد assignments للمشرفة، يجب عرض `0` لكل محطة، لا `-`.

\- إذا فشل endpoint فقط، يمكن عرض dash أو حالة خطأ واضحة، لكن ليس كحالة عادية لكل المحطات.



الفجوة الحالية أن الواجهة لا تميز بين:

\- لم يتم التحميل لأن النطاق غير محفوظ.

\- فشل التحميل.

\- تم التحميل والعدد صفر.



كلها تنتهي بصريًا إلى `-` في حالات كثيرة.



\*\*E) العلاقة مع حفظ التعيين\*\*

نعم، الحساب الحالي يعتمد على `route\_assignment` المحفوظ فقط في backend.



إذا غيّر المستخدم المسارات ولم يحفظ:

\- `finalZones` تتغير وتظهر المحطات الجديدة.

\- `hasPersistedAssignmentMatch` يصبح `false`.

\- لا يتم استدعاء endpoint.

\- `stationLeadCounts` يصبح `null`.

\- كل محطة تعرض `-`.



هنا أمامنا خياران لاحقًا:



الخيار 1: عرض counts فقط بعد الحفظ.

هذا يناسب endpoint الحالي ولا يحتاج API جديد. لكن يجب أن تكون الواجهة واضحة: عند وجود تغييرات غير محفوظة لا تعرض `-` وكأنها نتيجة، بل تعرض حالة مثل “غير محسوب” أو تخفي العداد حتى الحفظ. وبعد الحفظ يجب إعادة الجلب وعرض `0` أو الرقم.



الخيار 2: حساب counts للتركيبة الحالية قبل الحفظ.

هذا يتطلب endpoint جديد أو توسيع endpoint الحالي ليقبل `routes` و `extraZones` في body/query، بدل الاعتماد على `route\_assignments`. هذا أدق UX لكنه تعديل أكبر، لأن backend سيحتاج حساب `zoneIds` من payload غير محفوظ.



\*\*F) التقرير المختصر\*\*

1\. مصدر جدول المحطات:

`finalZones` في `RouteAssigner.tsx`، مبنية من `composition + extraZones` مع إزالة التكرار.



2\. هل يوجد endpoint للعدادات؟

نعم، `GET /api/planning/marketing-targets`.



3\. هل RouteAssigner يستدعيه؟

نعم، لكن فقط عندما يكون `hasPersistedAssignmentMatch = true`.



4\. لماذا تظهر `-` حاليًا؟

لأن `stationLeadCounts = null`. وهذا غالبًا لأن التعيين الحالي في الواجهة لا يطابق التعيين المحفوظ، أو لأن الجلب لم يبدأ/فشل. عند `null` تعرض الواجهة `stationLeadCount ?? '-'`.



5\. أقل تعديل مطلوب لاحقًا حتى تظهر `0` أو الرقم:

إصلاح حالة الواجهة بحيث بعد نجاح تحميل counts يتم عرض `0` لأي محطة غير موجودة في map، وهذا موجود جزئيًا. والأهم: تعديل شرط/حالة `hasPersistedAssignmentMatch` أو طريقة العرض حتى لا تبقى `stationLeadCounts = null` للحالات التي يجب أن تكون صفر، خصوصًا `solo` أو نطاق محفوظ فعليًا. كذلك إزالة النصوص المطلوبة منك: كلمة `محتملون` وجملة `Leads مسندة للمشرفة`.



6\. هل نحتاج endpoint جديد؟

ليس ضروريًا إذا القرار أن العد يظهر فقط للتعيين المحفوظ. نحتاج إصلاح ربط/حالة UI. نحتاج endpoint جديد فقط إذا أردنا حساب العد للتركيبة الحالية قبل الحفظ.



7\. هل الحساب يعتمد على المحفوظ أم غير المحفوظ؟

يعتمد على `route\_assignment` المحفوظ فقط. لا يحسب من `composition` الحالية في الواجهة.



8\. الملفات التي ستتأثر في التنفيذ:

\- \[RouteAssigner.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/pages/planning/RouteAssigner.tsx): إصلاح عرض `-`، إزالة النصوص، وضبط إعادة الجلب/حالة النطاق غير المحفوظ.

\- \[planning.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/planning.ts): لا يحتاج تعديل إذا بقينا على الحساب من التعيين المحفوظ.

\- \[api.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/lib/api.ts): لا يحتاج تعديل إلا إذا قررنا endpoint جديد لحساب التركيبة غير المحفوظة.

