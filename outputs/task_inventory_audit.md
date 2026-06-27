# جرد مهام Golden CRM

تاريخ الجرد: 2026-06-27

## نطاق الجرد

تمت مراجعة مصادر المهام التالية:

- `packages/api/routes/fieldVisits.ts`: مسار تسجيل نتيجة المهمة الموحد.
- `packages/api/services/visitTaskResultReflection.ts`: منطق عكس النتيجة على `open_tasks`.
- `packages/api/routes/openTasks.ts`: إنشاء المهام وأسباب الإنشاء.
- `packages/web/src/taskTypes/*`: مودلات تسجيل النتائج في الواجهة.
- `packages/web/src/pages/tasks/TaskEvaluationLab.tsx`: مختبر تقييم نماذج الإنشاء والنتيجة.
- `migrations/*`: تعريفات أنواع المهام وقوائم `system_lists`.
- `docs/tasks`: مجلد برومبتات مهام التطوير، وليس سجل تشغيل فعلي.

> ملاحظة: هذا الجرد لا يحذف بيانات. المقصود بـ “يجب حذفها/عدم التعامل معها” هنا: أنواع مهام أو برومبتات قديمة لا يجب فتحها تشغيلياً قبل اكتمال مسار الإنشاء والنتيجة.

## جدول المقارنة حسب نوع المهمة

| المهمة | حالة المسار | نتيجة تمت بنجاح | إعادة جدولة / متابعة | رفض / إلغاء | سبب الإنشاء / قائمة الإنشاء | التوصية |
|---|---|---|---|---|---|---|
| `device_demo` - عرض جهاز | مكتملة | `device_sold` أو `offer_presented` مع عرض مقبول | `rescheduled` عبر `customer_followup_reasons` | `cancelled` عبر `visit_cancellation_reasons` أو عروض مرفوضة | إنشاء خارجي غالباً من التليماركتنغ/الحجز؛ لا يوجد سبب إنشاء مستقل في مودل المهمة | التعامل معها |
| `device_delivery` - تسليم جهاز | مكتملة | `delivered_successfully` | `customer_not_available`, `wrong_address` تبقي المهمة متابعة بتاريخ متوقع | `refused_delivery` | `sale_delivery`, `post_maintenance_return`, `temporary_swap_delivery`, `replacement_delivery`, `manual_delivery` | التعامل معها |
| `device_installation` - تركيب جهاز | مكتملة | `installed_successfully` | `installation_incomplete` مع `installation_incomplete_reason` | `refused_installation` مع `installation_refusal_reason` | `service_request` أو ناتجة من تسليم جهاز | التعامل معها |
| `device_activation` - تشغيل جهاز | مكتملة | `activated_successfully` | `activation_failed`, `device_issue` مع `device_activation_followup_reasons` | لا يوجد رفض مستقل؛ الفشل/مشكلة الجهاز متابعة لا إلغاء | `service_request` أو ناتجة من تركيب جهاز | التعامل معها |
| `device_disconnection` - فك جهاز | مكتملة | `disconnected_successfully`, `requires_retrieval` | `not_disconnected`, `unsafe_to_disconnect` مع تاريخ متابعة | `customer_refused_disconnection` | `contract_cancelled`, `temporary_stop`, `customer_request`, `technical_safety`, `replacement_preparation`, `maintenance_preparation`, `other` | التعامل معها |
| `device_checkup` - تشييك جهاز | مكتملة | `checked_successfully` | `reschedule` عبر `device_checkup_reschedule_reasons` | `customer_refused_checkup` عبر `device_checkup_refusal_reasons` | `device_checkup`, `manual_checkup`, `other` | التعامل معها |
| `device_retrieval` - سحب جهاز | مكتملة | `retrieved_successfully` | `reschedule` عبر `device_retrieval_reschedule_reasons` | `customer_refused_retrieval` عبر `device_retrieval_refusal_reasons` | `device_retrieval_maintenance`, `device_retrieval_replacement`, `maintenance_preparation`, `replacement_preparation`, `other` | التعامل معها |
| `device_return` - إرجاع جهاز | مكتملة | `returned_successfully` | `reschedule` عبر `device_return_reschedule_reasons` | `customer_refused_return` عبر `device_return_refusal_reasons` | `device_return_after_maintenance`, `post_maintenance_return`, `other` | التعامل معها |
| `device_transfer` - نقل جهاز | مكتملة | `transferred_successfully` | `reschedule` عبر `device_transfer_reschedule_reasons` | `customer_refused_transfer` عبر `device_transfer_refusal_reasons` | `device_transfer_same_customer_new_address`, `device_transfer_another_customer`, `other` | التعامل معها |
| `emergency_maintenance` - صيانة طارئة | مكتملة مع مسارين | `resolved` في مسار `/open-tasks/:id/emergency-result` | `rescheduled` عبر مودل الصيانة/المسار الموحد | `cancelled` عبر `visit_cancellation_reasons` | إنشاء خارجي من طلب صيانة/بلاغ؛ ليس مودل إنشاء عام | التعامل معها |
| `periodic_maintenance` - صيانة دورية | جزئية/متقدمة | `performed` في مسار الصيانة، أو superseded ضمن صيانة طارئة | `partially_performed`, `not_performed`, أو `rescheduled` | `cancelled` في مسار lifecycle | `periodic_manual_creation_reasons` للإنشاء اليدوي، وتوليد آلي عبر الخدمة | التعامل معها بحذر، لا تعتبر مكتملة UI مثل باقي المهام |
| `installment_collection` - تحصيل قسط/ذمة | مكتملة | `paid_full`, `paid_partial` | `rescheduled` عبر `collection_reschedule_reasons` وينشئ مهمة تحصيل لاحقة | `refused_to_pay` عبر `collection_refusal_reasons` | `contract_installment_due`, `remaining_installment_balance`, `rescheduled_collection`, `previous_task_cancelled`, وغيرها من `open_task_reasons` | التعامل معها |
| `gift_delivery` - تسليم هدية | مكتملة في الكود، لكن مختبر التقييم قديم ويعرضها missing | `delivered_successfully` | `rescheduled` عبر `gift_delivery_reschedule_reasons` | `refused_gift` عبر `gift_delivery_refusal_reasons` | إنشاء خارجي من نظام الهدايا؛ أسباب الاستحقاق في `gift_promise_conditions` | التعامل معها، وتحديث المختبر |
| `golden_warranty_offer` - عرض كفالة ذهبية | مكتملة | `activated` / قبول العرض | `rescheduled` عبر `golden_offer_followup_reasons` | `cancelled` عبر `golden_offer_rejection_reasons` | `golden_offer_creation_reasons` | التعامل معها |
| `golden_warranty_card_delivery` - تسليم بطاقة كفالة | مكتملة | `delivered` | `rescheduled` عبر `golden_card_followup_reasons` | `cancelled` عبر `golden_card_rejection_reasons` | `golden_card_creation_reasons` | التعامل معها |
| `device_purchase` - شراء/توقيع عقد | غير مكتملة كمسار مهمة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | موجود تاريخياً في `task_type_config` والتصاميم، لكن مسار العقود هو البديل العملي | عدم التعامل معها كـ `open_task` حالياً |
| `maintenance_collection` - تحصيل صيانة | غير مكتملة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | جزء من `open_task_reasons` لكن لا يوجد مودل مستقل | عدم التعامل معها حتى توحيدها مع تحصيل الذمم |
| `device_repair` - إصلاح جهاز | غير مكتملة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | موجودة في التصاميم فقط عملياً | عدم التعامل معها، واستعمال صيانة طارئة/دورية أو سحب/إرجاع حسب الحالة |
| `parts_sale` - بيع قطع | غير مكتملة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | موجودة في التصاميم فقط | عدم التعامل معها حتى يكتمل نموذج مخزون/بيع القطع |
| `golden_warranty` - منح كفالة ذهبية | غير مكتملة/قديمة | لا يوجد مسار تفعيل كامل يكتب الكفالة على الجهاز | لا يوجد | لا يوجد | استُبدلت عملياً بـ `golden_warranty_offer` و `golden_warranty_card_delivery` | ترحيل/تعطيل النوع القديم |
| `warranty_cancellation` - إلغاء كفالة | غير مكتملة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | موجودة في التصاميم فقط | عدم التعامل معها |
| `warranty_reactivation` - إعادة تفعيل كفالة | غير مكتملة | لا يوجد مودل نتيجة موحد | لا يوجد | لا يوجد | موجودة في التصاميم فقط | عدم التعامل معها |

