# سيناريوهات اختبار End-to-End — صيانة طارئة V1.0

> **الغرض:** التحقّق من تغطية كل قواعد الدستور بسيناريوهات تشغيلية واقعية.
> **النطاق:** V1.0 — emergency_maintenance + قنوات داخلية فقط.
> **المرجع:** [maintenance.md](./maintenance.md)
> **آخر تحديث:** 2026-06-04

## فهرس السيناريوهات

| المجموعة | السيناريو |
|---|---|
| **A. المسارات السعيدة** | SC-01 إلى SC-04 |
| **B. مخارج بديلة** | SC-05 إلى SC-08 |
| **C. الـ Claim و الـ Reopen** | SC-09 إلى SC-12 |
| **D. الـ Linking والـ Duplicates** | SC-13 إلى SC-17 |
| **E. لائحة الأعطال** | SC-18 إلى SC-23 |
| **F. الجهاز الخارجي** | SC-24 إلى SC-25 |
| **G. الـ Immutability والـ Audit** | SC-26 إلى SC-28 |
| **H. حدود الصلاحيات** | SC-29 إلى SC-31 |
| **I. Visit Task Wizard (4 مراحل)** | SC-32 إلى SC-35 |

---

## A. المسارات السعيدة (Happy Paths)

### SC-01 — المسار القياسي الكامل: زبون OP، عطل واحد، إصلاح ناجح

**Persona:** Operator + Technician (فريق قياسي)

**الفرضيات المسبقة:**
- أحمد زبون OP لديه جهاز مُسجَّل (`installed_devices.status = 'active'`).
- جهازه لا يَملك أي open_task نشط.
- الشركة تَملك Operator + Audit Admin مُتاحَين.

**الخطوات:**
1. الموظف يَستلم مكالمة من أحمد ⇒ يَفتح زر "إنشاء صيانة" من تفاصيل الزبون
2. النظام يُنشئ `service_request` بـ:
   - `channel = 'client_detail_button'`
   - `status = 'in_review'` (triager حيّ)
   - `public_ref_number = 'SR-20260604-0001'`
   - `requester_user_id = الموظف`, `beneficiary_client_id = أحمد`, `submission_type = 'apply'`
   - `installed_device_id = جهاز أحمد`, `device_source = 'company_device'`
   - `problem_description = 'الفلتر لا يعمل'`
3. الموظف يُضيف عطلاً واحداً للائحة: نوع = "ضغط منخفض"، تفاصيل = "لا ينزل ماء"
4. الموظف يَضغط promote ⇒ النظام:
   - يُنشئ `open_task` بـ `task_type = 'emergency_maintenance'`, `creation_origin = 'emergency_request'`
   - يُنشئ `open_task_emergency_payload` يَحوي snapshot المُبلَّغ
   - يَنقل العطل إلى ربط `open_task_id`
   - `service_request.status = 'promoted'`, `linked_open_task_id` يُملأ
5. مدير الفرع يُسنِد فريقاً ⇒ يُجدوِل زيارة
6. الفني يَصل، يَبدأ الزيارة، يُدخل قياسات pre
7. الفني يَفحص العطل، يَستبدل قطعة Periodic، يَعمل
8. الفني يُدخل قياسات post + يُسجِّل نتيجة العطل:
   - `service_request_problems.status = 'resolved'`
   - `resolution_visit_task_id` يُملأ
   - `repaired_by_employee_id = الفني نفسه`
   - `resolution_recorded_by_user_id = الفني نفسه`
   - القطعة المُستبدَلة تُسجَّل في `visit_task_parts_used` بـ `maintenance_type = 'Periodic'`
9. النظام يَحسب التسوية المالية: القطعة Periodic + كفالة عقد فعّالة ⇒ تُغطّى
10. `visit_task.final_decision = 'resolved'`، `open_task.status = 'completed'`، `derived_outcome = 'fully_resolved'`

**النتيجة المتوقَّعة:**
- الزبون لا يَدفع شيئاً
- audit log يَحوي: `request_created`, `claimed_by_operator`, `party_linked`, `problem_added`, `promoted_to_task`, `problem_status_changed (resolved)`, `problem_resolution_recorded`

**القواعد المُختبَرة:** SR-R001..R006, SR-AUTH-02, SR-AUTH-06, EM-PROB-05, الإطار الثلاثي (الطبقة 3 المالية)

---

### SC-02 — مسار قياسي بـ multi-problem: 3 أعطال، كلها مَحلولة

**Persona:** Operator + Supervisor + Technician

**الفرضيات:** زبون OP، جهاز مُسجَّل، لا open_task نشط

**الخطوات:**
1. مكالمة، الموظف يَفتح service_request من client_detail_button
2. الزبون يَشكو ثلاثة أمور: "ماء مالح" + "ضوضاء من المضخّة" + "تسريب من الصنبور"
3. الموظف يُضيف 3 أعطال للائحة، كلٌّ بنوعه:
   - "تشبّع الممبرين" → تفاصيل
   - "ضوضاء المضخّة" → تفاصيل
   - "تسريب صنبور" → تفاصيل
