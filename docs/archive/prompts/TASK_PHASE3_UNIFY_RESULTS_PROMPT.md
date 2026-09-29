# المرحلة ٣: توحيد نتائج المهام ضمن `visit_task_results`

> **الهدف:** كل نتيجة مهمة — سواء تلي ماركتينج أو صيانة أو تسليم أو تركيب — تُحفظ بنفس النمط:
> ```
> visit_task → visit_task_result (parent) → visit_task_{type}_results (child)
> ```
>
> **السياق:** حالياً نتائج post-sale (تسليم، تركيب) بتحفظ بـ `open_task_*_results` منفصلة عن الزيارة. هاد بيعيق التعميم. لازم نجمعن تحت `visit_task_results`.

---

## ٠) المبدأ الموحّد

كل نوع مهمة بيملك:

| الطبقة | الجدول | الغرض |
|--------|--------|-------|
| **Parent** | `visit_task_results` | النتيجة العامة (`final_decision`, `reason_code`, `closing_notes`) |
| **Child** | `visit_task_XXX_results` | تفاصيل النوع (سيريال، عرض، فحص فني...) |

مثال موجود:
- `device_demo` → `visit_task_results` + `visit_task_device_demo_results`
- `emergency_maintenance` → `visit_task_results` + `visit_task_emergency_technical_states` + `visit_task_emergency_parts_used` + `visit_task_emergency_financials`

---

## ١) Migration: إنشاء جداول نتائج Post-Sale

### ١.١ `visit_task_device_delivery_results`

```sql
CREATE TABLE IF NOT EXISTS visit_task_device_delivery_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtddr_result UNIQUE (visit_task_result_id),

  outcome               VARCHAR(50) NOT NULL
                          CHECK (outcome IN (
                            'delivered_successfully',
                            'customer_not_available',
                            'wrong_address',
                            'refused_delivery'
                          )),
  serial_number         VARCHAR(100),
  device_model_id       INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  delivery_condition    VARCHAR(50)
                          CHECK (delivery_condition IN ('perfect', 'minor_damage', 'missing_accessories')),
  delivery_address      TEXT,
  delivery_lat          NUMERIC(10,7),
  delivery_lng          NUMERIC(10,7),
  actual_delivery_date  DATE,
  delivered_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  customer_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_photos       JSONB NOT NULL DEFAULT '[]',
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### ١.٢ `visit_task_device_installation_results`

```sql
CREATE TABLE IF NOT EXISTS visit_task_device_installation_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtdir_result UNIQUE (visit_task_result_id),

  outcome               VARCHAR(50) NOT NULL
                          CHECK (outcome IN (
                            'installed_successfully',
                            'installation_incomplete',
                            'site_not_ready'
                          )),

  water_source_type     VARCHAR(50),
  pipe_type             VARCHAR(50),
  pipe_length_meters    NUMERIC(8,2),
  electrical_connection BOOLEAN NOT NULL DEFAULT FALSE,
  wall_mounting_done    BOOLEAN NOT NULL DEFAULT FALSE,
  installed_accessories JSONB NOT NULL DEFAULT '[]',
  installation_start_date DATE,
  installation_end_date   DATE,
  before_photos         JSONB NOT NULL DEFAULT '[]',
  after_photos          JSONB NOT NULL DEFAULT '[]',
  technical_notes       TEXT,
  installed_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### ١.٣ `visit_task_device_activation_results`

```sql
CREATE TABLE IF NOT EXISTS visit_task_device_activation_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uvtdar_result UNIQUE (visit_task_result_id),

  outcome               VARCHAR(50) NOT NULL
                          CHECK (outcome IN ('activated_successfully', 'activation_failed', 'device_issue')),

  tds_before            NUMERIC,
  tds_after             NUMERIC,
  pump_pressure         NUMERIC,
  membrane_output       VARCHAR(50),
  tank_pressure         NUMERIC,
  uv_status             VARCHAR(50),
  customer_trained      BOOLEAN NOT NULL DEFAULT FALSE,
  training_notes        TEXT,
  activation_photos     JSONB NOT NULL DEFAULT '[]',
  activated_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## ٢) Backend: Endpoint نتيجة موحّد

### ٢.١ الـ Pattern

بدل ما يكون عندك endpoint منفصل لكل نوع:
```
POST /open-tasks/:id/delivery-result
POST /open-tasks/:id/installation-result
```

صير عندك endpoint واحد:
```
POST /field-visits/:visitId/tasks/:taskId/result
```

### ٢.٢ المنطق

```typescript
// 1. Validation
const { taskId } = req.params;
const { outcome, notes, typeSpecificData } = req.body;

