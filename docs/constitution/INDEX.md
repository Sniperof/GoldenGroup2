# فهرس الدستور — Golden CRM Constitution Index

> **الفهرس الوحيد المعتمد لدستور المطورين.** أي ملف غير مذكور هنا ليس جزءاً من الدستور (راجع [الأرشيف](../archive/) للتاريخ).
> **للإدارة والزبون:** نقطة الدخول هي [docs/README.md](../README.md).
> **آخر مراجعة شاملة:** 2026-09-29.

---

## ابدأ من هنا

| الترتيب | اقرأ | لماذا |
|---|---|---|
| ١ | [standards/engineering-change-process.md](standards/engineering-change-process.md) | عملية التغيير الرسمية: كيف يبدأ أي تعديل وكيف يُغلق |
| ٢ | [project-constitution.md](project-constitution.md) | الدستور الأعلى: المصدر المعتمد وقواعد العمل العامة |
| ٣ | [terminology.md](terminology.md) | المصطلحات الرسمية (العقد، الجهاز، السجل، المخزون) |
| ٤ | هذا الفهرس، ثم ملف الدومين المرتبط بالموضوع | — |
| ٥ | الكود المرتبط مباشرة | الكود هو المصدر التشغيلي للحقيقة |

**مبدأ العمل:** أي تعديل يبدأ بتحليل جزئية محددة في الكود. إذا غيّر التعديل المعنى أو العقد، يُحدَّث الدستور أولاً ثم يُنفَّذ. الدستور تفسير منظَّم للكود، لا بديل عنه. دليل الإجراءات التفصيلي (إضافة كيان، حل ثغرة، إضافة ميزة): [standards/constitution-workflow.md](standards/constitution-workflow.md).

### مفتاح الحالات

| الرمز | المعنى |
|---|---|
| ✅ | منفَّذ في الكود |
| 🟡 | منفَّذ جزئياً |
| 📝 | موثَّق مفاهيمياً، غير منفَّذ بعد |
| ⚠️ | الوثيقة متأخرة عن الكود وتحتاج مراجعة |
| — | مرجع أو أداة (لا ينطبق التنفيذ) |

---

## 1. الدومينات (`domains/`)

### الزبائن والمبيعات

