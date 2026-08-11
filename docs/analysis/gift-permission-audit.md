# تدقيق صلاحيات مسار الهدايا

تاريخ التدقيق: 2026-07-26

## نموذج القرار

كل مسارات الهدايا تتبع:

`identity + permission + scope + gift subject = decision`

الحارس `requirePermission()` يثبت امتلاك القدرة فقط. بعده يُحمّل سجل الهدية
ويُمرر إلى `canAccessGift()` مع:

- `sourceBranchId`
- `responsibleBranchId`
- `assignedUserId`
- `beneficiaryEmployeeId`
- إسناد الزبون المستفيد للمستخدم الحالي، عند وجود مستفيد زبون

## جرد المسارات

| المسار | الصلاحية | تحقق الـ subject |
|---|---|---|
| `GET /gifts/records` | `contract_gifts.view` | خطة قائمة `GLOBAL/BRANCH/ASSIGNED` على الخادم |
| `POST /gifts/records/similar` | `contract_gifts.manage` | فرع المصدر والمسؤولية قبل كشف السجلات المشابهة |
| `POST /gifts/records` | `contract_gifts.manage` | فرع المصدر والمسؤولية والمستخدم المسند |
| `PATCH /gifts/records/:id/condition` | `contract_gifts.verify_condition` | تحميل سجل الهدية ثم policy |
| `POST /gifts/records/:id/approve` | `contract_gifts.approve_delivery` | تحميل سجل الهدية ثم policy |
| `POST /gifts/records/:id/withdraw-approval` | `contract_gifts.approve_delivery` | تحميل سجل الهدية ثم policy |
| `POST /gifts/records/:id/create-delivery-task` | `contract_gifts.create_delivery_task` | تحقق مستقل لكل سجل في المجموعة |
| `POST /gifts/records/:id/manual-delivery` | `contract_gifts.manual_delivery` | تحميل السجل، policy، وفرع تسليم مطابق للمصدر/المسؤولية |
| `POST /gifts/records/:id/reopen-manual-delivery` | `contract_gifts.reopen_manual_delivery` | `GLOBAL` فقط + تحميل سجل الهدية ثم policy |
| `POST /gifts/records/:id/cancel` | `contract_gifts.cancel` | تحميل سجل الهدية ثم policy |

## الصلاحية الجديدة

`contract_gifts.reopen_manual_delivery`

- النطاق المسموح: `GLOBAL` فقط.
- المنح الابتدائية: الأدوار التي تملك
  `field_visits.reopen_closed` بمنحة `GLOBAL`.
- لا تعتمد على اسم الدور.
- الواجهة تخفي الفعل دون الصلاحية، لكن المنع الحاسم في API.
- السبب إلزامي، ويحفظ حدث التدقيق لقيم التسليم اليدوي السابقة.

## مصفوفة الاختبارات السلبية المطلوبة

1. مستخدم بلا الصلاحية: `403`.
2. منحة `BRANCH` أو `ASSIGNED` للصلاحية الجديدة: غير صالحة في الكتالوج ولا
   تمنح حق التنفيذ.
3. سجل في فرع غير مسموح: `403` لكل صلاحيات الهدايا ذات النطاق.
4. سجل غير مسند لمستخدم `ASSIGNED`: `403`.
5. إعادة فتح سجل ليس `delivered_manually`: `409`.
6. إعادة فتح بلا سبب: `400`.

## المسارات الإيجابية

- `GLOBAL`: وصول لأي سجل هدية.
- `BRANCH`: وصول لسجل مصدره أو مسؤوليته ضمن الفروع المسموحة.
- `ASSIGNED`: وصول ضمن الفرع مع إسناد السجل/الزبون أو كون المستفيد هو الموظف
  الحالي.
- super-admin: المسار الصريح في محرك الصلاحيات، مع بقاء تحقق حالة السجل
  وشروط الانتقال.