4. promote ⇒ كل الـ 3 تَنتقل لـ open_task
5. الزيارة تَتم، الفني:
   - يَستبدل الممبرين (`Emergency`-class)
   - يُحكم تثبيت المضخّة (لا قطعة)
   - يَستبدل أنبوب الصنبور (`Accessory`-class)
6. المشرف يُدخل النتائج (الفني عَمِل):
   - كل عطل بـ `status = 'resolved'`
   - `resolution_recorded_by_user_id = المشرف`
   - `repaired_by_employee_id = الفني` (لكل عطل)
   - الممبرين: `maintenance_type = 'Emergency'` + كفالة ذهبية فعّالة ⇒ مُغطّى
   - الصنبور: `maintenance_type = 'Accessory'` + لا كفالة ذهبية ⇒ الزبون يَدفع

**النتيجة المتوقَّعة:**
- `derived_outcome = 'fully_resolved'`
- التمييز محفوظ: المشرف كَتب، الفني عَمِل (تقارير الأداء تَحفظ الفني)
- الفاتورة سطر-بسطر: الممبرين مجاني، الصنبور مدفوع

**القواعد المُختبَرة:** ٠.١٩.د (تمييز recorded vs repaired)، الطبقة 3 الكاملة (3 تصنيفات قطع + 2 كفالات)

---

### SC-03 — Walk-in لـ Visitor عبر مكالمة هاتفية

**Persona:** Operator + Audit Admin (للموافقة على Candidate)

**الفرضيات:** المُتصِل غير مُسجَّل في النظام

**الخطوات:**
1. مكالمة من رقم غير معروف
2. الموظف يَفتح "إنشاء يدوي" من لوحة الأدمن (channel = `admin_manual`)
3. الـ Operator يَملأ الحقول الإلزامية walk-in:
   - `requester_external.name = 'سامي الخطيب'`
   - `requester_external.primary_phone = '0944111222'`
   - `service_address.governorate = 'دمشق'`
   - `service_address.detailed_address = 'الميدان، شارع الزاوية، بناية 7'`
4. `problem_description = 'الجهاز لا يَعمل من أمس'`
5. النظام يَفحص duplicate: لا تطابق ضمن 72h ⇒ لا flag
6. الـ Operator يَضغط Suggested Matches ⇒ لا تطابق
7. الـ Operator يُنشئ Candidate جديد بـ بيانات سامي ⇒ `beneficiary_candidate_id` يُملأ
8. الـ Operator يَفحص الجهاز: غير مُسجَّل ⇒ `device_source = 'external_device'`، `external_device_name = 'جهاز كذا'`
9. promote ⇒ النظام:
   - يُنشئ `installed_device` خفيف لـ سامي بـ `contract_id = NULL`
   - يُنشئ `open_task` بـ `installed_device_id = الجهاز الجديد`

**النتيجة المتوقَّعة:**
- audit log: `request_created`, `claimed_by_operator`, `candidate_created`, `party_linked`, `promoted_to_task`
- الجهاز الخارجي مُسجَّل دون عقد بيع
- سامي صار Candidate قابلاً للترقية لاحقاً

**القواعد المُختبَرة:** SR-WALKIN-01..06، ٠.١٣ (Device Source `external_device`)، EM-PROB-05

---

### SC-04 — متعدّد الأعطال مع Field Discovery

**Persona:** Operator + Technician

**الفرضيات:** زبون OP، الموظف يَفتح service_request بعطل واحد فقط

**الخطوات:**
1. الموظف يَفتح service_request: عطل واحد فقط (تسريب)
2. promote، الزيارة تَنطلق
3. الفني يَصل، يَفحص العطل الأصلي، يُؤكِّده
4. أثناء الفحص يَكتشف عطلَين إضافيَين: ضغط منخفض + ضعف Ozone
5. الفني يُضيف العطلَين للائحة بـ `added_during_phase = 'field_discovery'`
6. الفني يَحلّ العطل الأصلي + يَحلّ ضغط منخفض، يُؤجِّل Ozone (لا قطعة متوفّرة)
7. الـ visit_task ينتهي

**النتيجة المتوقَّعة:**
- 3 أعطال في اللائحة: واحد بـ `intake` + اثنان بـ `field_discovery`
- البادج المرئي على بنود `field_discovery` (٠.١٩.ط)
- `derived_outcome = 'partially_resolved'` (2 resolved + 1 deferred)
- open_task `status = needs_follow_up` (deferred واحد على الأقل)

**القواعد المُختبَرة:** ٠.١٩.ط (Field Discovery)، ٠.١٩.ح (derived_outcome computed)

---

## B. مخارج بديلة

### SC-05 — Resolved at Intake (حلّ هاتفي)

**Persona:** Operator + Technician المُشاور

**الفرضيات:** زبون OP، يَتصل بشكوى

**الخطوات:**
1. الـ Operator يَفتح service_request، يَستلم الشكوى: "الجهاز يُصدِر صوتاً غريباً"
2. الـ Operator يَستدعي Technician المُشاور
3. المُشاور يَسأل: "هل المضخّة تَهتزّ؟"
4. الزبون يُؤكّد
5. المُشاور: "يحتاج فقط لإحكام البراغي. هل تَستطيع فحصها بنفسك؟"
6. الزبون: "نعم"
7. المُشاور يَضيف عطل بـ `added_during_phase = 'technical_consultation'`، يَنقله مباشرة لـ `status = 'resolved_at_intake'` مع notes
8. الـ Operator يُغلق الـ service_request بـ `triage_outcome = 'resolved_by_advice'`
9. service_request.status = `resolved_at_intake`

