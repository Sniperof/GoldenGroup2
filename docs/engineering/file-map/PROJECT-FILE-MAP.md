# خريطة ملفات المشروع حسب الأقسام

> مولَّدة آلياً بتاريخ 2026-10-04 من `scripts/generate-file-map.mjs`. لا تعدّل هذا الملف يدوياً؛ أعد توليده بالأمر `node scripts/generate-file-map.mjs`.

هذه الوثيقة تحدد لكل قسم من أقسام النظام (كما تظهر في القائمة الجانبية) ملفات الواجهة (Frontend) وملفات الخادم (Backend) التي تخصه. الملفات التي يستخدمها أكثر من قسم مذكورة في قسم «مشترك بين عدة أقسام»، والبنية التي يعتمد عليها الجميع في «البنية الأساسية المشتركة».

النطاق: 890 ملفاً في `packages/web` و`packages/api` و`packages/shared` (منها 244 ملف اختبار). ملفات الـ migrations في `migrations/` خارج هذا التصنيف.

## طريقة التصنيف

| المرحلة | ماذا تفعل |
|---|---|
| قواعد صريحة | كل قسم له أنماط مجلدات وأسماء ملفات (مثلاً `pages/contracts/*` و`routes/contracts.ts` للعقود). أول قاعدة تنطبق هي المعتمدة |
| تتبّع الاستيراد | الملف الذي لا تنطبق عليه قاعدة يُنسب للأقسام التي تستورده فعلاً: قسم واحد فهو له، من 2 إلى 5 أقسام فهو مشترك، 6 فأكثر فهو من البنية الأساسية |
| الاختبارات | كل ملف اختبار يتبع قسم الملف الذي يختبره |

النتيجة: 879 ملفاً صُنّف بقاعدة صريحة، و11 بتتبّع الاستيراد.

## الملخص

| المجموعة في القائمة | القسم | ملفات الواجهة | ملفات الخادم | الحزمة المشتركة | اختبارات |
|---|---|---|---|---|---|
| الرئيسية | لوحة المتابعة | 12 | 2 | 0 | 3 |
| الرئيسية | تنبيهات المتابعة | 2 | 2 | 0 | 1 |
| المبيعات والزبائن | الزبائن | 20 | 11 | 0 | 18 |
| المبيعات والزبائن | الأسماء المقترحة وجلسات الترشيح | 9 | 8 | 0 | 14 |
| المبيعات والزبائن | الاتصالات والمواعيد | 12 | 7 | 1 | 10 |
| المبيعات والزبائن | عروض الأجهزة | 4 | 0 | 0 | 0 |
| المبيعات والزبائن | العقود | 5 | 17 | 0 | 11 |
| المبيعات والزبائن | تحصيل الذمم | 5 | 2 | 0 | 0 |
| المبيعات والزبائن | الشكاوى | 4 | 3 | 1 | 8 |
| المبيعات والزبائن | طلبات ترشيح الأسماء وترخيص الوكلاء | 4 | 5 | 0 | 6 |
| الخدمة الميدانية | طلبات الخدمة (عامة، فحص المياه، الأجهزة، الصيانة الدورية، الكفالة الذهبية) | 23 | 30 | 0 | 25 |
| الخدمة الميدانية | التخطيط والجدولة | 7 | 12 | 1 | 9 |
| الخدمة الميدانية | الزيارات الميدانية وزياراتي | 11 | 6 | 0 | 10 |
| الخدمة الميدانية | تسليم وتركيب وتشغيل وفك الأجهزة | 10 | 3 | 1 | 3 |
| الخدمة الميدانية | الصيانة والأعطال | 11 | 3 | 1 | 2 |
| الخدمة الميدانية | خدمات الكفالة | 7 | 2 | 0 | 1 |
| الخدمة الميدانية | محرك المهام المشترك ومهامي | 22 | 8 | 1 | 8 |
| الهدايا | الهدايا | 11 | 5 | 0 | 11 |
| الأجهزة والمخزون | الأجهزة وقطع الغيار والأجهزة المركّبة | 22 | 12 | 0 | 8 |
| الموارد البشرية | الموظفون والأقسام | 5 | 8 | 0 | 6 |
| الموارد البشرية | التوظيف (الشواغر، الطلبات، المقابلات، الدورات) | 16 | 18 | 0 | 5 |
| التقارير | التقارير | 3 | 38 | 0 | 34 |
| الإدارة والإعدادات | الفروع | 1 | 1 | 0 | 1 |
| الإدارة والإعدادات | المناطق الإدارية وخطوط السير | 4 | 7 | 0 | 3 |
| الإدارة والإعدادات | المستخدمون والأدوار والصلاحيات | 6 | 10 | 1 | 1 |
| الإدارة والإعدادات | طلبات إنشاء الحساب | 5 | 5 | 1 | 2 |
| الإدارة والإعدادات | القوائم المرجعية وأنواع المهام وإعدادات النظام | 7 | 7 | 0 | 3 |
| الإدارة والإعدادات | إدارة تطبيق الزبائن (البانرات، الإشعارات، الروابط) | 3 | 7 | 0 | 6 |
| خارج القائمة | واجهة تطبيق الزبائن (موبايل) — خادم فقط | 0 | 52 | 0 | 22 |
| خارج القائمة | تسجيل الدخول والجلسة | 2 | 5 | 0 | 0 |
| خارج القائمة | البنية الأساسية المشتركة | 51 | 28 | 4 | 12 |
| — | مشترك بين عدة أقسام | 6 | 0 | 0 | 1 |

## الرئيسية

### لوحة المتابعة

| | |
|---|---|
| مسارات الصفحات | `/` |
| مسارات الـ API | `/api/me` — أرقام الودجات نفسها تأتي من `/api/reports/<metric>` (خدمات المؤشرات في قسم التقارير) |
| عدد الملفات | واجهة 12، خادم 2، اختبارات 3 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/Dashboard.tsx](../../../packages/web/src/pages/Dashboard.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/breakdownLabels.ts](../../../packages/web/src/components/dashboard/breakdownLabels.ts) |
| مكوّن واجهة | [web/src/components/dashboard/BreakdownWidget.tsx](../../../packages/web/src/components/dashboard/BreakdownWidget.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/DashboardCustomizer.tsx](../../../packages/web/src/components/dashboard/DashboardCustomizer.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/DonutChart.tsx](../../../packages/web/src/components/dashboard/DonutChart.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/FunnelChart.tsx](../../../packages/web/src/components/dashboard/FunnelChart.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/KpiCard.tsx](../../../packages/web/src/components/dashboard/KpiCard.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/MetricWidget.tsx](../../../packages/web/src/components/dashboard/MetricWidget.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/RankedBarChart.tsx](../../../packages/web/src/components/dashboard/RankedBarChart.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/ScopeFilterBar.tsx](../../../packages/web/src/components/dashboard/ScopeFilterBar.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/TimelineChart.tsx](../../../packages/web/src/components/dashboard/TimelineChart.tsx) |
| مكوّن واجهة | [web/src/components/dashboard/widgetRegistry.ts](../../../packages/web/src/components/dashboard/widgetRegistry.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/dashboardLayout.ts](../../../packages/api/routes/dashboardLayout.ts) |
| خدمة/منطق عمل | [api/services/reporting/dashboardLayoutPolicy.ts](../../../packages/api/services/reporting/dashboardLayoutPolicy.ts) |

<details><summary>الاختبارات (3)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/dashboardLayout.contract.test.ts](../../../packages/api/routes/dashboardLayout.contract.test.ts) |
| اختبار | [api/services/reporting/dashboardLayoutPolicy.test.ts](../../../packages/api/services/reporting/dashboardLayoutPolicy.test.ts) |
| اختبار | [web/src/pages/Dashboard.personalization.contract.test.ts](../../../packages/web/src/pages/Dashboard.personalization.contract.test.ts) |

</details>

### تنبيهات المتابعة

| | |
|---|---|
| مسارات الصفحات | `/supervisor/alerts` |
| مسارات الـ API | `/api/open-tasks/attempt-alerts` و`/api/field-visits/escalation-alerts` (داخل مسارات المهام والزيارات) |
| عدد الملفات | واجهة 2، خادم 2، اختبارات 1 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/supervisor/SupervisorAlertsPage.tsx](../../../packages/web/src/pages/supervisor/SupervisorAlertsPage.tsx) |
| مكوّن واجهة | [web/src/components/supervisor/AttemptAlertsCard.tsx](../../../packages/web/src/components/supervisor/AttemptAlertsCard.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| سياسة صلاحيات | [api/policies/supervisorAlertPolicy.ts](../../../packages/api/policies/supervisorAlertPolicy.ts) |
| خدمة/منطق عمل | [api/services/visitEscalationJob.ts](../../../packages/api/services/visitEscalationJob.ts) |

<details><summary>الاختبارات (1)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/supervisorAlertPolicy.test.ts](../../../packages/api/policies/supervisorAlertPolicy.test.ts) |

</details>

## المبيعات والزبائن

### الزبائن

| | |
|---|---|
| مسارات الصفحات | `/clients`، `/clients/:id` |
| مسارات الـ API | `/api/clients`، `/api/customers` |
| عدد الملفات | واجهة 20، خادم 11، اختبارات 18 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/ClientProfile.tsx](../../../packages/web/src/pages/ClientProfile.tsx) |
| صفحة | [web/src/pages/clientProfile/AccountStatementTab.tsx](../../../packages/web/src/pages/clientProfile/AccountStatementTab.tsx) |
| صفحة | [web/src/pages/clientProfile/DevicesTab.tsx](../../../packages/web/src/pages/clientProfile/DevicesTab.tsx) |
| صفحة | [web/src/pages/clientProfile/PartsStockTab.tsx](../../../packages/web/src/pages/clientProfile/PartsStockTab.tsx) |
| صفحة | [web/src/pages/clientProfile/PreOffersTab.tsx](../../../packages/web/src/pages/clientProfile/PreOffersTab.tsx) |
| صفحة | [web/src/pages/clientProfile/PurchaseHistoryTab.tsx](../../../packages/web/src/pages/clientProfile/PurchaseHistoryTab.tsx) |
| صفحة | [web/src/pages/Clients.tsx](../../../packages/web/src/pages/Clients.tsx) |
| مكوّن واجهة | [web/src/components/AssignAgentModal.tsx](../../../packages/web/src/components/AssignAgentModal.tsx) |
| مكوّن واجهة | [web/src/components/ClientAvatar.tsx](../../../packages/web/src/components/ClientAvatar.tsx) |
| مكوّن واجهة | [web/src/components/ClientCardPopup.tsx](../../../packages/web/src/components/ClientCardPopup.tsx) |
| مكوّن واجهة | [web/src/components/ClientModal.tsx](../../../packages/web/src/components/ClientModal.tsx) |
| مكوّن واجهة | [web/src/components/clients/ContactControlCard.tsx](../../../packages/web/src/components/clients/ContactControlCard.tsx) |
| مكوّن واجهة | [web/src/components/clients/DeviceOfferModal.tsx](../../../packages/web/src/components/clients/DeviceOfferModal.tsx) |
| مكوّن واجهة | [web/src/components/clients/StandaloneDeviceOffersModal.tsx](../../../packages/web/src/components/clients/StandaloneDeviceOffersModal.tsx) |
| مكوّن واجهة | [web/src/components/ClientSnapshot.tsx](../../../packages/web/src/components/ClientSnapshot.tsx) |
| مكوّن واجهة | [web/src/components/customers/CustomerCallLog.tsx](../../../packages/web/src/components/customers/CustomerCallLog.tsx) |
| مكوّن واجهة | [web/src/components/customers/MessageReplyOutcomeModal.tsx](../../../packages/web/src/components/customers/MessageReplyOutcomeModal.tsx) |
| مكوّن واجهة | [web/src/components/customers/PhoneCallLog.tsx](../../../packages/web/src/components/customers/PhoneCallLog.tsx) |
| مكوّن واجهة | [web/src/components/preOffers/OutcomeChip.tsx](../../../packages/web/src/components/preOffers/OutcomeChip.tsx) |
| حالة (store/hook) | [web/src/hooks/useClientStore.ts](../../../packages/web/src/hooks/useClientStore.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/clients.ts](../../../packages/api/routes/clients.ts) |
| مسار API | [api/routes/customerCalls.ts](../../../packages/api/routes/customerCalls.ts) |
| مسار API | [api/routes/customerPreOffers.ts](../../../packages/api/routes/customerPreOffers.ts) |
| سياسة صلاحيات | [api/policies/clientPolicy.ts](../../../packages/api/policies/clientPolicy.ts) |
| خدمة/منطق عمل | [api/services/clientLifecycleService.ts](../../../packages/api/services/clientLifecycleService.ts) |
| خدمة/منطق عمل | [api/services/clientReadModel.ts](../../../packages/api/services/clientReadModel.ts) |
| خدمة/منطق عمل | [api/services/customerIdentity/identitySnapshot.ts](../../../packages/api/services/customerIdentity/identitySnapshot.ts) |
| خدمة/منطق عمل | [api/services/customerOwnership.ts](../../../packages/api/services/customerOwnership.ts) |
| خدمة/منطق عمل | [api/services/financialMovements.ts](../../../packages/api/services/financialMovements.ts) |
| بنية/مساعد | [api/lib/clientClassification.ts](../../../packages/api/lib/clientClassification.ts) |
| بنية/مساعد | [api/lib/clientSnapshot.ts](../../../packages/api/lib/clientSnapshot.ts) |

<details><summary>الاختبارات (18)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/lib/clientClassification.test.ts](../../../packages/api/lib/clientClassification.test.ts) |
| اختبار | [api/routes/clientAssignmentIntegrity.contract.test.ts](../../../packages/api/routes/clientAssignmentIntegrity.contract.test.ts) |
| اختبار | [api/routes/clientCandidateReferralDate.contract.test.ts](../../../packages/api/routes/clientCandidateReferralDate.contract.test.ts) |
| اختبار | [api/routes/clientNetworkMediatorLink.contract.test.ts](../../../packages/api/routes/clientNetworkMediatorLink.contract.test.ts) |
| اختبار | [api/routes/clientsAssignedPaginationPerformance.test.ts](../../../packages/api/routes/clientsAssignedPaginationPerformance.test.ts) |
| اختبار | [api/routes/customerCalls.test.ts](../../../packages/api/routes/customerCalls.test.ts) |
| اختبار | [api/routes/customerPreOffersAuthorization.test.ts](../../../packages/api/routes/customerPreOffersAuthorization.test.ts) |
| اختبار | [api/services/clientDeletionPolicy.test.ts](../../../packages/api/services/clientDeletionPolicy.test.ts) |
| اختبار | [api/services/customerIdentity/identitySnapshot.test.ts](../../../packages/api/services/customerIdentity/identitySnapshot.test.ts) |
| اختبار | [api/services/financialMovementsHistoricalBackfill.test.ts](../../../packages/api/services/financialMovementsHistoricalBackfill.test.ts) |
| اختبار | [web/src/components/ClientModal.assignmentNetwork.contract.test.ts](../../../packages/web/src/components/ClientModal.assignmentNetwork.contract.test.ts) |
| اختبار | [web/src/components/ClientModal.candidateAddress.contract.test.ts](../../../packages/web/src/components/ClientModal.candidateAddress.contract.test.ts) |
| اختبار | [web/src/components/clients/DeviceOfferLookupLoadingPolicy.test.ts](../../../packages/web/src/components/clients/DeviceOfferLookupLoadingPolicy.test.ts) |
| اختبار | [web/src/pages/ClientProfile.networkError.contract.test.ts](../../../packages/web/src/pages/ClientProfile.networkError.contract.test.ts) |
| اختبار | [web/src/pages/Clients.addressFallback.contract.test.ts](../../../packages/web/src/pages/Clients.addressFallback.contract.test.ts) |
| اختبار | [web/src/pages/ClientsBulkActivationPolicy.test.ts](../../../packages/web/src/pages/ClientsBulkActivationPolicy.test.ts) |
| اختبار | [web/src/pages/ClientsDeletePolicy.test.ts](../../../packages/web/src/pages/ClientsDeletePolicy.test.ts) |
| اختبار | [web/src/pages/ClientsFilterLoadingPolicy.test.ts](../../../packages/web/src/pages/ClientsFilterLoadingPolicy.test.ts) |

</details>

### الأسماء المقترحة وجلسات الترشيح

