# Contracts Workbench

> مسار توثيق مخصص للعقود داخل طبقة `constitution`.
> الهدف منه تفكيك موضوع العقود إلى وحدات واضحة: ما هو الجهاز، ما هو العقد، ما هي الالتزامات المالية، وما هي العمليات التشغيلية المرتبطة بها.

## الهدف

ملف [domains/contracts.md](../domains/contracts.md) يبقى هو الدستور المرجعي الجامع.
أما هذا المجلد فهو "ورشة عمل" منظمة لتفصيل العقود خطوة خطوة حتى نتمكن من:

1. تثبيت التعاريف الأساسية بلا خلط.
2. فصل الطبقات: الجهاز الفيزيائي، العقد، الالتزامات المالية، والعمليات التشغيلية.
3. توثيق كل مسار عمل بالتسلسل التنفيذي.
4. استخراج التاسكات المفتوحة من الوثائق بشكل منظم وقابل للتنفيذ.

## ترتيب القراءة

1. [00-scope-and-method.md](./00-scope-and-method.md)
2. [01-what-is-a-device.md](./01-what-is-a-device.md)
3. [01a-device-user-stories.md](./01a-device-user-stories.md)
4. [01b-device-entry-scenarios.md](./01b-device-entry-scenarios.md)
5. [01c-contract-device-boundary-scenarios.md](./01c-contract-device-boundary-scenarios.md)
6. [01d-unified-device-contract-states.md](./01d-unified-device-contract-states.md)
7. [01e-device-possession-ledger.md](./01e-device-possession-ledger.md)
8. [01f-device-parts-and-components.md](./01f-device-parts-and-components.md)
9. [01g-installation-location-glossary.md](./01g-installation-location-glossary.md)
10. [02-what-is-a-contract.md](./02-what-is-a-contract.md)
11. [02a-contract-parties-and-participants.md](./02a-contract-parties-and-participants.md)
12. [02b-contract-warranties.md](./02b-contract-warranties.md)
13. [02c-printable-electronic-contract.md](./02c-printable-electronic-contract.md)
14. [03-financial-obligations.md](./03-financial-obligations.md)
15. [03a-financial-ledger-and-customer-statement.md](./03a-financial-ledger-and-customer-statement.md) - إحالة سريعة
16. [04-operational-lifecycle.md](./04-operational-lifecycle.md) - إحالة سريعة
17. [04a-contract-cancellation-matrix.md](./04a-contract-cancellation-matrix.md)
18. [05-contract-data-map.md](./05-contract-data-map.md)
19. [06-gaps-and-questions.md](./06-gaps-and-questions.md)
20. [06a-current-implementation-audit.md](./06a-current-implementation-audit.md)
21. [07-task-backlog.md](./07-task-backlog.md)
22. [08-resolved-decisions.md](./08-resolved-decisions.md)

## التصنيف البنيوي الحالي

### 1. الملفات المرجعية

هذه هي الملفات التي يجب أن تعد مرجع الحقيقة المفهومية داخل هذا المجلد:

- [00-scope-and-method.md](./00-scope-and-method.md)
- [01-what-is-a-device.md](./01-what-is-a-device.md)
- [01d-unified-device-contract-states.md](./01d-unified-device-contract-states.md)
- [01e-device-possession-ledger.md](./01e-device-possession-ledger.md)
- [01f-device-parts-and-components.md](./01f-device-parts-and-components.md)
- [01g-installation-location-glossary.md](./01g-installation-location-glossary.md)
- [02-what-is-a-contract.md](./02-what-is-a-contract.md)
- [02a-contract-parties-and-participants.md](./02a-contract-parties-and-participants.md)
- [02b-contract-warranties.md](./02b-contract-warranties.md)
- [02c-printable-electronic-contract.md](./02c-printable-electronic-contract.md)
- [03-financial-obligations.md](./03-financial-obligations.md)
- [04a-contract-cancellation-matrix.md](./04a-contract-cancellation-matrix.md)
- [06a-current-implementation-audit.md](./06a-current-implementation-audit.md)
- [08-resolved-decisions.md](./08-resolved-decisions.md) — مرجع القرارات المحسومة (DEC-CT-XX)

### 2. الملفات التحليلية

هذه الملفات تساعد على النقاش، واختبار الفرضيات، وتوليد القرارات، لكنها ليست المرجع النهائي الأول:

- [01a-device-user-stories.md](./01a-device-user-stories.md)
- [01b-device-entry-scenarios.md](./01b-device-entry-scenarios.md)
- [01c-contract-device-boundary-scenarios.md](./01c-contract-device-boundary-scenarios.md)
- [06-gaps-and-questions.md](./06-gaps-and-questions.md)

