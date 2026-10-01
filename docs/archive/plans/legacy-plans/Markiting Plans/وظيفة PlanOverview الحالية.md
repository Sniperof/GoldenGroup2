\*\*A) وظيفة PlanOverview الحالية\*\*  

صفحة \[PlanOverview.tsx](<D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/planning/PlanOverview.tsx>) تعرض ملخص خطة اليوم: الفرق المجدولة، هل لها نطاق عمل/مسار أم لا، تفاصيل المقاطع، وعدد “المهام/الأهداف” التسويقية لكل فريق.



حالياً تقرأ:

\- `day\_schedules` عبر `api.schedules.get(date)`.

\- `route\_assignments` عبر `api.routeAssignments.list()`.

\- `routes`, `geoUnits`, `clients`, `employees`, `contracts`, `visits`.

\- candidates من `useCandidateStore`.

\- Leads من `useClientStore().getLeads(contracts, visits)`.



تبني نطاق المناطق داخل `getMarketingLoad` من:

\- نقاط المسارات داخل `assignment.routes`.

\- `assignment.extraZones`.

\- ثم تستخدم `Set<number>` لإزالة التكرار.



عند فتح بطاقة فريق، تعرض Modal فيه candidates/leads المطابقة. ومن نفس البيانات المعروضة يتم توليد قائمة تيلماركتنغ عبر `generateTaskList(teamKey, date, items)`.



\*\*B) منطق getMarketingLoad الحالي\*\*  

الدالة موجودة داخل \[PlanOverview.tsx](<D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/planning/PlanOverview.tsx>) كدالة محلية.



مدخلاتها:

\- `assignment: RouteAssignmentData`

\- تعتمد من الخارج على `savedRoutes`, `geoUnits`, `candidates`, و `activeLeads`.



منطقها الحالي:

\- يبني `zoneIds` من RouteComposition + extraZones.

\- يطابق Candidates إذا:

&#x20; - `status === 'FollowUp'`

&#x20; - `geoUnitId` داخل `zoneIds`

\- يطابق Leads إذا:

&#x20; - `client.neighborhood` داخل `zoneIds`

&#x20; - والـ client موجود ضمن `activeLeads`.



لا يستخدم:

\- الفريق الحالي.

\- `teamKey`.

\- supervisor.

\- assignments.

\- `client\_assignments`.

\- `candidate\_assignments`.



إذن الحساب الحالي جغرافي فقط، ولا يطبق شرط “مسند للمشرفة”.



\*\*C) تعريف Lead و FOP الحالي\*\*  

Lead الحالي في `useClientStore.getLeads` هو Client بلا عقود وبلا زيارات:

\- لا توجد عقود له.

\- لا توجد زيارات له.



FOP موجود كمفهوم في صفحات أخرى مثل `Clients.tsx`:

\- `OP`: لديه عقد.

\- `FOP`: لديه زيارة ولا يملك عقداً.

\- `Lead`: لا عقد ولا زيارة.



لكن PlanOverview حالياً لا يدخل FOP في `getMarketingLoad`. هو يستخدم فقط:

\- Candidates بحالة `FollowUp`.

\- Leads من `getLeads`.



لذلك إضافة FOP الآن ستكون توسيعاً للسلوك الحالي، وليست مجرد تصحيح فلترة. الأفضل ألا ندخله في نفس خطوة التصحيح إلا إذا قرر المنتج صراحة أن FOP يجب أن يظهر في حمل PlanOverview الآن.



\*\*D) إسناد الأهداف للمشرفة\*\*  

يوجد جدولان مهمان من migration \[042\_assignments\_m2m.sql](<D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/042\_assignments\_m2m.sql>):



\- `client\_assignments`

\- `candidate\_assignments`



الحقول:

\- `id`

\- `client\_id` أو `candidate\_id`

\- `hr\_user\_id`

\- `assigned\_at`

\- `assigned\_by`

\- unique على `(client\_id, hr\_user\_id)` أو `(candidate\_id, hr\_user\_id)`



لا يوجد `status` أو `active flag` للإسناد؛ الإسناد الحالي يعتبر فعالاً ما دام الصف موجوداً.



الإسناد متعدد، وليس واحداً فقط، لأن الجداول تسمح بأكثر من `hr\_user\_id` لنفس العميل/المرشح.



الهدف يجب قبوله إذا كان مسنداً إلى `hr\_user\_id` المطابق لحساب المشرفة الموجودة في الفريق. أي:

```text

داخل نطاق العمل

AND

EXISTS assignment where assignment.hr\_user\_id = supervisorHrUserId

```



\*\*E) ربط مشرفة الفريق بـ hr\_user\*\*  

في `day\_schedules`، `team.supervisor` هو `employees.id`.



الربط الصحيح مع المستخدم هو:

```text

hr\_users.employee\_id = employees.id

```



لكن `api.employees.list()` المستخدم في PlanOverview يرجع بيانات الموظف الأساسية ولا يحتوي `hr\_user\_id` أو `systemUserId`. تفاصيل الموظف قد تحتوي `systemAccount`، لكن PlanOverview لا يجلب تفاصيل كل مشرفة.



لذلك الاعتماد على frontend lookup غير كافٍ حالياً. الطريق الأكثر أماناً هو backend، لأن backend يستطيع:

\- معرفة `teamKey`.

\- قراءة `day\_schedules`.

\- استخراج `supervisor employee\_id`.

\- ربطه بـ `hr\_users.id`.

\- تطبيق فلتر assignments مباشرة.



\*\*F) أين يجب تنفيذ الفلترة؟\*\*  

