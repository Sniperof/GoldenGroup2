# Golden CRM — Project Constitution

> **Status:** active draft
> **Role:** الدستور الأعلى الذي يحدد طريقة فهم المشروع وطريقة تغييره.

## 1) المصدر المعتمد
- الكود الحالي هو المصدر التشغيلي للحقيقة.
- أي تغيير لا يبدأ من افتراض عام؛ يبدأ من تحليل جزئية محددة في الكود.

## 2) ترتيب العمل لأي تعديل
1. فهم الطلب
2. تحليل الكود الحالي
3. تحديد الجزئية المستهدفة
4. تحديد الأثر
5. تحديث الدستور إذا تغيّر المعنى/العقد
6. التنفيذ
7. التحقق
8. التوثيق

## 3) قواعد عامة
- لا توسعة جانبية غير مطلوبة.
- لا bypass غير موثق.
- لا خلط بين المصطلحات الرسمية والlegacy.
- إذا تغيّر workflow أو terminology أو contract، يجب تحديث الدستور أولًا.

## 4) مراجع الدومينات
- `docs/constitution/domains/README.md`
- `docs/constitution/features/README.md`
- `docs/constitution/decisions/README.md`

## 5) Permissions and authorization
- The mandatory engineering contract is `docs/constitution/domains/permissions-engineering-standard.md`.
- Any change involving roles, permissions, scopes, branches, ownership, JWT authorization claims, or UI permission gates must follow that contract before implementation.
- The governing model is `identity + permission + scope + subject = decision`.