**النتيجة المتوقَّعة:**
- لا open_task يُنشأ
- لا visit يُجدوَل
- العطل مُسجَّل في audit للتقارير ("كم حالة حُلَّت هاتفياً هذا الشهر؟")

**القواعد المُختبَرة:** SR-R005 (resolved_at_intake)، ٠.٤.ج (المخارج الفعّالة)، EM-PROB-02

---

### SC-06 — Rejected (تجاوز الصلاحية الثنائية)

**Persona:** Operator + Audit Admin

**الخطوات:**
1. Operator يَستلم بلاغ
2. يَكتشف أنه duplicate تمّ حلّه أمس (طلب آخر بـ `resolved_at_intake`)
3. Operator يَضغط "إرسال للرفض" ⇒ يُفعِّل `review_required_flag = TRUE` (إجباري قبل أي رفض)
4. Audit Admin يَستلم الطلب في لائحته
5. Audit Admin يَفحص ⇒ يَرفض بـ `triage_outcome = 'duplicate'` مع `duplicate_of_request_id`

**النتيجة المتوقَّعة:**
- `service_request.status = 'rejected'`
- `rejected_by_user_id = Audit Admin`
- audit log: `review_required_flag_set`, `escalated_to_audit_admin`, `rejected_decision`

**القواعد المُختبَرة:** SR-R007، SR-AUTH-01، ٠.١٦ (الصلاحية الثنائية)

---

### SC-07 — محاولة رفض مباشر من Operator (مرفوضة)

**Persona:** Operator

**الفرضيات:** Operator يَملك `service_requests.review` فقط

**الخطوات:**
1. Operator يَفتح طلباً، يَرى أنه spam
2. يَضغط زر "رفض" ⇒ النظام يَرفض الإجراء (لا يَملك `service_requests.reject`)
3. الـ UI يَعرض: "الرفض من صلاحية Audit Admin. اضغط 'تصعيد للمراجعة'"

**النتيجة المتوقَّعة:**
- الـ status لا يَتغيّر
- audit log فارغ من event رفض
- error معروف للـ Operator

**القواعد المُختبَرة:** SR-AUTH-01، ٠.١٦

---

### SC-08 — Auto-Cancel بعد 7 أيام في awaiting_customer_info

**Persona:** Operator + Cron job

**الفرضيات:** service_request في `awaiting_customer_info` بانتظار صورة من الزبون

**الخطوات:**
1. اليوم 0: Operator يَنقل لـ `awaiting_customer_info`
2. الأيام 1-6: لا رد من الزبون
3. اليوم 7 في 22:00: cron يَفحص ⇒ يَجد طلباً تَجاوز 7 أيام
4. cron يَنقل لـ `cancelled` بـ `triage_outcome = 'customer_no_response'`
5. audit log: `cancelled_by_admin` بـ `actor_role = 'system'`

**النتيجة المتوقَّعة:**
- لا تَدخّل بشري مطلوب
- الـ status terminal
- إعادة الفتح ممكنة لاحقاً (SR-REOPEN-04)

**القواعد المُختبَرة:** ٠.٤.ج (auto-cancel)، SR-REOPEN

---

## C. الـ Claim و الـ Reopen

### SC-09 — Take-Over: Operator B يَتولّى من Operator A

**Persona:** Operator A + Operator B

**الخطوات:**
1. Operator A يَفتح service_request، `claim` ⇒ `reviewed_by_user_id = A`
2. Operator A يَخرج للاستراحة
3. مكالمة من الزبون يَستلمها Operator B
4. Operator B يَفتح نفس الـ request، يَرى زر "تولّي"
5. Operator B يَضغط "تولّي" ⇒ `reviewed_by_user_id = B`
6. النظام يُرسل notification لـ Operator A: "تَمّ التولّي عن طلبك SR-XXX"
7. audit log: `claim_transferred` مع `previous_owner_id = A`, `new_owner_id = B`

**النتيجة المتوقَّعة:**
- لا قفل DB
- التولّي فوري
- Operator A يَعرف

**القواعد المُختبَرة:** SR-CLAIM-01..07

---

### SC-10 — تَدخّل Audit Admin بدون تَولّي

**Persona:** Operator A + Audit Admin

**الخطوات:**
1. Operator A يَدير طلباً، يُفعِّل `review_required_flag`
2. Audit Admin يَفتح الطلب
3. Audit Admin يَكتب internal note + يَنقل لـ `rejected`
4. `rejected_by_user_id = Audit Admin`
5. لكن `reviewed_by_user_id` يَبقى = Operator A

**النتيجة المتوقَّعة:**
- ملكية الـ Operator التشغيلية محفوظة (SR-CLAIM-06)
- قرار الرفض موثَّق منفصلاً
- تقارير الأداء تَحفظ ما عَمِله Operator A

**القواعد المُختبَرة:** SR-CLAIM-06

---

### SC-11 — Reopen بعد Rejected

**Persona:** Audit Admin