| | |
|---|---|
| مسارات الصفحات | `/candidates`، `/candidates/:id` |
| مسارات الـ API | `/api/candidates`، `/api/referral-sheets` |
| عدد الملفات | واجهة 9، خادم 8، اختبارات 14 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/candidates/CandidateDetail.tsx](../../../packages/web/src/pages/candidates/CandidateDetail.tsx) |
| صفحة | [web/src/pages/candidates/CandidatesEntry.tsx](../../../packages/web/src/pages/candidates/CandidatesEntry.tsx) |
| مكوّن واجهة | [web/src/components/candidates/AddCandidateModal.tsx](../../../packages/web/src/components/candidates/AddCandidateModal.tsx) |
| مكوّن واجهة | [web/src/components/candidates/CreateReferralSessionModal.tsx](../../../packages/web/src/components/candidates/CreateReferralSessionModal.tsx) |
| مكوّن واجهة | [web/src/components/candidates/ImportCSVModal.tsx](../../../packages/web/src/components/candidates/ImportCSVModal.tsx) |
| مكوّن واجهة | [web/src/components/candidates/ManualSearchModal.tsx](../../../packages/web/src/components/candidates/ManualSearchModal.tsx) |
| مكوّن واجهة | [web/src/components/candidates/QualificationModal.tsx](../../../packages/web/src/components/candidates/QualificationModal.tsx) |
| مكوّن واجهة | [web/src/components/candidates/SessionDetailsModal.tsx](../../../packages/web/src/components/candidates/SessionDetailsModal.tsx) |
| حالة (store/hook) | [web/src/hooks/useCandidateStore.ts](../../../packages/web/src/hooks/useCandidateStore.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/candidates.ts](../../../packages/api/routes/candidates.ts) |
| مسار API | [api/routes/referralSheets.ts](../../../packages/api/routes/referralSheets.ts) |
| سياسة صلاحيات | [api/policies/candidatePolicy.ts](../../../packages/api/policies/candidatePolicy.ts) |
| سياسة صلاحيات | [api/policies/referralSheetPolicy.ts](../../../packages/api/policies/referralSheetPolicy.ts) |
| خدمة/منطق عمل | [api/services/candidateDuplicateDetection.ts](../../../packages/api/services/candidateDuplicateDetection.ts) |
| خدمة/منطق عمل | [api/services/candidateOwnershipService.ts](../../../packages/api/services/candidateOwnershipService.ts) |
| خدمة/منطق عمل | [api/services/candidateReferrer.ts](../../../packages/api/services/candidateReferrer.ts) |
| خدمة/منطق عمل | [api/services/referralSheetStats.ts](../../../packages/api/services/referralSheetStats.ts) |

<details><summary>الاختبارات (14)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/candidatePolicy.test.ts](../../../packages/api/policies/candidatePolicy.test.ts) |
| اختبار | [api/routes/candidateDetailContract.test.ts](../../../packages/api/routes/candidateDetailContract.test.ts) |
| اختبار | [api/routes/candidateRestrictedLeadLink.contract.test.ts](../../../packages/api/routes/candidateRestrictedLeadLink.contract.test.ts) |
| اختبار | [api/routes/candidatesPagedContract.test.ts](../../../packages/api/routes/candidatesPagedContract.test.ts) |
| اختبار | [api/routes/giftCandidateFilterContract.test.ts](../../../packages/api/routes/giftCandidateFilterContract.test.ts) |
| اختبار | [api/services/candidateDuplicateDetection.test.ts](../../../packages/api/services/candidateDuplicateDetection.test.ts) |
| اختبار | [api/services/candidateOwnershipService.test.ts](../../../packages/api/services/candidateOwnershipService.test.ts) |
| اختبار | [api/services/candidateReferrer.test.ts](../../../packages/api/services/candidateReferrer.test.ts) |
| اختبار | [web/src/components/candidates/AddCandidateModal.contract.test.ts](../../../packages/web/src/components/candidates/AddCandidateModal.contract.test.ts) |
| اختبار | [web/src/components/candidates/AddCandidateModal.saveGuard.contract.test.ts](../../../packages/web/src/components/candidates/AddCandidateModal.saveGuard.contract.test.ts) |
| اختبار | [web/src/components/candidates/QualificationRestrictedLead.contract.test.ts](../../../packages/web/src/components/candidates/QualificationRestrictedLead.contract.test.ts) |
| اختبار | [web/src/components/candidates/SessionDetailsModal.contract.test.ts](../../../packages/web/src/components/candidates/SessionDetailsModal.contract.test.ts) |
| اختبار | [web/src/hooks/useCandidateStore.contract.test.ts](../../../packages/web/src/hooks/useCandidateStore.contract.test.ts) |
| اختبار | [web/src/pages/candidates/CandidateDetail.contract.test.ts](../../../packages/web/src/pages/candidates/CandidateDetail.contract.test.ts) |

</details>

### الاتصالات والمواعيد

| | |
|---|---|
| مسارات الصفحات | `/telemarketer` |
| مسارات الـ API | `/api/contact-targets`، `/api/telemarketing` |
| عدد الملفات | واجهة 12، خادم 7، مشتركة 1، اختبارات 10 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/TelemarketerWorkspace.tsx](../../../packages/web/src/pages/TelemarketerWorkspace.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/AppointmentSchedulerModal.tsx](../../../packages/web/src/components/telemarketing/AppointmentSchedulerModal.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/AppointmentsWorkspacePanel.tsx](../../../packages/web/src/components/telemarketing/AppointmentsWorkspacePanel.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/CustomerQueueCard.tsx](../../../packages/web/src/components/telemarketing/CustomerQueueCard.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/CustomerQueueFilters.tsx](../../../packages/web/src/components/telemarketing/CustomerQueueFilters.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/OutcomeRecorderModal.tsx](../../../packages/web/src/components/telemarketing/OutcomeRecorderModal.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/outcomeSaveError.ts](../../../packages/web/src/components/telemarketing/outcomeSaveError.ts) |
| مكوّن واجهة | [web/src/components/telemarketing/TeamAgendaPanel.tsx](../../../packages/web/src/components/telemarketing/TeamAgendaPanel.tsx) |
| مكوّن واجهة | [web/src/components/telemarketing/VisitTimePicker.tsx](../../../packages/web/src/components/telemarketing/VisitTimePicker.tsx) |
| حالة (store/hook) | [web/src/hooks/useTelemarketingStore.ts](../../../packages/web/src/hooks/useTelemarketingStore.ts) |
| مساعد/إعداد | [web/src/lib/contactUtils.ts](../../../packages/web/src/lib/contactUtils.ts) |
| مساعد/إعداد | [web/src/utils/addressUtils.ts](../../../packages/web/src/utils/addressUtils.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/contactTargets.ts](../../../packages/api/routes/contactTargets.ts) |
| مسار API | [api/routes/telemarketing.ts](../../../packages/api/routes/telemarketing.ts) |
| سياسة صلاحيات | [api/policies/telemarketingServiceTaskPolicy.ts](../../../packages/api/policies/telemarketingServiceTaskPolicy.ts) |
| خدمة/منطق عمل | [api/services/contactTargetLocks.ts](../../../packages/api/services/contactTargetLocks.ts) |
| خدمة/منطق عمل | [api/services/contactTargetsCleanupJob.ts](../../../packages/api/services/contactTargetsCleanupJob.ts) |
| خدمة/منطق عمل | [api/services/telemarketingAppointmentSnapshot.ts](../../../packages/api/services/telemarketingAppointmentSnapshot.ts) |
| خدمة/منطق عمل | [api/services/telemarketingScope.ts](../../../packages/api/services/telemarketingScope.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/telemarketingOutcomes.ts](../../../packages/shared/telemarketingOutcomes.ts) |

<details><summary>الاختبارات (10)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/telemarketingServiceTaskPolicy.test.ts](../../../packages/api/policies/telemarketingServiceTaskPolicy.test.ts) |
| اختبار | [api/routes/telemarketingClientDetails.contract.test.ts](../../../packages/api/routes/telemarketingClientDetails.contract.test.ts) |
| اختبار | [api/routes/telemarketingPermissionSplit.contract.test.ts](../../../packages/api/routes/telemarketingPermissionSplit.contract.test.ts) |
| اختبار | [api/services/contactTargetLocks.test.ts](../../../packages/api/services/contactTargetLocks.test.ts) |
| اختبار | [api/services/telemarketingAppointmentSnapshot.test.ts](../../../packages/api/services/telemarketingAppointmentSnapshot.test.ts) |
| اختبار | [api/services/telemarketingMembershipScope.contract.test.ts](../../../packages/api/services/telemarketingMembershipScope.contract.test.ts) |
| اختبار | [api/services/telemarketingTeamAgenda.test.ts](../../../packages/api/services/telemarketingTeamAgenda.test.ts) |
| اختبار | [web/src/components/telemarketing/OutcomeRecorderModal.test.ts](../../../packages/web/src/components/telemarketing/OutcomeRecorderModal.test.ts) |
| اختبار | [web/src/components/telemarketing/TeamAgendaPanel.test.ts](../../../packages/web/src/components/telemarketing/TeamAgendaPanel.test.ts) |
| اختبار | [web/src/components/telemarketing/VisitTimePicker.test.ts](../../../packages/web/src/components/telemarketing/VisitTimePicker.test.ts) |

</details>

### عروض الأجهزة

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/device-demo` |
| مسارات الـ API | `/api/open-tasks/device-demo` وبقية عمليات المهمة عبر `/api/open-tasks` (محرك المهام المشترك) |
| عدد الملفات | واجهة 4، خادم 0، اختبارات 0 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/tasks/DeviceDemoDetail.tsx](../../../packages/web/src/pages/tasks/DeviceDemoDetail.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_demo/DeviceDemoOfferTab.tsx](../../../packages/web/src/taskTypes/device_demo/DeviceDemoOfferTab.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_demo/DeviceDemoResultModal.tsx](../../../packages/web/src/taskTypes/device_demo/DeviceDemoResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_demo/DeviceDemoResultRenderer.tsx](../../../packages/web/src/taskTypes/device_demo/DeviceDemoResultRenderer.tsx) |

### العقود

| | |
|---|---|
| مسارات الصفحات | `/contracts`، `/contracts/new`، `/contracts/:id` |
| مسارات الـ API | `/api/contracts`، `/api/service-agreements` |
| عدد الملفات | واجهة 5، خادم 17، اختبارات 11 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/contracts/ContractDetail.tsx](../../../packages/web/src/pages/contracts/ContractDetail.tsx) |
| صفحة | [web/src/pages/contracts/ContractForm.tsx](../../../packages/web/src/pages/contracts/ContractForm.tsx) |
| صفحة | [web/src/pages/contracts/ContractList.tsx](../../../packages/web/src/pages/contracts/ContractList.tsx) |
| مكوّن واجهة | [web/src/components/devices/ServiceAgreementForm.tsx](../../../packages/web/src/components/devices/ServiceAgreementForm.tsx) |
| حالة (store/hook) | [web/src/hooks/useContractPrintable.ts](../../../packages/web/src/hooks/useContractPrintable.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/contractDocuments.ts](../../../packages/api/routes/contractDocuments.ts) |
| مسار API | [api/routes/contracts.ts](../../../packages/api/routes/contracts.ts) |
| مسار API | [api/routes/serviceAgreements.ts](../../../packages/api/routes/serviceAgreements.ts) |
| سياسة صلاحيات | [api/policies/contractCreationPolicy.ts](../../../packages/api/policies/contractCreationPolicy.ts) |
| سياسة صلاحيات | [api/policies/contractDocumentPolicy.ts](../../../packages/api/policies/contractDocumentPolicy.ts) |
| سياسة صلاحيات | [api/policies/contractPolicy.ts](../../../packages/api/policies/contractPolicy.ts) |
| خدمة/منطق عمل | [api/services/contractCreationContextService.ts](../../../packages/api/services/contractCreationContextService.ts) |
| خدمة/منطق عمل | [api/services/contractCustomerLookupService.ts](../../../packages/api/services/contractCustomerLookupService.ts) |
| خدمة/منطق عمل | [api/services/contractLifecycle.ts](../../../packages/api/services/contractLifecycle.ts) |
| خدمة/منطق عمل | [api/services/contractRenderer.ts](../../../packages/api/services/contractRenderer.ts) |
| خدمة/منطق عمل | [api/services/contractTradein.ts](../../../packages/api/services/contractTradein.ts) |
| قالب | [api/templates/contracts/sale_definitive.v1.html](../../../packages/api/templates/contracts/sale_definitive.v1.html) |
| قالب | [api/templates/contracts/sale_definitive.v2.html](../../../packages/api/templates/contracts/sale_definitive.v2.html) |
| قالب | [api/templates/contracts/sale_free.v1.html](../../../packages/api/templates/contracts/sale_free.v1.html) |
| قالب | [api/templates/contracts/sale_settlement_amendment.v1.html](../../../packages/api/templates/contracts/sale_settlement_amendment.v1.html) |
| قالب | [api/templates/contracts/sale_temporary.v1.html](../../../packages/api/templates/contracts/sale_temporary.v1.html) |
| بنية/مساعد | [api/lib/contractWarrantyPolicy.ts](../../../packages/api/lib/contractWarrantyPolicy.ts) |

<details><summary>الاختبارات (11)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/contractCreationPolicy.test.ts](../../../packages/api/policies/contractCreationPolicy.test.ts) |
| اختبار | [api/policies/contractDocumentPolicy.test.ts](../../../packages/api/policies/contractDocumentPolicy.test.ts) |
| اختبار | [api/policies/contractPolicy.test.ts](../../../packages/api/policies/contractPolicy.test.ts) |
| اختبار | [api/routes/contractCustomerLookupRoute.test.ts](../../../packages/api/routes/contractCustomerLookupRoute.test.ts) |
| اختبار | [api/services/contractActivationTriggerOrderMigration.test.ts](../../../packages/api/services/contractActivationTriggerOrderMigration.test.ts) |
| اختبار | [api/services/contractCompletionMigration.test.ts](../../../packages/api/services/contractCompletionMigration.test.ts) |
| اختبار | [api/services/contractCreationContextService.test.ts](../../../packages/api/services/contractCreationContextService.test.ts) |
| اختبار | [api/services/contractCustomerLookupService.test.ts](../../../packages/api/services/contractCustomerLookupService.test.ts) |
| اختبار | [api/services/contractLifecycle.test.ts](../../../packages/api/services/contractLifecycle.test.ts) |
| اختبار | [api/services/contractTradein.test.ts](../../../packages/api/services/contractTradein.test.ts) |
| اختبار | [web/src/pages/contracts/ContractVisitCreationFlow.test.ts](../../../packages/web/src/pages/contracts/ContractVisitCreationFlow.test.ts) |

</details>

### تحصيل الذمم

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/collection`، `/tasks/dues` |
| مسارات الـ API | `/api/dues` |
| عدد الملفات | واجهة 5، خادم 2، اختبارات 0 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/tasks/CollectionTaskDetail.tsx](../../../packages/web/src/pages/tasks/CollectionTaskDetail.tsx) |
| صفحة | [web/src/pages/tasks/Dues.tsx](../../../packages/web/src/pages/tasks/Dues.tsx) |
| مكوّن واجهة | [web/src/components/CollectionModal.tsx](../../../packages/web/src/components/CollectionModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/installment_collection/InstallmentCollectionResultModal.tsx](../../../packages/web/src/taskTypes/installment_collection/InstallmentCollectionResultModal.tsx) |
| حالة (store/hook) | [web/src/hooks/useCollectionStore.ts](../../../packages/web/src/hooks/useCollectionStore.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/dues.ts](../../../packages/api/routes/dues.ts) |
| خدمة/منطق عمل | [api/services/installmentCollectionTasks.ts](../../../packages/api/services/installmentCollectionTasks.ts) |

### الشكاوى

| | |
|---|---|
| مسارات الصفحات | `/complaints`، `/complaints/new`، `/complaints/:id` |
| مسارات الـ API | `/api/complaints` |
| عدد الملفات | واجهة 4، خادم 3، مشتركة 1، اختبارات 8 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/complaints/ComplaintDetailPage.tsx](../../../packages/web/src/pages/complaints/ComplaintDetailPage.tsx) |
| صفحة | [web/src/pages/complaints/complaintsApi.ts](../../../packages/web/src/pages/complaints/complaintsApi.ts) |
| صفحة | [web/src/pages/complaints/ComplaintsListPage.tsx](../../../packages/web/src/pages/complaints/ComplaintsListPage.tsx) |
| صفحة | [web/src/pages/complaints/NewComplaintPage.tsx](../../../packages/web/src/pages/complaints/NewComplaintPage.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/complaints.ts](../../../packages/api/routes/complaints.ts) |
| سياسة صلاحيات | [api/policies/complaintPolicy.ts](../../../packages/api/policies/complaintPolicy.ts) |
| خدمة/منطق عمل | [api/services/complaints/complaintService.ts](../../../packages/api/services/complaints/complaintService.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/complaints.ts](../../../packages/shared/complaints.ts) |

