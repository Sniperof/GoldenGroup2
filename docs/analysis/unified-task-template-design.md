# تصميم القالب الموحد للمهام

> **الغرض:** تثبيت البنية التقنية التي تجعل إضافة أي نوع مهمة جديد من الـ 20 عملية سهلة ومحددة.
> **المرجع:** `device_demo` كمهمة مرجعية مشغولة حالياً
> **المبدأ:** لا تعديل على النواة — فقط تسجيل plugin جديد

---

## 1) المشكلة الحالية

```
إضافة مهمة جديدة اليوم تعني:
  ✗ تعديل marketingVisits.ts (1638 سطر)
  ✗ تعديل MarketingVisitOutcomeModal.tsx (1816 سطر)
  ✗ تعديل if/else في applyTaskOutcome و applyTaskResult
  ✗ تعديل فلاتر OpenTasks.tsx يدوياً
  ✗ تعديل shared/types.ts بقيم مشفرة
  
الخطر: كل تغيير يمس كود device_demo المشغول
```

---

## 2) الهدف — ماذا يعني "قالب موحد"؟

```
إضافة مهمة جديدة يجب أن تعني:
  ✓ migration واحد: task_type_config + result table
  ✓ ملف handler خلفية جديد فقط
  ✓ ملف UI plugin واجهة جديد فقط
  ✗ صفر تعديل على النواة المشتركة
```

---

## 3) الفصل الأساسي — ما يبقى مشتركاً وما يتغير

### 3.1 مشترك تماماً بين كل المهام (النواة)

```
open_tasks lifecycle:
  open → assigned → in_scheduling → scheduled → in_execution → completed/cancelled

contact_targets lifecycle (التخطيط والجدولة)
task_activity_log (سجل التدقيق)
client_snapshot / contract_snapshot (عند الإنشاء)
visit creation / cancellation
planning queries (من يظهر في قائمة اليوم)
```

### 3.2 مختلف لكل نوع (الـ plugin)

```
ما الحقول التي تُسجَّل كنتيجة؟
ما جدول قاعدة البيانات الذي يُكتب فيه؟
ما معنى "منفذة" و"غير منفذة" لهذا النوع؟
هل تُنشئ مهمة جديدة بعد الإغلاق؟ (مثال: device_activation تُنشئ periodic_maintenance)
ما شكل النموذج الذي يملأه الفريق الميداني؟
```

---

## 4) الواجهة — Interface التي يجب أن يحقق كل plugin

### 4.1 Backend Plugin Interface

```typescript
// packages/api/services/taskTypeHandlers/types.ts

export interface TaskOutcomeValidationError {
  field: string;
  message: string;
}

export interface TaskTypeHandler {
  /**
   * تحقق من صحة payload النتيجة قبل الحفظ
   * يُعيد null إذا كل شيء صحيح، أو مصفوفة أخطاء
   */
  validateOutcome(body: unknown): TaskOutcomeValidationError[] | null;

  /**
   * احفظ النتيجة في جدول النوع الخاص
   * يُنفَّذ داخل transaction موجودة
   */
  persistOutcome(
    db: Queryable,
    context: {
      openTaskId: number;
      visitTaskId: number;        // marketing_visit_task.id
      visitId: string;            // marketing_visit.id
      userId: number | null;
    },
    body: unknown,
  ): Promise<void>;

  /**
   * ما حالة open_task بعد هذا الـ outcome؟
   * 'completed' | 'cancelled' | 'needs_reschedule'
   */
  resolveOpenTaskStatus(outcome: string): 'completed' | 'cancelled' | 'needs_reschedule';

  /**
   * هل هذا الـ outcome يُنشئ مهمة لاحقة تلقائياً؟
   * مثال: device_activation → periodic_maintenance
   * مثال: device_purchase → device_delivery
   * إذا لم تكن هناك مهمة لاحقة → أُعيد null
   */
  maybeCreateFollowUp?(
    db: Queryable,
    openTask: { id: number; clientId: number; branchId: number; contractId?: number },
    outcome: string,
    body: unknown,
  ): Promise<{ taskType: string; dueDate?: string; notes?: string } | null>;

  /**
   * قراءة نتيجة المهمة لعرضها (للـ GET endpoints)
   */
  loadResult?(
    db: Queryable,
    visitTaskId: number,
  ): Promise<Record<string, unknown> | null>;
}
```