**الفرضيات:** service_request `rejected` قبل يومين بـ `duplicate`

**الخطوات:**
1. الزبون يَتصل: "الطلب الأول لا علاقة له بهذا"
2. Audit Admin يُراجع، يَكتشف أن الرفض كان خطأ
3. Audit Admin يَضغط "إعادة فتح" + سبب من `reopen_reasons`
4. النظام:
   - `service_request.status = 'in_review'` (لا `received`)
   - `reopen_count += 1` (= 1)
   - `last_reopened_at = NOW()`
   - audit log: `request_reopened`

**النتيجة المتوقَّعة:**
- الطلب يَعود لمسار طبيعي
- الحقول السابقة (`triage_outcome`, `closed_at`, `rejected_by_user_id`) تَبقى snapshot
- إذا أُغلق مرة ثانية، الـ count يَزداد

**القواعد المُختبَرة:** SR-REOPEN-01..05، ٠.٤.ب

---

### SC-12 — Reopen متكرّر يُفعِّل `review_required_flag` آلياً

**الخطوات:**
1. service_request أُعيد فتحه مرتين سابقاً (`reopen_count = 2`)
2. Audit Admin يَضغط إعادة فتح ثالثة
3. النظام يَنفّذ + يُفعِّل `review_required_flag = TRUE` آلياً (SR-REOPEN-04)
4. أي رفض لاحق يَتطلّب Audit Admin (لكن المستخدم نفسه فعَّل، fine)

**النتيجة المتوقَّعة:** تنبيه على نمط مشبوه بدون منع

**القواعد المُختبَرة:** SR-REOPEN-04

---

## D. الـ Linking والـ Duplicates

### SC-13 — Suggested Matches (Fuzzy success)

**الخطوات:**
1. Operator يُنشئ service_request walk-in بـ "محمد الأحمد، 0944555666"
2. النظام يَعرض Suggested Records:
   - "محمد علي الأحمد" — مستوى ثقة عالٍ (High) — phone exact match
   - "أحمد محمد" — Medium — اسم متشابه + phone مختلف
3. Operator يَختار الأول

**النتيجة المتوقَّعة:**
- `beneficiary_client_id` يُملأ
- audit log: `party_linked`

**القواعد المُختبَرة:** P-MAINT-SR-05، Fuzzy Matching

---

### SC-14 — تغيير الربط بعد اكتشاف خطأ

**الخطوات:**
1. Operator ربط طلباً بـ Candidate A
2. أثناء in_review، يَكتشف وجود client B (سجل قديم فاتَه)
3. Operator يَضغط "تغيير الربط" → يَختار client B
4. النظام:
   - يَفصل Candidate A
   - يَربط بـ client B
   - audit log: `linkage_changed` مع old + new + reason

**النتيجة المتوقَّعة:**
- Candidate A يَبقى موجوداً (قد يُستخدم لاحقاً، أو يَصير orphan)
- الـ request مرتبط بـ client B الآن

**القواعد المُختبَرة:** SR-CAND-01

---

### SC-15 — Candidate Orphan بعد التراجع

**الفرضيات:** SC-14 حدث، Candidate A لا يَملك أي شيء آخر مرتبطاً به

**الخطوات:**
1. شاشة candidates management تَعرض view محسوب
2. Candidate A يَظهر تحت "Orphans"
3. مدير الـ candidates يَحذفه (بصلاحية حذف clients)

**النتيجة المتوقَّعة:**
- الـ orphan view يَتحدّث
- لا تأثير على service_request الذي ربطته سابقاً

**القواعد المُختبَرة:** SR-CAND-02، SR-CAND-03

---

### SC-16 — Duplicate Detection آلي

**الفرضيات:** طلب موجود سابق منذ 24 ساعة بـ "0944111222" + "ضغط منخفض في الفلتر"

**الخطوات:**
1. Operator يُنشئ طلباً جديداً بـ نفس الرقم + "ضعف ضغط الماء"
2. النظام يَحسب score:
   - phone exact = 1.0 × 0.5 = 0.5
   - device: لو نفس الجهاز معروف = 0.25 × 1 = 0.25
   - problem fuzzy = 0.6 × 0.25 = 0.15
   - **total = 0.9** > 0.75 ⇒ duplicate
3. النظام يُفعِّل آلياً:
   - `duplicate_flag = TRUE`
   - `duplicate_of_request_id = الطلب القديم`
   - `review_required_flag = TRUE` (بـ SR-R009)
   - audit log: `duplicate_flag_set`

**النتيجة المتوقَّعة:**
- الـ Operator يَرى تنبيه duplicate
- يَستطيع متابعة المراجعة أو طلب من Audit Admin الرفض

**القواعد المُختبَرة:** ٠.١٥.أ (خوارزمية duplicate)

---

### SC-17 — Duplicate Detection يَدوي (لا يَلتقطه آلياً)

**الفرضيات:** نفس الزبون اتصل من رقم مختلف أبلَغ عن نفس العطل بصياغة مختلفة جداً

**الخطوات:**
1. Operator يَرى الطلب الجديد، يَنتبه بحدسه إلى التشابه
2. يَضغط "تفعيل duplicate flag يدوياً" → يَختار الـ duplicate_of_request_id
3. النظام يَتعامل كحالة (SC-16) لكن بـ مَصدر يدوي