<details><summary>الاختبارات (8)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/complaintPolicy.test.ts](../../../packages/api/policies/complaintPolicy.test.ts) |
| اختبار | [api/services/complaints/complaintCreateLookupPolicy.test.ts](../../../packages/api/services/complaints/complaintCreateLookupPolicy.test.ts) |
| اختبار | [api/services/complaints/complaintEntryPointContract.test.ts](../../../packages/api/services/complaints/complaintEntryPointContract.test.ts) |
| اختبار | [api/services/complaints/complaintRequesterContact.test.ts](../../../packages/api/services/complaints/complaintRequesterContact.test.ts) |
| اختبار | [api/services/complaints/complaintTransitionSql.test.ts](../../../packages/api/services/complaints/complaintTransitionSql.test.ts) |
| اختبار | [api/services/complaints/complaintWorkflowGuards.test.ts](../../../packages/api/services/complaints/complaintWorkflowGuards.test.ts) |
| اختبار | [api/services/complaints/mobileComplaintSubjectContext.test.ts](../../../packages/api/services/complaints/mobileComplaintSubjectContext.test.ts) |
| اختبار | [shared/complaints.test.ts](../../../packages/shared/complaints.test.ts) |

</details>

### طلبات ترشيح الأسماء وترخيص الوكلاء

| | |
|---|---|
| مسارات الصفحات | `/service-requests/name-nomination`، `/service-requests/agent-license` |
| مسارات الـ API | `/api/service-requests` (نفس مسار طلبات الخدمة، بنوعي الطلب `name_nomination` و`agent_license`) |
| عدد الملفات | واجهة 4، خادم 5، اختبارات 6 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/service-requests/AgentLicenseRequestsPage.tsx](../../../packages/web/src/pages/service-requests/AgentLicenseRequestsPage.tsx) |
| صفحة | [web/src/pages/service-requests/NameNominationRequestsPage.tsx](../../../packages/web/src/pages/service-requests/NameNominationRequestsPage.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/AgentLicensePanel.tsx](../../../packages/web/src/components/service-requests/AgentLicensePanel.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/NameNominationPanel.tsx](../../../packages/web/src/components/service-requests/NameNominationPanel.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| سياسة صلاحيات | [api/policies/agentLicensePolicy.ts](../../../packages/api/policies/agentLicensePolicy.ts) |
| سياسة صلاحيات | [api/policies/nameNominationPolicy.ts](../../../packages/api/policies/nameNominationPolicy.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/agentLicenseFormSchema.ts](../../../packages/api/services/serviceRequests/agentLicenseFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/nameNominationFormSchema.ts](../../../packages/api/services/serviceRequests/nameNominationFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/nameNominationHandoffService.ts](../../../packages/api/services/serviceRequests/nameNominationHandoffService.ts) |

<details><summary>الاختبارات (6)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/agentLicensePolicy.test.ts](../../../packages/api/policies/agentLicensePolicy.test.ts) |
| اختبار | [api/policies/nameNominationPolicy.test.ts](../../../packages/api/policies/nameNominationPolicy.test.ts) |
| اختبار | [api/services/serviceRequests/agentLicenseContract.test.ts](../../../packages/api/services/serviceRequests/agentLicenseContract.test.ts) |
| اختبار | [api/services/serviceRequests/agentLicenseFormSchema.test.ts](../../../packages/api/services/serviceRequests/agentLicenseFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/nameNominationFormSchema.test.ts](../../../packages/api/services/serviceRequests/nameNominationFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/nameNominationV2Contract.test.ts](../../../packages/api/services/serviceRequests/nameNominationV2Contract.test.ts) |

</details>

## الخدمة الميدانية

### طلبات الخدمة (عامة، فحص المياه، الأجهزة، الصيانة الدورية، الكفالة الذهبية)

| | |
|---|---|
| مسارات الصفحات | `/service-requests`، `/service-requests/water-check`، `/service-requests/device-requests`، `/service-requests/periodic-maintenance`، `/service-requests/golden-warranty`، `/service-requests/:id` |
| مسارات الـ API | `/api/maintenance-requests`، `/api/service-requests` |
| عدد الملفات | واجهة 23، خادم 30، اختبارات 25 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/clientProfile/ServiceRequestsTab.tsx](../../../packages/web/src/pages/clientProfile/ServiceRequestsTab.tsx) |
| صفحة | [web/src/pages/service-requests/DeviceRequestsPage.tsx](../../../packages/web/src/pages/service-requests/DeviceRequestsPage.tsx) |
| صفحة | [web/src/pages/service-requests/GoldenWarrantyRequestsPage.tsx](../../../packages/web/src/pages/service-requests/GoldenWarrantyRequestsPage.tsx) |
| صفحة | [web/src/pages/service-requests/NewServiceRequestPage.tsx](../../../packages/web/src/pages/service-requests/NewServiceRequestPage.tsx) |
| صفحة | [web/src/pages/service-requests/PeriodicMaintenanceRequestsPage.tsx](../../../packages/web/src/pages/service-requests/PeriodicMaintenanceRequestsPage.tsx) |
| صفحة | [web/src/pages/service-requests/ServiceRequestDetailPage.tsx](../../../packages/web/src/pages/service-requests/ServiceRequestDetailPage.tsx) |
| صفحة | [web/src/pages/service-requests/ServiceRequestsListPage.tsx](../../../packages/web/src/pages/service-requests/ServiceRequestsListPage.tsx) |
| صفحة | [web/src/pages/service-requests/WaterCheckRequestsPage.tsx](../../../packages/web/src/pages/service-requests/WaterCheckRequestsPage.tsx) |
| صفحة | [web/src/pages/service-requests/WaterCheckSimulatorPage.tsx](../../../packages/web/src/pages/service-requests/WaterCheckSimulatorPage.tsx) |
| مكوّن واجهة | [web/src/components/requests/RequestDetailLayout.tsx](../../../packages/web/src/components/requests/RequestDetailLayout.tsx) |
| مكوّن واجهة | [web/src/components/requests/RequestsListView.tsx](../../../packages/web/src/components/requests/RequestsListView.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/AuditLogTimeline.tsx](../../../packages/web/src/components/service-requests/AuditLogTimeline.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/DeviceRequestPanel.tsx](../../../packages/web/src/components/service-requests/DeviceRequestPanel.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/MergeOrSplitModal.tsx](../../../packages/web/src/components/service-requests/MergeOrSplitModal.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/NewServiceRequestModal.tsx](../../../packages/web/src/components/service-requests/NewServiceRequestModal.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/ProblemsList.tsx](../../../packages/web/src/components/service-requests/ProblemsList.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/RequestActionConfirmModal.tsx](../../../packages/web/src/components/service-requests/RequestActionConfirmModal.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/RequestHandoffReadiness.tsx](../../../packages/web/src/components/service-requests/RequestHandoffReadiness.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/RequestOverviewSummary.tsx](../../../packages/web/src/components/service-requests/RequestOverviewSummary.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/SuggestedMatchesPanel.tsx](../../../packages/web/src/components/service-requests/SuggestedMatchesPanel.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/TerminalTransitionModal.tsx](../../../packages/web/src/components/service-requests/TerminalTransitionModal.tsx) |
| مكوّن واجهة | [web/src/components/service-requests/WaterCheckRequestDetailPanel.tsx](../../../packages/web/src/components/service-requests/WaterCheckRequestDetailPanel.tsx) |
| مساعد/إعداد | [web/src/lib/serviceRequestDisplay.ts](../../../packages/web/src/lib/serviceRequestDisplay.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/maintenanceRequests.ts](../../../packages/api/routes/maintenanceRequests.ts) |
| مسار API | [api/routes/serviceRequests.ts](../../../packages/api/routes/serviceRequests.ts) |
| سياسة صلاحيات | [api/policies/serviceRequestPartyLinkPolicy.ts](../../../packages/api/policies/serviceRequestPartyLinkPolicy.ts) |
| خدمة/منطق عمل | [api/services/periodicMaintenanceTasks.ts](../../../packages/api/services/periodicMaintenanceTasks.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/_shared.ts](../../../packages/api/services/serviceRequests/_shared.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/atomicClientLink.ts](../../../packages/api/services/serviceRequests/atomicClientLink.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/beneficiaryLinkService.ts](../../../packages/api/services/serviceRequests/beneficiaryLinkService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/branchResolutionService.ts](../../../packages/api/services/serviceRequests/branchResolutionService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/claimService.ts](../../../packages/api/services/serviceRequests/claimService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/createService.ts](../../../packages/api/services/serviceRequests/createService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/derivedOutcomeCalc.ts](../../../packages/api/services/serviceRequests/derivedOutcomeCalc.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/deviceRequestFormSchema.ts](../../../packages/api/services/serviceRequests/deviceRequestFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/deviceRequestHandoffService.ts](../../../packages/api/services/serviceRequests/deviceRequestHandoffService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/duplicateDetection.ts](../../../packages/api/services/serviceRequests/duplicateDetection.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/emergencyMaintenanceFormSchema.ts](../../../packages/api/services/serviceRequests/emergencyMaintenanceFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/fuzzyMatching.ts](../../../packages/api/services/serviceRequests/fuzzyMatching.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/goldenWarrantyFormSchema.ts](../../../packages/api/services/serviceRequests/goldenWarrantyFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/goldenWarrantyHandoffService.ts](../../../packages/api/services/serviceRequests/goldenWarrantyHandoffService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/internalDeviceRequestService.ts](../../../packages/api/services/serviceRequests/internalDeviceRequestService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/internalGoldenWarrantyRequest.ts](../../../packages/api/services/serviceRequests/internalGoldenWarrantyRequest.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/internalPeriodicMaintenanceRequest.ts](../../../packages/api/services/serviceRequests/internalPeriodicMaintenanceRequest.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/periodicMaintenanceFormSchema.ts](../../../packages/api/services/serviceRequests/periodicMaintenanceFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/periodicMaintenanceHandoffService.ts](../../../packages/api/services/serviceRequests/periodicMaintenanceHandoffService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/problemsService.ts](../../../packages/api/services/serviceRequests/problemsService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/promoteService.ts](../../../packages/api/services/serviceRequests/promoteService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/reopenService.ts](../../../packages/api/services/serviceRequests/reopenService.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/serviceRequestTypeRegistry.ts](../../../packages/api/services/serviceRequests/serviceRequestTypeRegistry.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/stateMachine.ts](../../../packages/api/services/serviceRequests/stateMachine.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/waterCheckFormSchema.ts](../../../packages/api/services/serviceRequests/waterCheckFormSchema.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/waterCheckHandoffService.ts](../../../packages/api/services/serviceRequests/waterCheckHandoffService.ts) |

<details><summary>الاختبارات (25)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/periodicMaintenanceRequestPolicy.test.ts](../../../packages/api/policies/periodicMaintenanceRequestPolicy.test.ts) |
| اختبار | [api/policies/serviceRequestPartyLinkPolicy.test.ts](../../../packages/api/policies/serviceRequestPartyLinkPolicy.test.ts) |
| اختبار | [api/services/periodicMaintenanceTasks.test.ts](../../../packages/api/services/periodicMaintenanceTasks.test.ts) |
| اختبار | [api/services/serviceRequests/atomicClientLink.test.ts](../../../packages/api/services/serviceRequests/atomicClientLink.test.ts) |
| اختبار | [api/services/serviceRequests/beneficiaryLinkService.test.ts](../../../packages/api/services/serviceRequests/beneficiaryLinkService.test.ts) |
| اختبار | [api/services/serviceRequests/branchResolutionService.test.ts](../../../packages/api/services/serviceRequests/branchResolutionService.test.ts) |
| اختبار | [api/services/serviceRequests/clientRequestHistory.contract.test.ts](../../../packages/api/services/serviceRequests/clientRequestHistory.contract.test.ts) |
| اختبار | [api/services/serviceRequests/createServiceBeneficiaryValidation.test.ts](../../../packages/api/services/serviceRequests/createServiceBeneficiaryValidation.test.ts) |
| اختبار | [api/services/serviceRequests/deviceRequestContract.test.ts](../../../packages/api/services/serviceRequests/deviceRequestContract.test.ts) |
| اختبار | [api/services/serviceRequests/deviceRequestFormSchema.test.ts](../../../packages/api/services/serviceRequests/deviceRequestFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/emergencyMaintenanceContract.test.ts](../../../packages/api/services/serviceRequests/emergencyMaintenanceContract.test.ts) |
| اختبار | [api/services/serviceRequests/emergencyMaintenanceFormSchema.test.ts](../../../packages/api/services/serviceRequests/emergencyMaintenanceFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/escalationLock.test.ts](../../../packages/api/services/serviceRequests/escalationLock.test.ts) |
| اختبار | [api/services/serviceRequests/goldenWarrantyContract.test.ts](../../../packages/api/services/serviceRequests/goldenWarrantyContract.test.ts) |
| اختبار | [api/services/serviceRequests/goldenWarrantyFormSchema.test.ts](../../../packages/api/services/serviceRequests/goldenWarrantyFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/internalPeriodicMaintenanceRequest.test.ts](../../../packages/api/services/serviceRequests/internalPeriodicMaintenanceRequest.test.ts) |
| اختبار | [api/services/serviceRequests/periodicMaintenanceContract.test.ts](../../../packages/api/services/serviceRequests/periodicMaintenanceContract.test.ts) |
| اختبار | [api/services/serviceRequests/periodicMaintenanceFormSchema.test.ts](../../../packages/api/services/serviceRequests/periodicMaintenanceFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/referralAttribution.contract.test.ts](../../../packages/api/services/serviceRequests/referralAttribution.contract.test.ts) |
| اختبار | [api/services/serviceRequests/registryVocabulary.test.ts](../../../packages/api/services/serviceRequests/registryVocabulary.test.ts) |
| اختبار | [api/services/serviceRequests/serviceRequestPartyDetailsContract.test.ts](../../../packages/api/services/serviceRequests/serviceRequestPartyDetailsContract.test.ts) |
| اختبار | [api/services/serviceRequests/serviceRequestTypeRegistryMigration.test.ts](../../../packages/api/services/serviceRequests/serviceRequestTypeRegistryMigration.test.ts) |
| اختبار | [api/services/serviceRequests/waterCheckFormSchema.test.ts](../../../packages/api/services/serviceRequests/waterCheckFormSchema.test.ts) |
| اختبار | [api/services/serviceRequests/waterCheckHandoffService.test.ts](../../../packages/api/services/serviceRequests/waterCheckHandoffService.test.ts) |
| اختبار | [web/src/lib/serviceRequestDisplay.test.ts](../../../packages/web/src/lib/serviceRequestDisplay.test.ts) |

</details>

### التخطيط والجدولة

| | |
|---|---|
| مسارات الصفحات | `/planning/overview`، `/planning/schedule`، `/planning/zone-study`، `/planning/assign` |
| مسارات الـ API | `/api/planning`، `/api/planning/zone-study`، `/api/route-assignments`، `/api/schedules`، `/api/work-scopes` |
| عدد الملفات | واجهة 7، خادم 12، مشتركة 1، اختبارات 9 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/planning/PlanningContactTargets.tsx](../../../packages/web/src/pages/planning/PlanningContactTargets.tsx) |
| صفحة | [web/src/pages/planning/PlanOverview.tsx](../../../packages/web/src/pages/planning/PlanOverview.tsx) |
| صفحة | [web/src/pages/planning/RouteAssigner.tsx](../../../packages/web/src/pages/planning/RouteAssigner.tsx) |
| صفحة | [web/src/pages/planning/routeSegments.ts](../../../packages/web/src/pages/planning/routeSegments.ts) |
| صفحة | [web/src/pages/planning/TeamScheduler.tsx](../../../packages/web/src/pages/planning/TeamScheduler.tsx) |
| صفحة | [web/src/pages/planning/TeamTasksDetail.tsx](../../../packages/web/src/pages/planning/TeamTasksDetail.tsx) |
| صفحة | [web/src/pages/planning/ZoneStudy.tsx](../../../packages/web/src/pages/planning/ZoneStudy.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/planning.ts](../../../packages/api/routes/planning.ts) |
| مسار API | [api/routes/routeAssignments.ts](../../../packages/api/routes/routeAssignments.ts) |
| مسار API | [api/routes/schedules.ts](../../../packages/api/routes/schedules.ts) |
| مسار API | [api/routes/workScopes.ts](../../../packages/api/routes/workScopes.ts) |
| مسار API | [api/routes/zoneStudy.ts](../../../packages/api/routes/zoneStudy.ts) |
| سياسة صلاحيات | [api/policies/routeAssignmentPolicy.ts](../../../packages/api/policies/routeAssignmentPolicy.ts) |
| خدمة/منطق عمل | [api/services/planningContactTargetScope.ts](../../../packages/api/services/planningContactTargetScope.ts) |
| خدمة/منطق عمل | [api/services/planningDayCycle.ts](../../../packages/api/services/planningDayCycle.ts) |
| خدمة/منطق عمل | [api/services/planningMarketingTargets.ts](../../../packages/api/services/planningMarketingTargets.ts) |
| خدمة/منطق عمل | [api/services/planningTaskCuration.ts](../../../packages/api/services/planningTaskCuration.ts) |
| خدمة/منطق عمل | [api/services/teamPlanningScope.ts](../../../packages/api/services/teamPlanningScope.ts) |
| خدمة/منطق عمل | [api/services/zoneStudy.ts](../../../packages/api/services/zoneStudy.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/workCoverage.ts](../../../packages/shared/workCoverage.ts) |

