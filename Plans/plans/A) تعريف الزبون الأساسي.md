**A) تعريف الزبون الأساسي**
- الكيان الأساسي هو `clients` / `Client`.
- تعريف الجدول في [migrations/001_core_tables.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/001_core_tables.sql:30).
- واجهة الـ API له في [packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:18).
- أهم حقول الهوية والتواصل:
  - `id`, `first_name`, `father_name`, `last_name`, `nickname`, `name`
  - `mobile`, `contacts`
  - `gender`, `national_id`, `birth_date`
  - `governorate`, `district`, `neighborhood`, `detailed_address`, `gps_coordinates`
- حقول تدل على منشئ الزبون:
  - `created_by` موجود في DB عبر [migrations/041_clients_created_by.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/041_clients_created_by.sql:4)
  - يظهر في الـ API كـ `createdByUserId`, `createdByUserName`, `createdByRoleDisplayName` في [clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:58)
- حقول تدل على مصدر الزبون:
  - `source_channel`
  - `referrer_type`
  - `referrer_id`
  - `referrer_name`
  - `referral_notes`
  - `referral_entity_id`
  - `referral_date`
  - `referral_reason`
  - `referral_sheet_id`
  - `referral_address_text`
  - `referrers` كـ JSONB
- لا يوجد في `clients` جدول مصادر منفصل؛ الموجود هو حقول مصدر أساسية + مصفوفة `referrers`.

**B) من يستطيع إنشاء زبون حالياً؟**
- الإنشاء الخلفي يتم عبر `POST /api/clients` في [packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:515) ويتطلب صلاحية `clients.create`.
- الواجهة الأساسية للإنشاء هي `ClientModal` في [packages/web/src/components/ClientModal.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/components/ClientModal.tsx:24)، وتُستخدم من صفحة العملاء [packages/web/src/pages/Clients.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/pages/Clients.tsx:189).
- يوجد أيضًا إنشاء زبون من مسار تأهيل `Candidate` داخل [packages/web/src/hooks/useCandidateStore.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/hooks/useCandidateStore.ts:156) عبر `api.clients.create(...)`.
- البيانات المطلوبة عمليًا:
  - أهم إلزامي: `name` و`mobile` بعد التطبيع، مع `contacts` أو fallback إلى `mobile`
  - ويُرسل كذلك الفرع `branchId` وحقول المصدر/الوسيط والبيانات الجغرافية وغيرها
- هل المستخدم الحالي يُحفظ كمنشئ؟
  - نعم، backend يحفظ `created_by = authContext.userId` عند الإنشاء في [clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:565)
- هل يُربط الزبون بموظف أو مشرفة أو فرع؟
  - نعم بالفرع `branch_id`
  - نعم يمكن ربطه بعدة موظفين عبر `client_assignments`
  - وإذا لم يكن المستخدم super admin فالمستخدم الحالي يُفرض ضمن `assignmentUserIds`
- هل يوجد فرق حسب الدور؟
  - منطق الدور ليس “نوع منشئ مختلف” داخل جدول الزبون، بل permission/policy على من يقدر ينشئ ولأي branch ولمن يُسند
  - لا يوجد حقل مستقل يقول “هذا الزبون أُنشئ من مشرفة” مقابل “من مدير فرع” إلا عبر `created_by` ثم اسم/دور المنشئ في الـ join

**C) كيف يتعامل النظام مع تكرار نفس الزبون؟**
- يوجد منع تكرار فعلي للـ `Client`.
- أساس المنع: رقم الهاتف فقط بعد normalization، سواء في `mobile` أو داخل `contacts`.
- المنع موجود في الـ API نفسه، وليس فقط في الواجهة:
  - `findDuplicateClientByPhone(...)` في [packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:227)
  - ويُستخدم قبل الإنشاء والتعديل في [clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:549)
- لا يوجد `UNIQUE` constraint على `clients.mobile` أو `national_id` في المايغريشنز التي راجعتها؛ المنع هنا logic-level في الـ API، وليس DB constraint.
- لا يوجد منع على الاسم بحد ذاته، ولا على الرقم الوطني.
- ماذا يحدث إذا حاول موظف ثانٍ إدخال نفس الزبون؟
  - يُرفض إنشاء `Client` بـ `409` و`DUPLICATE_CLIENT_PHONE`
  - إذا كان له حق رؤية السجل الموجود، يحصل على `MATCH_VISIBLE`
  - إذا كان السجل خارج نطاق رؤيته، يحصل على `MATCH_RESTRICTED`