**النتيجة المتوقَّعة:** نفس نتيجة SC-16 لكن audit يَكشف الإضافة اليدوية

**القواعد المُختبَرة:** ٠.١٥ (Flags)، SR-R009

---

## E. لائحة الأعطال

### SC-18 — البلاغ الثاني: دمج (الافتراضي)

**Persona:** Operator

**الفرضيات:** أحمد لديه `open_task` نشط لجهازه (3 أعطال مَفتوحة، زيارة الأربعاء)

**الخطوات:**
1. أحمد يَتصل الثلاثاء: "اكتشفت تسريباً ثانياً"
2. Operator يَفتح service_request جديد لأحمد
3. النظام يَكتشف open_task نشط على جهازه ⇒ يَعرض شاشة قرار
4. Operator يَختار "أضف للمهمة القائمة"
5. النظام:
   - يُضيف العطل الجديد للائحة على نفس open_task
   - يَنقل service_request لـ `promoted`
   - `linked_open_task_id = المهمة القائمة` (نفسها)
   - audit log على service_request: `merged_into_existing_task`
   - audit log على open_task: `additional_report_attached`
6. الفني يَوم الأربعاء يَرى 4 أعطال في لائحة الزيارة

**النتيجة المتوقَّعة:**
- لا open_task جديد
- لا زيارة جديدة
- زيارة واحدة تَحلّ كل شيء

**القواعد المُختبَرة:** EM-UNIQ-02، EM-UNIQ-03

---

### SC-19 — البلاغ الثاني: فتح منفصل (استثناء)

**الخطوات:**
1. أحمد لديه open_task جارٍ لـ فلتر مياه
2. أحمد يَتصل: "الآن المكنسة عَطلانة" (جهاز مختلف كلياً، تخصّص مختلف)
3. Operator يَفتح service_request، النظام يَعرض open_task القائم
4. Operator يَختار "افتح طلباً منفصلاً" + يَختار سبباً من `emergency_uniqueness_override_reasons` = "تخصّص فني مختلف"
5. النظام يُفعِّل `review_required_flag = TRUE`
6. Audit Admin يَستلم، يَفحص، يُوافق ⇒ promote عادي
7. open_task جديد يُنشأ على نفس الزبون (لكن جهاز مختلف)

**النتيجة المتوقَّعة:**
- مهمتان متوازيتان للزبون نفسه على أجهزة مختلفة
- audit log كامل للقرار + الموافقة

**القواعد المُختبَرة:** EM-UNIQ-04، SR-AUTH-01

---

### SC-20 — تعديل عطل في in_review

**الخطوات:**
1. Operator أضاف عطلاً بـ نوع خاطئ
2. يَكتشف ⇒ يُعدِّل النوع
3. `edit_count += 1`، `last_edited_at` يُملأ
4. audit log: `problem_edited`

**القواعد المُختبَرة:** ٠.١٩.هـ (مصفوفة الصلاحيات، مرحلة in_review)

---

### SC-21 — Soft Delete عطل في intake

**الخطوات:**
1. Operator أضاف عطلاً بـ خطأ في المسوّدة
2. يَضغط حذف، يُدخل سبباً
3. النظام يَنفّذ soft delete (`deleted_at` يُملأ، الصف يَبقى)
4. الـ UI لا يَعرضه ضمن اللائحة الفعّالة

**القواعد المُختبَرة:** EM-PROB-01، ٠.١٩.هـ

---

### SC-22 — منع الحذف بعد promote

**الخطوات:**
1. Operator يُحاول حذف عطل من service_request `promoted`
2. النظام يَرفض ⇒ يَقترح "إلغاء العطل بـ status = cancelled" بدلاً من حذف

**القواعد المُختبَرة:** ٠.١٩.هـ (الصف الثالث)

---

### SC-23 — Audit Admin Override بعد إغلاق visit

**الفرضيات:** visit مُغلَق، عطل في status = `resolved`

**الخطوات:**
1. اكتُشِف أن العطل لم يُحَلّ فعلياً (الزبون اتصل بعد أسبوع)
2. Audit Admin يَفتح الـ request، يَضغط override
3. يَضع `status = 'unresolvable_field'` + سبب صريح
4. audit log: `problem_audit_admin_override` مع `previous_state = 'resolved'`, `new_state = 'unresolvable_field'`

**القواعد المُختبَرة:** EM-PROB-04، ٠.١٩.هـ (الصف الخامس)

---

## F. الجهاز الخارجي

### SC-24 — Walk-in على جهاز خارجي

**الفرضيات:** زبون OP اشترى جهازاً من شركة أخرى، يَتصل لطلب خدمة

**الخطوات:**
1. Operator يَفتح service_request
2. يَختار `device_source = 'external_device'`
3. يَملأ `external_device_name = 'جهاز AquaPure 5'`, `serial = 'AP-12345'`
4. promote ⇒ النظام يُنشئ `installed_device` خفيف (`contract_id = NULL`)
5. open_task يُنشأ بـ ربط للجهاز الجديد