| الدومين | الملف | الحالة |
|---|---|---|
| الزبائن | [domains/clients.md](domains/clients.md) | ✅ |
| المرشحون | [domains/candidates.md](domains/candidates.md) | ✅ |
| العقود والعمليات المالية | [domains/contracts.md](domains/contracts.md) — التفصيل في [ورشة العقود](#6-ورشة-العقود-contracts) | 🟡 |
| التسويق الهاتفي | [domains/telemarketing.md](domains/telemarketing.md) | ✅ |

### الأجهزة

| الدومين | الملف | الحالة |
|---|---|---|
| الأجهزة المركبة (دورة الحياة بعد البيع) | [domains/installed-devices.md](domains/installed-devices.md) | 🟡 |
| كتالوج الأجهزة وقطع الغيار والخصومات | [domains/devices-maintenance.md](domains/devices-maintenance.md) | 🟡 ⚠️ |

### المهام والزيارات

| الدومين | الملف | الحالة |
|---|---|---|
| المهام — دورة الحياة والمراحل (المرجع الأعلى) | [domains/tasks.md](domains/tasks.md) | ✅ |
| موديل المهمة الموحد | [domains/task-model.md](domains/task-model.md) — المصدر الرسمي لأنواع المهام: [مهام الزيارات.pdf](<domains/مهام الزيارات.pdf>) | ✅ |
| المهام المفتوحة — قاموس الجدول وعقد API | [domains/open-tasks.md](domains/open-tasks.md) | 🟡 |
| الزيارات — المفاهيم الموحدة (المرجع الأعلى) | [domains/visits.md](domains/visits.md) | ✅ |
| الزيارات الميدانية — قاموس الجدول وعقد API | [domains/field-visits.md](domains/field-visits.md) | 🟡 |

### التخطيط والجغرافيا

| الدومين | الملف | الحالة |
|---|---|---|
| التخطيط التشغيلي (المظلة) | [domains/planning.md](domains/planning.md) | ✅ |
| الجداول اليومية | [domains/day-schedules.md](domains/day-schedules.md) | ✅ |
| المسارات الجغرافية | [domains/routes.md](domains/routes.md) | ✅ |
| توزيع المسارات | [domains/route-assignments.md](domains/route-assignments.md) | ✅ |
| نطاقات العمل | [domains/work-scopes.md](domains/work-scopes.md) | ⚠️ |
| المناطق الجغرافية | [domains/geo-units.md](domains/geo-units.md) | ✅ |

### التنظيم والصلاحيات

| الدومين | الملف | الحالة |
|---|---|---|
| الفروع | [domains/branches.md](domains/branches.md) | ✅ |
| الموظفون والمستخدمون | [domains/employees.md](domains/employees.md) | 🟡 ⚠️ |
| الأدوار والصلاحيات — سيناريوهات الأدوار | [domains/roles-and-permissions.md](domains/roles-and-permissions.md) | ✅ |
| الصلاحيات — قاموس الجداول | [domains/permissions.md](domains/permissions.md) — الملزم عند التعارض: [معيار هندسة الصلاحيات](standards/permissions-engineering-standard.md) | 🟡 ⚠️ |
| الإعدادات الإدارية | [domains/admin-settings.md](domains/admin-settings.md) — يحوي حالياً روابط التواصل في التطبيق فقط | 🟡 ⚠️ |

### التوظيف والتقارير

| الدومين | الملف | الحالة |
|---|---|---|
| التوظيف والاستقطاب | [domains/jobs-recruitment.md](domains/jobs-recruitment.md) — الميزات في [§2](#2-الميزات-features) | ⚠️ |
| التقارير والمؤشرات (الطبقة التحليلية) | [domains/reporting-analytics.md](domains/reporting-analytics.md) — التقارير المنفذة في [§4](#4-التقارير-featuresreports) | 🟡 |

---

## 2. الميزات (`features/`)

| المجال | الميزة | الملف | الحالة |
|---|---|---|---|
| التخطيط | ملخص الخطة وجهات الاتصال ذات المهام | [features/planning-contact-targets.md](features/planning-contact-targets.md) | ✅ |
| التخطيط | فلتر حساب الحمل لجهات الاتصال | [features/contact-targets-eligibility-filter.md](features/contact-targets-eligibility-filter.md) | ✅ |
| التخطيط | جدولة الفرق | [features/team-scheduling.md](features/team-scheduling.md) | ✅ ⚠️ |
| التخطيط | دراسة النطاقات | [features/zone-study.md](features/zone-study.md) | ✅ |
| التخطيط | توزيع المسارات ونطاق العمل | [features/route-assignment.md](features/route-assignment.md) | ✅ |
| التسويق | مواعيد التسويق الهاتفي | [features/telemarketing-appointments.md](features/telemarketing-appointments.md) | ✅ |
| الزيارات | نموذج الزيارة الموحدة | [features/unified-visit-model.md](features/unified-visit-model.md) | 🟡 |
| الزيارات | شاشة تفاصيل الزيارة | [features/visit-detail-page-constitution.md](features/visit-detail-page-constitution.md) | 🟡 |
| المهام | المهام المفتوحة (الواجهة) | [features/open-tasks.md](features/open-tasks.md) | ✅ |
| المهام | تجربة الجهاز (الواجهة والقوائم) — التعريف الكامل في [§3](#3-أنواع-المهام-featurestasks) | [features/device-demo.md](features/device-demo.md) | 🟡 ⚠️ |
| الزبائن | توثيق الزبون والوسطاء | [features/client-documentation.md](features/client-documentation.md) | 🟡 ⚠️ |
| الصلاحيات | خطة العرض والنطاق لكل دور | [features/permissions-view-strategy.md](features/permissions-view-strategy.md) | ✅ |
| الطلبات | عقد قسم الطلبات | [features/request-section-contract.md](features/request-section-contract.md) | 🟡 |
| التطبيق | إنشاء الحساب ومصادقة تطبيق الزبائن | [features/account-creation-and-app-auth.md](features/account-creation-and-app-auth.md) | 🟡 |
| التطبيق | الشكاوى (منفذ برمجياً، غير منشور) | [features/complaints.md](features/complaints.md) | ✅ |
| الهدايا | نظام الهدايا | [features/gifts.md](features/gifts.md) | 🟡 |
| الهدايا | خطة تنفيذ واجهة الهدايا | [features/gifts-ui-implementation-plan.md](features/gifts-ui-implementation-plan.md) | 🟡 ⚠️ |
| التوظيف | الشواغر | [features/jobs/vacancies.md](features/jobs/vacancies.md) | ✅ |
| التوظيف | الوظائف العامة | [features/jobs/public-jobs.md](features/jobs/public-jobs.md) | ✅ |
| التوظيف | طلبات التوظيف | [features/jobs/applications.md](features/jobs/applications.md) | ✅ |
| التوظيف | الإدخال اليدوي لطلب التوظيف | [features/jobs/manual-application-entry.md](features/jobs/manual-application-entry.md) | ✅ |
| التوظيف | المقابلات | [features/jobs/interviews.md](features/jobs/interviews.md) | ✅ |
| التوظيف | الدورات التدريبية | [features/jobs/training-courses.md](features/jobs/training-courses.md) | ✅ |

---

## 3. أنواع المهام (`features/tasks/`)

> كل نوع مهمة يُعرَّف وفق [القالب الموحد (14 محوراً)](templates/unified-task-template.md). الإطار المشترك لصفحات المهام: [features/tasks/tasks-unified-template.md](features/tasks/tasks-unified-template.md).

| نوع المهمة | الملف | الحالة |
|---|---|---|
| عرض الجهاز `device_demo` | [features/tasks/device-demo.md](features/tasks/device-demo.md) | ✅ |
| تسليم الجهاز `device_delivery` | [features/tasks/device-delivery.md](features/tasks/device-delivery.md) | 🟡 |
| تركيب الجهاز `device_installation` | [features/tasks/device-installation.md](features/tasks/device-installation.md) | 🟡 ⚠️ |
| تشغيل الجهاز `device_activation` | [features/tasks/device-activation.md](features/tasks/device-activation.md) | ✅ |
| تشييك الجهاز `device_checkup` | [features/tasks/device-checkup.md](features/tasks/device-checkup.md) | — |
| نقل الجهاز `device_transfer` | [features/tasks/device-transfer.md](features/tasks/device-transfer.md) | — |
| فك الجهاز `device_disconnection` | [features/tasks/device-disconnection.md](features/tasks/device-disconnection.md) | 📝 |
| سحب الجهاز `device_retrieval` | [features/tasks/device-retrieval.md](features/tasks/device-retrieval.md) | 📝 |
| إرجاع الجهاز `device_return` | [features/tasks/device-return.md](features/tasks/device-return.md) | 📝 |
| الصيانة الطارئة — النطاق المنفَّذ (V1) | [features/tasks/maintenance-v1.md](features/tasks/maintenance-v1.md) | ✅ |
| الصيانة (الطارئة والدورية) — الدستور الكامل | [features/tasks/maintenance.md](features/tasks/maintenance.md) | 🟡 ⚠️ |
| الصيانة الدورية | [features/tasks/periodic-maintenance.md](features/tasks/periodic-maintenance.md) | 🟡 |
| تسليم الهدية `gift_delivery` | [features/tasks/gift-delivery.md](features/tasks/gift-delivery.md) | ✅ |
| تسديد الذمم `installment_collection` | [features/tasks/installment-collection.md](features/tasks/installment-collection.md) | 📝 |

---

## 4. التقارير (`features/reports/`)

> معيار دورة حياة التقرير (G1–G5) في [domains/reporting-analytics.md §9](domains/reporting-analytics.md).

| التقرير | الملف | الحالة |
|---|---|---|
| اتصالات الزبائن | [features/reports/customer-calls-report.md](features/reports/customer-calls-report.md) | 🟡 G3 |
| ملف البيعات اليومي | [features/reports/daily-work-sales-file-report.md](features/reports/daily-work-sales-file-report.md) | 🟡 G3 |
| نتائج حسب القسم | [features/reports/department-results-report.md](features/reports/department-results-report.md) | 🟡 G3 |
| الأعطال | [features/reports/device-faults-report.md](features/reports/device-faults-report.md) | ✅ |
| الكفالة الذهبية | [features/reports/golden-warranty-report.md](features/reports/golden-warranty-report.md) | 🟡 G3 |
| هدايا الوسطاء | [features/reports/mediator-gifts-report.md](features/reports/mediator-gifts-report.md) | ✅ |
| الأجهزة المسحوبة للشركة | [features/reports/retrieved-devices-report.md](features/reports/retrieved-devices-report.md) | ✅ |
| المبيعات حسب النوع | [features/reports/sales-by-type-report.md](features/reports/sales-by-type-report.md) | 🟡 G3 |
| عدد المبيعات | [features/reports/sales-count-report.md](features/reports/sales-count-report.md) | 🟡 G3 |
| الاستحقاقات | [features/reports/service-dues-report.md](features/reports/service-dues-report.md) | ✅ |
| عمل الفنيين | [features/reports/technician-work-report.md](features/reports/technician-work-report.md) | 🟡 G3 |
| عقد مؤقت | [features/reports/temporary-contract-report.md](features/reports/temporary-contract-report.md) | 🟡 G3 |

---

## 5. المكوّنات المشتركة (`components/`)

| المكوّن | الملف | الحالة |
|---|---|---|
| لقطة الزبون `ClientSnapshot` | [components/client-snapshot.md](components/client-snapshot.md) | ✅ ⚠️ |
| لقطة المرشح `CandidateSnapshot` | [components/candidate-snapshot.md](components/candidate-snapshot.md) | 🟡 |
| لقطة العقد `ContractSnapshot` | [components/contract-snapshot.md](components/contract-snapshot.md) | 🟡 ⚠️ |
| لقطة الجهاز `DeviceSnapshot` | [components/device-snapshot.md](components/device-snapshot.md) | 🟡 ⚠️ |
| صفحة تفاصيل المهمة | [components/task-detail-page.md](components/task-detail-page.md) | 🟡 ⚠️ |

> ⚠️ ثلاث لقطات (الزبون، العقد، الجهاز) ما زالت موسومة «Draft — بانتظار موافقة Product Owner» رغم أن الكود يستهلكها فعلاً.

---

## 6. ورشة العقود (`contracts/`)

تفكيك العقود إلى وحدات: تعريف الجهاز، تعريف العقد، الالتزامات المالية، الكفالات، الإلغاء. ترتيب القراءة وتصنيف الملفات في [contracts/README.md](contracts/README.md)، والقرارات المحسومة (DEC-CT-XX) في [contracts/08-resolved-decisions.md](contracts/08-resolved-decisions.md).

---

## 7. القرارات المعمارية (`decisions/`)

> الحالة منقولة كما هي من سطر «الحالة» في كل قرار. القرار الجديد يُضاف كملف مستقل بهذا المجلد ويُسجَّل هنا.

| القرار | التاريخ | الموضوع | الحالة (من الملف) |
|---|---|---|---|
| [DEC-001](decisions/DEC-001-multi-branch-client-service.md) | 2026-05-27 | تعدد الفروع في خدمة الزبائن | ⏳ قيد المراجعة |
| [DEC-002](decisions/DEC-002-contract-ownership-from-task.md) | 2026-05-27 | ملكية البيعة وربط العقد بالمهمة | مقرر — ينتظر التنفيذ |
| [DEC-003](decisions/DEC-003-visit-task-unification.md) | 2026-05-31 | توحيد الزيارة والموعد، وفصل الوعد عن التنفيذ | ✅ معتمد |
| [DEC-004](decisions/DEC-004-visit-task-lifecycle-refinement.md) | 2026-05-31 | تنقيح دورة حياة الزيارة والمهام | ✅ معتمد |
| [DEC-005](decisions/DEC-005-contact-targets-filter.md) | 2026-05-31 | توحيد فلتر جهات الاتصال ودورة حياتها | معتمد |
| [DEC-006](decisions/DEC-006-pending-resolutions-round1.md) | 2026-05-31 | حسم النقاط المعلقة من DEC-003/004/005 (الجولة الأولى) | معتمد |
| [DEC-007](decisions/DEC-007-visit-structure-list-and-survey.md) | 2026-05-31 | هيكلة الزيارة: لائحة الأسماء والاستبيان | معتمد |
| [DEC-008](decisions/DEC-008-zone-study-stage.md) | 2026-06-12 | مرحلة دراسة النطاقات | معتمد |
| [DEC-009](decisions/DEC-009-eligible-task-and-contact-lifecycle.md) | 2026-06-14 | «المهمة المؤهلة» ودورة حياة جهة الاتصال | ✅ معتمد (عُدّل عبر DEC-015) |
| [DEC-010](decisions/DEC-010-visit-task-pull.md) | 2026-06-22 | سحب مهام الزبون داخل الزيارة الجارية | ✅ معتمد |
| [DEC-011](decisions/DEC-011-field-initiated-visit.md) | 2026-06-23 | الزيارة الميدانية الفورية | ✅ معتمد |
| [DEC-012](decisions/DEC-012-catalog-active-state.md) | 2026-07-02 | حالة فعالية كتالوج الأجهزة وقطع الغيار | مسودة معتمدة للتنفيذ |
| [DEC-013](decisions/DEC-013-account-creation-and-app-auth.md) | 2026-07-17 | إنشاء الحساب ومصادقة تطبيق الزبائن | مسودة معتمدة للتنفيذ |
| [DEC-014](decisions/DEC-014-contract-tradein-statistics.md) | 2026-07-30 | الاستبدال في العقد تصنيف إحصائي فقط | معتمد |
| [DEC-015](decisions/DEC-015-layered-planning-curation.md) | 2026-07-30 | التنقية ذات الطبقات لجهات اتصال التخطيط | ✅ معتمد للتنفيذ |
| [DEC-016](decisions/DEC-016-water-check-unverified-intake.md) | 2026-08-03 | استقبال فحص المياه بلا تحقق من الرقم | ✅ معتمد — منفَّذ بالكود، غير مطبّق على بيئة |
| [DEC-017](decisions/DEC-017-app-devices-and-visits.md) | 2026-08-13 | «أجهزتي» و«زياراتي» في تطبيق الزبائن | ✅ معتمد |
| [DEC-018](decisions/DEC-018-independent-complaints-domain.md) | 2026-08-17 | دومين الشكاوى المستقل | معتمد ومنفذ برمجياً — غير منشور |
| [DEC-019](decisions/DEC-019-app-notifications.md) | 2026-08-17 | إشعارات تطبيق العميل | 🟢 معتمد ومنفذ بالكامل |


---

## 8. المعايير الملزمة (`standards/`)

| المعيار | الملف | الحالة |
|---|---|---|
| عملية التغيير الهندسي | [standards/engineering-change-process.md](standards/engineering-change-process.md) | — |
| دليل العمل مع الدستور | [standards/constitution-workflow.md](standards/constitution-workflow.md) | ⚠️ (جدول «السياق الحالي» فيه قديم) |
| معيار هندسة الصلاحيات والنطاق | [standards/permissions-engineering-standard.md](standards/permissions-engineering-standard.md) | 🟡 ملزم |
| معيار نطاق الفرع والعرض | [standards/branch-scope-and-visibility-standard.md](standards/branch-scope-and-visibility-standard.md) | 🟡 |
| بروتوكول تدقيق أقسام السجلات | [standards/section-audit-protocol.md](standards/section-audit-protocol.md) | ✅ ملزم |
| أنماط الجدولة الزمنية للمهام | [standards/task-scheduling-patterns.md](standards/task-scheduling-patterns.md) | ✅ |
| سياسة أجهزة الدخول لنظام الويب | [standards/web-device-access-policy.md](standards/web-device-access-policy.md) | ✅ |

---

## 9. المتابعة (`trackers/`)

| المتعقّب | الملف |
|---|---|
| الثغرات المفتوحة بكل الكيانات | [trackers/GAPS-TRACKER.md](trackers/GAPS-TRACKER.md) |
| المرجع المتقاطع (حقول مشتركة وعلاقات) ⚠️ | [trackers/CROSS-REFERENCE.md](trackers/CROSS-REFERENCE.md) |
| الديون التقنية | [trackers/tech-debt.md](trackers/tech-debt.md) |
| أعمال معلّقة غير مجدولة | [trackers/pending-work.md](trackers/pending-work.md) |
| باك لوج ورشة العقود | [trackers/contracts-task-backlog.md](trackers/contracts-task-backlog.md) |
| أسئلة وثغرات ورشة العقود | [trackers/contracts-gaps-and-questions.md](trackers/contracts-gaps-and-questions.md) |
| خطة نشطة: تنقية جهات اتصال التخطيط | [trackers/2026-07-30-layered-planning-curation-plan.md](trackers/2026-07-30-layered-planning-curation-plan.md) |
| خطة نشطة: تنفيذ الشكاوى V1 | [trackers/2026-08-17-complaints-v1-implementation-plan.md](trackers/2026-08-17-complaints-v1-implementation-plan.md) |

---

## 10. القوالب (`templates/`)

دليل اختيار القالب المناسب لكل نوع وثيقة: [templates/README.md](templates/README.md).

---

## أين ألاقي...؟

| بدّك تفهم... | روح ع... |
|---|---|
| حقول الزبون وقيودها | [domains/clients.md §2](domains/clients.md#2-الجدول-والحقول-table--field-dictionary) |
| صلاحيات الزبون ونطاقاتها | [domains/clients.md §6](domains/clients.md#6-صلاحيات-الوصول-permission-matrix) |
| عقد API للزبون | [domains/clients.md §7](domains/clients.md#7-عقد-api-api-contract) |
| حالات الاختبار | [domains/clients.md §8](domains/clients.md#8-حالات-الاختبار-الشاملة-test-cases) |
| كيف يشوف كل دور | [features/permissions-view-strategy.md](features/permissions-view-strategy.md) |
| القاعدة الملزمة لأي تعديل على الصلاحيات أو الفروع | [standards/permissions-engineering-standard.md](standards/permissions-engineering-standard.md) |
| كيف أوثّق كياناً جديداً | [templates/entity-constitution.md](templates/entity-constitution.md) |
| كيف أعرّف نوع مهمة جديد | [templates/unified-task-template.md](templates/unified-task-template.md) |

---

## خارج الدستور

| المجلد | المحتوى |
|---|---|
| [../engineering/api/](../engineering/api/) | مراجع API (بما فيها عقود تطبيق الموبايل) |
| [../engineering/runbooks/](../engineering/runbooks/) | أدلة النشر والتشغيل (PM2 للبرودكشن الحالي، Docker/Jenkins للسيرفرات الجديدة) |
| [../engineering/audits/](../engineering/audits/) | تدقيقات الأقسام ومصفوفات اختبار الصلاحيات |
| [../deliverables/](../deliverables/) | عروض ومخرجات سُلّمت للزبون |
| [../archive/](../archive/) | التاريخ: handoffs، خطط منتهية، prompts، وثائق متجاوزة |
