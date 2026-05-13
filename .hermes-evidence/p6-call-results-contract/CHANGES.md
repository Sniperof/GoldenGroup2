# CHANGES — P6 Call Results Contract

## الملفات المُعدَّلة

### `packages/web/src/components/telemarketing/OutcomeRecorderModal.tsx`

| التغيير | السطور |
|---------|--------|
| import `PhoneStatusUpdate` type من shared | +1 |
| إضافة `phoneStatusUpdate` لـ `SaveExtras` | +2 |
| إضافة `selectedPhoneStatus` state | +1 |
| useEffect لـ auto-populate default phone status عند تغيير outcome | +10 |
| إضافة `requiresPhoneStatus` flag في `canSave` | +2 |
| إضافة `phoneStatusUpdate` في extras قبل `onSave` | +3 |
| إضافة UI: phone status buttons عند `requiresPhoneStatusUpdate` | +25 |

### `packages/web/src/pages/TelemarketerWorkspace.tsx`

| التغيير | السطور |
|---------|--------|
| import `ClientModal` | +1 |
| import `ContactEntry`, `Client` types | +1 |
| import `Edit3` icon | +1 |
| إضافة `isClientEditModalOpen` state | +1 |
| إضافة phone status apply في `handleSaveOutcome` | +14 |
| إضافة ClientModal open لـ data_update outcomes | +3 |
| تعديل journey: زر "تعديل نتيجة الرسالة" لـ message_sent | +5 |
| إضافة ClientModal في render | +12 |

---

## ملاحظات التنفيذ

**Phone status:**
- `PHONE_STATUS_TO_CONTACT_ENTRY` كان مستورداً مسبقاً في TelemarketerWorkspace لكن غير مُستخدَم
- التطبيق: `updateClient(entityId, { contacts: [...updated] })` بعد حفظ call log

**ClientModal:**
- مستخدم مسبقاً في `ClientProfile.tsx` — لا modal جديد
- يُفتح بـ `initialData = entityDetails as Client`
- `onSave` يُحدّث الـ store ويُعيد `loadClients()`

**message_sent button:**
- يظهر بغض النظر عن عدد المحاولات (لا يخضع لشرط `taskCalls.length < 3`)
- لون أصفر (amber) متميّز عن زر "محاولة مرة أخرى" البنفسجي

**TypeScript:**
- Cast `newContactStatus` كـ `ContactEntry['status']` لإرضاء الـ type checker
- Build ناجح: `✓ built in 7.37s` بدون errors
