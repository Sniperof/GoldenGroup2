# دليل إنشاء مهمة جديدة — نمط الزيارة الموحّد

> **الحالة:** معتمد كمرجع دستوري
> **الغرض:** أي شخص بده يضيف نوع مهمة جديد بيعرف بالظبط شو لازم يعمل
> **السياق:** بعد اكتمال Phase 1 + 2 + 3 — الزيارة موحّدة، النتيجة موحّدة، endpoint موحّد

---

## ١. البنية الموحّدة (يلي صار لازم نتبعها)

```
field_visit (الزيارة)
  └── visit_task (task_type = 'xxx', task_family = 'yyy')
        └── visit_task_result (final_decision, closing_notes, reason_code)
              └── visit_task_xxx_results (تفاصيل النوع)
```

**ملاحظة:** ما في `open_task_*_results` للمهام الميدانية — النتيجة بتكون جوا الزيارة.

---

## ٢. خطوات إضافة مهمة جديدة (بالترتيب)

### الخطوة ١: تعريف النوع بالداتا بيز

| العمل | الملف | المثال |
|-------|-------|--------|
| إضافة `task_type` لـ `visit_tasks.task_type` constraint | migration | `ALTER TABLE visit_tasks ... ADD 'periodic_maintenance'` |
| إضافة سجل بـ `task_type_config` | migration أو seed | `INSERT INTO task_type_config (task_type, task_family, ...)` |
| إضافة صلاحيات الإنشاء والنتيجة | migration | `tasks.periodic_maintenance.create`, `tasks.periodic_maintenance.result` |

> **القاعدة:** `task_family` بيحدد العائلة (marketing / delivery / emergency / maintenance / collection / service / warranty / sales).

---

### الخطوة ٢: إنشاء جدول نتيجة النوع

Migration جديد — اسم الجدول:
```
visit_task_{نوع_المهمة}_results
```

مثال موجود:
| النوع | الجدول |
|-------|--------|
| device_demo | `visit_task_device_demo_results` |
| device_delivery | `visit_task_device_delivery_results` |
| device_installation | `visit_task_device_installation_results` |
| device_activation | `visit_task_device_activation_results` |
| emergency_maintenance | `visit_task_emergency_technical_states` + `visit_task_emergency_parts_used` + `visit_task_emergency_financials` |