## قوائم إعادة الجدولة المستقلة

| المهمة | القائمة / القرار |
|---|---|
| عرض جهاز | `customer_followup_reasons`, القرار `rescheduled` |
| تسليم جهاز | لا توجد قائمة مستقلة؛ قرارات المتابعة `customer_not_available`, `wrong_address` |
| تركيب جهاز | `installation_incomplete_reason`, القرار `installation_incomplete` |
| تشغيل جهاز | `device_activation_followup_reasons`, القرارات `activation_failed`, `device_issue` |
| فك جهاز | `device_disconnection_reasons`, قرارات المتابعة `not_disconnected`, `unsafe_to_disconnect` |
| تشييك جهاز | `device_checkup_reschedule_reasons`, القرار `reschedule` |
| سحب جهاز | `device_retrieval_reschedule_reasons`, القرار `reschedule` |
| إرجاع جهاز | `device_return_reschedule_reasons`, القرار `reschedule` |
| نقل جهاز | `device_transfer_reschedule_reasons`, القرار `reschedule` |
| صيانة طارئة/دورية lifecycle | `customer_followup_reasons`, القرار `rescheduled` |
| تحصيل قسط | `collection_reschedule_reasons`, القرار `rescheduled` |
| تسليم هدية | `gift_delivery_reschedule_reasons`, القرار `rescheduled` |
| عرض كفالة ذهبية | `golden_offer_followup_reasons`, القرار `rescheduled` |
| تسليم بطاقة كفالة | `golden_card_followup_reasons`, القرار `rescheduled` |