**النتيجة المتوقَّعة:**
- جهاز خارجي مُدخَل النظام
- لا `service_agreement` (V1.0)
- الزيارة تَنطلق طبيعياً
- الفاتورة كلها على الزبون (لا كفالة)

**القواعد المُختبَرة:** ٠.١٣ (Device Source)، contracts/01b §2

---

### SC-25 — العطل على جهاز خارجي

**الخطوات:** نفس SC-24 + الفني يَستهلك قطعتَين:
- قطعة `Periodic` (محلّيّاً، من مستودع شركتنا) → الزبون يَدفع (لا كفالة عقد لأن لا عقد)
- قطعة `Accessory` (شراء خارجي) → الزبون يَدفع

**النتيجة المتوقَّعة:**
- الفاتورة كاملة على الزبون
- التصنيف المالي يَعمل حتى بدون عقد

**القواعد المُختبَرة:** الطبقة 3 المالية

---

## G. الـ Immutability والـ Audit

### SC-26 — محاولة تعديل بيانات الزبون المُرسَلة

**الخطوات:**
1. Operator يَكتشف خطأ في `problem_description` (إملاء)
2. يُحاول تعديله ⇒ النظام يَرفض (SR-R008)
3. الـ UI يَقترح "إضافة internal note: 'الإملاء الصحيح هو ...'"
4. Operator يُضيف internal note بدلاً من تعديل

**النتيجة المتوقَّعة:**
- بيانات الزبون immutable
- التصحيح موثَّق كملاحظة منفصلة

**القواعد المُختبَرة:** SR-R008، SR-AUTH-04

---

### SC-27 — Audit Log كامل لطلب من البداية للنهاية

**الخطوات:** يَطلب Operator طباعة Audit Log لـ service_request مكتمل

**النتيجة المتوقَّعة:** سلسلة events موثَّقة:
```
1. request_created
2. claimed_by_operator
3. party_linked (client)
4. problem_added (×N)
5. promoted_to_task (linked_open_task_id)
6. problem_status_changed (resolved ×N)
7. problem_resolution_recorded (×N)
```
كل event مرتَّب زمنياً، بـ actor + payload

**القواعد المُختبَرة:** ٠.١٧ (Audit Log)، ٠.١٩.و

---

### SC-28 — منع الحذف الفيزيائي

**الخطوات:**
1. SuperAdmin يُحاول `DELETE` على `service_requests` row
2. النظام يَرفض (DB trigger أو app-level)
3. الـ UI يُوجِّه: "استخدم archive بدلاً من حذف"

**القواعد المُختبَرة:** SR-R010، ٠.١٨

---

## H. حدود الصلاحيات

### SC-29 — BRANCH user يُحاول رؤية الـ service_requests

**Persona:** موظف فرع لا يَملك `service_requests.view` GLOBAL

**الخطوات:**
1. يَدخل URL لـ صفحة الطلبات
2. النظام يَعرض 403 (forbidden)

**القواعد المُختبَرة:** ٠.١٦ (GLOBAL only)

---

### SC-30 — Operator يُحاول reject مباشرةً

**موصوف في SC-07** أعلاه.

---

### SC-31 — Operator يُحاول رؤية طلبات فرع آخر

**الخطوات:**
1. Operator يَفتح dashboard
2. النظام يَعرض **كل** الطلبات في الشركة (لأن صلاحيته GLOBAL)
3. لا تقييد بـ branch — Operator يَستطيع التولّي على طلب من أي فرع

**النتيجة المتوقَّعة:** لا فرز بـ branch — كل الطلبات مرئية

**القواعد المُختبَرة:** ٠.٨ (فصل المركزية)، ٠.١٦

---

## مصفوفة التغطية (Coverage Matrix)

| القاعدة | السيناريو المُختبِر |
|---|---|
| SR-R001..R011 | SC-01, SC-05, SC-06, SC-08, SC-11 |
| SR-R007 (Audit Admin reject only) | SC-06, SC-07 |
| SR-R008 (Immutability) | SC-26 |
| SR-R009 (duplicate → review_required) | SC-16, SC-17 |
| SR-R010 (no hard delete) | SC-28 |
| SR-AUTH-01..06 | SC-06, SC-07, SC-19, SC-29 |
| SR-CLAIM-01..07 | SC-09, SC-10 |
| SR-REOPEN-01..05 | SC-11, SC-12 |
| SR-REF-01..05 | SC-01 (public_ref_number generation) |
| SR-WALKIN-01..06 | SC-03, SC-24 |
| SR-CAND-01..05 | SC-14, SC-15 |
| EM-UNIQ-01..06 | SC-18, SC-19 |
| EM-PROB-01..05 | SC-21, SC-22, SC-23 |
| الإطار الثلاثي (3 طبقات) | SC-02, SC-04, SC-24, SC-25 |
| ٠.١٩.د (recorded vs repaired) | SC-02 |
| ٠.١٩.ز (technical state display) | (UI scenario, manual) |
| ٠.١٩.ح (derived_outcome) | SC-04, SC-32, SC-34 |
| ٠.١٩.ط (Field Discovery) | SC-04, SC-33 |
| 4 مراحل (المحور 11.ب) | SC-32 إلى SC-35 |
| استمرارية اللائحة عبر زيارات (٠.١٩.أ) | SC-34 |
| إزالة cascade `needs_followup` | SC-35 |
| ٠.٤.ج (Auto-Cancel 7 days) | SC-08 |
| ٠.١٥.أ (Duplicate Detection algorithm) | SC-16 |