- لا يوجد دمج تلقائي.
- لا يوجد تسجيل تلقائي للمحاولة الجديدة كمصدر جديد على نفس الزبون في مسار `POST /clients`.
- توجد شاشة ورسالة واضحة في الواجهة عبر `smartMatch`:
  - [packages/web/src/components/candidates/ManualSearchModal.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/components/candidates/ManualSearchModal.tsx:95)
  - [packages/web/src/components/candidates/QualificationModal.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/components/candidates/QualificationModal.tsx:207)

**D) هل يوجد مفهوم "اسم مقترح" أو Candidate؟**
- نعم، `Candidate` جدول مستقل.
- تعريفه في [migrations/001_core_tables.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/001_core_tables.sql:83).
- الـ API في [packages/api/routes/candidates.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/candidates.ts:216).
- من ينشئ Candidate؟
  - من الواجهة `AddCandidateModal` في [packages/web/src/components/candidates/AddCandidateModal.tsx](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/components/candidates/AddCandidateModal.tsx:355)
  - عبر `api.candidates.create`
- هل Candidate مرتبط بمنشئ/موظف/مشرفة؟
  - نعم، عنده `created_by`
  - نعم، عنده `owner_user_id` legacy
  - نعم، عنده `candidate_assignments` متعددين
  - نعم، عنده `branch_id`
- هل يتحول إلى Client؟
  - نعم، عبر `qualifyCandidate(...)` في [useCandidateStore.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/hooks/useCandidateStore.ts:156)
  - ويوجد الربط الرجوعي `convertedToLeadId` على الـ candidate
- عند التحويل إلى Client، هل يُحفظ مصدره الأصلي؟
  - نعم جزئيًا: مسار التأهيل يمرر `sourceChannel`, `referrerType`, `referrerName`, `referralEntityId`, `referralDate`, `referralReason`, `referralSheetId`
- إذا كان Candidate يشبه Client موجودًا:
  - لا يُنشأ Client جديد عند الربط
  - بدل ذلك يُستخدم `linkCandidateToClient(...)` في [useCandidateStore.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/hooks/useCandidateStore.ts:224)
  - هذا المسار يضيف source جديد داخل `client.referrers`

**E) هل يمكن لنفس الزبون أن يظهر عند أكثر من موظف؟**
- نعم.
- لا يبدو أن الزبون له “مالك واحد” فقط كـ source of truth حاليًا.
- الربط التشغيلي الحالي مع الموظفين يتم عبر `client_assignments` many-to-many في [migrations/042_assignments_m2m.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/042_assignments_m2m.sql:6).
- إذًا يمكن ربط نفس الزبون بأكثر من موظف في نفس الوقت.
- يوجد أيضًا `assigned_at` و`assigned_by` داخل `client_assignments`، أي يوجد تاريخ إضافة الربط.
- منشئ الزبون يبقى محفوظًا في `created_by` منفصلًا عن الإسناد.
- إذا خرجت مشرفة من العمل، بنية النظام لا تجعل الزبون “ملكية شخص واحد فقط”؛ الزبون مرتبط بالفرع `branch_id` ويمكن أن يبقى مع Assignments أخرى. على الأقل من schema الحالية، هو ليس ملتصقًا بمنشئ وحيد كمصدر تشغيل دائم.

**F) هل يوجد سجل مصادر متعدد للزبون؟**
- لا يوجد جدول مخصص واضح مثل `client_sources` أو `customer_sources`.
- أقرب شيء موجود حاليًا هو:
  - حقول المصدر الأساسية على `clients`
  - مصفوفة `clients.referrers` من نوع JSONB
  - `candidates`
  - `referral_sheets`
- `referrers` يمكن أن يعمل كسجل مصادر متعدد، لكن:
  - ليس جدولًا مستقلًا
  - لا يُملأ تلقائيًا في كل سيناريو
  - الاستخدام الأوضح له حاليًا هو عند `linkCandidateToClient(...)` لإضافة مرجع جديد على عميل موجود