// 2. Upsert visit_task_result
INSERT INTO visit_task_results (visit_task_id, final_decision, closing_notes)
VALUES ($1, $2, $3)
ON CONFLICT (visit_task_id) DO UPDATE ...
RETURNING id;

// 3. Upsert child table based on task_type
switch (taskType) {
  case 'device_delivery':
    INSERT INTO visit_task_device_delivery_results (...)
    VALUES (...)
    ON CONFLICT (visit_task_result_id) DO UPDATE ...;
    break;
  case 'device_installation':
    INSERT INTO visit_task_device_installation_results (...)
    VALUES (...)
    ON CONFLICT (visit_task_result_id) DO UPDATE ...;
    break;
  // ... etc
}
```

### ٢.٣ الـ GET

```
GET /field-visits/:visitId/tasks/:taskId/result
```

يرجع:
```json
{
  "result": { "finalDecision": "...", "closingNotes": "..." },
  "deliveryResult": { ... },       // null if not delivery
  "installationResult": { ... },    // null if not installation
  "activationResult": { ... },      // null if not activation
  "deviceDemoResult": { ... },     // null if not demo
  "emergencyResult": { ... }       // null if not emergency
}
```

---

## ٣) Frontend: `ResultRenderer` موحّد

الـ `TaskDetailLayout` لازم يتعدّل:

```tsx
// BEFORE: كل نوع endpoint منفصل
api.openTasks.getDeliveryResult(taskId)
api.openTasks.getInstallationResult(taskId)

// AFTER: endpoint واحد
api.fieldVisits.getTaskResult(visitId, taskId)
```

الـ `ResultRenderer` بيختار عارض حسب `taskType`:
```tsx
const renderers: Record<string, React.FC> = {
  device_demo: DeviceDemoResultRenderer,
  device_delivery: DeliveryResultRenderer,
  device_installation: InstallationResultRenderer,
  device_activation: ActivationResultRenderer,
  emergency_maintenance: EmergencyResultRenderer,
  // ... جديد بس نضيفه هون
};
```

---

## ٤) Data Migration

```sql
-- نقل نتائج التسليم القديمة
INSERT INTO visit_task_device_delivery_results (...)
SELECT
  vtr.id,  -- visit_task_result_id
  r.outcome,
  r.serial_number,
  ...
FROM open_task_delivery_results r
JOIN open_tasks ot ON ot.id = r.open_task_id
JOIN visit_tasks vt ON vt.source_open_task_id = ot.id
JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
ON CONFLICT (visit_task_result_id) DO UPDATE SET ...;

-- نفس الشي لـ installation
```

> **ملاحظة:** `open_task_*_results` ما تنحذف — نتركها للـ audit لحتى نتأكد من سلامة النقل.

---

## ٥) Constitution — إضافة قسم ٢.١٠

### ٢.١٠ — نمط النتيجة الموحّد (Unified Result Pattern)

كل مهمة — بغض النظر عن نوعها — تستخدم نفس نمط النتيجة:

1. `visit_task_results`: النتيجة العامة (final_decision, closing_notes).
2. `visit_task_{type}_results`: تفاصيل النوع (سيريال، عرض، فحص...).
3. لا يُسمح بجداول نتائج خارج هالنمط (مثل `open_task_*_results` للمهام الميدانية).
4. الـ `final_decision` بيختلف حسب النوع — بس القالب ثابت.
5. كل نوع جديد بيحتاج:
   - Migration لجدول `visit_task_{type}_results`
   - Renderer component
   - Case بـ unified endpoint

---

## ٦) Acceptance Criteria

- [ ] `visit_task_device_delivery_results` موجود وشغال.
- [ ] `visit_task_device_installation_results` موجود وشغال.
- [ ] `visit_task_device_activation_results` موجود وشغال.
- [ ] `POST /field-visits/:visitId/tasks/:taskId/result` endpoint موحّد شغال.
- [ ] `GET` بيرجع كل النتائج ضمن نفس الـ response.
- [ ] Frontend بيستخدم endpoint واحد لكل أنواع.
- [ ] البيانات القديمة نُقلت بدون فقدان.
- [ ] دستور مُحدّث بقسم ٢.١٠.

---

## ٧) ما يُغيّر (Non-goals)

- لا تحذف `open_task_delivery_results` أو `open_task_installation_results` — تترك للـ audit.
- لا تغيّر `open_tasks` — هو كيان منفصل (المهمة المفتوحة ≠ المهمة بالزيارة).
- لا تغيّر marketing_visits legacy — هاد Phase ٤.

---

**تاريخ الكتابة:** 2026-05-22
**الكتاب:** Hermes (manager/analyst)
**المنفّذ:** (Codex / Claude Code)
**Dependencies:** Phase ١ + Phase ٢ مكتملة.