---

## I. Visit Task Wizard (4 مراحل)

> **مرجع تحليل الـ wizard الحالي:** [maintenance.md § تحليل Visit Result Wizard الحالي](./maintenance.md). السيناريوهات هنا تَصف السلوك المتوقَّع **بعد** التعديل لتطبيق الإطار الجديد (لائحة الأعطال، derived_outcome، Field Discovery، تمييز recorded vs repaired).

### SC-32 — Wizard كامل: مهمة بـ 3 أعطال، حلّ ناجح

**Persona:** Technician (يُدخل + يُصلح)

**الفرضيات:**
- open_task `emergency_maintenance` بـ 3 أعطال في اللائحة (من intake)
- الفني وَصل، الزيارة `in_progress`

#### Phase 1 — preState (قياسات قبل)

1. الفني يَفتح Wizard ⇒ active phase = `preState` آلياً
2. يَملأ القياسات:
   - TDS_in = 350، TDS_out = 25 (Efficiency = 93% ⇒ "ممتازة")
   - Pump pressure = 65
   - Membrane state = "يعمل"
   - UV status = "يعمل"
3. يَحفظ ⇒ ينتقل آلياً لـ Phase 2

**النتيجة المتوقَّعة:** صف في `device_technical_states` بـ phase='pre'، linked to visit_task

#### Phase 2 — actions (لائحة الأعطال + قطع + إجراءات)

1. النظام يَعرض لائحة الـ 3 أعطال من اللائحة المنقولة من service_request
2. لكل عطل، الفني يَختار:
   - **العطل 1 (تشبّع الممبرين):** status = `resolved`، notes
   - **العطل 2 (ضوضاء المضخّة):** status = `resolved`، notes
   - **العطل 3 (تسريب):** status = `deferred` (يَحتاج قطعة غير متوفّرة)
3. الفني يَضيف قطعتَين:
   - قطعة Periodic (Pre-filter)، يَختار **ربط بعطل 1**، quantity=1، price=15000
   - قطعة Emergency (Membrane)، يَختار **ربط بعطل 1**، quantity=1، price=120000
4. dropdown "مَن سَجَّل النتيجة" = الفني نفسه
5. dropdown "مَن أصلح" = الفني نفسه
6. action_type_id = "تبديل ممبرين" من admin list
7. يَحفظ Phase 2

**النتيجة المتوقَّعة:**
- 3 صفوف في `service_request_problems` بـ statuses (resolved/resolved/deferred)
- `repaired_by_employee_id` = الفني (لكل بند resolved)
- `resolution_recorded_by_user_id` = الفني (نفسه في هذه الحالة)
- صفّان في `visit_task_parts_used`، كل واحد بـ `linked_problem_id` للعطل 1
- صف في `visit_task_maintenance_actions`

#### Phase 3 — postState (قياسات بعد)

1. الفني يُدخل القياسات الجديدة:
   - TDS_in = 350، TDS_out = 8 (Efficiency = 98% ⇒ "ممتازة")
   - Pump pressure = 70
   - Membrane state = "يعمل"
   - UV status = "يعمل"
2. CompareRow يَعرض: TDS_out 25 → 8 (تحسُّن) بـ badge أصفر
3. يَحفظ

**النتيجة المتوقَّعة:** صف في `device_technical_states` بـ phase='post'

#### Phase 4 — costs (التسوية المالية + derived outcome)

1. النظام يَعرض **derived_outcome** آلياً (لا اختيار يدوي):
   - 2 resolved + 1 deferred ⇒ "حُلَّت جزئياً" (badge أصفر)
2. الـ technician لا يَستطيع تغيير derived_outcome (الـ field readonly)
3. النظام يَحسب التسوية المالية تلقائياً سطر-بسطر:
   - Pre-filter (Periodic) + كفالة عقد فعّالة ⇒ **مُغطّى** = 0
   - Membrane (Emergency) + كفالة ذهبية فعّالة ⇒ **مُغطّى** = 0
   - **مَجموع على الزبون = 0**
4. الفني يَحفظ Phase 4

**النتيجة المتوقَّعة:**
- `visit_task.final_decision = 'partially_resolved'` (محسوب لا يدوي)
- `open_task.status = 'needs_follow_up'` (deferred واحد)
- `derived_outcome = 'partially_resolved'`
- لا فاتورة على الزبون
- audit log: `problem_status_changed` × 3، `problem_resolution_recorded` × 2، `parts_added` × 2

**القواعد المُختبَرة:** الـ 4 مراحل (المحور 11.ب)، ٠.١٩.ح (derived_outcome)، ٠.١٩.د (recorded vs repaired)، الإطار الثلاثي (الطبقة 3 المالية الكاملة)

---

### SC-33 — Wizard مع Field Discovery

**Persona:** Technician + Supervisor

**الفرضيات:** open_task بعطل واحد فقط من intake، الفني وَصل

#### Phase 1: preState

قياسات عادية. القياسات تَكشف انخفاضاً في الضغط لم يَذكره الزبون.