الخيار 1: داخل PlanOverview frontend  

المزايا: أسرع وأقل ملفات.  

المخاطر: لا يوجد `hr\_user\_id` للمشرفة حالياً، ويمكن الالتفاف على المنطق عند توليد التيلماركتنغ. كما أن البيانات المعروضة قد تختلف عن API.  

هل يمنع ظهور أهداف غير مسموحة؟ جزئياً فقط.  

هل يمنع توليد قائمة خاطئة؟ لا بشكل مضمون.  

يناسب المرحلة الحالية؟ فقط كحل مؤقت، لا كحل صحيح.



الخيار 2: API/backend service يرجع marketing targets الصحيحة  

المزايا: مصدر واحد للحقيقة، يربط supervisor employee بـ hr\_user، يطبق نطاق العمل والإسناد في مكان واحد، ويمكن لاحقاً استخدامه للتيلماركتنغ وMarketing Visit.  

المخاطر: يحتاج endpoint/service جديد أو توسيع منظم، لكنه ليس migration.  

هل يمنع ظهور أهداف غير مسموحة؟ نعم.  

هل يمنع توليد قائمة خاطئة؟ نعم إذا استخدمته PlanOverview والتوليد لاحقاً.  

يناسب المرحلة الحالية؟ نعم، هو الأفضل مع أقل مخاطرة مستقبلية.



الخيار 3: تعديل توليد التيلماركتنغ لاحقاً فقط  

المزايا: يؤجل العمل.  

المخاطر: PlanOverview سيظل يعرض أهدافاً غير مسموحة، ومدير الفرع قد يرى أرقاماً وقوائم مضللة.  

هل يمنع ظهور أهداف غير مسموحة؟ لا.  

هل يمنع توليد قائمة خاطئة؟ فقط لاحقاً، وليس الآن.  

يناسب المرحلة الحالية؟ لا، لأنه يترك المشكلة في نقطة القرار الأساسية.



\*\*G) حالة الفريق solo\*\*  

الـ solo يظهر في PlanOverview كـ `solo\_0`, `solo\_1` وله `supervisor: null`.



حالياً إذا كان للـ solo route assignment، فإن `getMarketingLoad` يحسب له حمل تسويقي مثل أي فريق، لأنه لا يعرف نوع الفريق ولا المشرفة.



حسب القاعدة المعتمدة، يجب أن يصبح marketing load للـ solo = 0 لأن لا توجد مشرفة نطابق الإسناد عليها.



هذا لا يعني أن solo لا يمكن أن تكون له مهام أخرى لاحقاً، مثل صيانة أو طوارئ، لكن الحمل التسويقي Lead/FOP/Candidate يجب ألا يظهر له في هذه المرحلة.



\*\*H) علاقة حساب الحمل بالتيلماركتنغ\*\*  

نعم، توليد `telemarketing\_task\_list` يعتمد حالياً على نفس targets التي تظهر في PlanOverview. `handleGenerateList` يأخذ `candList` و `leadList` المعروضة في modal، يحولها إلى items، ثم يستدعي `generateTaskList`.



Backend في \[telemarketing.ts](<D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/telemarketing.ts>) يحفظ العناصر القادمة كما هي تقريباً. لا يتحقق أن:

\- الهدف داخل نطاق العمل.

\- الهدف مسند للمشرفة.

\- الفريق يحتوي مشرفة.

\- الـ teamKey صالح لذلك اليوم.



لذلك حالياً يمكن توليد قائمة لأهداف غير مسندة للمشرفة إذا ظهرت في PlanOverview.



يمكن تأجيل validation التيلماركتنغ للمرحلة الثالثة، لكن بشرط أن المرحلة الثانية تجعل PlanOverview نفسه يستخدم backend targets صحيحة. أما الاكتفاء بالواجهة فقط فسيبقي ثغرة التوليد قائمة.



\*\*I) التوصية\*\*  

أقل تعديل صحيح للمرحلة الثانية هو نقل حساب targets التسويقية إلى backend service/API، ثم جعل PlanOverview يعرض النتائج القادمة منه بدلاً من حسابها محلياً بالمنطقة فقط.



التوصية العملية:

\- الحل يجب أن يكون في backend، مع استخدام PlanOverview له.

\- لا نحتاج migration الآن.

\- نعم، نحتاج API جديد أو endpoint واضح مثل marketing targets حسب `date + teamKey`.

\- لا أنصح بإدخال FOP الآن إلا بقرار منتجي صريح، لأن PlanOverview حالياً لا يحسبه.

\- نعم، يجب أن يكون marketing load للـ solo = 0.

\- الملفات المتوقع تأثرها لاحقاً: `PlanOverview.tsx`, route/API جديد أو `routeAssignments/marketingTargets`, وربما `api.ts` في الواجهة. التيلماركتنغ يبقى للمرحلة التالية.



خطة تنفيذ لاحقة من 4 خطوات:

1\. إنشاء backend service يحسب `zoneIds` من `route\_assignments` حسب `date/teamKey`.

2\. في نفس الخدمة، استخراج supervisor من `day\_schedules.teams\[index]` وربطه بـ `hr\_users.employee\_id`.

3\. إرجاع Candidates/Leads فقط إذا كانت داخل النطاق ومسندة إلى `supervisorHrUserId`، وإرجاع صفر للـ solo.

4\. تعديل PlanOverview ليستخدم هذا endpoint بدلاً من `getMarketingLoad` المحلي، مع ترك توليد التيلماركتنغ كما هو للمرحلة الثالثة أو ربطه بنفس المصدر لاحقاً.

