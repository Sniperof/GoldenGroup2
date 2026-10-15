# Marketing Visit — Device Demo Fields

هذا الملف يربط الحقول بمصدرها الفعلي في الكود، بدون أي افتراضات إضافية.

## 1) طبقة الزيارة (`MarketingVisit`)

| الحقل | المصدر بالكود | الملاحظات |
|---|---|---|
| `status` | `packages/shared/types.ts` → `MarketingVisit.status` | حالة الزيارة نفسها |
| `scheduledDate` | `packages/shared/types.ts` → `MarketingVisit.scheduledDate` | تاريخ الزيارة |
| `scheduledTime` | `packages/shared/types.ts` → `MarketingVisit.scheduledTime` | وقت الزيارة |
| `sourceType` | `packages/shared/types.ts` → `MarketingVisit.sourceType` | مصدر الزيارة |
| `sourceId` | `packages/shared/types.ts` → `MarketingVisit.sourceId` | معرف المصدر |
| `requestedDeviceModelId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | الجهاز المطلوب/المعروض |
| `requestedDeviceName` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | اسم الجهاز |
| `technicianNotes` | `packages/shared/types.ts` | ملاحظات الفني |
| `customerName` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | اسم الزبون |
| `customerAddress` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | عنوان الزبون |
| `customerMobile` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | موبايل الزبون |
| `ownership` | `packages/api/routes/marketingVisits.ts` → `mapCustomerOwnership(row)` | مسؤولية الزبون (مشرف/فني/فرع/شركة) |
| `createdBy` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | منشئ الزيارة/السجل |
| `completedBy` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | من أنهى الزيارة |
| `completedAt` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | وقت الإنهاء |

## 2) طبقة المهمة (`MarketingVisitTask`)

| الحقل | المصدر بالكود | الملاحظات |
|---|---|---|
| `id` | `packages/shared/types.ts` → `MarketingVisitTask.id` | معرف المهمة |
| `visitId` | `packages/shared/types.ts` → `MarketingVisitTask.visitId` | رابط الزيارة |
| `taskType` | `packages/shared/types.ts` → `MarketingVisitTask.taskType` | نوع المهمة |
| `status` | `packages/shared/types.ts` → `MarketingVisitTask.status` | `pending / completed / not_completed` |
| `result` | `packages/shared/types.ts` → `MarketingVisitTask.result` | نتيجة المهمة التفصيلية |
| `outcome` | `packages/shared/types.ts` → `MarketingVisitTask.outcome` | `offer_presented / device_sold / rescheduled / cancelled` |
| `offerType` | `packages/shared/types.ts` → `MarketingVisitTask.offerType` | نوع العرض (كاش/تقسيط) |
| `cashOfferAmount` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | مبلغ الكاش |
| `installmentAmount` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | مبلغ التقسيط |
| `installmentMonths` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | أشهر التقسيط |
| `closedByEmployeeId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | الموظف اللي أغلق العرض |
| `resultNotes` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | ملاحظات النتيجة |
| `contractId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | العقد المرتبط |
| `completedAt` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | وقت إغلاق المهمة |
| `createdAt` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | وقت الإنشاء |
| `updatedAt` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | آخر تحديث |
| `currency` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | العملة |
| `discountPercentage` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | نسبة الحسم |
| `soldDeviceModelId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | الجهاز المباع |
| `soldDeviceModelName` | `packages/api/routes/marketingVisits.ts` | اسم الجهاز المباع |
| `offeredDeviceModelId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | الجهاز المعروض |
| `offeredDeviceModelName` | `packages/api/routes/marketingVisits.ts` | اسم الجهاز المعروض |
| `noClosingReason` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | سبب عدم الإغلاق |
| `saleReferenceNumber` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | رقم مرجعي للبيع |
| `cancellationReasonId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | سبب الإلغاء |
| `rescheduleReasonId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | سبب إعادة الجدولة |
| `followUpDueDate` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | تاريخ المتابعة |
| `cancellationReason` | `packages/api/routes/marketingVisits.ts` | نص السبب |
| `rescheduleReason` | `packages/api/routes/marketingVisits.ts` | نص السبب |
| `sourceOpenTaskId` | `packages/shared/types.ts` + `packages/api/routes/marketingVisits.ts` | المهمة المفتوحة الأصلية |

## 3) طبقة العروض (`MarketingVisitTaskOfferInput` / `marketing_visit_task_offers`)

| الحقل | المصدر بالكود | الملاحظات |
|---|---|---|
| `deviceModelId` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.deviceModelId` | الجهاز داخل العرض |
| `offerType` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.offerType` | `cash / installment` |
| `quantity` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.quantity` | عدد الأجهزة |
| `totalAmount` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.totalAmount` | المبلغ الكلي |
| `firstPaymentAmount` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.firstPaymentAmount` | الدفعة الأولى للتقسيط |
| `installmentMonths` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.installmentMonths` | عدد أشهر التقسيط |
| `currency` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.currency` | العملة |
| `discountPercentage` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.discountPercentage` | نسبة الحسم |
| `closedByEmployeeId` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.closedByEmployeeId` | من أغلق العرض |
| `noClosingReason` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.noClosingReason` | سبب عدم الإغلاق |
| `customerResponse` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.customerResponse` | رد الزبون: accepted / rejected / extension_requested |
| `rejectionReasonId` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.rejectionReasonId` | سبب الرفض |
| `extensionReasonId` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.extensionReasonId` | سبب المهلة |
| `extensionDueDate` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.extensionDueDate` | تاريخ المهلة |
| `saleReferenceNumber` | `packages/shared/types.ts` → `MarketingVisitTaskOfferInput.saleReferenceNumber` | مرجع البيع |

## 4) نتيجة المهمة (`MarketingVisitTaskOutcome`)

| القيمة | المصدر بالكود | الملاحظات |
|---|---|---|
| `offer_presented` | `packages/shared/types.ts` → `MarketingVisitTaskOutcome` | تقديم عرض |
| `device_sold` | `packages/shared/types.ts` → `MarketingVisitTaskOutcome` | تم البيع |
| `rescheduled` | `packages/shared/types.ts` → `MarketingVisitTaskOutcome` | إعادة جدولة |
| `cancelled` | `packages/shared/types.ts` → `MarketingVisitTaskOutcome` | إلغاء |

## 5) نتيجة الزيارة (`MarketingVisitStatus`)

| القيمة | المصدر بالكود | الملاحظات |
|---|---|---|
| `completed` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | الزيارة اكتملت |
| `not_completed` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | لم تكتمل |
| `postponed_by_company` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | مؤجلة من الشركة |
| `postponed_by_customer` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | مؤجلة من الزبون |
| `cancelled` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | ملغاة |
| `needs_reschedule` | `packages/api/routes/marketingVisits.ts` → `RESULT_ALLOWED_STATUSES` | تحتاج إعادة جدولة |

## 6) ماذا يحدث عند `rescheduled`

هذا منطق موجود بالكود وليس استنتاجاً:

- لازم `rescheduleReasonId`
- لازم `followUpDueDate`
- النظام ينشئ `open_tasks` جديدة تلقائياً
- القيم المهمة:
  - `reason = 'follow_up'`
  - `status = 'needs_reschedule'`
  - `due_date = followUpDueDate`
  - `source = 'system'`
  - `origin = 'system'`

**المصدر:** `packages/api/routes/marketingVisits.ts` قرب السطور 1205–1272

## 7) ماذا يحدث عند `offer_presented`

من الكود:

- يمكن إرسال `offers[]` متعددة
- وإذا ما في `offers[]`، فهناك حقول legacy فردية أيضاً:
  - `offerType`
  - `cashOfferAmount`
  - `installmentAmount`
  - `installmentMonths`
  - `currency`
  - `closedByEmployeeId`
  - `noClosingReason`
  - `offeredDeviceModelId`

**المصدر:** `packages/api/routes/marketingVisits.ts` قرب السطور 937–968 و 1009–1107

## 8) ملاحظة مهمة

أي توصيف وظيفي خارج ما سبق هو **شرح تنظيمي** وليس نصاً حرفياً من الكود.