- `contact_targets` ليس سجل مصدر زبون؛ هو target تشغيلي للتواصل التسويقي على client lead، وليس سجل provenance متعدد.
- `candidates` يمكن اعتباره مسار مصدر/ترشيح مستقل، لكنه ليس سجلًا موحدًا عامًا لكل مصادر الـ client عبر الزمن.
- `audit_logs` موجود كجدول عام في [migrations/002_job_tables.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/002_job_tables.sql:156)، لكن لم أجد استخدامًا له في مسارات `clients` أو `candidates`. استخدامه ظاهر أكثر في مسارات التوظيف، لا في العميل.
- النتيجة: يوجد pieces قريبة من الفكرة، لكن لا يوجد “سجل مصادر متعدد” متكامل وموحّد للعميل.

**G) أمثلة مختصرة من الكود**
```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES hr_users(id)
```
[041_clients_created_by.sql](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/041_clients_created_by.sql:4)

```ts
const duplicate = await findDuplicateClientByPhone(c.mobile);
if (duplicate) {
  return res.status(409).json({ error: 'DUPLICATE_CLIENT_PHONE', ... });
}
```
[packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:549)

```ts
INSERT INTO clients (... source_channel, referrer_type, referrer_name, referrers, ..., branch_id, created_by)
```
[packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:562)

```ts
INSERT INTO client_assignments (client_id, hr_user_id, assigned_by)
```
[packages/api/routes/clients.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/clients.ts:413)

```ts
const newReferrer = {
  referrerType: candidate.referralType,
  referralEntityId: candidate.referralEntityId,
  referrerName: candidate.referralNameSnapshot,
  sourceChannel: candidate.referralOriginChannel,
  referralDate: candidate.referralDate,
  referralReason: candidate.referralReason,
  referralSheetId: candidate.referralSheetId
};
updateData.referrers = [...existingReferrers, newReferrer];
```
[packages/web/src/hooks/useCandidateStore.ts](/D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/hooks/useCandidateStore.ts:233)

**H) الاستنتاج النهائي**
1. نعم، الزبون في النظام اليوم كيان واحد موحد اسمه `Client`.
2. نعم، النظام يحفظ منشئ الزبون الأول عبر `created_by`.
3. نعم، النظام يحفظ “مصدرًا” للزبون، لكن بشكل جزئي عبر حقول مثل `sourceChannel`, `referrerType`, `referrerName` وغيرها.
4. ليس بشكل عام ومنهجي. يوجد دعم جزئي لمصادر متعددة عبر `referrers`، لكنه ليس مسارًا عامًا موحدًا لكل السيناريوهات.
5. إذا أدخل موظفان نفس الزبون كـ `Client` بنفس الهاتف:
   - الإدخال الثاني يُرفض
   - وقد يرى المستخدم السجل الموجود أو يُقال له إنه موجود لكن خارج نطاقه
   - ولا يتم تلقائيًا تسجيل هذا الإدخال الثاني كمصدر جديد على نفس الزبون
6. لا يوجد حاليًا سجل مصادر متعدد مخصص ومنظم ككيان مستقل.
7. `Candidate` و`contact_targets` لا يغطّيان الحاجة كاملة:
   - `Candidate` يغطي جزءًا من الترشيحات والتحويل والربط
   - `contact_targets` يغطي هدف اتصال تسويقي، وليس تاريخ مصادر العميل
8. النظام الحالي قريب جزئيًا من الفكرة المنتجية، لأنه يملك:
   - عميل موحد
   - منشئ أول
   - حقول مصدر
   - وإمكانية إضافة مصادر إضافية يدويًا/جزئيًا عبر `referrers`
   - لكنه ما زال بعيدًا عن نموذج “العميل واحد وله سجل مصادر متعدد عبر الزمن من قنوات وموظفين مختلفين” كنموذج domain واضح ومستخدم في كل المسارات
9. أقل مفهوم ناقص لاحقًا: ليس منع التكرار، بل “سجل مصدر إضافي مستقل أو على الأقل مسار موحد لإضافة source entry جديد إلى العميل الموجود عند كل محاولة/ترشيح/قناة جديدة” بدل أن ينتهي الأمر فقط برفض الإدخال أو ربط candidate بشكل خاص.