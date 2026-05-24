# البرومت — مهمة تركيب الجهاز (device_installation)

> **النمط:** نفس نمط `device_delivery` بالضبط — migration + backend endpoints + frontend components
> **النطاق:** staging فقط
> **ملاحظة UI:** كل شيء بالعربية أمام الموظف

---

## ١. تعريف المهمة

**نوع المهمة:** تركيب الجهاز
**العائلة:** توصيل وتركيب
**إلزامية العقد:** نعم
**تاريخ الاستحقاق:** نعم (`has_due_date = TRUE`) — `short_window` ٣ أيام
**التسلسل:** تُنشأ تلقائياً بعد نجاح تسليم الجهاز

---

## ٢. إنشاء المهمة

### ٢.١ مصادر الإنشاء

| المصدر | متى |
|--------|-----|
| **تلقائي** | عند تسجيل نتيجة تسليم ناجحة (`delivered_successfully`) |
| **يدوي** | من صفحة الزبون → العقود → تبويب "تتبع الجهاز" |

### ٢.٢ شروط ظهور زر الإنشاء اليدوي

- العقد نشط
- حالة الجهاز: "تم التسليم" (`delivered`)
- لا توجد مهمة تركيب مفتوحة لنفس العقد

### ٢.٣ حقول الإنشاء (اليدوي)

| الحقل | إلزامي | الوصف |
|-------|--------|-------|
| العقد | نعم | قائمة العقود يلي `device_status = 'delivered'` |
| اسم الزبون | نعم | تلقائي من العقد |
| نوع الجهاز | نعم | تلقائي من العقد |
| عنوان التركيب | نعم | من العقد — قابل للتعديل |
| تاريخ الاستحقاق | نعم | افتراضي = `NOW() + 3 أيام` |
| التاريخ المتوقع | لا | إذا حدده الزبون |
| السبب | نعم | من "إدارة القوائم" — نوع "أسباب المهام" |
| الأولوية | لا | عالية / متوسطة / منخفضة |
| ملاحظات | لا | نص حر |

---

## ٣. تتبع الجهاز (ClientProfile → العقود)

### عند "تم التسليم"

```
[تسليم الجهاز] ← مكتملة ✓
[تركيب الجهاز] ← نشطة الآن
[تشغيل الجهاز] ← مخفية
زر: "إضافة مهمة تركيب"
```

---

## ٤. نتيجة المهمة (Task Result)

### ٤.١ الحقول يسجلها الفني

| # | الحقل | إلزامي | الوصف |
|---|-------|--------|-------|
| ١ | **النتيجة** (`outcome`) | نعم | تم التركيب / تركيب غير مكتمل / الموقع غير جاهز |
| ٢ | **مصدر المياه** | نعم (إن نجح) | بئر / شبكة عامة / خزان / سطحي... |
| ٣ | **نوع التمديدات** | نعم (إن نجح) | بلاستيك / معدنية |
| ٤ | **طول التمديد (متر)** | لا | — |
| ٥ | **توصيل كهرباء** | لا | نعم / لا |
| ٦ | **تثبيت بالحائط** | لا | نعم / لا |
| ٧ | **الملحقات المتركبة** | لا | قائمة checkbox: فلاتر / قاعدة / صنبور / أنابيب... |
| ٨ | **تاريخ بدء التركيب** | لا | — |
| ٩ | **تاريخ إنهاء التركيب** | لا | — |
| ١٠ | **صور قبل التركيب** | لا | مصفوفة URLs |
| ١١ | **صور بعد التركيب** | لا | مصفوفة URLs |
| ١٢ | **ملاحظات فنية** | لا | — |
| ١٣ | **مين ركّب؟** | لا | الفني المسجل بالزيارة |

### ٤.٢ نتائج ممكنة

| النتيجة | حالة المهمة | حالة الجهاز | اللي بيصير بعدها |
|---------|------------|-------------|------------------|
| تم التركيب بنجاح | مكتملة | مركّب | ينشئ تلقائياً مهمة تشغيل |
| تركيب غير مكتمل | مكتملة | مُسلَّم | ينشئ مهمة تركيب جديدة (متابعة) |
| الموقع غير جاهز | مكتملة | مُسلَّم | ينشئ مهمة تركيب جديدة (إعادة زيارة) |

---

## ٥. صفحة تفاصيل المهمة

**المسار:** `/مهام/تركيب/[رقم]` ← أو نفس `/tasks/delivery/:id` يلي بيتحول حسب `taskType`

**التبويبات:**

١. **نظرة عامة** ← جاهزة
٢. **بيانات الزبون** ← جاهزة
٣. **العقد والجهاز** ← جاهزة
٤. **التواصل والمتابعة** ← جاهزة
٥. **معلومات التركيب** ← تبويب إضافي — يظهر بيانات التركيب
٦. **النتيجة** ← يظهر نموذج التركيب

