# TASK: حذف workaround `!allTasksArePostSale` من `telemarketing.ts`

> السياق: `AP-G006` تم إصلاحه جذرياً بجعل `contact_target` كيان يومي (عبر migration 151 + تعديلات `planningMarketingTargets.ts` + `contactTargets.ts`).
> الـ workaround (`!allTasksArePostSale`) لم يعد له داعٍ ويجب إزالته.

---

## الملف الوحيد

`packages/api/routes/telemarketing.ts`

---

## التعديلات المطلوبة (3 مواقع)

### موقع ١: إزالة تعريف `POST_SALE_TASK_TYPES` و `allTasksArePostSale` (سطور ~1437–1444)

**الحذف:**
```ts
// Post-sale tasks (device_delivery / device_installation / device_activation) are
// created from contracts, not from telemarketing campaigns.  Their task-list items
// may carry a contact_target_id from a *previous* closed campaign — which must NOT
// block booking.  We skip contact_target lifecycle checks entirely for these task types.
const POST_SALE_TASK_TYPES = ['device_delivery', 'device_installation', 'device_activation'];
const allTasksArePostSale =
  rawSelectedTasks.length > 0 &&
  rawSelectedTasks.every(t => POST_SALE_TASK_TYPES.includes(t.taskType));
```

**السبب:**
- جهة الاتصال صارت كيان يومي (`date` موجود بالـ `contact_targets`).
- مهمة `device_delivery` اليوم = جهة اتصال `date=today` جديدة (مفتوحة).
- ما في جهة قديمة مغلقة بتتعرض للحجز بعد الإصلاح.
- الـ bypass أصبح redundant.

---

### موقع ٢: تبسيط فحص `contact_target.status === 'closed'` (سطر ~1480)

**قبل:**
```ts
if (contactTargetId != null && !allTasksArePostSale) {
  const ctRow = await pgClient.query<{ status: string }>(
    'SELECT status FROM contact_targets WHERE id = $1',
    [contactTargetId],
  );
  if (ctRow.rows[0]?.status === 'closed') {
    await pgClient.query('ROLLBACK');
    return res.status(409).json({
      error: 'لا يمكن حجز موعد — جهة الاتصال مُقفلة بالفعل (نتيجة حجز سابق أو إغلاق).'
    });
  }
}
```

**بعد:**
```ts
if (contactTargetId != null) {
  const ctRow = await pgClient.query<{ status: string }>(
    'SELECT status FROM contact_targets WHERE id = $1',
    [contactTargetId],
  );
  if (ctRow.rows[0]?.status === 'closed') {
    await pgClient.query('ROLLBACK');
    return res.status(409).json({
      error: 'لا يمكن حجز موعد — جهة الاتصال مُقفلة بالفعل (نتيجة حجز سابق أو إغلاق).'
    });
  }
}
```

**التغيير الوحيد:** حذف `&& !allTasksArePostSale`.

---

### موقع ٣: تبسيط إغلاق جهة الاتصال بعد الحجز (سطر ~1656)

**قبل:**
```ts
if (contactTargetId != null && !allTasksArePostSale) {
  // AP-R007 / PC-G004: booking closes the contact target. The reason
  // is preserved via latest_call_outcome (= 'booked_marketing_appointment')
  // written by the upstream call-recording flow.
  // Post-sale tasks are excluded: their task-list item may reference a legacy
  // contact_target from a previous campaign; mutating it would corrupt history.
  await updateContactTargetLifecycle(pgClient, contactTargetId, {
    status: 'closed',
    latestAppointmentId: savedAppointment.id,
  });
}
```

**بعد:**
```ts
if (contactTargetId != null) {
  // AP-R007 / PC-G004: booking closes the contact target. The reason
  // is preserved via latest_call_outcome (= 'booked_marketing_appointment')
  // written by the upstream call-recording flow.
  await updateContactTargetLifecycle(pgClient, contactTargetId, {
    status: 'closed',
    latestAppointmentId: savedAppointment.id,
  });
}
```

**التغييران:**
1. حذف `&& !allTasksArePostSale`
2. حذف التعليق عن "Post-sale tasks are excluded..." (صار غير صحيح)

---

## التحقق بعد التعديل

1. ابحث في `telemarketing.ts` عن `allTasksArePostSale` أو `POST_SALE_TASK_TYPES` → يجب ألا يوجد أي تطابق.
2. السيرفر يجب أن يشغل بدون أخطاء (`npm run dev` أو `pm2 restart`).
3. سيناريو الاختبار:
   - أنشئ `device_delivery` مهمة لزبون جديد
   - افتح `planning` + `generate-from-plan` → يجب أن تنشئ `contact_target` جديدة (`date=today`)
   - حاول حجز موعد → يجب أن ينجح بدون 409
   - تحقق أن `contact_target.status = 'closed'` بعد الحجز