### 4.2 Frontend Plugin Interface

```typescript
// packages/web/src/taskTypes/types.ts
import type { LucideIcon } from 'lucide-react';

export interface OutcomeFormProps {
  taskType: string;
  openTaskId: number;
  visitId: string;
  visitTaskId: number;
  onSave: (payload: unknown) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export interface ResultViewProps {
  taskType: string;
  result: Record<string, unknown> | null;
}

export interface TaskTypeUIConfig {
  /** الاسم العربي */
  label: string;
  /** رمز اللون للعائلة */
  familyColor: string;
  /** الأيقونة */
  icon: LucideIcon;
  /** ألوان حالة خاصة بهذا النوع (اختياري — يرجع لـ defaults إذا لم تُحدد) */
  statusColors?: Partial<Record<string, string>>;
  /** نموذج تسجيل النتيجة */
  OutcomeForm: React.ComponentType<OutcomeFormProps>;
  /** عرض النتيجة بعد التسجيل */
  ResultView?: React.ComponentType<ResultViewProps>;
}
```

---

## 5) الـ Registry — مركز التسجيل

### 5.1 Backend Registry

```typescript
// packages/api/services/taskTypeHandlers/index.ts

import { deviceDemoHandler } from './deviceDemo';
import { emergencyMaintenanceHandler } from './emergencyMaintenance';
// مستقبلاً:
// import { deviceActivationHandler } from './deviceActivation';
// import { installmentCollectionHandler } from './installmentCollection';

export const TASK_TYPE_REGISTRY: Record<string, TaskTypeHandler> = {
  device_demo: deviceDemoHandler,
  emergency_maintenance: emergencyMaintenanceHandler,
  // يكفي إضافة سطر واحد هنا
};

export function getTaskTypeHandler(taskType: string): TaskTypeHandler | null {
  return TASK_TYPE_REGISTRY[taskType] ?? null;
}
```

### 5.2 Frontend Registry

```typescript
// packages/web/src/taskTypes/registry.ts

import { deviceDemoUIConfig } from './deviceDemo';
import { emergencyMaintenanceUIConfig } from './emergencyMaintenance';

export const TASK_TYPE_UI_REGISTRY: Record<string, TaskTypeUIConfig> = {
  device_demo: deviceDemoUIConfig,
  emergency_maintenance: emergencyMaintenanceUIConfig,
};

export function getTaskTypeUI(taskType: string): TaskTypeUIConfig | undefined {
  return TASK_TYPE_UI_REGISTRY[taskType];
}
```

---

## 6) device_demo كـ Plugin مرجعي — كيف تبدو؟

### 6.1 Backend Handler

```typescript
// packages/api/services/taskTypeHandlers/deviceDemo.ts

export const deviceDemoHandler: TaskTypeHandler = {

  validateOutcome(body) {
    const errors: TaskOutcomeValidationError[] = [];
    const { outcome, offers } = body as any;

    const VALID = ['offer_presented', 'device_sold', 'rescheduled', 'cancelled'];
    if (!outcome || !VALID.includes(outcome)) {
      errors.push({ field: 'outcome', message: 'outcome غير صالح' });
      return errors;
    }

    if (outcome === 'offer_presented' || outcome === 'device_sold') {
      if (!Array.isArray(offers) || offers.length === 0) {
        errors.push({ field: 'offers', message: 'يجب تحديد عرض واحد على الأقل' });
      }
      // ... باقي تحقق العروض
    }

    return errors.length > 0 ? errors : null;
  },

  async persistOutcome(db, context, body) {
    const { outcome, offers, notes } = body as any;
    const { openTaskId, visitTaskId, visitId, userId } = context;

    // UPDATE marketing_visit_tasks
    await db.query(`UPDATE marketing_visit_tasks SET outcome = $1, ... WHERE id = $2`, [outcome, visitTaskId]);

    // INSERT marketing_visit_task_offers (للعروض)
    if (offers?.length) {
      for (const offer of offers) {
        await db.query(`INSERT INTO marketing_visit_task_offers (...) VALUES (...)`, [...]);
      }
    }
    // لا يوجد متابعة تلقائية لـ device_demo عادةً
    // (device_purchase يُنشأ يدوياً من الواجهة إذا وافق الزبون)
  },

  resolveOpenTaskStatus(outcome) {
    if (outcome === 'offer_presented' || outcome === 'device_sold') return 'completed';
    if (outcome === 'rescheduled') return 'needs_reschedule';
    return 'cancelled';
  },

  // لا يوجد follow-up تلقائي لـ device_demo
  maybeCreateFollowUp: undefined,

  async loadResult(db, visitTaskId) {
    const { rows } = await db.query(
      `SELECT mvt.outcome, mvt.result_notes, mvo.*
       FROM marketing_visit_tasks mvt
       LEFT JOIN marketing_visit_task_offers mvo ON mvo.task_id = mvt.id
       WHERE mvt.id = $1`,
      [visitTaskId],
    );
    return rows.length > 0 ? rows : null;
  },
};
```