---

## ٦. الملفات المطلوبة

### إنشاء جديد:

| # | الملف | الوصف |
|---|-------|-------|
| ١ | `migrations/145_device_installation_results.sql` | جدول `open_task_installation_results` + صلاحيات |
| ٢ | `packages/web/src/taskTypes/device_delivery/InstallationInfoTab.tsx` | تبويب بيانات التركيب |
| ٣ | `packages/web/src/taskTypes/device_delivery/InstallationResultForm.tsx` | نموذج نتيجة التركيب |
| ٤ | `packages/web/src/taskTypes/device_delivery/InstallationResultRenderer.tsx` | عارض النتيجة |

### تعديل:

| # | الملف | الوصف |
|---|-------|-------|
| ٥ | `packages/api/routes/openTasks.ts` | إضافة `GET/POST /:id/installation-result` |
| ٦ | `packages/web/src/pages/tasks/DeliveryTaskDetail.tsx` | تفعيل `InstallationResultRenderer` حسب `taskType` |
| ٧ | `packages/web/src/lib/api.ts` | `getInstallationResult` + `saveInstallationResult` |
| ٨ | `packages/shared/types.ts` | `InstallationResultOutcome` + `VisitTaskInstallationResult` |

---

## ٧. قاعدة البيانات (Migration 145)

```sql
CREATE TABLE IF NOT EXISTS open_task_installation_results (
  id                       BIGSERIAL   PRIMARY KEY,
  open_task_id             INTEGER     NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_open_task_installation_result UNIQUE (open_task_id),

  outcome                  VARCHAR(50) NOT NULL CHECK (outcome IN (
    'installed_successfully', 'installation_incomplete', 'site_not_ready'
  )),

  -- بيانات التركيب
  water_source_type        VARCHAR(50),  -- مصدر المياه
  pipe_type                VARCHAR(50),  -- نوع التمديد
  pipe_length_meters       NUMERIC,      -- طول التمديد بالمتر
  electrical_connection    BOOLEAN DEFAULT FALSE,
  wall_mounting_done       BOOLEAN DEFAULT FALSE,
  installed_accessories    JSONB DEFAULT '[]', -- قائمة الملحقات المتركبة

  -- التواريخ
  installation_start_date  DATE,
  installation_end_date    DATE,

  -- الصور والملاحظات
  before_photos            JSONB DEFAULT '[]',
  after_photos             JSONB DEFAULT '[]',
  technical_notes          TEXT,

  installed_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- صلاحيات
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('tasks.installation.view',   'tasks', 'installation', 'view',   'عرض مهام التركيب',        305),
  ('tasks.installation.result', 'tasks', 'installation', 'result', 'تسجيل نتيجة تركيب',        306)
ON CONFLICT (key) DO NOTHING;
```

---

## ٨. Backend API

### `GET /open-tasks/:id/installation-result`
- صلاحية: `tasks.installation.view`
- بيرجع: النتيجة المحفوظة + اسم الفني

### `POST /open-tasks/:id/installation-result`
- صلاحية: `tasks.installation.result`
- بيسجل النتيجة وبينفذ:
  - تحديث المهمة إلى "مكتملة"
  - `installed_successfully` → `contract.device_status = 'installed'` + ينشئ `device_activation`
  - `installation_incomplete` / `site_not_ready` → ينشئ `device_installation` جديدة

---

## ٩. Frontend — InstallationResultForm

### النتيجة الأولى: اختيار النتيجة

```
[◉] تم التركيب بنجاح
[○] تركيب غير مكتمل  
[○] الموقع غير جاهز
```

### عند اختيار "تم التركيب بنجاح": تظهر الحقول التالية

| الحقل | النوع |
|-------|-------|
| مصدر المياه | قائمة منسدلة |
| نوع التمديدات | قائمة منسدلة |
| طول التمديد (متر) | رقم |
| توصيل كهرباء | نعم/لا |
| تثبيت بالحائط | نعم/لا |
| الملحقات المتركبة | checkbox list |
| صور قبل التركيب | رفع ملفات |
| صور بعد التركيب | رفع ملفات |
| ملاحظات فنية | نص حر |

### عند اختيار فشل: تظهر فقط
- سبب الفشل (نص)
- ملاحظات

---

## ١٠. التحقق والبناء

```bash
pnpm tsc --noEmit --skipLibCheck  → ٠ أخطاء
pnpm build                          → success
pm2 restart golden-crm-staging      ← يعمل
```

---

## ملاحظة مهمة

لا تغيّر `TaskDetailLayout.tsx` — استخدم نفس الـ extension pattern يلي استخدمناه بـ `device_delivery`.
