# Printable Sale Contract V2 Plan

## الهدف

هذه الوثيقة تحول فجوة العقد الإلكتروني الحالية إلى خطة تنفيذ واضحة لنسخة:

> **`sale_definitive printable v2`**

والمقصود بها:

- عقد بيع قطعي مطبوع
- يطابق النص المرجعي الدستوري
- ويسحب البيانات الفعلية المتفق عليها من النظام
- ويصلح كنسخة قانونية معتمدة، لا كملخص عرض مبسط

## الوضع الحالي باختصار

المنفذ حالياً في:

- `packages/api/routes/contractDocuments.ts`
- `packages/api/services/contractRenderer.ts`
- `packages/api/templates/contracts/sale_definitive.v1.html`

هو **renderer أولي** يحقق:

- preview للمسودة
- freeze للنسخة المعتمدة
- قالب HTML مطبوع

لكنه لا يطابق بعد النص المرجعي الكامل في:

- [02c-printable-electronic-contract.md](./02c-printable-electronic-contract.md)

ولذلك يجب اعتبار `v1`:

> **خطوة بنيوية صحيحة، لكنها ليست النسخة القانونية النهائية لعقد البيع القطعي**

## ما الذي يجب أن نبنيه في V2

## 1. توسيع render bundle

يجب أن تتوقف الطباعة عن سحب "بعض حقول العقد"، وتنتقل إلى:

> **Render bundle قانوني كامل**

### أ. بيانات رأس العقد

- `contract_number`
- `contract_date`
- `sale_subtype`
- `status`
- `branch`

### ب. بيانات الفريق الأول

- اسم الشركة
- اسم موظف الإغلاق
- صفة موظف الإغلاق
- `draft_notice_text` إذا كان العقد ما يزال مسودة

### ج. بيانات الفريق الثاني

اللقطة القانونية الكاملة للزبون:

- الاسم الكامل
- اسم الأم
- تاريخ الولادة
- رقم الهوية
- القيد
- الجهة المصدرة
- تاريخ المنح
- الخانة
- المحافظة
- المنطقة
- الناحية
- الحي
- العنوان التفصيلي
- أرقام التواصل

### د. بيانات الجهاز

- اسم الجهاز
- العدد
- الرقم التسلسلي إن كان جزءاً من النص
- عنوان التركيب
- مكونات البيع التابعة

### هـ. البيانات المالية

- سعر الجهاز الأساسي
- الحسم على الجهاز إن وجد
- القيمة النهائية للجهاز
- القيمة النهائية للعقد
- الدفعة الأولى
- الرصيد المتبقي
- نوع السداد
- ملخص الأقساط
- جدول الأقساط

### و. بيانات الكفالة

- مدة كفالة العقد
- عدد الزيارات
- نص سريان الكفالة من تاريخ تشغيل الجهاز

### ز. البيانات القانونية الإضافية

- نص التأخير والغرامة
- الاختصاص القضائي
- عدد النسخ
- منع الشطب والتعديل اليدوي

## 2. بناء placeholder map مطابق للدستور

بدلاً من map صغير من نوع:

- `contractNumber`
- `basePrice`
- `finalPrice`

يجب أن نبني map مطابقاً للنص المرجعي، ويغطي على الأقل:

### الرأس والأطراف

- `contract_title`
- `contract_number`
- `contract_date`
- `company_name`
- `company_representative_name`
- `company_representative_title`
- `draft_notice_text`
- `customer_full_name`
- `customer_mother_name`
- `customer_birth_date`
- `customer_national_id_number`
- `customer_registry_record`
- `customer_id_issued_by`
- `customer_id_issue_date`
- `customer_id_box`
- `customer_governorate`
- `customer_area`
- `customer_sub_area`
- `customer_neighborhood`
- `customer_detailed_address`
- `customer_contact_rows`

### موضوع البيع والمادة /2/

- `device_name`
- `device_quantity`
- `device_base_price_number`
- `device_base_price_words`
- `device_discount_label`
- `device_discount_amount_number`
- `device_discount_amount_words`
- `device_final_price_number`
- `device_final_price_words`
- `contract_items_summary`
- `final_price_number`
- `final_price_words`
- `payment_clause_text`

### المواد /4/ إلى /9/

