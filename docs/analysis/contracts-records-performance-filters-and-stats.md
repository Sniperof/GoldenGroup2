# العقود — تحليل الأداء والفلاتر والإحصائيات

**الحالة:** تحليل مرجعي + بدء تنفيذ (نفس ترتيب الزبائن: المسار المصفَّح أولاً).
**التاريخ:** 2026-07-29
**النطاق:** صفحة `packages/web/src/pages/contracts/ContractList.tsx` ومسارها `GET /api/contracts` في `packages/api/routes/contracts.ts`.
**مرجع مماثل:** [clients-records-performance-and-filters.md](clients-records-performance-and-filters.md) — نعيد استخدام نمطه حرفياً.

---

## 1. تشخيص الأداء (نفس عيوب الزبائن، أخفّ حدّةً)

`GET /api/contracts` ([contracts.ts:543](../../packages/api/routes/contracts.ts:543)): `... ${where} ORDER BY c.id DESC` — **بلا `LIMIT`/تصفّح**، يُعيد كل العقود ضمن النطاق. والـSELECT فيه **6 استعلامات فرعية قياسية لكل صف** (موظف التسكير، سبب عدم التسكير، اسم الفرع، فرع الخدمة، المنشئ، مالك البيع). والواجهة `ContractList` تُحمّل الكل وتُنفّذ البحث/الفرز/الفلترة/التصفّح في المتصفح عبر `SmartTable`. ادعاء Swagger «مع Pagination» غير منفَّذ (drift).

**لماذا أخفّ من الزبائن:** العقود مجموعة جزئية من الزبائن (ليس كل زبون يشتري) فالحجم أقل؛ والاستعلامات الفرعية هنا بحث اسم بالمفتاح الأساسي (رخيص) لا `EXISTS` عبر جداول متعددة كما في الزبائن. لكن الحالة الأسوأ (GLOBAL على «كل الفروع») تُحمّل كامل جدول العقود، والنمو غير محدود — فالتصفّح مفيد ورخيص (إعادة استخدام نمط `/clients/paged` + وضع SmartTable الخادمي).

---

## 2. قرار النطاق (محسوم)

**العقود فرعية فقط — لا معنى لـ ASSIGNED.** من لا يملك `contracts.view_list` على مستوى BRANCH/GLOBAL لا يرى العقود ولا إحصائياتها إطلاقاً (لا مجموعة فرعية شخصية). لذلك:

`appendContractScope` = تصفية بالفرع فقط (`c.branch_id = ANY(...)`)، أبسط من `appendClientScope` (بلا طبقة إسناد). أنماط النطاق = GLOBAL / BRANCH فقط (NONE = لا وصول). كل widgets العقود بصلاحية `contracts.view_list`.

المسار المصفَّح يحاكي نطاق `GET /` الحالي حرفياً (super-admin: ترويسة الفرع اختيارية؛ غيره: `c.branch_id = actingBranchId`) حفاظاً على السلوك القائم.

---

## 3. الفلاتر — الحالي مقابل المقترح

الحالي: الحالة + نوع الدفع + بحث (رقم العقد/الزبون/الجهاز/السيريال) — كله في المتصفح.

الكتالوج المقترح (مبني على أعمدة العقد الفعلية):

| الفلتر | العمود | النوع |
|--------|--------|------|
| الحالة | `status` | متعدّدة (مسودة/فعال/مكتمل/ملغي) — موجود |
| نوع البيع | `sale_type` | ثابتة |
| النوع الفرعي | `sale_subtype` | ثابتة |
| نوع الدفع | `payment_type` | ثابتة — موجود |
| مالك البيع | `sale_owner_id` | ديناميكية (موظفون) |
| موظف التسكير | `closing_employee_id` | ديناميكية |
| المنشئ | `created_by` | ديناميكية |
| الفرع / فرع الخدمة | `branch_id` / `service_branch_id` | مبدّل/ديناميكية |
| فترة التعاقد | `contract_date` | مدى تاريخي |
| موديل الجهاز | `device_model_id` | ديناميكية |
| مدى المبلغ | `final_price` | مدى رقمي |
| سبب الإلغاء | `cancellation_reason` | قائمة مُدارة `contract_cancellation_reasons` |

