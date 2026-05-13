# CHANGES

## الملف المُعدَّل

**`packages/api/routes/contactTargets.ts`**

---

## التعديل الفعلي (السطر الوحيد المتغيّر في هذه الجلسة)

```diff
  router.get('/marketing', async (req, res) => {
    const branchId = getBranchId(req);
    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

-   const { rows } = await pool.query(marketingTargetSelect, [branchId]);
+   const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
    return res.json(rows.map((row: any) => ({ ...row, ownership: mapCustomerOwnership(row) })));
  });
```

---

## السياق الكامل للـ diff (من git)

التعديلات في الـ diff الكامل تشمل تغييرات من جلسات سابقة + تعديل هذه الجلسة:

| التعديل | الجلسة | الوصف |
|---------|--------|-------|
| إضافة imports لـ `customerOwnership` | سابقة | ضرورية لـ `mapCustomerOwnership` في response |
| إضافة `ACTIVE_OPEN_TASK_STATUSES` constant | سابقة | يُعرَّف على مستوى الملف |
| إضافة `${buildCustomerOwnershipSelectColumns()}` في SQL | سابقة | إضافة ownership columns للاستعلام |
| إضافة `LEFT JOIN branches b, cb` | سابقة | مطلوب لـ ownership SQL |
| إضافة `AND EXISTS (... $2::varchar[])` في SQL | سابقة | إضافة فلتر open_tasks — ولَّد البـ bug لاحقاً |
| إضافة فلتر مماثل في INSERT query | سابقة | لـ `POST /sync` (صحيح) |
| تصحيح `POST /sync` لتمرير `ACTIVE_OPEN_TASK_STATUSES` | سابقة | أصلح نصف المشكلة |
| **تصحيح `GET /marketing` لتمرير `ACTIVE_OPEN_TASK_STATUSES`** | **هذه الجلسة** | **الـ fix الأساسي** |

---

## لا يوجد تعديل في

- `packages/shared/types.ts` — لا حاجة
- `packages/web/` — لا حاجة
- أي ملف آخر
- Production — لم يُلمَس نهائياً
