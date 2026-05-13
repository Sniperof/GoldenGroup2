# P6 — عقد نتائج الاتصال في Telemarketer Workspace

## السلوكيات الثلاث المُنفَّذة

---

### 1. `message_sent` — سجل قابل للتعديل

**قبل:** سجل الرسالة كان يظهر في الجدول ولكن بدون أي زر للمتابعة أو التعديل.

**بعد:**
- عند ظهور آخر سجل بـ `outcome = 'message_sent'`، يظهر زر **"تعديل نتيجة الرسالة"** بلون أصفر متميّز
- الزر يفتح `OutcomeRecorderModal` مباشرة
- المستخدم يُسجّل النتيجة الحقيقية بعد الرد (نجاح الاتصال، حجز موعد، إلخ)
- السجل الأصلي لا يُحذف — يُضاف سجل جديد فوقه

**الكود:**
```typescript
// TelemarketerWorkspace.tsx — journey events
{isLatest && log.outcome === 'message_sent' && (
    <button onClick={() => setIsOutcomeModalOpen(true)} className="...text-amber-700...">
        <Edit3 /> تعديل نتيجة الرسالة
    </button>
)}
```

---

### 2. `not_reached` → تحديث حالة الرقم

**قبل:** `PHONE_STATUS_TO_CONTACT_ENTRY` كان مُستورَداً لكن غير مستخدم. الحالة لم تُطبَّق على الـ contact.

**بعد:**
- `OutcomeRecorderModal` يعرض **"حالة الرقم"** عند اختيار outcome يحمل `requiresPhoneStatusUpdate: true`
- الحالة الافتراضية تُملأ تلقائياً من `defaultPhoneStatus` في `OUTCOME_MAP`
- القيم المعروضة: فعال / مفضل / خارج التغطية / غير مستخدم / قيمة خاطئة
- الحفظ مُحجوب إذا لم تُختَر حالة (`!selectedPhoneStatus`)
- `handleSaveOutcome` يُطبّق التحديث على `client.contacts` عبر `updateClient`

**الـ outcomes المتأثرة:**
- `out_of_coverage` → default: `out_of_coverage`
- `wrong_number` → default: `wrong_value`
- `not_in_service` → default: `not_in_use`

---

### 3. `address_updated` / `new_number` → فتح تعديل بيانات الزبون

**قبل:** هذه النتائج كانت تُسجَّل كـ call log فقط بدون أي إجراء لاحق.

**بعد:**
- بعد حفظ call log لـ `address_updated` أو `new_number`، يُفتح `ClientModal` فوراً
- المودال يحمل بيانات الزبون الحالية كـ `initialData`
- المستخدم يعدّل العنوان أو يضيف رقم جديد
- عند الحفظ: يُحدَّث `useClientStore` ويُعاد تحميل الـ clients

---

## قواعد العقد (ما يجب أن يبقى ثابتاً)

| النتيجة | السلوك |
|---------|--------|
| `message_sent` | يُسجَّل كـ `status: 'pending'` + يظهر زر "تعديل" لاحقاً |
| `out_of_coverage`/`wrong_number`/`not_in_service` | يُعرض اختيار حالة رقم + يُطبَّق على الـ contact |
| `address_updated`/`new_number` | يُسجَّل call log + يُفتح ClientModal فوراً |