نمط الواجهة: نفس لوحة الفلاتر الموحّدة + الرقائق (FilterField/ActiveFilterChip) المعتمدة في الزبائن.

**تصحيح معماري (2026-07-30):** فلترا «لديه جهاز مركّب» و«ضمان ذهبي فعّال» سِمتا جهاز لا عقد، فنُقلا خارج العقود: «لديه جهاز مركّب» يتقاعد (قائمة الأجهزة نفسها هي القاعدة المركّبة، وفلتر حالتها يميّز active/installed…)، و«الضمان الذهبي» صار فلتراً في قائمة الأجهزة المركّبة (`isGoldenWarranty`).

---

## 4. الإحصائيات — دومين جديد (§2.هـ)

لا يوجد أي widget للعقود اليوم. المقنّن في دستور reporting-analytics §2.هـ، بنفس نموذج metric/breakdown ومعزول بالنطاق عبر `appendContractScope`:

**KPIs (قياسية):**

| المؤشر | الصيغة | ملاحظة |
|--------|--------|--------|
| `contracts.count` | `COUNT(*)` ضمن الفترة | يستبعد `status='draft'` |
| `contracts.sales_value` | `Σ final_price` | العقود المعتمدة فقط (لا مسودة) |
| `contracts.avg_value` | `AVG(final_price)` | المعتمدة فقط |
| `contracts.cancellation_rate` | `COUNT(cancelled)/COUNT(*)` % | خلال الفترة |
| `contracts.stuck_drafts` | `COUNT(status='draft')` لحظي | مؤشّر منفصل |

**تجميعات:**

| المؤشر | الصيغة | الرسم |
|--------|--------|------|
| `contracts.sales_by_branch` | `Σ final_price GROUP BY branch_id` | Bar |
| `contracts.sales_by_seller` | `Σ final_price GROUP BY sale_owner_id` | Bar (Leaderboard) |
| `contracts.sales_by_sale_type` | `COUNT GROUP BY sale_type` | Donut |
| `contracts.sales_trend` | `Σ final_price` حسب bucket زمني | Timeline |
| `contracts.by_payment_type` | `COUNT GROUP BY payment_type` | Donut |
| `contracts.by_device_model` | `COUNT GROUP BY device_model_id` | Bar |
| `contracts.cancelled_by_reason` | `COUNT GROUP BY cancellation_reason` | Bar (نصّ حرّ — قيد) |

---

## 5. القرارات والقيود

استبعاد المسوّدات (DEC-CT-01): العقد المسودة بلا أثر تشغيلي، فقيمة المبيعات وعددها **تستبعد `status='draft'`** (المبيعات = المعتمدة فقط)؛ و«عقود مسوّدة عالقة» مؤشّر منفصل يعدّها.

سبب الإلغاء نصّ حرّ (`cancellation_reason`) → «الملغاة حسب السبب» عليه قيد جودة بيانات (كالمهن §3.10) — يُفضَّل لاحقاً تحويله لقائمة أسباب.

`appendContractScope` جديد في `reportingScope.ts` (فرع فقط) — لبنة مشتركة لكل widgets العقود.

---

## 6. خطة التنفيذ (نفس ترتيب الزبائن)

| المرحلة | العمل |
|---------|-------|
| 1. الخادم | `GET /contracts/paged` (يُسجَّل قبل `/:id`): page/limit/search/status/paymentType/sort + total. يحاكي نطاق `GET /` الحالي. لبنة نطاق مشتركة تمنع الـdrift |
| 2. api الواجهة | `api.contracts.listPaged()` بجوار `list` (دون لمسها) + نوع `PagedContracts` |
| 3. الصفحة | ربط `ContractList` بـ`listPaged` (بحث debounce + فلاتر/فرز/تصفّح خادمي) + إصلاح وميض التحميل |
| 4. SmartTable | يعمل بوضعه الخادمي الجاهز (لا تغيير) |
| 5. الفلاتر الغنية | لوحة موحّدة + الفلاتر الجديدة (نوع البيع/البائع/التسكير/الفترة/الموديل/المبلغ…) |
| 6. الإحصائيات | `appendContractScope` + KPIs + تجميعات §2.هـ في الكتالوجين + السجلّ |

الأولوية للعقود: الفلاتر والإحصائيات (القفزة الفعلية)؛ التصفّح تحصين رخيص للحالة الأسوأ والنمو.