- `included_components_text`
- `includes_delivery_once`
- `includes_installation_once`
- `warranty_months_label`
- `periodic_visits_count`
- `periodic_visits_interval_text`
- `periodic_visits_duration_text`
- `payment_type_label`
- `down_payment_number`
- `down_payment_words`
- `remaining_balance_number`
- `remaining_balance_words`
- `installments_summary_text`
- `installments_table`
- `late_penalty_text`
- `late_penalty_amount`

### الخاتمة والتوقيع

- `jurisdiction_text`
- `copies_count_text`
- `no_manual_edit_text`
- `company_signature_name`
- `company_signature_title`
- `customer_signature_name`
- `contract_approval_name`
- `print_date`

## 3. إعادة بناء قالب البيع القطعي

يجب إنشاء:

- `packages/api/templates/contracts/sale_definitive.v2.html`

ولا أوصي بترقيع `v1` نفسها، لأن الفرق ليس تجميلياً، بل:

- اختلاف مواد
- اختلاف placeholders
- اختلاف مستوى قانوني كامل

### القاعدة

`v2` يجب أن تمثل:

> **العقد القانوني المرجعي**

وليس:

> **بطاقة تفصيل مطبوعة**

## 4. تقسيم التنفيذ مادة مادة

### المرحلة A — الرأس والطرفان

- عنوان العقد
- رقم العقد
- التاريخ
- الفريق الأول
- الفريق الثاني
- `draft_notice_text`

### المرحلة B — المادة /2/ والمادة /3/

- موضوع البيع
- سعر الجهاز
- الحسم الشرطي
- القيمة النهائية
- جوهر السداد
- القبول

### المرحلة C — المواد /4/ إلى /7/

- ما يشمله السعر
- كفالة العقد
- قطع الغيار والخدمة
- الزيارات الدورية

### المرحلة D — المواد /8/ إلى /11/

- السداد
- التأخير
- الاختصاص القضائي
- النسخ والأثر الكتابي

### المرحلة E — التوقيع والاعتماد

- توقيع الفريق الأول
- توقيع الفريق الثاني
- اعتماد العقد
- تاريخ التوليد

## 5. ما الذي يجب أن يبقى شرطياً

هذه الأجزاء لا يجب أن تظهر دائماً:

- قسم الحسم إذا لم يوجد حسم
- قسم الأقساط إذا لم توجد أقساط
- مادة الزيارات إذا لم توجد زيارات دورية
- إشعار المسودة إذا لم يكن العقد draft

## 6. ما الذي يجب ألا نفعله في V2

- لا نربط القالب بالهدية أو المؤقت في نفس المرحلة
- لا نبدأ بتوليد PDF قبل إغلاق HTML القانونية
- لا نستخدم labels خامة من قاعدة البيانات داخل النص القانوني
- لا نعتمد على بيانات حية ناقصة إذا كان لها snapshot متفق عليه

## 7. القرار التنفيذي المقترح

### المهمة الأولى

توسيع `loadContractForRender()` إلى bundle قانوني كامل.

### المهمة الثانية

بناء `buildPrintableSaleDefinitiveVars()` أو ما يعادلها داخل renderer:

- مهمتها الوحيدة تحويل bundle إلى placeholder map نظيف

### المهمة الثالثة

إضافة `sale_definitive.v2.html`

### المهمة الرابعة

تبديل `ACTIVE_TEMPLATE_VERSION.sale_definitive` من `v1` إلى `v2`

فقط بعد اكتمال المراجعة.

## 8. ما الذي يؤجل بعد V2

- `sale_temporary` printable template
- `sale_free` printable template
- structured snapshot إضافي منفصل داخل `contract_documents`
- amendment model
- PDF generation canon

## 9. النتيجة المطلوبة من هذه الخطة

عند اكتمال `sale_definitive printable v2` يجب أن يصبح عندنا:

1. عقد بيع قطعي مطبوع مطابق للدستور المرجعي
2. قابل للتجميد عند الاعتماد
3. يعرض البيانات القانونية والمالية الحقيقية المتفق عليها
4. يصلح كأساس صحيح للانتقال إلى:
   - عقد الهدية
   - العقد المؤقت
   - وتحسينات التعديل اللاحقة