### 3. الملفات التنفيذية / التنظيمية

هذه الملفات تنظّم العمل أو تلخصه، لكنها ليست مرجع تعريف مفهومي بحد ذاتها:

- [05-contract-data-map.md](./05-contract-data-map.md)
- [07-task-backlog.md](./07-task-backlog.md)

### 4. الملفات الإحالية

هذه الملفات تبقى موجودة لتسهيل القراءة والتنقل، لكن تم دمج جوهرها المرجعي في ملفات أخرى:

- [03a-financial-ledger-and-customer-statement.md](./03a-financial-ledger-and-customer-statement.md)
- [04-operational-lifecycle.md](./04-operational-lifecycle.md)

## توصيات المراجعة البنيوية

### ما يجب إبقاؤه كما هو

- إبقاء الفصل بين:
  - تعريف الجهاز
  - سجل الحيازة
  - الحالة التشغيلية
  - الكفالات
  - المال
  - مصفوفة الإلغاء
- إبقاء ملفات السيناريوهات والقصص كطبقة تحليل منفصلة، لأنها مفيدة جداً في اختبار القرارات قبل تحويلها إلى تنفيذ.

### ما يجب أن يبقى لكنه يصبح مرجعاً ثانوياً أو مجرد إحالة

- [04-operational-lifecycle.md](./04-operational-lifecycle.md)
  - ملف مفيد، لكنه قصير جداً حالياً، ويجب أن يعامل كإحالة سريعة أو ملخص، لا كمصدر الحقيقة الأول.
- [05-contract-data-map.md](./05-contract-data-map.md)
  - يصلح كخريطة تنقل أو فهرس حقول، لا كوثيقة قرار مفهومي مستقلة.
- [06-gaps-and-questions.md](./06-gaps-and-questions.md)
  - يجب أن يبقى مؤقتاً فقط ما دامت هناك أسئلة مفتوحة، ثم يصغر تدريجياً مع حسمها.

### ما تم دمجه فعلاً

- تم دمج الجوهر المرجعي في [03a-financial-ledger-and-customer-statement.md](./03a-financial-ledger-and-customer-statement.md) داخل [03-financial-obligations.md](./03-financial-obligations.md)
- تم دمج الجوهر المرجعي في [04-operational-lifecycle.md](./04-operational-lifecycle.md) داخل [02-what-is-a-contract.md](./02-what-is-a-contract.md)

وبالتالي صار الملفان:

- [03a-financial-ledger-and-customer-statement.md](./03a-financial-ledger-and-customer-statement.md)
- [04-operational-lifecycle.md](./04-operational-lifecycle.md)

ملفين إحاليين مختصرين، لا مرجعين مفهوميَّين مستقلين

### ما أوصي بعدم دمجه حالياً

- عدم دمج [01-what-is-a-device.md](./01-what-is-a-device.md) مع [01d-unified-device-contract-states.md](./01d-unified-device-contract-states.md)
  - لأن الأول تعريفي
  - والثاني قاموس حالات وقرارات
- عدم دمج [02b-contract-warranties.md](./02b-contract-warranties.md) مع [02c-printable-electronic-contract.md](./02c-printable-electronic-contract.md)
  - لأن الأول يعرّف معنى الكفالة
  - والثاني يعرّف تمثيلها القانوني والطباعة
- عدم دمج [04a-contract-cancellation-matrix.md](./04a-contract-cancellation-matrix.md) مع [01d-unified-device-contract-states.md](./01d-unified-device-contract-states.md)
  - لأن الأولى مصفوفة قرار
  - والثانية قاموس حالات عام

## مبدأ العمل

- هذا المجلد لا يلغي أي دستور موجود.
- أي معلومة هنا يجب أن تكون منسجمة مع الكود الحالي أو موصوفة صراحة كفرضية/سؤال مفتوح.
- عند حسم أي نقطة مفهومية أو تنفيذية هنا، يجب عكسها لاحقا في:
  - `docs/constitution/domains/contracts.md`
  - أو `docs/constitution/domains/installed-devices.md`
  - أو القرار المعماري المناسب إذا كانت القاعدة جديدة

## المراجع الأساسية

- [contracts domain](../domains/contracts.md)
- [installed devices domain](../domains/installed-devices.md)
- [field visits domain](../domains/field-visits.md)
- [contract ownership decision](../decisions/DEC-002-contract-ownership-from-task.md)
- [visit lifecycle contract](../../visit-lifecycle-contract.md)
- [contracts API route](../../../packages/api/routes/contracts.ts)
