# Contract Data Map

## الهدف

هذه الخريطة تصنف بيانات العقود حسب معناها الحقيقي، لا حسب مكان ظهورها في الواجهة فقط.

## أولا: بيانات تعريف الصفقة

- `contract_number`
- `contract_date`
- `customer_id`
- `customer_name`
- `branch_id`
- `contract_type`
- `sale_type`
- `sale_source`
- `sale_subtype`

## ثانيا: بيانات الاتفاق المالي

- `base_price`
- `final_price`
- `payment_type`
- `down_payment`
- `installments_count`
- `discount_id`
- `applied_device_discount_id`

## ثالثا: بيانات المشتري القانونية

- `buyer_mother_name`
- `buyer_national_id_registry`
- `buyer_national_id_issued_by`
- `buyer_national_id_issue_date`
- `buyer_national_id_box`
- `buyer_birth_date`
- `buyer_gender`

## رابعا: بيانات الأثر التشغيلي

- `source_visit`
- `source_open_task_id`
- `source_task_offer_id`
- `sale_reference_number`
- `closing_employee_id`
- `closing_date`
- `created_by`

## خامسا: بيانات الجهاز الفيزيائي

هذه لا يجب اعتبارها "ملكية مفهومية للعقد" حتى لو ظهرت عبر response العقد:

- `serialNumber`
- `deviceStatus`
- `deliveryDate`
- `installationDate`
- `installationGeoUnitId`
- `installationAddressText`
- `installationLat`
- `installationLng`
- `isGoldenWarranty`
- `goldenWarrantyEndDate`
- `contractWarrantyEndDate`
- `warrantyMonths`
- `warrantyVisits`

## قاعدة التصنيف

إذا ظهر الحقل في شاشة العقد فهذا لا يعني أن العقد هو مالكه المفهومي.
الملكية المفهومية يجب أن تحدد من سؤال: "عن أي حقيقة هذا الحقل يجيب؟"