## قوائم الرفض / الإلغاء المستقلة

| المهمة | القائمة / القرار |
|---|---|
| عرض جهاز | `visit_cancellation_reasons`, القرار `cancelled`; وعلى مستوى العرض `customer_response=rejected` |
| تسليم جهاز | القرار `refused_delivery` بدون قائمة رفض مستقلة واضحة |
| تركيب جهاز | `installation_refusal_reason`, القرار `refused_installation` |
| فك جهاز | `device_disconnection_reasons`, القرار `customer_refused_disconnection` |
| تشييك جهاز | `device_checkup_refusal_reasons`, القرار `customer_refused_checkup` |
| سحب جهاز | `device_retrieval_refusal_reasons`, القرار `customer_refused_retrieval` |
| إرجاع جهاز | `device_return_refusal_reasons`, القرار `customer_refused_return` |
| نقل جهاز | `device_transfer_refusal_reasons`, القرار `customer_refused_transfer` |
| صيانة طارئة/دورية lifecycle | `visit_cancellation_reasons`, القرار `cancelled` |
| تحصيل قسط | `collection_refusal_reasons`, القرار `refused_to_pay` |
| تسليم هدية | `gift_delivery_refusal_reasons`, القرار `refused_gift` |
| عرض كفالة ذهبية | `golden_offer_rejection_reasons`, القرار `cancelled` |
| تسليم بطاقة كفالة | `golden_card_rejection_reasons`, القرار `cancelled` |

## قوائم سبب الإنشاء المستقلة

| المهمة | قائمة/أسباب الإنشاء |
|---|---|
| كل المهام العامة | `open_task_reasons`: `new_lead`, `follow_up`, `renewal`, `service_request`, `other` + إضافات لاحقة |
| تسليم جهاز | `sale_delivery`, `post_maintenance_return`, `temporary_swap_delivery`, `replacement_delivery`, `manual_delivery` |
| فك جهاز | `contract_cancelled`, `temporary_stop`, `customer_request`, `technical_safety`, `replacement_preparation`, `maintenance_preparation`, `other` |
| تشييك جهاز | `device_checkup`, `manual_checkup`, `other` |
| سحب جهاز | `device_retrieval_maintenance`, `device_retrieval_replacement`, `maintenance_preparation`, `replacement_preparation`, `other` |
| إرجاع جهاز | `device_return_after_maintenance`, `post_maintenance_return`, `other` |
| نقل جهاز | `device_transfer_same_customer_new_address`, `device_transfer_another_customer`, `other` |
| تحصيل قسط | `contract_installment_due`, `maintenance_receivable_due`, `golden_warranty_receivable_due`, `remaining_installment_balance`, `rescheduled_collection`, `previous_task_cancelled`, `manager_followup`, `data_correction` |
| صيانة دورية يدوية | `periodic_manual_creation_reasons` |
| عرض كفالة ذهبية | `golden_offer_creation_reasons` |
| تسليم بطاقة كفالة | `golden_card_creation_reasons` |
| تسليم هدية | `gift_promise_conditions` كسبب استحقاق، والإنشاء فعلياً من نظام الهدايا |

## مهام يجب عدم التعامل معها حالياً

هذه الأنواع موجودة في `task_type_config` أو التصاميم، لكنها لا تملك مسار نتيجة موحداً كاملاً أو مودل واجهة واضحاً:

- `device_purchase`
- `maintenance_collection`
- `device_repair`
- `parts_sale`
- `golden_warranty`
- `warranty_cancellation`
- `warranty_reactivation`

التوصية التنفيذية:

1. تعطيلها من `task_type_config.is_active` أو إخفاؤها من الواجهات التشغيلية حتى تكتمل.
2. عدم حذف بيانات قديمة قبل ترحيلها أو التأكد من عدم وجود `open_tasks` نشطة منها.
3. إذا تقرر حذفها نهائياً، يجب عمل migration واضحة تتعامل مع FK من `open_tasks` و `visit_tasks` وسجلات النشاط.

## ملفات `docs/tasks` التي يفضل اعتبارها قديمة أو مرجعية فقط

المجلد `docs/tasks` يحتوي برومبتات تنفيذ كثيرة، بينها نسخ متعددة ومراحل قديمة. أمثلة يجب عدم تشغيلها كمهام جديدة دون مراجعة:

- ملفات `TASK_UNIFIED_VISIT_MIGRATION_*`: مراحل حذف/ترحيل legacy، وبعضها بدائل لبعض.
- عائلة `TASK_156_PURCHASE_HISTORY_*`: نسخ متعددة لنفس موضوع سجل الشراء.
- `TASK_165_*`: أكثر من مهمة بنفس الرقم لمواضيع مختلفة.
- ملفات حذف `marketing_visits` legacy: يجب التعامل معها كأرشيف تحقق، لا كتعليمات حذف مباشرة.

الأفضل نقل هذه الملفات إلى أرشيف أو إضافة بادئة `ARCHIVED_` بعد التأكد من أنها ليست جزءاً من عمل جار.