<details><summary>الاختبارات (9)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/planningContactTargetScope.integration.test.ts](../../../packages/api/services/planningContactTargetScope.integration.test.ts) |
| اختبار | [api/services/planningContactTargetScope.test.ts](../../../packages/api/services/planningContactTargetScope.test.ts) |
| اختبار | [api/services/planningCurationAuthorization.test.ts](../../../packages/api/services/planningCurationAuthorization.test.ts) |
| اختبار | [api/services/planningCurationContract.test.ts](../../../packages/api/services/planningCurationContract.test.ts) |
| اختبار | [api/services/planningDayCycle.contract.test.ts](../../../packages/api/services/planningDayCycle.contract.test.ts) |
| اختبار | [api/services/planningDayCycle.integration.test.ts](../../../packages/api/services/planningDayCycle.integration.test.ts) |
| اختبار | [api/services/planningDayTelemarketer.contract.test.ts](../../../packages/api/services/planningDayTelemarketer.contract.test.ts) |
| اختبار | [web/src/pages/planning/RouteAssignerExtraZones.test.ts](../../../packages/web/src/pages/planning/RouteAssignerExtraZones.test.ts) |
| اختبار | [web/src/pages/planning/routeSegments.test.ts](../../../packages/web/src/pages/planning/routeSegments.test.ts) |

</details>

### الزيارات الميدانية وزياراتي

| | |
|---|---|
| مسارات الصفحات | `/field-visits`، `/field-visits/:id`، `/my-visits` |
| مسارات الـ API | `/api/field-visits` |
| عدد الملفات | واجهة 11، خادم 6، اختبارات 10 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/visits/MyVisitsPage.tsx](../../../packages/web/src/pages/visits/MyVisitsPage.tsx) |
| صفحة | [web/src/pages/visits/VisitDetailPage.tsx](../../../packages/web/src/pages/visits/VisitDetailPage.tsx) |
| صفحة | [web/src/pages/visits/VisitsListPage.tsx](../../../packages/web/src/pages/visits/VisitsListPage.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/InstantVisitModal.tsx](../../../packages/web/src/components/fieldVisits/InstantVisitModal.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/PullTaskModal.tsx](../../../packages/web/src/components/fieldVisits/PullTaskModal.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/ReferralSheetModal.tsx](../../../packages/web/src/components/fieldVisits/ReferralSheetModal.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/VisitReasonModal.tsx](../../../packages/web/src/components/fieldVisits/VisitReasonModal.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/VisitSurveyModal.tsx](../../../packages/web/src/components/fieldVisits/VisitSurveyModal.tsx) |
| مكوّن واجهة | [web/src/components/fieldVisits/VisitTaskResultModalHost.tsx](../../../packages/web/src/components/fieldVisits/VisitTaskResultModalHost.tsx) |
| مكوّن واجهة | [web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx](../../../packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx) |
| مساعد/إعداد | [web/src/lib/fieldVisitPermissionPolicy.ts](../../../packages/web/src/lib/fieldVisitPermissionPolicy.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/fieldVisits.ts](../../../packages/api/routes/fieldVisits.ts) |
| سياسة صلاحيات | [api/policies/fieldVisitPolicy.ts](../../../packages/api/policies/fieldVisitPolicy.ts) |
| خدمة/منطق عمل | [api/services/visitBooking.ts](../../../packages/api/services/visitBooking.ts) |
| خدمة/منطق عمل | [api/services/visitClassification.ts](../../../packages/api/services/visitClassification.ts) |
| خدمة/منطق عمل | [api/services/visitCompletion.ts](../../../packages/api/services/visitCompletion.ts) |
| خدمة/منطق عمل | [api/services/visitTaskResultReflection.ts](../../../packages/api/services/visitTaskResultReflection.ts) |

<details><summary>الاختبارات (10)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/fieldVisitPolicy.test.ts](../../../packages/api/policies/fieldVisitPolicy.test.ts) |
| اختبار | [api/routes/fieldVisitsReadAccess.test.ts](../../../packages/api/routes/fieldVisitsReadAccess.test.ts) |
| اختبار | [api/routes/instantVisitOptions.contract.test.ts](../../../packages/api/routes/instantVisitOptions.contract.test.ts) |
| اختبار | [api/services/visitBooking.test.ts](../../../packages/api/services/visitBooking.test.ts) |
| اختبار | [api/services/visitBookingContactContext.test.ts](../../../packages/api/services/visitBookingContactContext.test.ts) |
| اختبار | [api/services/visitTaskResultReflection.test.ts](../../../packages/api/services/visitTaskResultReflection.test.ts) |
| اختبار | [web/src/components/fieldVisits/InstantVisitModal.contract.test.ts](../../../packages/web/src/components/fieldVisits/InstantVisitModal.contract.test.ts) |
| اختبار | [web/src/components/fieldVisits/VisitTaskResultModalHost.test.ts](../../../packages/web/src/components/fieldVisits/VisitTaskResultModalHost.test.ts) |
| اختبار | [web/src/lib/fieldVisitPermissionPolicy.test.ts](../../../packages/web/src/lib/fieldVisitPermissionPolicy.test.ts) |
| اختبار | [web/src/pages/visits/MyVisitsPage.contract.test.ts](../../../packages/web/src/pages/visits/MyVisitsPage.contract.test.ts) |

</details>

### تسليم وتركيب وتشغيل وفك الأجهزة

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/device-delivery`، `/tasks/group/device-installation`، `/tasks/group/device-activation`، `/tasks/group/device-disconnection` |
| مسارات الـ API | لا يوجد مسار مستقل: قراءة المهام عبر `/api/open-tasks`، وتسجيل النتائج عبر `/api/field-visits` من داخل الزيارة |
| عدد الملفات | واجهة 10، خادم 3، مشتركة 1، اختبارات 3 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/tasks/PostSaleTaskDetail.tsx](../../../packages/web/src/pages/tasks/PostSaleTaskDetail.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeliveryInfoTab.tsx](../../../packages/web/src/taskTypes/device_delivery/DeliveryInfoTab.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceActivationResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceActivationResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceCheckupResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceCheckupResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceDeliveryResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceDeliveryResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceDisconnectionResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceDisconnectionResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceInstallationResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceInstallationResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceRetrievalResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceRetrievalResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceReturnResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceReturnResultModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/device_delivery/DeviceTransferResultModal.tsx](../../../packages/web/src/taskTypes/device_delivery/DeviceTransferResultModal.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| سياسة صلاحيات | [api/policies/deviceDeliverySuspensionPolicy.ts](../../../packages/api/policies/deviceDeliverySuspensionPolicy.ts) |
| خدمة/منطق عمل | [api/services/deviceDeliverySuspension.ts](../../../packages/api/services/deviceDeliverySuspension.ts) |
| خدمة/منطق عمل | [api/services/deviceTaskEligibilityGuard.ts](../../../packages/api/services/deviceTaskEligibilityGuard.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/deviceTaskEligibility.ts](../../../packages/shared/deviceTaskEligibility.ts) |

<details><summary>الاختبارات (3)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/deviceDeliverySuspension.test.ts](../../../packages/api/services/deviceDeliverySuspension.test.ts) |
| اختبار | [api/services/deviceDeliverySuspensionContract.test.ts](../../../packages/api/services/deviceDeliverySuspensionContract.test.ts) |
| اختبار | [shared/deviceTaskEligibility.test.ts](../../../packages/shared/deviceTaskEligibility.test.ts) |

</details>

### الصيانة والأعطال

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/maintenance` |
| مسارات الـ API | `/api/emergency-result`، `/api/emergency-tickets` |
| عدد الملفات | واجهة 11، خادم 3، مشتركة 1، اختبارات 2 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/tasks/EmergencyTaskDetail.tsx](../../../packages/web/src/pages/tasks/EmergencyTaskDetail.tsx) |
| مكوّن واجهة | [web/src/components/emergency/EmergencyProblemsSection.tsx](../../../packages/web/src/components/emergency/EmergencyProblemsSection.tsx) |
| مكوّن واجهة | [web/src/components/emergency/EmergencyResultWizard.tsx](../../../packages/web/src/components/emergency/EmergencyResultWizard.tsx) |
| مكوّن واجهة | [web/src/components/emergency/InstallmentsSchedule.tsx](../../../packages/web/src/components/emergency/InstallmentsSchedule.tsx) |
| مكوّن واجهة | [web/src/components/emergency/MaintenanceReceiptModal.tsx](../../../packages/web/src/components/emergency/MaintenanceReceiptModal.tsx) |
| مكوّن واجهة | [web/src/components/emergency/PaymentEntriesList.tsx](../../../packages/web/src/components/emergency/PaymentEntriesList.tsx) |
| مكوّن واجهة | [web/src/components/emergency/result-phases/CostsForm.tsx](../../../packages/web/src/components/emergency/result-phases/CostsForm.tsx) |
| مكوّن واجهة | [web/src/components/emergency/result-phases/MaintenanceActionsForm.tsx](../../../packages/web/src/components/emergency/result-phases/MaintenanceActionsForm.tsx) |
| مكوّن واجهة | [web/src/components/emergency/result-phases/TechStateForm.tsx](../../../packages/web/src/components/emergency/result-phases/TechStateForm.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/emergency_maintenance/EmergencyDetailsTab.tsx](../../../packages/web/src/taskTypes/emergency_maintenance/EmergencyDetailsTab.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/emergency_maintenance/EmergencyResultModal.tsx](../../../packages/web/src/taskTypes/emergency_maintenance/EmergencyResultModal.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/emergencyResult.ts](../../../packages/api/routes/emergencyResult.ts) |
| مسار API | [api/routes/emergencyTickets.ts](../../../packages/api/routes/emergencyTickets.ts) |
| خدمة/منطق عمل | [api/services/emergencyDirectWorkshopRetrieval.ts](../../../packages/api/services/emergencyDirectWorkshopRetrieval.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/membraneEfficiency.ts](../../../packages/shared/membraneEfficiency.ts) |

<details><summary>الاختبارات (2)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/emergencyDirectWorkshopRetrieval.test.ts](../../../packages/api/services/emergencyDirectWorkshopRetrieval.test.ts) |
| اختبار | [shared/membraneEfficiency.test.ts](../../../packages/shared/membraneEfficiency.test.ts) |

</details>

