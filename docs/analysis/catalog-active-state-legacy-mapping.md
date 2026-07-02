# المرحلة السابعة: Mapping تهجير حالة كتالوج الأجهزة وقطع الغيار

## الهدف

هذه المرحلة تثبت قاعدة التهجير التي تمنع الخلط بين `inactive` و`deleted`.

القواعد المعتمدة:

- `Active` في المصدر القديم يصبح `is_active = true` و`deleted_at = NULL`.
- `Inactive` في المصدر القديم يصبح `is_active = false` و`deleted_at = NULL`.
- `deleted_at` لا يكتب إلا إذا كان المصدر القديم يملك دلالة حذف صريحة مختلفة عن inactive.

لا يجوز استنتاج `Inactive` من `deleted_at` الموجود حالياً في قاعدة staging، لأن جزءاً من المشكلة أن تهجيراً سابقاً قد يكون كتب هذه القيمة بشكل خاطئ.

## ملف mapping المطلوب

يقرأ سكربت التصحيح ملف CSV بهذه الأعمدة:

| العمود | القيم المقبولة | الوصف |
|---|---|---|
| `entity_type` | `device_model`, `spare_part` | نوع السجل في الكتالوج الجديد. |
| `match_key` | `id`, `code`, `name` | طريقة مطابقة السجل الحالي. يفضل `code` إذا كان ثابتاً في المصدر القديم والجديد. |
| `match_value` | نص | القيمة المستخدمة للمطابقة. |
| `legacy_status` | `Active`, `Inactive`, `true`, `false`, `1`, `0` | حالة السجل في المصدر القديم. |
| `legacy_deleted` | `true`, `false` | لا تكون `true` إلا عند وجود حذف صريح في المصدر القديم، وليس عند inactive. |

مثال:

```csv
entity_type,match_key,match_value,legacy_status,legacy_deleted
device_model,code,GG-100,Inactive,false
spare_part,code,FLT-001,Active,false
spare_part,code,OLD-999,Inactive,false
```

## أداة التصحيح

السكربت:

```powershell
node scripts/legacy-catalog-active-state-repair.mjs --file C:\path\legacy_catalog_active_state.csv
```

هذا الوضع dry-run فقط. يعرض ما سيتغير ولا يكتب شيئاً.

للتطبيق لاحقاً بعد مراجعة dry-run:

```powershell
node scripts/legacy-catalog-active-state-repair.mjs --file C:\path\legacy_catalog_active_state.csv --apply
```

يستخدم السكربت `DATABASE_URL` من البيئة أو الوسيط `--database-url`.

## شروط الأمان قبل `--apply`

لا تطبق التصحيح إذا ظهر أي مما يلي:

- صف mapping بقيمة حالة غير مفهومة.
- سجل لا يجد مطابقاً في الكتالوج الحالي.
- سجل يجد أكثر من مطابق.
- أكثر من صف mapping يحاول تغيير نفس السجل بقيم متعارضة.

## الأثر المتوقع

بعد تطبيق mapping صحيح:

- الأجهزة والقطع التي كانت `Inactive` تعود للظهور كسجلات كتالوج غير محذوفة.
- لا تظهر في البيع والعروض والعقود الجديدة لأنها `is_active = false`.
- تبقى مرئية في الإدارة والتاريخ وصيانة الأجهزة القائمة مع شارات التحذير التي أضيفت في المراحل السابقة.

