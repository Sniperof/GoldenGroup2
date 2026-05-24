# دستور الدومين — نظام المهام الموحد

> الحالة: معتمد كمرجع دستوري
> اللغة: عربية موحدة
> النطاق: Task System Unified Template / Task Lifecycle / Task Creation / Task Types Foundation
> آخر تحديث: 2026-05-22

---

## 1. البنية العامة — القالب الموحد

### 1.1 هيكل صفحة التفاصيل (TaskDetailLayout)

```
┌─────────────────────────────────────────────────────┐
│  HEADER: اسم الزبون · نوع المهمة · حالتها · زر رجوع │
├─────────────────────────────────────────────────────┤
│  TAB BAR: [نظرة عامة][بيانات الزبون][العقد والجهاز] │
│           [التواصل والمتابعة][...تابات إضافية...][النتيجة] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  محتوى التاب النشط                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 التابات الأساسية — ثابتة لجميع المهام

| التاب | المحتوى الثابت | قابل للتخصيص |
|-------|---------------|--------------|
| **نظرة عامة** | ملخص المهمة (حالة، أولوية، سبب) + الجدولة + بيانات الإنشاء + إحصائيات سريعة | `overviewExtraCards` + `scheduleExtraRows` |
| **بيانات الزبون** | لقطة الزبون (اسم، هاتف، عنوان كامل، أرقام تواصل) | ❌ |
| **العقد والجهاز** | لقطة العقد (رقم العقد، الجهاز، عنوان التركيب، المالية) | ❌ |
| **التواصل والمتابعة** | اتصالات التيلماركتر + سجل الأحداث + نموذج إضافة ملاحظة | ❌ |
| **النتيجة** | ملخص النتيجة (outcome، حالة، تاريخ إتمام، ملاحظات) | `ResultRenderer` |

### 1.3 البيانات المحملة — ثابتة لجميع المهام

| الحقل | الوصف |
|-------|-------|
| `task` | بيانات المهمة + snapshots (clientSnapshot, contractSnapshot, teamSnapshot) |
| `activity[]` | سجل الأحداث (task_activity_log) |
| `calls[]` | اتصالات التيلماركتر |
| `devices[]` | أجهزة مرتبطة (open_task_devices) |
| `preOffers[]` | عروض مسبقة (open_task_pre_offers) — يستخدمها device_demo فقط |

### 1.4 الحالات — 11 حالة مشتركة لجميع المهام

```
open → needs_follow_up → assigned → in_scheduling → scheduled
→ waiting_execution → in_execution → ended
→ completed / closed / cancelled
```

---

## 2. نقاط التخصيص — ما يختلف بين أنواع المهام

كل نوع مهمة يحتاج لتعريف 4 عناصر فقط ضمن `TaskTypeExtension`:

```typescript
const xyzExtension: TaskTypeExtension = {
  // 1. بطاقات إضافية في نظرة عامة (اختياري)
  overviewExtraCards: (data) => <XyzOverviewCards data={data} />,

  // 2. تابات إضافية بين "التواصل" و"النتيجة" (اختياري)
  extraTabs: [
    { id: 'xyz_info', label: 'معلومات XYZ', render: (data) => <XyzInfoTab data={data} /> }
  ],

  // 3. عارض النتيجة الخاص بالنوع (اختياري)
  ResultRenderer: XyzResultRenderer,

  // 4. أزرار في شريط التابات بعد تسجيل النتيجة (اختياري)
  tabBarActions: (data) => <XyzActions data={data} />,
};
```

### 2.1 مقارنة الأنواع المنفذة

| العنصر | device_demo | emergency_maintenance | device_delivery |
|--------|-------------|----------------------|-----------------|
| **تاب إضافي** | "تفاصيل العرض" (preOffers) | "تفاصيل الطوارئ" | "معلومات التركيب" |
| **scheduleExtraRows** | موعد الزيارة + وقتها | — | تاريخ الزيارة + وقتها + نوع المهمة |
| **ResultRenderer** | جدول العروض + ردود الزبون | بطاقة قرار الطوارئ | نجاح/فشل التسليم |
| **tabBarActions** | — | وصل الصيانة | — |
| **overviewIssuesFor** | مشاكل حسب نوع المهمة | — | سيريال رقم مفقود |
| **hasResultFor** | `outcome != null` | `em_costs_id != null` | `result != null` |

---

## 3. إنشاء المهمة

### 3.1 البيانات الإلزامية

| الحقل | إلزامي | ملاحظات |
|-------|--------|---------|
| `client_id` | ✅ دائماً | لأي مهمة |
| `branch_id` | ✅ دائماً | يُؤخذ تلقائياً من المستخدم |
| `task_type` | ✅ دائماً | من قائمة الـ 20 نوع |
| `task_family` | ✅ دائماً | يُحدد من `task_type_config` |
| `reason` | ✅ دائماً | من `system_lists` |
| `contract_id` | حسب النوع | إذا `contract_required = TRUE` في `task_type_config` |
| `due_date` | حسب النوع | إذا `has_due_date = TRUE` في `task_type_config` |
| `priority` | اختياري | high / medium / low |
| `notes` | اختياري | — |
| `devices[]` | اختياري | أجهزة مرتبطة |
| `preOffers[]` | اختياري | عروض مسبقة |

### 3.2 مصادر الإنشاء

| المصدر | `source` في DB | من يضيف | الصفحة |
|--------|---------------|---------|--------|
| يدوي | `manual` | موظف صلاحية `marketing_visits.update_result` | POST /open-tasks |
| التيلماركتر | `telemarketing` | موظف تيلماركتر خلال جلسة | TelemarketerWorkspace |
| طلب طوارئ | `emergency_ticket` | أي موظف يقدم طلب | نموذج الطوارئ |
| النظام تلقائياً | `system` | بعد تسجيل نتيجة معينة | — |
| إنشاء عقد | `system` | بعد حفظ عقد جديد | ContractForm |

### 3.3 قاعدة المهمة الواحدة

يتحكم `task_type_config.allow_multiple`:

- `FALSE` (الأغلبية): مهمة واحدة نشطة فقط لكل زبون من نفس النوع في مرحلة "قيد الانتظار"
- `TRUE`: يمكن عدة مهام متوازية (طوارئ، دورية، تحصيل، هدايا، تشييك)

---

## 4. تصنيف الـ 20 نوع مهمة

### 4.1 marketing

| النوع | التسمية | `allow_multi` | ملاحظات |
|-------|---------|---------------|---------|
| `device_demo` | عرض جهاز | FALSE | لا يحتاج عقد |
| `device_checkup` | تشييك على الجهاز | TRUE | يحتاج عقد |

### 4.2 delivery

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `device_delivery` | تسليم الجهاز | يحتاج عقد + due_date |
| `device_installation` | تركيب الجهاز | يحتاج عقد + due_date |
| `device_activation` | تشغيل الجهاز | يحتاج عقد + due_date |
| `gift_delivery` | تسليم هدية | allow_multi=TRUE |
| `device_return` | إعادة بعد صيانة | يحتاج عقد + due_date |

### 4.3 emergency

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `emergency_maintenance` | صيانة طارئة | allow_multi=TRUE |

### 4.4 maintenance

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `periodic_maintenance` | صيانة دورية | allow_multi=TRUE + due_date |

### 4.5 collection

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `installment_collection` | تحصيل قسط | allow_multi=TRUE + due_date |
| `maintenance_collection` | تحصيل ذمة | allow_multi=TRUE + due_date |

### 4.6 service

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `parts_sale` | شراء قطعة | يحتاج عقد |
| `device_retrieval` | سحب الجهاز | يحتاج عقد |
| `device_repair` | فحص وإصلاح | يحتاج عقد |
| `device_disconnection` | توقيف مؤقت | يحتاج عقد |
| `device_transfer` | نقل لعنوان جديد | يحتاج عقد |

### 4.7 warranty

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `golden_warranty` | منح كفالة ذهبية | يحتاج عقد |
| `warranty_cancellation` | إلغاء الكفالة | يحتاج عقد |
| `warranty_reactivation` | إعادة تفعيل كفالة | يحتاج عقد |

### 4.8 sales

| النوع | التسمية | ملاحظات |
|-------|---------|---------|
| `device_purchase` | توقيع عقد | يحتاج عقد |

---

## 5. كيف تضيف نوع مهمة جديد؟

### 5.1 Frontend — ملف واحد

1. أنشئ: `packages/web/src/pages/tasks/XyzTaskDetail.tsx`
   - استورد `TaskDetailLayout`
   - عرّف `xyzExtension` (extraTabs, ResultRenderer, ...)
   - أضف `scheduleExtraRows` لو في بيانات جدولة خاصة
   - أضف `overviewIssuesFor` لو في تحققات خاصة

2. أضف Route في `App.tsx`:
   ```tsx
   <Route path="/tasks/xyz/:id" element={<XyzTaskDetail />} />
   ```

3. أضف رابط في قائمة نوع المهمة حيث تعرض الـ task card

### 5.2 Backend — لو المهمة تحتاج نتيجة خاصة

4. أضف endpoint في `openTasks.ts`:
   ```
   GET /:id/xyz-result    → إرجاع نتيجة محفوظة
   POST /:id/xyz-result   → حفظ نتيجة جديدة
   ```
   (استخدم نموذج `emergency-result` كمرجع)

5. أضف migration لجدول النتيجة لو احتجت:
   ```sql
   CREATE TABLE xyz_task_results (...)
   ```

### 5.3 ما لازم تتغيّر أبداً

- `TaskDetailLayout.tsx` — يعمل تلقائياً مع أي نوع جديد
- جميع التابات الأساسية — محملة تلقائياً
- دورة الحياة (11 حالة) — مشتركة لجميع الأنواع
- `task_type_config` — السجل موجود للـ 20 نوع
- `open_tasks` DB table — تقبل أي task_type

---

## 6. الخلاصة

الإضافة الجديدة تحتاج **ملف واحد في الـ Frontend** + **endpoint للنتيجة** لو في نتيجة خاصة. كل شيء آخر (التحميل، التابات الأساسية، سجل الأحداث، الجدولة، لقطة الزبون والعقد) يعمل تلقائياً من القالب.