### خدمات الكفالة

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/warranty-services` |
| مسارات الـ API | `/api/device-warranties` |
| عدد الملفات | واجهة 7، خادم 2، اختبارات 1 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/tasks/WarrantyServicesTaskDetail.tsx](../../../packages/web/src/pages/tasks/WarrantyServicesTaskDetail.tsx) |
| مكوّن واجهة | [web/src/components/devices/WarrantyStatusBadge.tsx](../../../packages/web/src/components/devices/WarrantyStatusBadge.tsx) |
| مكوّن واجهة | [web/src/components/warranty/WarrantyPaymentEntries.tsx](../../../packages/web/src/components/warranty/WarrantyPaymentEntries.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardCreateModal.tsx](../../../packages/web/src/taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardCreateModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal.tsx](../../../packages/web/src/taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/golden_warranty_offer/GoldenWarrantyOfferCreateModal.tsx](../../../packages/web/src/taskTypes/golden_warranty_offer/GoldenWarrantyOfferCreateModal.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal.tsx](../../../packages/web/src/taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/deviceWarranties.ts](../../../packages/api/routes/deviceWarranties.ts) |
| خدمة/منطق عمل | [api/services/goldenWarrantyCardDelivery.ts](../../../packages/api/services/goldenWarrantyCardDelivery.ts) |

<details><summary>الاختبارات (1)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/goldenWarrantyCardDelivery.test.ts](../../../packages/api/services/goldenWarrantyCardDelivery.test.ts) |

</details>

### محرك المهام المشترك ومهامي

| | |
|---|---|
| مسارات الصفحات | `/tasks/group/my-customers`، `/tasks/open`، `/tasks/group/:group` |
| مسارات الـ API | `/api/open-tasks` |
| عدد الملفات | واجهة 22، خادم 8، مشتركة 1، اختبارات 8 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/OpenTasks.tsx](../../../packages/web/src/pages/OpenTasks.tsx) |
| صفحة | [web/src/pages/tasks/TaskEvaluationLab.tsx](../../../packages/web/src/pages/tasks/TaskEvaluationLab.tsx) |
| صفحة | [web/src/pages/tasks/TaskGroupPage.tsx](../../../packages/web/src/pages/tasks/TaskGroupPage.tsx) |
| مكوّن واجهة | [web/src/components/tasks/CancelOpenTaskModal.tsx](../../../packages/web/src/components/tasks/CancelOpenTaskModal.tsx) |
| مكوّن واجهة | [web/src/components/tasks/cards/TaskCreationCard.tsx](../../../packages/web/src/components/tasks/cards/TaskCreationCard.tsx) |
| مكوّن واجهة | [web/src/components/tasks/cards/TaskHeroSummary.tsx](../../../packages/web/src/components/tasks/cards/TaskHeroSummary.tsx) |
| مكوّن واجهة | [web/src/components/tasks/cards/TaskQuickStatsCard.tsx](../../../packages/web/src/components/tasks/cards/TaskQuickStatsCard.tsx) |
| مكوّن واجهة | [web/src/components/tasks/cards/TaskScheduleCard.tsx](../../../packages/web/src/components/tasks/cards/TaskScheduleCard.tsx) |
| مكوّن واجهة | [web/src/components/tasks/cards/TaskSummaryCard.tsx](../../../packages/web/src/components/tasks/cards/TaskSummaryCard.tsx) |
| مكوّن واجهة | [web/src/components/tasks/shared.tsx](../../../packages/web/src/components/tasks/shared.tsx) |
| مكوّن واجهة | [web/src/components/tasks/tabs/TaskClientTab.tsx](../../../packages/web/src/components/tasks/tabs/TaskClientTab.tsx) |
| مكوّن واجهة | [web/src/components/tasks/tabs/TaskCommunicationOnlyTab.tsx](../../../packages/web/src/components/tasks/tabs/TaskCommunicationOnlyTab.tsx) |
| مكوّن واجهة | [web/src/components/tasks/tabs/TaskContractTab.tsx](../../../packages/web/src/components/tasks/tabs/TaskContractTab.tsx) |
| مكوّن واجهة | [web/src/components/tasks/tabs/TaskOverviewTab.tsx](../../../packages/web/src/components/tasks/tabs/TaskOverviewTab.tsx) |
| مكوّن واجهة | [web/src/components/tasks/tabs/TaskResultTab.tsx](../../../packages/web/src/components/tasks/tabs/TaskResultTab.tsx) |
| مكوّن واجهة | [web/src/components/tasks/TaskDetailLayout.tsx](../../../packages/web/src/components/tasks/TaskDetailLayout.tsx) |
| مكوّن واجهة | [web/src/components/tasks/TaskHeader.tsx](../../../packages/web/src/components/tasks/TaskHeader.tsx) |
| مكوّن واجهة | [web/src/components/tasks/types.ts](../../../packages/web/src/components/tasks/types.ts) |
| حالة (store/hook) | [web/src/hooks/useOpenTaskStore.ts](../../../packages/web/src/hooks/useOpenTaskStore.ts) |
| مساعد/إعداد | [web/src/lib/taskDateStatus.ts](../../../packages/web/src/lib/taskDateStatus.ts) |
| مساعد/إعداد | [web/src/lib/taskDecisionLabels.ts](../../../packages/web/src/lib/taskDecisionLabels.ts) |
| مساعد/إعداد | [web/src/lib/taskRoutes.ts](../../../packages/web/src/lib/taskRoutes.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/openTasks.ts](../../../packages/api/routes/openTasks.ts) |
| سياسة صلاحيات | [api/policies/openTaskPolicy.ts](../../../packages/api/policies/openTaskPolicy.ts) |
| خدمة/منطق عمل | [api/services/assignedTasks.ts](../../../packages/api/services/assignedTasks.ts) |
| خدمة/منطق عمل | [api/services/assigneeEligibility.ts](../../../packages/api/services/assigneeEligibility.ts) |
| خدمة/منطق عمل | [api/services/openTaskCancellation.ts](../../../packages/api/services/openTaskCancellation.ts) |
| خدمة/منطق عمل | [api/services/openTaskClientProjection.ts](../../../packages/api/services/openTaskClientProjection.ts) |
| خدمة/منطق عمل | [api/services/openTaskLinkagePolicy.ts](../../../packages/api/services/openTaskLinkagePolicy.ts) |
| بنية/مساعد | [api/domain/stageEngine.ts](../../../packages/api/domain/stageEngine.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/taskResultPolicy.ts](../../../packages/shared/taskResultPolicy.ts) |

<details><summary>الاختبارات (8)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/openTaskPolicy.test.ts](../../../packages/api/policies/openTaskPolicy.test.ts) |
| اختبار | [api/services/openTaskCancellation.test.ts](../../../packages/api/services/openTaskCancellation.test.ts) |
| اختبار | [api/services/openTaskClientProjection.test.ts](../../../packages/api/services/openTaskClientProjection.test.ts) |
| اختبار | [api/services/openTaskLinkagePolicy.test.ts](../../../packages/api/services/openTaskLinkagePolicy.test.ts) |
| اختبار | [api/services/taskResultEntryPolicy.test.ts](../../../packages/api/services/taskResultEntryPolicy.test.ts) |
| اختبار | [shared/taskResultPolicy.test.ts](../../../packages/shared/taskResultPolicy.test.ts) |
| اختبار | [web/src/components/tasks/TaskResultEntryPolicy.test.ts](../../../packages/web/src/components/tasks/TaskResultEntryPolicy.test.ts) |
| اختبار | [web/src/lib/taskDecisionLabels.test.ts](../../../packages/web/src/lib/taskDecisionLabels.test.ts) |

</details>

## الهدايا

### الهدايا

| | |
|---|---|
| مسارات الصفحات | `/gifts`، `/tasks/group/gift-delivery` |
| مسارات الـ API | `/api/gifts` |
| عدد الملفات | واجهة 11، خادم 5، اختبارات 11 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/clientProfile/GiftsTab.tsx](../../../packages/web/src/pages/clientProfile/GiftsTab.tsx) |
| صفحة | [web/src/pages/contracts/ContractGiftsPanel.tsx](../../../packages/web/src/pages/contracts/ContractGiftsPanel.tsx) |
| صفحة | [web/src/pages/gifts/GiftsManagement.tsx](../../../packages/web/src/pages/gifts/GiftsManagement.tsx) |
| صفحة | [web/src/pages/tasks/GiftDeliveryTaskDetail.tsx](../../../packages/web/src/pages/tasks/GiftDeliveryTaskDetail.tsx) |
| مكوّن واجهة | [web/src/components/gifts/GiftDefinitionsPanel.tsx](../../../packages/web/src/components/gifts/GiftDefinitionsPanel.tsx) |
| مكوّن واجهة | [web/src/components/gifts/GiftPromiseInlinePanel.tsx](../../../packages/web/src/components/gifts/GiftPromiseInlinePanel.tsx) |
| مكوّن واجهة | [web/src/components/gifts/GiftRecordActions.tsx](../../../packages/web/src/components/gifts/GiftRecordActions.tsx) |
| مكوّن واجهة | [web/src/components/gifts/GiftRecordsTable.tsx](../../../packages/web/src/components/gifts/GiftRecordsTable.tsx) |
| مكوّن واجهة | [web/src/components/gifts/ReferralGiftPromisesPanel.tsx](../../../packages/web/src/components/gifts/ReferralGiftPromisesPanel.tsx) |
| تعريف نوع مهمة | [web/src/taskTypes/gift_delivery/GiftDeliveryResultModal.tsx](../../../packages/web/src/taskTypes/gift_delivery/GiftDeliveryResultModal.tsx) |
| مساعد/إعداد | [web/src/data/gifts.ts](../../../packages/web/src/data/gifts.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/gifts.ts](../../../packages/api/routes/gifts.ts) |
| سياسة صلاحيات | [api/policies/giftPolicy.ts](../../../packages/api/policies/giftPolicy.ts) |
| خدمة/منطق عمل | [api/services/giftDeliveryTaskCreation.ts](../../../packages/api/services/giftDeliveryTaskCreation.ts) |
| خدمة/منطق عمل | [api/services/giftPromises.ts](../../../packages/api/services/giftPromises.ts) |
| خدمة/منطق عمل | [api/services/referralGiftPromises.ts](../../../packages/api/services/referralGiftPromises.ts) |

<details><summary>الاختبارات (11)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/giftPolicy.test.ts](../../../packages/api/policies/giftPolicy.test.ts) |
| اختبار | [api/policies/referralGiftPromiseAuthorization.test.ts](../../../packages/api/policies/referralGiftPromiseAuthorization.test.ts) |
| اختبار | [api/routes/giftPromiseConditions.contract.test.ts](../../../packages/api/routes/giftPromiseConditions.contract.test.ts) |
| اختبار | [api/routes/referralGiftPromiseRoutes.contract.test.ts](../../../packages/api/routes/referralGiftPromiseRoutes.contract.test.ts) |
| اختبار | [api/services/giftDeliveryDecision.test.ts](../../../packages/api/services/giftDeliveryDecision.test.ts) |
| اختبار | [api/services/giftDeliveryTaskCreation.test.ts](../../../packages/api/services/giftDeliveryTaskCreation.test.ts) |
| اختبار | [api/services/giftPromises.test.ts](../../../packages/api/services/giftPromises.test.ts) |
| اختبار | [api/services/referralGiftPromises.test.ts](../../../packages/api/services/referralGiftPromises.test.ts) |
| اختبار | [web/src/components/gifts/GiftPromiseInlinePanel.contract.test.ts](../../../packages/web/src/components/gifts/GiftPromiseInlinePanel.contract.test.ts) |
| اختبار | [web/src/components/gifts/GiftRecordActions.layout.test.ts](../../../packages/web/src/components/gifts/GiftRecordActions.layout.test.ts) |
| اختبار | [web/src/components/gifts/ReferralGiftPromisesPanel.contract.test.ts](../../../packages/web/src/components/gifts/ReferralGiftPromisesPanel.contract.test.ts) |

</details>

## الأجهزة والمخزون

### الأجهزة وقطع الغيار والأجهزة المركّبة

| | |
|---|---|
| مسارات الصفحات | `/devices`، `/devices/:id`، `/installed-devices`، `/installed-devices/:id` |
| مسارات الـ API | `/api/device-models`، `/api/device-parts`، `/api/devices`، `/api/installed-devices`، `/api/spare-parts` |
| عدد الملفات | واجهة 22، خادم 12، اختبارات 8 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/DeviceDetail.tsx](../../../packages/web/src/pages/DeviceDetail.tsx) |
| صفحة | [web/src/pages/DeviceManagement.tsx](../../../packages/web/src/pages/DeviceManagement.tsx) |
| صفحة | [web/src/pages/devices/DeviceProfilePage.tsx](../../../packages/web/src/pages/devices/DeviceProfilePage.tsx) |
| صفحة | [web/src/pages/devices/InstalledDevicesList.tsx](../../../packages/web/src/pages/devices/InstalledDevicesList.tsx) |
| صفحة | [web/src/pages/devices/sections/CurrentHolderSection.tsx](../../../packages/web/src/pages/devices/sections/CurrentHolderSection.tsx) |
| صفحة | [web/src/pages/devices/sections/FinancialSection.tsx](../../../packages/web/src/pages/devices/sections/FinancialSection.tsx) |
| صفحة | [web/src/pages/devices/sections/IdentitySection.tsx](../../../packages/web/src/pages/devices/sections/IdentitySection.tsx) |
| صفحة | [web/src/pages/devices/sections/InstalledPartsSection.tsx](../../../packages/web/src/pages/devices/sections/InstalledPartsSection.tsx) |
| صفحة | [web/src/pages/devices/sections/LinkedContractSection.tsx](../../../packages/web/src/pages/devices/sections/LinkedContractSection.tsx) |
| صفحة | [web/src/pages/devices/sections/OperationalStatusSection.tsx](../../../packages/web/src/pages/devices/sections/OperationalStatusSection.tsx) |
| صفحة | [web/src/pages/devices/sections/PossessionHistorySection.tsx](../../../packages/web/src/pages/devices/sections/PossessionHistorySection.tsx) |
| صفحة | [web/src/pages/devices/sections/ProblemsHistorySection.tsx](../../../packages/web/src/pages/devices/sections/ProblemsHistorySection.tsx) |
| صفحة | [web/src/pages/devices/sections/SectionShell.tsx](../../../packages/web/src/pages/devices/sections/SectionShell.tsx) |
| صفحة | [web/src/pages/devices/sections/ServiceAgreementsSection.tsx](../../../packages/web/src/pages/devices/sections/ServiceAgreementsSection.tsx) |
| صفحة | [web/src/pages/devices/sections/TasksSection.tsx](../../../packages/web/src/pages/devices/sections/TasksSection.tsx) |
| صفحة | [web/src/pages/devices/sections/TechnicalHealthSection.tsx](../../../packages/web/src/pages/devices/sections/TechnicalHealthSection.tsx) |
| صفحة | [web/src/pages/devices/sections/WarrantiesSection.tsx](../../../packages/web/src/pages/devices/sections/WarrantiesSection.tsx) |
| مكوّن واجهة | [web/src/components/devices/DevicePossessionTimeline.tsx](../../../packages/web/src/components/devices/DevicePossessionTimeline.tsx) |
| مكوّن واجهة | [web/src/components/devices/DeviceStatusBadge.tsx](../../../packages/web/src/components/devices/DeviceStatusBadge.tsx) |
| مكوّن واجهة | [web/src/components/devices/PartCard.tsx](../../../packages/web/src/components/devices/PartCard.tsx) |
| مكوّن واجهة | [web/src/components/devices/PossessionHolderChip.tsx](../../../packages/web/src/components/devices/PossessionHolderChip.tsx) |
| مكوّن واجهة | [web/src/components/devices/TechnicalStateFields.tsx](../../../packages/web/src/components/devices/TechnicalStateFields.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/deviceModels.ts](../../../packages/api/routes/deviceModels.ts) |
| مسار API | [api/routes/deviceParts.ts](../../../packages/api/routes/deviceParts.ts) |
| مسار API | [api/routes/devicePossession.ts](../../../packages/api/routes/devicePossession.ts) |
| مسار API | [api/routes/installedDevices.ts](../../../packages/api/routes/installedDevices.ts) |
| مسار API | [api/routes/spareParts.ts](../../../packages/api/routes/spareParts.ts) |
| سياسة صلاحيات | [api/policies/devicePossessionPolicy.ts](../../../packages/api/policies/devicePossessionPolicy.ts) |
| خدمة/منطق عمل | [api/services/catalogActiveStateService.ts](../../../packages/api/services/catalogActiveStateService.ts) |
| خدمة/منطق عمل | [api/services/deviceModelSalesBranchesService.ts](../../../packages/api/services/deviceModelSalesBranchesService.ts) |
| خدمة/منطق عمل | [api/services/devicePossessionProjection.ts](../../../packages/api/services/devicePossessionProjection.ts) |
| خدمة/منطق عمل | [api/services/deviceScopeService.ts](../../../packages/api/services/deviceScopeService.ts) |
| خدمة/منطق عمل | [api/services/deviceSerialIntegrity.ts](../../../packages/api/services/deviceSerialIntegrity.ts) |
| بنية/مساعد | [api/lib/installationGeoLevel.ts](../../../packages/api/lib/installationGeoLevel.ts) |

<details><summary>الاختبارات (8)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/devicePossessionPolicy.test.ts](../../../packages/api/policies/devicePossessionPolicy.test.ts) |
| اختبار | [api/services/deviceModelSalesBranchesService.test.ts](../../../packages/api/services/deviceModelSalesBranchesService.test.ts) |
| اختبار | [api/services/devicePossessionProjection.test.ts](../../../packages/api/services/devicePossessionProjection.test.ts) |
| اختبار | [api/services/deviceSerialIntegrity.test.ts](../../../packages/api/services/deviceSerialIntegrity.test.ts) |
| اختبار | [api/services/deviceSerialOptionalityContract.test.ts](../../../packages/api/services/deviceSerialOptionalityContract.test.ts) |
| اختبار | [api/services/deviceTransferProjection.test.ts](../../../packages/api/services/deviceTransferProjection.test.ts) |
| اختبار | [web/src/components/devices/PossessionHolderChip.test.ts](../../../packages/web/src/components/devices/PossessionHolderChip.test.ts) |
| اختبار | [web/src/pages/deviceMediaEditing.contract.test.ts](../../../packages/web/src/pages/deviceMediaEditing.contract.test.ts) |

</details>

## الموارد البشرية

### الموظفون والأقسام

| | |
|---|---|
| مسارات الصفحات | `/employees`، `/employees/:id`، `/departments` |
| مسارات الـ API | `/api/departments`، `/api/employees` |
| عدد الملفات | واجهة 5، خادم 8، اختبارات 6 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/Departments.tsx](../../../packages/web/src/pages/Departments.tsx) |
| صفحة | [web/src/pages/EmployeeDetail.tsx](../../../packages/web/src/pages/EmployeeDetail.tsx) |
| صفحة | [web/src/pages/Employees.tsx](../../../packages/web/src/pages/Employees.tsx) |
| مكوّن واجهة | [web/src/components/employees/EmployeeFormModal.tsx](../../../packages/web/src/components/employees/EmployeeFormModal.tsx) |
| مساعد/إعداد | [web/src/lib/employeeMediatorLookup.ts](../../../packages/web/src/lib/employeeMediatorLookup.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/departments.ts](../../../packages/api/routes/departments.ts) |
| مسار API | [api/routes/employees.ts](../../../packages/api/routes/employees.ts) |
| خدمة/منطق عمل | [api/services/employeeLookupProjection.ts](../../../packages/api/services/employeeLookupProjection.ts) |
| خدمة/منطق عمل | [api/services/employeeMediatorReference.ts](../../../packages/api/services/employeeMediatorReference.ts) |
| خدمة/منطق عمل | [api/services/employeeService.ts](../../../packages/api/services/employeeService.ts) |
| خدمة/منطق عمل | [api/services/employeeSystemAccountErrors.ts](../../../packages/api/services/employeeSystemAccountErrors.ts) |
| وصول للبيانات | [api/repositories/employeeManagerCandidateQuery.ts](../../../packages/api/repositories/employeeManagerCandidateQuery.ts) |
| وصول للبيانات | [api/repositories/employeeRepository.ts](../../../packages/api/repositories/employeeRepository.ts) |

<details><summary>الاختبارات (6)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/employeeCloserLookupPermission.test.ts](../../../packages/api/routes/employeeCloserLookupPermission.test.ts) |
| اختبار | [api/services/employeeBranchTransfer.test.ts](../../../packages/api/services/employeeBranchTransfer.test.ts) |
| اختبار | [api/services/employeeLookupProjection.test.ts](../../../packages/api/services/employeeLookupProjection.test.ts) |
| اختبار | [api/services/employeeManagerCandidatePolicy.test.ts](../../../packages/api/services/employeeManagerCandidatePolicy.test.ts) |
| اختبار | [api/services/employeeSystemAccountErrors.test.ts](../../../packages/api/services/employeeSystemAccountErrors.test.ts) |
| اختبار | [web/src/lib/employeeMediatorLookup.test.ts](../../../packages/web/src/lib/employeeMediatorLookup.test.ts) |

</details>

### التوظيف (الشواغر، الطلبات، المقابلات، الدورات)

| | |
|---|---|
| مسارات الصفحات | `/jobs/vacancies`، `/jobs/applications`، `/jobs/interviews`، `/jobs/training-courses`، `/jobs/public` |
| مسارات الـ API | `/api/admin/applications`، `/api/admin/interviews`، `/api/admin/training-courses`، `/api/admin/vacancies`، `/api/public/applications`، `/api/public/vacancies` |
| عدد الملفات | واجهة 16، خادم 18، اختبارات 5 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/jobs/ApplicationDetail.tsx](../../../packages/web/src/pages/jobs/ApplicationDetail.tsx) |
| صفحة | [web/src/pages/jobs/Applications.tsx](../../../packages/web/src/pages/jobs/Applications.tsx) |
| صفحة | [web/src/pages/jobs/interviewerLookup.ts](../../../packages/web/src/pages/jobs/interviewerLookup.ts) |
| صفحة | [web/src/pages/jobs/Interviews.tsx](../../../packages/web/src/pages/jobs/Interviews.tsx) |
| صفحة | [web/src/pages/jobs/ManualApplicationEntry.tsx](../../../packages/web/src/pages/jobs/ManualApplicationEntry.tsx) |
| صفحة | [web/src/pages/jobs/PublicJobs.tsx](../../../packages/web/src/pages/jobs/PublicJobs.tsx) |
| صفحة | [web/src/pages/jobs/TrainingCourseDetail.tsx](../../../packages/web/src/pages/jobs/TrainingCourseDetail.tsx) |
| صفحة | [web/src/pages/jobs/TrainingCourses.tsx](../../../packages/web/src/pages/jobs/TrainingCourses.tsx) |
| صفحة | [web/src/pages/jobs/Vacancies.tsx](../../../packages/web/src/pages/jobs/Vacancies.tsx) |
| صفحة | [web/src/pages/jobs/VacancyDetail.tsx](../../../packages/web/src/pages/jobs/VacancyDetail.tsx) |
| حالة (store/hook) | [web/src/hooks/useApplicationListStore.ts](../../../packages/web/src/hooks/useApplicationListStore.ts) |
| حالة (store/hook) | [web/src/hooks/useInterviewStore.ts](../../../packages/web/src/hooks/useInterviewStore.ts) |
| حالة (store/hook) | [web/src/hooks/useTrainingStore.ts](../../../packages/web/src/hooks/useTrainingStore.ts) |
| حالة (store/hook) | [web/src/hooks/useVacancyStore.ts](../../../packages/web/src/hooks/useVacancyStore.ts) |
| مساعد/إعداد | [web/src/lib/applicationState.ts](../../../packages/web/src/lib/applicationState.ts) |
| مساعد/إعداد | [web/src/lib/jobMatch.ts](../../../packages/web/src/lib/jobMatch.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/adminApplications.ts](../../../packages/api/routes/adminApplications.ts) |
| مسار API | [api/routes/interviews.ts](../../../packages/api/routes/interviews.ts) |
| مسار API | [api/routes/publicApplications.ts](../../../packages/api/routes/publicApplications.ts) |
| مسار API | [api/routes/publicVacancies.ts](../../../packages/api/routes/publicVacancies.ts) |
| مسار API | [api/routes/trainingCourses.ts](../../../packages/api/routes/trainingCourses.ts) |
| مسار API | [api/routes/vacancies.ts](../../../packages/api/routes/vacancies.ts) |
| سياسة صلاحيات | [api/policies/trainingCoursePolicy.ts](../../../packages/api/policies/trainingCoursePolicy.ts) |
| خدمة/منطق عمل | [api/services/applicationService.ts](../../../packages/api/services/applicationService.ts) |
| خدمة/منطق عمل | [api/services/applicationSubmissionError.ts](../../../packages/api/services/applicationSubmissionError.ts) |
| خدمة/منطق عمل | [api/services/interviewService.ts](../../../packages/api/services/interviewService.ts) |
| خدمة/منطق عمل | [api/services/trainingCourseService.ts](../../../packages/api/services/trainingCourseService.ts) |
| خدمة/منطق عمل | [api/services/vacancyApplicability.ts](../../../packages/api/services/vacancyApplicability.ts) |
| خدمة/منطق عمل | [api/services/vacancyExpiryJob.ts](../../../packages/api/services/vacancyExpiryJob.ts) |
| وصول للبيانات | [api/repositories/applicationRepository.ts](../../../packages/api/repositories/applicationRepository.ts) |
| وصول للبيانات | [api/repositories/interviewRepository.ts](../../../packages/api/repositories/interviewRepository.ts) |
| وصول للبيانات | [api/repositories/trainingCourseRepository.ts](../../../packages/api/repositories/trainingCourseRepository.ts) |
| بنية/مساعد | [api/utils/applicationHelpers.ts](../../../packages/api/utils/applicationHelpers.ts) |
| بنية/مساعد | [api/utils/recruitmentPolicy.ts](../../../packages/api/utils/recruitmentPolicy.ts) |

<details><summary>الاختبارات (5)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/policies/trainingCoursePolicy.test.ts](../../../packages/api/policies/trainingCoursePolicy.test.ts) |
| اختبار | [api/services/applicationReferrer.test.ts](../../../packages/api/services/applicationReferrer.test.ts) |
| اختبار | [api/services/vacancyApplicability.test.ts](../../../packages/api/services/vacancyApplicability.test.ts) |
| اختبار | [api/services/vacancyExpiryJob.test.ts](../../../packages/api/services/vacancyExpiryJob.test.ts) |
| اختبار | [web/src/pages/jobs/applicationAttachmentPolicy.test.ts](../../../packages/web/src/pages/jobs/applicationAttachmentPolicy.test.ts) |

</details>

## التقارير

### التقارير

| | |
|---|---|
| مسارات الصفحات | `/reports` |
| مسارات الـ API | `/api/reports` |
| عدد الملفات | واجهة 3، خادم 38، اختبارات 34 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/Reports.tsx](../../../packages/web/src/pages/Reports.tsx) |
| مساعد/إعداد | [web/src/lib/reportFilterOptions.ts](../../../packages/web/src/lib/reportFilterOptions.ts) |
| مساعد/إعداد | [web/src/lib/reportValues.ts](../../../packages/web/src/lib/reportValues.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/reports.ts](../../../packages/api/routes/reports.ts) |
| خدمة/منطق عمل | [api/services/reporting/breakdownCatalog.ts](../../../packages/api/services/reporting/breakdownCatalog.ts) |
| خدمة/منطق عمل | [api/services/reporting/breakdownService.ts](../../../packages/api/services/reporting/breakdownService.ts) |
| خدمة/منطق عمل | [api/services/reporting/customerCallsReport.ts](../../../packages/api/services/reporting/customerCallsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/dailyVisitsReport.ts](../../../packages/api/services/reporting/dailyVisitsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/dailyWorkSalesFileReport.ts](../../../packages/api/services/reporting/dailyWorkSalesFileReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/departmentResultsReport.ts](../../../packages/api/services/reporting/departmentResultsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/deviceFaultsReport.ts](../../../packages/api/services/reporting/deviceFaultsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/escalationsReport.ts](../../../packages/api/services/reporting/escalationsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/fieldWorkLaterals.ts](../../../packages/api/services/reporting/fieldWorkLaterals.ts) |
| خدمة/منطق عمل | [api/services/reporting/geographicPortfolioReport.ts](../../../packages/api/services/reporting/geographicPortfolioReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/goldenWarrantyReport.ts](../../../packages/api/services/reporting/goldenWarrantyReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/mediatorGiftsReport.ts](../../../packages/api/services/reporting/mediatorGiftsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/metricsCatalog.ts](../../../packages/api/services/reporting/metricsCatalog.ts) |
| خدمة/منطق عمل | [api/services/reporting/metricsService.ts](../../../packages/api/services/reporting/metricsService.ts) |
| خدمة/منطق عمل | [api/services/reporting/reportEmployeeDimension.ts](../../../packages/api/services/reporting/reportEmployeeDimension.ts) |
| خدمة/منطق عمل | [api/services/reporting/reportingError.ts](../../../packages/api/services/reporting/reportingError.ts) |
| خدمة/منطق عمل | [api/services/reporting/reportingScope.ts](../../../packages/api/services/reporting/reportingScope.ts) |
| خدمة/منطق عمل | [api/services/reporting/retrievedDevicesReport.ts](../../../packages/api/services/reporting/retrievedDevicesReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/salesByTypeReport.ts](../../../packages/api/services/reporting/salesByTypeReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/salesCountReport.ts](../../../packages/api/services/reporting/salesCountReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/salesFollowUpTasksReport.ts](../../../packages/api/services/reporting/salesFollowUpTasksReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/serviceDevicesReport.ts](../../../packages/api/services/reporting/serviceDevicesReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/serviceDuesReport.ts](../../../packages/api/services/reporting/serviceDuesReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/supervisorWorkReport.ts](../../../packages/api/services/reporting/supervisorWorkReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportAccess.ts](../../../packages/api/services/reporting/tabularReportAccess.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportCatalog.ts](../../../packages/api/services/reporting/tabularReportCatalog.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportCleanupJob.ts](../../../packages/api/services/reporting/tabularReportCleanupJob.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportExcel.ts](../../../packages/api/services/reporting/tabularReportExcel.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportFilterOptions.ts](../../../packages/api/services/reporting/tabularReportFilterOptions.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportService.ts](../../../packages/api/services/reporting/tabularReportService.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportSorting.ts](../../../packages/api/services/reporting/tabularReportSorting.ts) |
| خدمة/منطق عمل | [api/services/reporting/tabularReportWorker.ts](../../../packages/api/services/reporting/tabularReportWorker.ts) |
| خدمة/منطق عمل | [api/services/reporting/technicianWorkReport.ts](../../../packages/api/services/reporting/technicianWorkReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/temporaryContractReport.ts](../../../packages/api/services/reporting/temporaryContractReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/timeWindow.ts](../../../packages/api/services/reporting/timeWindow.ts) |
| خدمة/منطق عمل | [api/services/reporting/workFilesGeoSupervisorsReport.ts](../../../packages/api/services/reporting/workFilesGeoSupervisorsReport.ts) |
| خدمة/منطق عمل | [api/services/reporting/workFilesNamesFileReport.ts](../../../packages/api/services/reporting/workFilesNamesFileReport.ts) |

<details><summary>الاختبارات (34)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/reporting/customerCallsReport.test.ts](../../../packages/api/services/reporting/customerCallsReport.test.ts) |
| اختبار | [api/services/reporting/dailyVisitsReport.test.ts](../../../packages/api/services/reporting/dailyVisitsReport.test.ts) |
| اختبار | [api/services/reporting/dailyWorkSalesFileReport.test.ts](../../../packages/api/services/reporting/dailyWorkSalesFileReport.test.ts) |
| اختبار | [api/services/reporting/departmentResultsReport.test.ts](../../../packages/api/services/reporting/departmentResultsReport.test.ts) |
| اختبار | [api/services/reporting/deviceFaultsReport.test.ts](../../../packages/api/services/reporting/deviceFaultsReport.test.ts) |
| اختبار | [api/services/reporting/escalationsReport.test.ts](../../../packages/api/services/reporting/escalationsReport.test.ts) |
| اختبار | [api/services/reporting/geographicPortfolioReport.test.ts](../../../packages/api/services/reporting/geographicPortfolioReport.test.ts) |
| اختبار | [api/services/reporting/goldenWarrantyReport.test.ts](../../../packages/api/services/reporting/goldenWarrantyReport.test.ts) |
| اختبار | [api/services/reporting/mediatorGiftsReport.test.ts](../../../packages/api/services/reporting/mediatorGiftsReport.test.ts) |
| اختبار | [api/services/reporting/reportEmployeeDimension.test.ts](../../../packages/api/services/reporting/reportEmployeeDimension.test.ts) |
| اختبار | [api/services/reporting/reportingScope.test.ts](../../../packages/api/services/reporting/reportingScope.test.ts) |
| اختبار | [api/services/reporting/reportTimeWindows.test.ts](../../../packages/api/services/reporting/reportTimeWindows.test.ts) |
| اختبار | [api/services/reporting/retrievedDevicesReport.test.ts](../../../packages/api/services/reporting/retrievedDevicesReport.test.ts) |
| اختبار | [api/services/reporting/salesByTypeReport.test.ts](../../../packages/api/services/reporting/salesByTypeReport.test.ts) |
| اختبار | [api/services/reporting/salesCountReport.test.ts](../../../packages/api/services/reporting/salesCountReport.test.ts) |
| اختبار | [api/services/reporting/salesFollowUpTasksReport.test.ts](../../../packages/api/services/reporting/salesFollowUpTasksReport.test.ts) |
| اختبار | [api/services/reporting/serviceDevicesReport.test.ts](../../../packages/api/services/reporting/serviceDevicesReport.test.ts) |
| اختبار | [api/services/reporting/serviceDuesReport.test.ts](../../../packages/api/services/reporting/serviceDuesReport.test.ts) |
| اختبار | [api/services/reporting/supervisorWorkReport.test.ts](../../../packages/api/services/reporting/supervisorWorkReport.test.ts) |
| اختبار | [api/services/reporting/tabularReportAccess.test.ts](../../../packages/api/services/reporting/tabularReportAccess.test.ts) |
| اختبار | [api/services/reporting/tabularReportCatalog.test.ts](../../../packages/api/services/reporting/tabularReportCatalog.test.ts) |
| اختبار | [api/services/reporting/tabularReportCleanupJob.test.ts](../../../packages/api/services/reporting/tabularReportCleanupJob.test.ts) |
| اختبار | [api/services/reporting/tabularReportExcel.test.ts](../../../packages/api/services/reporting/tabularReportExcel.test.ts) |
| اختبار | [api/services/reporting/tabularReportFilterOptions.test.ts](../../../packages/api/services/reporting/tabularReportFilterOptions.test.ts) |
| اختبار | [api/services/reporting/tabularReportPagination.test.ts](../../../packages/api/services/reporting/tabularReportPagination.test.ts) |
| اختبار | [api/services/reporting/tabularReportSorting.test.ts](../../../packages/api/services/reporting/tabularReportSorting.test.ts) |
| اختبار | [api/services/reporting/tabularReportWorker.test.ts](../../../packages/api/services/reporting/tabularReportWorker.test.ts) |
| اختبار | [api/services/reporting/technicianWorkReport.test.ts](../../../packages/api/services/reporting/technicianWorkReport.test.ts) |
| اختبار | [api/services/reporting/temporaryContractReport.integration.test.ts](../../../packages/api/services/reporting/temporaryContractReport.integration.test.ts) |
| اختبار | [api/services/reporting/temporaryContractReport.test.ts](../../../packages/api/services/reporting/temporaryContractReport.test.ts) |
| اختبار | [api/services/reporting/workFilesGeoSupervisorsReport.test.ts](../../../packages/api/services/reporting/workFilesGeoSupervisorsReport.test.ts) |
| اختبار | [api/services/reporting/workFilesNamesFileReport.test.ts](../../../packages/api/services/reporting/workFilesNamesFileReport.test.ts) |
| اختبار | [web/src/lib/reportFilterOptions.test.ts](../../../packages/web/src/lib/reportFilterOptions.test.ts) |
| اختبار | [web/src/lib/reportValues.test.ts](../../../packages/web/src/lib/reportValues.test.ts) |

</details>

## الإدارة والإعدادات

### الفروع

| | |
|---|---|
| مسارات الصفحات | `/branches` |
| مسارات الـ API | `/api/branches` |
| عدد الملفات | واجهة 1، خادم 1، اختبارات 1 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/Branches.tsx](../../../packages/web/src/pages/Branches.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/branches.ts](../../../packages/api/routes/branches.ts) |

<details><summary>الاختبارات (1)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/branchesMobileProfile.test.ts](../../../packages/api/routes/branchesMobileProfile.test.ts) |

</details>

### المناطق الإدارية وخطوط السير

| | |
|---|---|
| مسارات الصفحات | `/geo`، `/routes` |
| مسارات الـ API | `/api/geo-units`، `/api/public/areas`، `/api/routes` |
| عدد الملفات | واجهة 4، خادم 7، اختبارات 3 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/GeoSettings.tsx](../../../packages/web/src/pages/GeoSettings.tsx) |
| صفحة | [web/src/pages/RouteManager.tsx](../../../packages/web/src/pages/RouteManager.tsx) |
| مكوّن واجهة | [web/src/components/geo/GeoPathDisplay.tsx](../../../packages/web/src/components/geo/GeoPathDisplay.tsx) |
| مساعد/إعداد | [web/src/lib/geoConstants.ts](../../../packages/web/src/lib/geoConstants.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/geoUnits.ts](../../../packages/api/routes/geoUnits.ts) |
| مسار API | [api/routes/publicAreas.ts](../../../packages/api/routes/publicAreas.ts) |
| مسار API | [api/routes/routes.ts](../../../packages/api/routes/routes.ts) |
| سياسة صلاحيات | [api/policies/routePolicy.ts](../../../packages/api/policies/routePolicy.ts) |
| خدمة/منطق عمل | [api/services/geo/administrativeAddress.ts](../../../packages/api/services/geo/administrativeAddress.ts) |
| خدمة/منطق عمل | [api/services/geo/publicAreaCatalog.ts](../../../packages/api/services/geo/publicAreaCatalog.ts) |
| خدمة/منطق عمل | [api/services/geoScopeService.ts](../../../packages/api/services/geoScopeService.ts) |

<details><summary>الاختبارات (3)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/publicAreas.test.ts](../../../packages/api/routes/publicAreas.test.ts) |
| اختبار | [api/services/geo/administrativeAddress.test.ts](../../../packages/api/services/geo/administrativeAddress.test.ts) |
| اختبار | [api/services/geo/publicAreaCatalog.test.ts](../../../packages/api/services/geo/publicAreaCatalog.test.ts) |

</details>

### المستخدمون والأدوار والصلاحيات

| | |
|---|---|
| مسارات الصفحات | `/admin/users`، `/admin/roles`، `/admin/permissions-settings` |
| مسارات الـ API | `/api/admin`، `/trpc` |
| عدد الملفات | واجهة 6، خادم 10، مشتركة 1، اختبارات 1 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/admin/PermissionSettings.tsx](../../../packages/web/src/pages/admin/PermissionSettings.tsx) |
| صفحة | [web/src/pages/admin/RolePermissions.tsx](../../../packages/web/src/pages/admin/RolePermissions.tsx) |
| صفحة | [web/src/pages/admin/Roles.tsx](../../../packages/web/src/pages/admin/Roles.tsx) |
| صفحة | [web/src/pages/admin/Users.tsx](../../../packages/web/src/pages/admin/Users.tsx) |
| حالة (store/hook) | [web/src/hooks/useRoleStore.ts](../../../packages/web/src/hooks/useRoleStore.ts) |
| مساعد/إعداد | [web/src/lib/permissionDisplay.ts](../../../packages/web/src/lib/permissionDisplay.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/roles.ts](../../../packages/api/routes/roles.ts) |
| tRPC | [api/trpc/routers/roles.ts](../../../packages/api/trpc/routers/roles.ts) |
| خدمة/منطق عمل | [api/services/roleAssignmentGuard.ts](../../../packages/api/services/roleAssignmentGuard.ts) |
| خدمة/منطق عمل | [api/services/roleManagementService.ts](../../../packages/api/services/roleManagementService.ts) |
| خدمة/منطق عمل | [api/services/rolePermissionService.ts](../../../packages/api/services/rolePermissionService.ts) |
| خدمة/منطق عمل | [api/services/userBranchAssignmentService.ts](../../../packages/api/services/userBranchAssignmentService.ts) |
| بنية/مساعد | [api/dev-purge-roles-users.ts](../../../packages/api/dev-purge-roles-users.ts) |
| بنية/مساعد | [api/dev-reset-auth-users.ts](../../../packages/api/dev-reset-auth-users.ts) |
| بنية/مساعد | [api/dev-reset-single-superadmin.ts](../../../packages/api/dev-reset-single-superadmin.ts) |
| بنية/مساعد | [api/seed-superadmin.ts](../../../packages/api/seed-superadmin.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/contracts/roles.ts](../../../packages/shared/contracts/roles.ts) |

<details><summary>الاختبارات (1)</summary>

| النوع | الملف |
|---|---|
| اختبار | [web/src/lib/permissionDisplay.test.ts](../../../packages/web/src/lib/permissionDisplay.test.ts) |

</details>

### طلبات إنشاء الحساب

| | |
|---|---|
| مسارات الصفحات | `/account-requests`، `/admin/customer-app-users` |
| مسارات الـ API | `/api/admin`، `/api/admin/account-requests` |
| عدد الملفات | واجهة 5، خادم 5، مشتركة 1، اختبارات 2 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/account-requests/AccountRequestDetailPage.tsx](../../../packages/web/src/pages/account-requests/AccountRequestDetailPage.tsx) |
| صفحة | [web/src/pages/account-requests/AccountRequestsListPage.tsx](../../../packages/web/src/pages/account-requests/AccountRequestsListPage.tsx) |
| صفحة | [web/src/pages/admin/CustomerAppUsers.tsx](../../../packages/web/src/pages/admin/CustomerAppUsers.tsx) |
| مكوّن واجهة | [web/src/components/appAccounts/BulkActivateModal.tsx](../../../packages/web/src/components/appAccounts/BulkActivateModal.tsx) |
| مكوّن واجهة | [web/src/components/appAccounts/ClientAppAccountCard.tsx](../../../packages/web/src/components/appAccounts/ClientAppAccountCard.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/adminAccountRequests.ts](../../../packages/api/routes/adminAccountRequests.ts) |
| مسار API | [api/routes/adminAppAccounts.ts](../../../packages/api/routes/adminAppAccounts.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/adminAccountRequestService.ts](../../../packages/api/services/appAccounts/adminAccountRequestService.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/adminAppAccountService.ts](../../../packages/api/services/appAccounts/adminAppAccountService.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/appAccountListService.ts](../../../packages/api/services/appAccounts/appAccountListService.ts) |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف |
|---|---|
| نوع/قاعدة مشتركة | [shared/appAccounts.ts](../../../packages/shared/appAccounts.ts) |

<details><summary>الاختبارات (2)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/services/appAccounts/adminAppAccountBulkPolicy.test.ts](../../../packages/api/services/appAccounts/adminAppAccountBulkPolicy.test.ts) |
| اختبار | [api/services/appAccounts/appAccountListService.test.ts](../../../packages/api/services/appAccounts/appAccountListService.test.ts) |

</details>

### القوائم المرجعية وأنواع المهام وإعدادات النظام

| | |
|---|---|
| مسارات الصفحات | `/system-lists`، `/admin/task-types`، `/admin/emergency-action-types`، `/settings` |
| مسارات الـ API | `/api/admin/emergency-action-types`، `/api/admin/task-types`، `/api/system-lists`، `/api/system-settings` |
| عدد الملفات | واجهة 7، خادم 7، اختبارات 3 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/admin/EmergencyActionTypes.tsx](../../../packages/web/src/pages/admin/EmergencyActionTypes.tsx) |
| صفحة | [web/src/pages/admin/SystemLists.tsx](../../../packages/web/src/pages/admin/SystemLists.tsx) |
| صفحة | [web/src/pages/admin/TaskTypes.tsx](../../../packages/web/src/pages/admin/TaskTypes.tsx) |
| صفحة | [web/src/pages/SystemSettings.tsx](../../../packages/web/src/pages/SystemSettings.tsx) |
| حالة (store/hook) | [web/src/hooks/useSystemList.ts](../../../packages/web/src/hooks/useSystemList.ts) |
| حالة (store/hook) | [web/src/hooks/useSystemListItems.ts](../../../packages/web/src/hooks/useSystemListItems.ts) |
| حالة (store/hook) | [web/src/hooks/useSystemLists.ts](../../../packages/web/src/hooks/useSystemLists.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/emergencyActionTypes.ts](../../../packages/api/routes/emergencyActionTypes.ts) |
| مسار API | [api/routes/systemLists.ts](../../../packages/api/routes/systemLists.ts) |
| مسار API | [api/routes/systemSettings.ts](../../../packages/api/routes/systemSettings.ts) |
| مسار API | [api/routes/systemSettingsValidation.ts](../../../packages/api/routes/systemSettingsValidation.ts) |
| مسار API | [api/routes/taskTypeConfig.ts](../../../packages/api/routes/taskTypeConfig.ts) |
| خدمة/منطق عمل | [api/services/referenceValueService.ts](../../../packages/api/services/referenceValueService.ts) |
| خدمة/منطق عمل | [api/services/systemSettings.ts](../../../packages/api/services/systemSettings.ts) |

<details><summary>الاختبارات (3)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/systemSettingsValidation.test.ts](../../../packages/api/routes/systemSettingsValidation.test.ts) |
| اختبار | [api/services/referenceValueService.test.ts](../../../packages/api/services/referenceValueService.test.ts) |
| اختبار | [web/src/pages/SystemSettings.contract.test.ts](../../../packages/web/src/pages/SystemSettings.contract.test.ts) |

</details>

### إدارة تطبيق الزبائن (البانرات، الإشعارات، الروابط)

| | |
|---|---|
| مسارات الصفحات | `/admin/app-home-banners`، `/admin/app-notifications`، `/admin/app-contact-links` |
| مسارات الـ API | `/api/admin/app-contact-links`، `/api/admin/app-home-banners`، `/api/admin/app-notifications` |
| عدد الملفات | واجهة 3، خادم 7، اختبارات 6 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/admin/AppContactLinks.tsx](../../../packages/web/src/pages/admin/AppContactLinks.tsx) |
| صفحة | [web/src/pages/admin/AppHomeBanners.tsx](../../../packages/web/src/pages/admin/AppHomeBanners.tsx) |
| صفحة | [web/src/pages/admin/AppNotifications.tsx](../../../packages/web/src/pages/admin/AppNotifications.tsx) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/adminAppNotifications.ts](../../../packages/api/routes/adminAppNotifications.ts) |
| مسار API | [api/routes/appContactLinks.ts](../../../packages/api/routes/appContactLinks.ts) |
| مسار API | [api/routes/appHomeBanners.ts](../../../packages/api/routes/appHomeBanners.ts) |
| خدمة/منطق عمل | [api/services/appContactLinks.ts](../../../packages/api/services/appContactLinks.ts) |
| خدمة/منطق عمل | [api/services/appHomeBanners.ts](../../../packages/api/services/appHomeBanners.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/broadcastDestinations.ts](../../../packages/api/services/appNotifications/broadcastDestinations.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/broadcastService.ts](../../../packages/api/services/appNotifications/broadcastService.ts) |

<details><summary>الاختبارات (6)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/routes/appContactLinks.contract.test.ts](../../../packages/api/routes/appContactLinks.contract.test.ts) |
| اختبار | [api/services/appContactLinks.test.ts](../../../packages/api/services/appContactLinks.test.ts) |
| اختبار | [api/services/appHomeBanners.test.ts](../../../packages/api/services/appHomeBanners.test.ts) |
| اختبار | [api/services/appNotifications/broadcastDestinations.test.ts](../../../packages/api/services/appNotifications/broadcastDestinations.test.ts) |
| اختبار | [api/services/appNotifications/broadcastService.test.ts](../../../packages/api/services/appNotifications/broadcastService.test.ts) |
| اختبار | [web/src/pages/admin/AppContactLinks.contract.test.ts](../../../packages/web/src/pages/admin/AppContactLinks.contract.test.ts) |

</details>

## خارج القائمة

### واجهة تطبيق الزبائن (موبايل) — خادم فقط

| | |
|---|---|
| مسارات الصفحات | لا توجد صفحات (خادم فقط) |
| مسارات الـ API | `/account-deletion`، `/api/app`، `/api/app/catalog/branches`، `/api/app/catalog/device-request-purposes`، `/api/app/catalog/devices`، `/api/app/notifications`، `/api/app/otp`، `/api/app/service-requests` |
| عدد الملفات | واجهة 0، خادم 52، اختبارات 22 |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/appAccount.ts](../../../packages/api/routes/appAccount.ts) |
| مسار API | [api/routes/appAuth.ts](../../../packages/api/routes/appAuth.ts) |
| مسار API | [api/routes/appBranchCatalog.ts](../../../packages/api/routes/appBranchCatalog.ts) |
| مسار API | [api/routes/appComplaints.ts](../../../packages/api/routes/appComplaints.ts) |
| مسار API | [api/routes/appDeviceCatalog.ts](../../../packages/api/routes/appDeviceCatalog.ts) |
| مسار API | [api/routes/appDeviceRequestPurposeCatalog.ts](../../../packages/api/routes/appDeviceRequestPurposeCatalog.ts) |
| مسار API | [api/routes/appDevices.ts](../../../packages/api/routes/appDevices.ts) |
| مسار API | [api/routes/appHome.ts](../../../packages/api/routes/appHome.ts) |
| مسار API | [api/routes/appNotifications.ts](../../../packages/api/routes/appNotifications.ts) |
| مسار API | [api/routes/appOtp.ts](../../../packages/api/routes/appOtp.ts) |
| مسار API | [api/routes/appServiceRequests.ts](../../../packages/api/routes/appServiceRequests.ts) |
| مسار API | [api/routes/appVisits.ts](../../../packages/api/routes/appVisits.ts) |
| مسار API | [api/routes/mobileServiceRequestMedia.ts](../../../packages/api/routes/mobileServiceRequestMedia.ts) |
| مسار API | [api/routes/publicAccountDeletion.ts](../../../packages/api/routes/publicAccountDeletion.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/accountDeletionService.ts](../../../packages/api/services/appAccounts/accountDeletionService.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/accountDuplicatePolicy.ts](../../../packages/api/services/appAccounts/accountDuplicatePolicy.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/accountRequestService.ts](../../../packages/api/services/appAccounts/accountRequestService.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/appAuthService.ts](../../../packages/api/services/appAccounts/appAuthService.ts) |
| خدمة/منطق عمل | [api/services/appAccounts/appProfileService.ts](../../../packages/api/services/appAccounts/appProfileService.ts) |
| خدمة/منطق عمل | [api/services/appBranchCatalogService.ts](../../../packages/api/services/appBranchCatalogService.ts) |
| خدمة/منطق عمل | [api/services/appDeviceCatalogService.ts](../../../packages/api/services/appDeviceCatalogService.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/fcmPushSender.ts](../../../packages/api/services/appNotifications/fcmPushSender.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/notificationCatalog.ts](../../../packages/api/services/appNotifications/notificationCatalog.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/notificationService.ts](../../../packages/api/services/appNotifications/notificationService.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/notify.ts](../../../packages/api/services/appNotifications/notify.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/outboxConsumer.ts](../../../packages/api/services/appNotifications/outboxConsumer.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/outboxJob.ts](../../../packages/api/services/appNotifications/outboxJob.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/pushDispatcher.ts](../../../packages/api/services/appNotifications/pushDispatcher.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/pushSender.ts](../../../packages/api/services/appNotifications/pushSender.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/timeSweep.ts](../../../packages/api/services/appNotifications/timeSweep.ts) |
| خدمة/منطق عمل | [api/services/appNotifications/timeSweepJob.ts](../../../packages/api/services/appNotifications/timeSweepJob.ts) |
| خدمة/منطق عمل | [api/services/complaints/mobileComplaintService.ts](../../../packages/api/services/complaints/mobileComplaintService.ts) |
| خدمة/منطق عمل | [api/services/geo/mobileServiceAddress.ts](../../../packages/api/services/geo/mobileServiceAddress.ts) |
| خدمة/منطق عمل | [api/services/otp/otpSender.ts](../../../packages/api/services/otp/otpSender.ts) |
| خدمة/منطق عمل | [api/services/otp/otpService.ts](../../../packages/api/services/otp/otpService.ts) |
| خدمة/منطق عمل | [api/services/otp/raselOtpSender.ts](../../../packages/api/services/otp/raselOtpSender.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileAgentLicenseIntake.ts](../../../packages/api/services/serviceRequests/mobileAgentLicenseIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileAttachmentIntake.ts](../../../packages/api/services/serviceRequests/mobileAttachmentIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileDeviceRequestIntake.ts](../../../packages/api/services/serviceRequests/mobileDeviceRequestIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileEmergencyMaintenanceIntake.ts](../../../packages/api/services/serviceRequests/mobileEmergencyMaintenanceIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileExecutableTypes.ts](../../../packages/api/services/serviceRequests/mobileExecutableTypes.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileGoldenWarrantyIntake.ts](../../../packages/api/services/serviceRequests/mobileGoldenWarrantyIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileIntakeExecution.ts](../../../packages/api/services/serviceRequests/mobileIntakeExecution.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileIntakeIdentity.ts](../../../packages/api/services/serviceRequests/mobileIntakeIdentity.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileIntakeRegistry.ts](../../../packages/api/services/serviceRequests/mobileIntakeRegistry.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileIntakeThrottle.ts](../../../packages/api/services/serviceRequests/mobileIntakeThrottle.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileNameNominationIntake.ts](../../../packages/api/services/serviceRequests/mobileNameNominationIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobilePeriodicMaintenanceIntake.ts](../../../packages/api/services/serviceRequests/mobilePeriodicMaintenanceIntake.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileRequestQuotaSettings.ts](../../../packages/api/services/serviceRequests/mobileRequestQuotaSettings.ts) |
| خدمة/منطق عمل | [api/services/serviceRequests/mobileWaterCheckIntake.ts](../../../packages/api/services/serviceRequests/mobileWaterCheckIntake.ts) |
| بنية/مساعد | [api/middleware/appAuth.ts](../../../packages/api/middleware/appAuth.ts) |
| بنية/مساعد | [api/middleware/rateLimit.ts](../../../packages/api/middleware/rateLimit.ts) |

<details><summary>الاختبارات (22)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/middleware/rateLimit.test.ts](../../../packages/api/middleware/rateLimit.test.ts) |
| اختبار | [api/routes/appDeviceCatalog.test.ts](../../../packages/api/routes/appDeviceCatalog.test.ts) |
| اختبار | [api/routes/appDevices.contract.test.ts](../../../packages/api/routes/appDevices.contract.test.ts) |
| اختبار | [api/routes/mobileServiceRequestMedia.test.ts](../../../packages/api/routes/mobileServiceRequestMedia.test.ts) |
| اختبار | [api/services/appAccounts/accountDuplicatePolicy.test.ts](../../../packages/api/services/appAccounts/accountDuplicatePolicy.test.ts) |
| اختبار | [api/services/appAccounts/accountRequestSnapshot.test.ts](../../../packages/api/services/appAccounts/accountRequestSnapshot.test.ts) |
| اختبار | [api/services/appAccounts/appProfileService.test.ts](../../../packages/api/services/appAccounts/appProfileService.test.ts) |
| اختبار | [api/services/appBranchCatalogService.test.ts](../../../packages/api/services/appBranchCatalogService.test.ts) |
| اختبار | [api/services/appDeviceCatalogService.test.ts](../../../packages/api/services/appDeviceCatalogService.test.ts) |
| اختبار | [api/services/appNotifications/notificationService.test.ts](../../../packages/api/services/appNotifications/notificationService.test.ts) |
| اختبار | [api/services/appNotifications/notify.test.ts](../../../packages/api/services/appNotifications/notify.test.ts) |
| اختبار | [api/services/appNotifications/outboxConsumer.test.ts](../../../packages/api/services/appNotifications/outboxConsumer.test.ts) |
| اختبار | [api/services/appNotifications/pushDispatcher.test.ts](../../../packages/api/services/appNotifications/pushDispatcher.test.ts) |
| اختبار | [api/services/appNotifications/timeSweep.test.ts](../../../packages/api/services/appNotifications/timeSweep.test.ts) |
| اختبار | [api/services/otp/raselOtpSender.killswitch.test.ts](../../../packages/api/services/otp/raselOtpSender.killswitch.test.ts) |
| اختبار | [api/services/otp/raselOtpSender.test.ts](../../../packages/api/services/otp/raselOtpSender.test.ts) |
| اختبار | [api/services/serviceRequests/mobileIntakeIdentity.test.ts](../../../packages/api/services/serviceRequests/mobileIntakeIdentity.test.ts) |
| اختبار | [api/services/serviceRequests/mobileIntakeRegistry.test.ts](../../../packages/api/services/serviceRequests/mobileIntakeRegistry.test.ts) |
| اختبار | [api/services/serviceRequests/mobileIntakeThrottle.test.ts](../../../packages/api/services/serviceRequests/mobileIntakeThrottle.test.ts) |
| اختبار | [api/services/serviceRequests/mobilePartyOptionalFieldsContract.test.ts](../../../packages/api/services/serviceRequests/mobilePartyOptionalFieldsContract.test.ts) |
| اختبار | [api/services/serviceRequests/mobileReferrerAddressContract.test.ts](../../../packages/api/services/serviceRequests/mobileReferrerAddressContract.test.ts) |
| اختبار | [api/services/serviceRequests/mobileWaterCheckIntake.test.ts](../../../packages/api/services/serviceRequests/mobileWaterCheckIntake.test.ts) |

</details>

### تسجيل الدخول والجلسة

| | |
|---|---|
| مسارات الصفحات | `/login` |
| مسارات الـ API | `/api/auth` |
| عدد الملفات | واجهة 2، خادم 5، اختبارات 0 |

#### الواجهة (Frontend)

| النوع | الملف |
|---|---|
| صفحة | [web/src/pages/auth/Login.tsx](../../../packages/web/src/pages/auth/Login.tsx) |
| حالة (store/hook) | [web/src/hooks/useAuthStore.ts](../../../packages/web/src/hooks/useAuthStore.ts) |

#### الخادم (Backend)

| النوع | الملف |
|---|---|
| مسار API | [api/routes/auth.ts](../../../packages/api/routes/auth.ts) |
| خدمة/منطق عمل | [api/services/authService.ts](../../../packages/api/services/authService.ts) |
| خدمة/منطق عمل | [api/services/sessionUserService.ts](../../../packages/api/services/sessionUserService.ts) |
| وصول للبيانات | [api/repositories/authRepository.ts](../../../packages/api/repositories/authRepository.ts) |
| بنية/مساعد | [api/middleware/auth.ts](../../../packages/api/middleware/auth.ts) |

## مشترك بين عدة أقسام

ملفات يستخدمها من 2 إلى 5 أقسام. أي تعديل عليها يجب اختباره في كل الأقسام المذكورة.

| النوع | الملف | يستخدمه |
|---|---|---|
| مكوّن واجهة | [web/src/components/filters/GeoCascadeFilter.tsx](../../../packages/web/src/components/filters/GeoCascadeFilter.tsx) | التقارير، إدارة تطبيق الزبائن (البانرات، الإشعارات، الروابط)، الأجهزة وقطع الغيار والأجهزة المركّبة |
| مكوّن واجهة | [web/src/components/MapPicker.tsx](../../../packages/web/src/components/MapPicker.tsx) | الزبائن، العقود، الأجهزة وقطع الغيار والأجهزة المركّبة، طلبات الخدمة (عامة، فحص المياه، الأجهزة، الصيانة الدورية، الكفالة الذهبية)، تسليم وتركيب وتشغيل وفك الأجهزة |
| مساعد/إعداد | [web/src/lib/callDateTime.ts](../../../packages/web/src/lib/callDateTime.ts) | الزبائن، الاتصالات والمواعيد |
| مساعد/إعداد | [web/src/lib/contactRules.ts](../../../packages/web/src/lib/contactRules.ts) | الزبائن، الأسماء المقترحة وجلسات الترشيح، الموظفون والأقسام، الاتصالات والمواعيد، التوظيف (الشواغر، الطلبات، المقابلات، الدورات) |
| مساعد/إعداد | [web/src/lib/geoPath.ts](../../../packages/web/src/lib/geoPath.ts) | المناطق الإدارية وخطوط السير، الزبائن |
| مساعد/إعداد | [web/src/lib/geoUnitsCache.ts](../../../packages/web/src/lib/geoUnitsCache.ts) | المناطق الإدارية وخطوط السير، محرك المهام المشترك ومهامي، الزبائن |
| اختبار | [web/src/lib/callDateTime.test.ts](../../../packages/web/src/lib/callDateTime.test.ts) | الزبائن، الاتصالات والمواعيد |

## البنية الأساسية المشتركة

الهيكل الذي تعتمد عليه كل الأقسام: نقطة تشغيل الخادم والواجهة، الاتصال بقاعدة البيانات، الإعدادات، التحقق من الصلاحيات، التخطيط العام للصفحة، مكونات الواجهة الأساسية (`components/ui`)، عميل الـ API، رفع الملفات والوسائط.

#### الواجهة (Frontend)

| النوع | الملف | يستخدمه |
|---|---|---|
| مكوّن واجهة | [web/src/components/BranchScopeIndicator.tsx](../../../packages/web/src/components/BranchScopeIndicator.tsx) | الكل |
| مكوّن واجهة | [web/src/components/BranchSwitcher.tsx](../../../packages/web/src/components/BranchSwitcher.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ErrorBoundary.tsx](../../../packages/web/src/components/ErrorBoundary.tsx) | الكل |
| مكوّن واجهة | [web/src/components/FloatingActionButton.tsx](../../../packages/web/src/components/FloatingActionButton.tsx) | الكل |
| مكوّن واجهة | [web/src/components/GeoSmartSearch.tsx](../../../packages/web/src/components/GeoSmartSearch.tsx) | 10 أقسام |
| مكوّن واجهة | [web/src/components/PermissionGate.tsx](../../../packages/web/src/components/PermissionGate.tsx) | الكل |
| مكوّن واجهة | [web/src/components/RequireBranchContext.tsx](../../../packages/web/src/components/RequireBranchContext.tsx) | الكل |
| مكوّن واجهة | [web/src/components/SmartTable.tsx](../../../packages/web/src/components/SmartTable.tsx) | الكل |
| مكوّن واجهة | [web/src/components/tableExport.ts](../../../packages/web/src/components/tableExport.ts) | الكل |
| مكوّن واجهة | [web/src/components/ui/Badge.tsx](../../../packages/web/src/components/ui/Badge.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Button.tsx](../../../packages/web/src/components/ui/Button.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Card.tsx](../../../packages/web/src/components/ui/Card.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Checkbox.tsx](../../../packages/web/src/components/ui/Checkbox.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/DataTable.tsx](../../../packages/web/src/components/ui/DataTable.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/DateField.tsx](../../../packages/web/src/components/ui/DateField.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/DatePicker.tsx](../../../packages/web/src/components/ui/DatePicker.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/IconButton.tsx](../../../packages/web/src/components/ui/IconButton.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/icons.ts](../../../packages/web/src/components/ui/icons.ts) | الكل |
| مكوّن واجهة | [web/src/components/ui/Input.tsx](../../../packages/web/src/components/ui/Input.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Modal.tsx](../../../packages/web/src/components/ui/Modal.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/PageHeader.tsx](../../../packages/web/src/components/ui/PageHeader.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/ProfileBreadcrumbBar.tsx](../../../packages/web/src/components/ui/ProfileBreadcrumbBar.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/ProfileTabsBar.tsx](../../../packages/web/src/components/ui/ProfileTabsBar.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Select.tsx](../../../packages/web/src/components/ui/Select.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Tabs.tsx](../../../packages/web/src/components/ui/Tabs.tsx) | الكل |
| مكوّن واجهة | [web/src/components/ui/Toggle.tsx](../../../packages/web/src/components/ui/Toggle.tsx) | الكل |
| حالة (store/hook) | [web/src/hooks/useBranchContextStore.ts](../../../packages/web/src/hooks/useBranchContextStore.ts) | الكل |
| حالة (store/hook) | [web/src/hooks/useBranchListScope.ts](../../../packages/web/src/hooks/useBranchListScope.ts) | الكل |
| حالة (store/hook) | [web/src/hooks/useBranchStore.ts](../../../packages/web/src/hooks/useBranchStore.ts) | الكل |
| حالة (store/hook) | [web/src/hooks/usePermissions.ts](../../../packages/web/src/hooks/usePermissions.ts) | الكل |
| مساعد/إعداد | [web/index.html](../../../packages/web/index.html) | الكل |
| مساعد/إعداد | [web/src/App.tsx](../../../packages/web/src/App.tsx) | الكل |
| مساعد/إعداد | [web/src/index.css](../../../packages/web/src/index.css) | الكل |
| مساعد/إعداد | [web/src/layout/MainLayout.tsx](../../../packages/web/src/layout/MainLayout.tsx) | الكل |
| مساعد/إعداد | [web/src/lib/api.ts](../../../packages/web/src/lib/api.ts) | الكل |
| مساعد/إعداد | [web/src/lib/authFetch.ts](../../../packages/web/src/lib/authFetch.ts) | الكل |
| مساعد/إعداد | [web/src/lib/branchContext.ts](../../../packages/web/src/lib/branchContext.ts) | الكل |
| مساعد/إعداد | [web/src/lib/branchScope.ts](../../../packages/web/src/lib/branchScope.ts) | الكل |
| مساعد/إعداد | [web/src/lib/createFetchStore.ts](../../../packages/web/src/lib/createFetchStore.ts) | الكل |
| مساعد/إعداد | [web/src/lib/createFilterStore.ts](../../../packages/web/src/lib/createFilterStore.ts) | الكل |
| مساعد/إعداد | [web/src/lib/deviceClass.ts](../../../packages/web/src/lib/deviceClass.ts) | الكل |
| مساعد/إعداد | [web/src/lib/hiddenFeatures.ts](../../../packages/web/src/lib/hiddenFeatures.ts) | الكل |
| مساعد/إعداد | [web/src/lib/trpc-contract.ts](../../../packages/web/src/lib/trpc-contract.ts) | الكل |
| مساعد/إعداد | [web/src/lib/trpc.ts](../../../packages/web/src/lib/trpc.ts) | الكل |
| مساعد/إعداد | [web/src/lib/types.ts](../../../packages/web/src/lib/types.ts) | الكل |
| مساعد/إعداد | [web/src/lib/uiId.ts](../../../packages/web/src/lib/uiId.ts) | الكل |
| مساعد/إعداد | [web/src/lib/uploadFile.ts](../../../packages/web/src/lib/uploadFile.ts) | الكل |
| مساعد/إعداد | [web/src/lib/uploadMedia.ts](../../../packages/web/src/lib/uploadMedia.ts) | الكل |
| مساعد/إعداد | [web/src/main.tsx](../../../packages/web/src/main.tsx) | الكل |
| مساعد/إعداد | [web/src/vite-env.d.ts](../../../packages/web/src/vite-env.d.ts) | الكل |
| مساعد/إعداد | [web/vite.config.ts](../../../packages/web/vite.config.ts) | الكل |

#### الخادم (Backend)

| النوع | الملف | يستخدمه |
|---|---|---|
| مسار API | [api/routes/media.ts](../../../packages/api/routes/media.ts) | الكل |
| مسار API | [api/routes/mediaServe.ts](../../../packages/api/routes/mediaServe.ts) | الكل |
| مسار API | [api/routes/upload.ts](../../../packages/api/routes/upload.ts) | الكل |
| tRPC | [api/trpc/init.ts](../../../packages/api/trpc/init.ts) | الكل |
| tRPC | [api/trpc/router.ts](../../../packages/api/trpc/router.ts) | الكل |
| خدمة/منطق عمل | [api/services/authorizationService.ts](../../../packages/api/services/authorizationService.ts) | الكل |
| خدمة/منطق عمل | [api/services/deviceClass.ts](../../../packages/api/services/deviceClass.ts) | الكل |
| خدمة/منطق عمل | [api/services/media/mediaAttachments.ts](../../../packages/api/services/media/mediaAttachments.ts) | الكل |
| خدمة/منطق عمل | [api/services/media/mediaInspect.ts](../../../packages/api/services/media/mediaInspect.ts) | الكل |
| خدمة/منطق عمل | [api/services/media/mediaOwnership.ts](../../../packages/api/services/media/mediaOwnership.ts) | الكل |
| خدمة/منطق عمل | [api/services/media/mediaService.ts](../../../packages/api/services/media/mediaService.ts) | الكل |
| خدمة/منطق عمل | [api/services/media/mediaStorage.ts](../../../packages/api/services/media/mediaStorage.ts) | الكل |
| خدمة/منطق عمل | [api/services/webDeviceAccessPolicy.ts](../../../packages/api/services/webDeviceAccessPolicy.ts) | الكل |
| بنية/مساعد | [api/cluster.ts](../../../packages/api/cluster.ts) | الكل |
| بنية/مساعد | [api/config/env.ts](../../../packages/api/config/env.ts) | الكل |
| بنية/مساعد | [api/db.ts](../../../packages/api/db.ts) | الكل |
| بنية/مساعد | [api/index.ts](../../../packages/api/index.ts) | الكل |
| بنية/مساعد | [api/middleware/apiErrorHandler.ts](../../../packages/api/middleware/apiErrorHandler.ts) | الكل |
| بنية/مساعد | [api/middleware/permission.ts](../../../packages/api/middleware/permission.ts) | الكل |
| بنية/مساعد | [api/migrate.ts](../../../packages/api/migrate.ts) | الكل |
| بنية/مساعد | [api/start.ts](../../../packages/api/start.ts) | الكل |
| بنية/مساعد | [api/storage/uploader.ts](../../../packages/api/storage/uploader.ts) | الكل |
| بنية/مساعد | [api/swagger.ts](../../../packages/api/swagger.ts) | الكل |
| بنية/مساعد | [api/utils/appErrors.ts](../../../packages/api/utils/appErrors.ts) | الكل |
| بنية/مساعد | [api/utils/auditLog.ts](../../../packages/api/utils/auditLog.ts) | الكل |
| بنية/مساعد | [api/utils/contactValidation.ts](../../../packages/api/utils/contactValidation.ts) | الكل |
| بنية/مساعد | [api/utils/phoneSql.ts](../../../packages/api/utils/phoneSql.ts) | الكل |
| بنية/مساعد | [api/utils/sanitize.ts](../../../packages/api/utils/sanitize.ts) | الكل |

#### الحزمة المشتركة (packages/shared)

| النوع | الملف | يستخدمه |
|---|---|---|
| نوع/قاعدة مشتركة | [shared/index.ts](../../../packages/shared/index.ts) | الكل |
| نوع/قاعدة مشتركة | [shared/types.ts](../../../packages/shared/types.ts) | الكل |
| نوع/قاعدة مشتركة | [shared/types/auth.ts](../../../packages/shared/types/auth.ts) | الكل |
| نوع/قاعدة مشتركة | [shared/types/authorization.ts](../../../packages/shared/types/authorization.ts) | الكل |

<details><summary>الاختبارات (12)</summary>

| النوع | الملف |
|---|---|
| اختبار | [api/middleware/apiErrorHandler.test.ts](../../../packages/api/middleware/apiErrorHandler.test.ts) |
| اختبار | [api/services/authorizationScopeCatalog.test.ts](../../../packages/api/services/authorizationScopeCatalog.test.ts) |
| اختبار | [api/services/deviceClass.test.ts](../../../packages/api/services/deviceClass.test.ts) |
| اختبار | [api/services/media/mediaAttachments.test.ts](../../../packages/api/services/media/mediaAttachments.test.ts) |
| اختبار | [api/services/media/mediaStorage.test.ts](../../../packages/api/services/media/mediaStorage.test.ts) |
| اختبار | [api/services/webDeviceAccessPolicy.test.ts](../../../packages/api/services/webDeviceAccessPolicy.test.ts) |
| اختبار | [api/utils/appErrors.test.ts](../../../packages/api/utils/appErrors.test.ts) |
| اختبار | [web/src/App.branchContext.contract.test.ts](../../../packages/web/src/App.branchContext.contract.test.ts) |
| اختبار | [web/src/components/SmartTable.layout.test.ts](../../../packages/web/src/components/SmartTable.layout.test.ts) |
| اختبار | [web/src/components/tableExport.test.ts](../../../packages/web/src/components/tableExport.test.ts) |
| اختبار | [web/src/layout/MainLayout.navigation.contract.test.ts](../../../packages/web/src/layout/MainLayout.navigation.contract.test.ts) |
| اختبار | [web/src/lib/uiId.test.ts](../../../packages/web/src/lib/uiId.test.ts) |

</details>