### 6.2 Frontend UI Config

```typescript
// packages/web/src/taskTypes/deviceDemo/index.ts

import { Package2 } from 'lucide-react';
import { DeviceDemoOutcomeForm } from './DeviceDemoOutcomeForm';
import { DeviceDemoResultView } from './DeviceDemoResultView';

export const deviceDemoUIConfig: TaskTypeUIConfig = {
  label: 'عرض جهاز',
  familyColor: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100',
  icon: Package2,
  OutcomeForm: DeviceDemoOutcomeForm,
  ResultView: DeviceDemoResultView,
};
```

---

## 7) مثال على نوع جديد — `device_activation` (تشغيل الجهاز)

يكفي هذا لإضافة النوع بالكامل:

### 7.1 Backend Handler

```typescript
// packages/api/services/taskTypeHandlers/deviceActivation.ts

export const deviceActivationHandler: TaskTypeHandler = {

  validateOutcome(body) {
    const errors: TaskOutcomeValidationError[] = [];
    const { outcome, tdsBefore, tdsAfter, technicalNotes } = body as any;

    const VALID = ['activated', 'not_activated'];
    if (!VALID.includes(outcome)) {
      errors.push({ field: 'outcome', message: 'outcome غير صالح' });
    }
    if (outcome === 'activated' && !tdsBefore) {
      errors.push({ field: 'tdsBefore', message: 'قراءة TDS قبل التشغيل إلزامية' });
    }
    // ...
    return errors.length > 0 ? errors : null;
  },

  async persistOutcome(db, context, body) {
    const { outcome, tdsBefore, tdsAfter, technicalNotes } = body as any;

    // UPDATE marketing_visit_tasks
    await db.query(`UPDATE marketing_visit_tasks SET outcome = $1, ... WHERE id = $2`, [outcome, context.visitTaskId]);

    // INSERT visit_task_activation_results
    await db.query(
      `INSERT INTO visit_task_activation_results
         (visit_task_id, activation_date, tds_before, tds_after, technical_notes)
       VALUES ($1, NOW(), $2, $3, $4)`,
      [context.visitTaskId, tdsBefore, tdsAfter, technicalNotes],
    );
  },

  resolveOpenTaskStatus(outcome) {
    return outcome === 'activated' ? 'completed' : 'needs_reschedule';
  },

  // الأهم: تشغيل الجهاز يُنشئ أول صيانة دورية تلقائياً
  async maybeCreateFollowUp(db, openTask, outcome, body) {
    if (outcome !== 'activated') return null;

    const { nextMaintenanceDays = 365 } = body as any; // N يوم من task_type_config
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + nextMaintenanceDays);

    return {
      taskType: 'periodic_maintenance',
      dueDate: dueDate.toISOString().slice(0, 10),
      notes: 'أول صيانة دورية بعد تشغيل الجهاز',
    };
  },

  async loadResult(db, visitTaskId) {
    const { rows } = await db.query(
      `SELECT * FROM visit_task_activation_results WHERE visit_task_id = $1`,
      [visitTaskId],
    );
    return rows[0] ?? null;
  },
};
```