#### Phase 2: actions (اكتشاف ميداني)

1. النظام يَعرض العطل الأصلي (1 بند)
2. الفني يَضغط زر "إضافة عطل مكتشَف" (Field Discovery)
3. modal يَفتح بـ:
   - dropdown نوع العطل من `system_lists.diagnosis_problem_types`
   - حقل تفاصيل
   - `added_during_phase = 'field_discovery'` (آلي)
   - `creator_role_snapshot = 'technician'` (آلي)
4. الفني يَختار "ضغط منخفض" + تفاصيل = "ضغط 30 بدلاً من 50"
5. يَحفظ ⇒ بند جديد في اللائحة بـ badge "مُكتشَف في الميدان"
6. الـ supervisor يَدخل النتائج:
   - العطل الأصلي: status = `resolved`
   - العطل المكتشَف: status = `resolved`
   - `recorded_by` = supervisor، `repaired_by` = الفني
7. القطع: pump diaphragm (Emergency-class) ربطها بالعطل المُكتشَف

#### Phase 3 + Phase 4 طبيعيان

**النتيجة المتوقَّعة:**
- 2 صفوف في `service_request_problems`، الثاني بـ `added_during_phase = 'field_discovery'`
- البادج في الواجهة يُميِّز المكتشَف عن المُبلَّغ
- `derived_outcome = 'fully_resolved'`
- audit log: `problem_added` بـ phase='field_discovery'

**القواعد المُختبَرة:** ٠.١٩.ط (Field Discovery)، ٠.١٩.د (recorded vs repaired متمايزَين)

---

### SC-34 — Wizard مع problem deferred بعد الزيارة الأولى → زيارة ثانية تَحلّه

**Persona:** Technician في زيارتَين متتاليتَين

**الفرضيات:** سيناريو SC-32 انتهى بـ deferred (عطل تسريب)

**الخطوات:**

#### الزيارة الأولى (SC-32 معاد):
- visit_task_1 يَنتهي بـ `final_decision = 'partially_resolved'`
- open_task يَصير `needs_follow_up`، `expected_date` يُملأ بعد أسبوع
- العطل 3 في اللائحة status = `deferred`

#### الأسبوع التالي — الزيارة الثانية:
1. open_task يُجدوَل visit_task_2 جديد
2. الفني يَصل، يَفتح Wizard
3. **Phase 1:** قياسات pre جديدة (للزيارة الثانية)
4. **Phase 2:**
   - النظام يَعرض اللائحة كاملة (3 أعطال)
   - الأعطال 1 و 2 بـ status `resolved` من الزيارة السابقة — readonly مع badge "حُلَّت في الزيارة السابقة"
   - العطل 3 (deferred) قابل للتعديل ⇒ الفني يَختار status = `resolved`
   - قطعة جديدة Accessory مرتبطة بالعطل 3
5. **Phase 3:** قياسات post
6. **Phase 4:**
   - derived_outcome على open_task = `fully_resolved` (كل الأعطال resolved الآن)
   - فاتورة: Accessory + لا كفالة ذهبية ⇒ الزبون يَدفع

**النتيجة المتوقَّعة:**
- اللائحة محفوظة عبر الزيارتَين (لا duplicates)
- العطل 3 يَملك `resolution_visit_task_id` = visit_task_2 (مُحدَّث)
- open_task `status = 'completed'`
- audit log واضح: visit 1 سَجَّل 2 أعطال، visit 2 سَجَّل العطل 3

**القواعد المُختبَرة:** ٠.١٩.أ (اللائحة تَستمرّ عبر الزيارات)، EM-PROB-02 (resolved لا يَقبل تغيير)، ٠.١٩.ح (derived_outcome يَتجدَّد)

---

### SC-35 — منع `needs_followup` كقرار يُنشئ مهمة جديدة

**Persona:** Technician

**الفرضيات:** الـ wizard المُعدَّل (بعد حذف "needs_followup creates new task")

**الخطوات:**
1. الفني في Phase 4 يَرى الـ derived_outcome (محسوب آلياً)
2. لا يَملك زر "إنشاء مهمة طوارئ جديدة"
3. لو احتاج لمتابعة، يَفعل ذلك على مستوى **العطل المُؤجَّل** (status = deferred)
4. open_task يَصير `needs_follow_up` آلياً عند وجود deferred واحد على الأقل

**النتيجة المتوقَّعة:**
- لا cascade
- لا open_task جديدة من Phase 4
- المتابعة موصولة بـ المهمة الأصلية عبر الـ deferred

**القواعد المُختبَرة:** إزالة cascade من CostsForm، ٠.١٩.ح، الإطار الثلاثي

---

## الفجوات (سيناريوهات لم تُكتَب بعد)

| الموضوع | السبب |
|---|---|
| سيناريوهات periodic | V2+ |
| سيناريوهات قنوات خارجية (mobile/web) | V1.1+ |
| سيناريوهات تَفصيلية للـ `device_technical_states` field-by-field | UI، خارج نطاق scenarios الوظيفية |

---

## المراجع
- [maintenance.md](./maintenance.md) — المرجع الدستوري الكامل
- [device-demo.md](./device-demo.md) — قالب الاختبار المرجعي