**القالب:**
```sql
CREATE TABLE IF NOT EXISTS visit_task_xxx_results (
  id                    BIGSERIAL    PRIMARY KEY,
  visit_task_result_id  BIGINT       NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtxxx_result UNIQUE (visit_task_result_id),

  outcome               VARCHAR(50)  NOT NULL
                          CHECK (outcome IN ('outcome_1', 'outcome_2', ...)),

  -- حقول التفاصيل (كل نوع بيختلف)
  field_1               TYPE,
  field_2               TYPE,
  ...

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

> **مهم:** كل جدول `child` بيحتوي `visit_task_result_id` كـ FK — هاد يربط النتيجة بالزيارة.

---

### الخطوة ٣: إضافة الـ case للـ Backend (Unified Endpoint)

بالملف `packages/api/routes/fieldVisits.ts`:

**بالـ `POST /:visitId/tasks/:taskId/result`:**

```ts
} else if (taskType === 'xxx') {
  await db.query(
    `INSERT INTO visit_task_xxx_results (
       visit_task_result_id, outcome, field_1, field_2, ...
     ) VALUES ($1, $2, $3, $4, ...)
     ON CONFLICT (visit_task_result_id) DO UPDATE SET ...`,
    [vtrId, outcome, typeData.field1, typeData.field2, ...],
  );
}
```

**بالـ `GET /:visitId/tasks/:taskId/result`:**

```sql
LEFT JOIN visit_task_xxx_results vtxxx ON vtxxx.visit_task_result_id = vtr.id
```

وبالـ response:
```ts
xxxResult: r.xxxOutcome ? { outcome: r.xxxOutcome, field1: r.field1, ... } : null,
```

> **القاعدة:** كل نوع جديد بيحتاج سطرين SQL + سطر response — بس.

---

### الخطوة ٤: Frontend — ResultRenderer + ResultForm

بالملف `packages/web/src/components/tasks/result-renderers/`:

| المكوّن | الغرض |
|---------|-------|
| `XxxResultRenderer.tsx` | عرض النتيجة المسجّلة |
| `XxxResultForm.tsx` | نموذج تسجيل النتيجة |

التسجيل بالـ registry:
```ts
const resultRenderers: Record<string, React.FC> = {
  device_demo: DeviceDemoResultRenderer,
  device_delivery: DeliveryResultRenderer,
  device_installation: InstallationResultRenderer,
  device_activation: ActivationResultRenderer,
  emergency_maintenance: EmergencyResultRenderer,
  // xxx: XxxResultRenderer,  ← هون بتضيف
};
```

---

### الخطوة ٥: Frontend — صفحة التفاصيل

إذا المهمة بتحتاج صفحة تفاصيل مستقلة:

| الملف | المحتوى |
|-------|---------|
| `packages/web/src/pages/tasks/XxxTaskDetail.tsx` | استيراد `TaskDetailLayout` + تمرير `xxxExtension` |
| `packages/web/src/App.tsx` | Route جديد: `/tasks/xxx/:id` |

مثال: `DeliveryTaskDetail.tsx` — استخدم نفس النمط.

---

### الخطوة ٦: تحديث الدستور

بالملف `docs/constitution/features/unified-task-creation-guide.md` (هاد الملف):

أضاف الصف بجدول "الجداول الموجودة":
```
| xxx | visit_task_xxx_results |
```

---

## ٣. قائمة التحقق (Checklist)

قبل ما تعتبر المهمة جاهزة:

- [ ] Migration — `task_type` مضاف لـ `visit_tasks`
- [ ] Migration — جدول `visit_task_xxx_results` منشأ
- [ ] Migration — صلاحيات `tasks.xxx.create` + `tasks.xxx.result`
- [ ] Backend — case بـ `POST` unified endpoint
- [ ] Backend — `LEFT JOIN` + response بـ `GET` unified endpoint
- [ ] Frontend — `ResultRenderer` مسجّل
- [ ] Frontend — `ResultForm` مسجّل
- [ ] Frontend — صفحة تفاصيل (إذا لازم)
- [ ] Constitution — جدول الأنواع مُحدّث
- [ ] Testing — نهاية لنهاية على staging

---

## ٤. أمثلة مرجعية

| النوع | Migration | Backend (POST) | Backend (GET) | Frontend Renderer |
|-------|-----------|----------------|---------------|-------------------|
| device_delivery | `149_visit_task_postsale_results.sql` | `fieldVisits.ts:764` | `fieldVisits.ts:887` | `DeliveryResultRenderer.tsx` |
| device_installation | `149_visit_task_postsale_results.sql` | `fieldVisits.ts:788` | `fieldVisits.ts:887` | `InstallationResultRenderer.tsx` |
| device_activation | `149_visit_task_postsale_results.sql` | `fieldVisits.ts:826` | `fieldVisits.ts:887` | `ActivationResultRenderer.tsx` |

---

## ٥. ما لازم ننساه

- **لا** ننشئ `open_task_xxx_results` — النتيجة لازم تكون جوا الزيارة.
- **لا** ننشئ endpoint منفصل — نستخدم unified endpoint.
- **لا** ننسى `task_family` — بيحدد الصلاحيات والتصنيف.
- **لا** ننسى `outcome` CHECK constraint — لازم يكون واضح.

---

**تاريخ الإنشاء:** 2026-05-23
**آخر تحديث:** 2026-05-23
**الكتاب:** Hermes (manager/analyst)