### 7.2 Frontend UI Config

```typescript
// packages/web/src/taskTypes/deviceActivation/index.ts

import { Zap } from 'lucide-react';
import { DeviceActivationOutcomeForm } from './DeviceActivationOutcomeForm';

export const deviceActivationUIConfig: TaskTypeUIConfig = {
  label: 'تشغيل الجهاز',
  familyColor: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  icon: Zap,
  OutcomeForm: DeviceActivationOutcomeForm,
};
```

### 7.3 التسجيل

```typescript
// backend:
TASK_TYPE_REGISTRY['device_activation'] = deviceActivationHandler;

// frontend:
TASK_TYPE_UI_REGISTRY['device_activation'] = deviceActivationUIConfig;
```

**هذا كل ما يلزم.** لا تعديل على أي شيء آخر.

---

## 8) النواة المشتركة — الـ Engine

### 8.1 Backend Route الموحد

```typescript
// packages/api/routes/openTasks.ts (القسم المضاف)

// POST /open-tasks/:id/outcome
router.post('/:id/outcome', requirePermission('marketing_visits.update_result'), async (req, res) => {
  const openTaskId = Number(req.params.id);
  const openTask = await loadOpenTaskById(pool, openTaskId);

  if (!openTask) return res.status(404).json({ error: 'المهمة غير موجودة' });

  const handler = getTaskTypeHandler(openTask.taskType);
  if (!handler) return res.status(400).json({ error: `نوع المهمة غير مدعوم: ${openTask.taskType}` });

  // 1. تحقق من الـ payload (مسؤولية الـ plugin)
  const errors = handler.validateOutcome(req.body);
  if (errors) return res.status(400).json({ errors });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. حفظ النتيجة (مسؤولية الـ plugin)
    const visitTaskId = openTask.marketingVisitTaskId; // الربط الحالي
    await handler.persistOutcome(client, {
      openTaskId,
      visitTaskId: Number(visitTaskId),
      visitId: openTask.marketingVisitId,
      userId: req.authContext?.userId ?? null,
    }, req.body);

    // 3. تحديث حالة open_task (النواة تقرر — الـ plugin يُخبر فقط)
    const newStatus = handler.resolveOpenTaskStatus(req.body.outcome);
    await client.query(
      `UPDATE open_tasks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, openTaskId],
    );

    // 4. سجل النشاط (النواة دائماً)
    await client.query(
      `INSERT INTO task_activity_log (task_id, event_type, old_value, new_value, performed_by)
       VALUES ($1, 'status_change', $2, $3, $4)`,
      [openTaskId, openTask.status, newStatus, req.authContext?.userId],
    );

    // 5. هل يوجد مهمة لاحقة؟ (مسؤولية الـ plugin)
    if (handler.maybeCreateFollowUp) {
      const followUp = await handler.maybeCreateFollowUp(client, {
        id: openTaskId,
        clientId: openTask.clientId,
        branchId: openTask.branchId,
      }, req.body.outcome, req.body);

      if (followUp) {
        await client.query(
          `INSERT INTO open_tasks (client_id, branch_id, task_type, task_family, reason, status, due_date, origin, origin_ref_id, notes)
           VALUES ($1, $2, $3,
             (SELECT task_family FROM task_type_config WHERE task_type = $3),
             'follow_up', 'open', $4, 'auto_follow_up', $5, $6)`,
          [openTask.clientId, openTask.branchId, followUp.taskType, followUp.dueDate, openTaskId, followUp.notes],
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
```

### 8.2 Frontend Component الموحد

```tsx
// packages/web/src/components/tasks/TaskOutcomeModal.tsx

import { getTaskTypeUI } from '../../taskTypes/registry';

interface TaskOutcomeModalProps {
  isOpen: boolean;
  taskType: string;
  openTaskId: number;
  visitId: string;
  visitTaskId: number;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskOutcomeModal({ isOpen, taskType, openTaskId, visitId, visitTaskId, onClose, onSaved }: TaskOutcomeModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uiConfig = getTaskTypeUI(taskType);

  if (!isOpen) return null;

  if (!uiConfig) {
    return (
      <div className="...">نوع المهمة '{taskType}' غير مدعوم في الواجهة بعد</div>
    );
  }

  const { OutcomeForm } = uiConfig;

  async function handleSave(payload: unknown) {
    setSaving(true);
    setError(null);
    try {
      await api.openTasks.recordOutcome(openTaskId, payload);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 ...">
      <div className="...">
        <OutcomeForm
          taskType={taskType}
          openTaskId={openTaskId}
          visitId={visitId}
          visitTaskId={visitTaskId}
          onSave={handleSave}
          onCancel={onClose}
          saving={saving}
          error={error}
        />
      </div>
    </div>
  );
}
```

---

## 9) هيكل الملفات المقترح

```
packages/
  api/
    services/
      taskTypeHandlers/
        types.ts              ← الـ Interface (لا منطق)
        index.ts              ← الـ Registry (التسجيل فقط)
        deviceDemo.ts         ← plugin device_demo (ينقل من marketingVisits.ts)
        emergencyMaintenance.ts ← plugin emergency (ينقل من marketingVisits.ts)
        deviceActivation.ts   ← plugin جديد (مستقبل)
        installmentCollection.ts ← plugin جديد (مستقبل)
        ...

  web/
    src/
      taskTypes/
        types.ts              ← الـ Interface (لا منطق)
        registry.ts           ← الـ Registry (التسجيل فقط)
        deviceDemo/
          index.ts            ← config التسجيل
          DeviceDemoOutcomeForm.tsx  ← النموذج (ينقل من MarketingVisitOutcomeModal)
          DeviceDemoResultView.tsx   ← العرض
        emergencyMaintenance/
          index.ts
          EmergencyOutcomeForm.tsx
        deviceActivation/     ← مستقبل
          index.ts
          DeviceActivationOutcomeForm.tsx
        ...
```

---

## 10) خطة الترحيل — بدون كسر device_demo

```
المرحلة 1 (الإعداد — لا تغييرات على السلوك):
  ✓ إنشاء taskTypeHandlers/types.ts (interfaces فقط)
  ✓ إنشاء taskTypeHandlers/deviceDemo.ts (نسخ المنطق الحالي من marketingVisits.ts)
  ✓ إنشاء taskTypeHandlers/index.ts (registry)
  ✓ إنشاء taskTypes/types.ts في الواجهة
  ✓ إنشاء taskTypes/deviceDemo/ (نقل DeviceDemoOutcomeForm من MarketingVisitOutcomeModal)
  ✓ إنشاء TaskOutcomeModal.tsx الموحد

المرحلة 2 (التوصيل — تبديل النقاط القديمة):
  ✓ توصيل POST /open-tasks/:id/outcome جديد
  ✓ المحافظة على /marketing-visits/:visitId/tasks/:taskId/outcome القديم (backward compat)
  ✓ توصيل TaskOutcomeModal في MarketingVisitDetailsPage بدلاً من MarketingVisitOutcomeModal

المرحلة 3 (التحقق):
  ✓ اختبار device_demo كامل يعمل عبر المسار الجديد
  ✓ إزالة المنطق المكرر من marketingVisits.ts

المرحلة 4 (التوسعة):
  ✓ إضافة emergency_maintenance كـ plugin منفصل
  ✓ إضافة أول نوع جديد (device_activation)
```

---

## 11) القاعدة الجوهرية للقالب

```
كل مهمة = plugin بـ 5 دوال:
  1. validateOutcome(body)        → أخطاء أو null
  2. persistOutcome(db, ctx, body) → void (داخل transaction)
  3. resolveOpenTaskStatus(outcome) → 'completed' | 'cancelled' | 'needs_reschedule'
  4. maybeCreateFollowUp?          → مهمة جديدة أو null
  5. loadResult?                   → بيانات النتيجة للعرض

+ UI Component واحد: OutcomeForm

لا شيء آخر يختلف بين المهام.
النواة (lifecycle, snapshots, activity log, contact targets) لا تُمس أبداً.
```
