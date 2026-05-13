# VERIFICATION — P3 Telemarketing Appointments Contract

## منهجية التحقق

1. قراءة الكود الكامل لمسار الحجز من الواجهة للباكند
2. استعلامات مباشرة في DB staging لإثبات كل ادعاء
3. تتبع chain: task_list_item → appointment → marketing_visit → marketing_visit_task

---

## 1. إثبات: الحجز يعمل بدون open_task

```sql
-- عدد الـ appointments بدون open_task_id
SELECT
  COUNT(*) AS total,
  COUNT(open_task_id) AS with_open_task,
  COUNT(*) - COUNT(open_task_id) AS without_open_task
FROM telemarketing_appointments;

-- النتيجة:
total=15  with_open_task=13  without_open_task=2

-- تفاصيل الـ 2 بدون open_task:
appointment fcc7ccc9 → client 2 → date 2026-05-03 → mv.status=completed ← زيارة اكتملت
appointment e688771d → client 2 → date 2026-05-07 → mv.status=scheduled
```

**الدليل الحاسم:** `appointment fcc7ccc9` بدون `open_task_id` أنتجت زيارة `status=completed`.
أي: **الحجز AND تسجيل النتيجة نجحا بدون أي open_task مرتبط**.

---

## 2. إثبات: نوع المهمة لا يُفرَّق عند الحجز

```sql
-- نوع كل مهام الزيارات التسويقية
SELECT task_type, COUNT(*) FROM marketing_visit_tasks GROUP BY task_type;

-- النتيجة:
device_demo | 15  ← 100%

-- هذا النتيجة بسبب الـ fallback، ليس بسبب validation:
```

```typescript
// telemarketing.ts:1382 — الكود الفعلي
const visitTaskTypes = rawSelectedTasks.map(t => t.taskType || 'device_demo');
//                                                              ^^^^^^^^^^^^ fallback
```

```typescript
// telemarketing.ts:1368-1371 — لا validation على taskType
const rawSelectedTasks = Array.isArray(appointment.selectedOpenTasks) && ...
  ? appointment.selectedOpenTasks  // ← يقبل أي string
  : [{ openTaskId: ..., taskType: 'device_demo', ... }];
```

**الدليل:** لو أُرسل `taskType: 'emergency_maintenance'` في `selectedOpenTasks`، الباكند يقبله.
كل السجلات الحالية `device_demo` لأن الواجهة تُرسل `openTaskType || 'device_demo'` دائماً.

---

## 3. إثبات: legacy upsert path يتجاوز open_task linkage

```typescript
// telemarketing.ts:840-863 — legacy upsert INSERT
await client.query(`
  INSERT INTO telemarketing_task_list_items (
    id, task_list_id, entity_type, entity_id, name, mobile, contact_number,
    contact_label, address_text, geo_unit_id, status, call_outcome, contact_target_id
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)
  --                                               ^^^^^ contact_target_id=NULL
  -- ← لا حقل open_task_id في الـ INSERT
`);
```

Items من legacy upsert: `open_task_id = NULL`، `contact_target_id = NULL`

```sql
-- تحقق: الـ items بدون open_task_id التي وصلت لـ 'booked'
SELECT COUNT(*) FROM telemarketing_task_list_items
WHERE status = 'booked' AND open_task_id IS NULL;
-- النتيجة: 4
```

---

## 4. إثبات: open_task status transition صامت عند فشله

```typescript
// telemarketing.ts:1465-1474
await pgClient.query(
  `UPDATE open_tasks
   SET status = 'scheduled', team_snapshot = $2
   WHERE id = $1 AND status = 'in_contact_list'`,  // ← شرط صارم
  [task.openTaskId, teamSnapshotJson],
);
// لا فحص على rowCount — لا خطأ إذا كان status ≠ in_contact_list
```

```sql
-- هل في open_tasks مرتبطة بـ appointments لكن ليست scheduled؟
SELECT ot.status, COUNT(*)
FROM telemarketing_appointments ta
JOIN open_tasks ot ON ot.id = ta.open_task_id
GROUP BY ot.status;

-- النتيجة:
scheduled   | 3
completed   | 8
cancelled   | 1
needs_resc. | 1
-- ← لا open_task بقي في 'in_contact_list' بعد الحجز
-- لكن لا دليل على أن المنطق نجح أم أُهمل — فقط أن النتيجة النهائية صحيحة
```

---

## 5. إثبات: UI gate (opensAppointment) سهل التجاوز

### الـ gate في الواجهة:
```typescript
// TelemarketerWorkspace.tsx:414
if (meta.opensAppointment) {  // true فقط لـ booked_marketing_appointment
    setIsAppointmentModalOpen(true);
}
```

### مسار تجاوز الـ gate:

**مسار 1 — Direct API:**
```bash
curl -X POST /api/telemarketing/appointments \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Branch-Id: 2" \
  -d '{"taskListId":"tm_xxx","taskListItemId":"item_xxx","teamKey":"team_0","date":"2026-05-12","timeSlot":"10:00",...}'
# → 200 OK — لا يُطلب outcome سابق
```

**مسار 2 — Calendar button في الواجهة (fallback path):**
```typescript
// TelemarketerWorkspace.tsx:905-909
<button
    onClick={() => { if (!selectedAppointment) setIsAppointmentModalOpen(true); }}
    disabled={!isBookedForSelected || !!selectedAppointment}
```
إذا كان `customer.status === 'booked'` (من أي مصدر)، يمكن فتح الـ modal مباشرة بدون تسجيل outcome أولاً.

---

## 6. Drift الموثَّق بين UI وباكند

| الجانب | الواجهة | الباكند | نوع الـ Drift |
|--------|---------|---------|--------------|
| gate الحجز | `opensAppointment=true` فقط | لا gate مكافئ | **Gap — UI-only gate** |
| نوع المهمة | لا تفلتر | لا تتحقق | **غياب validation مشترك** |
| waterSource | مطلوب لـ device_demo | يُمرَّر فقط، لا validation | **asymmetric check** |
| open_task existence | `openTasks.length > 0` شرط للعرض | اختياري تماماً | **UI اشتراط ≠ API اشتراط** |
| legacy upsert | محجوب (لا UI له) | مفتوح (endpoint موجود) | **hidden bypass** |

---

## 7. أهم نقطة تحقق

**الـ appointment `fcc7ccc9` (client 2, 2026-05-03):**
```
open_task_id = NULL
marketing_visit.status = completed
marketing_visit_task.source_open_task_id = NULL
```

هذا يثبت أن:
1. الحجز يعمل بدون open_task ✅
2. تسجيل النتيجة يعمل بدون open_task (عبر legacy endpoint) ✅
3. **لكن** عبر canonical endpoint (/outcome)، يُشترط وجود `'ended'` status الذي لا يظهر في DB أبداً

→ الـ contract الفعلي هو: **أي client في task list يمكن حجزه، بأي taskType، بدون open_task مرتبط**.
