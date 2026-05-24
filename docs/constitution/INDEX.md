# فهرس الدستور — Golden CRM Constitution Index

> نقطة الدخول الرئيسية لكل دستورات المشروع.
> **القاعدة:** أي معلومة بدّك إياها — هاد أول ملف بتفتحه.

---

## الدومينات (Domains) — الكيانات الأساسية

| الكيان | الملف | الحالة | الحجم | Test Cases | الثغرات |
|---|---|---|---|---|---|
| الزبائن (Clients) | [domains/clients.md](domains/clients.md) | ✅ مكتمل | 533 سطر | 12+ | 5 |
| المرشحون (Candidates) | [domains/candidates.md](domains/candidates.md) | ✅ مكتمل | 301 سطر | 11+ | 5 |
| العقود (Contracts) | [domains/contracts.md](domains/contracts.md) | ✅ مكتمل | 527 سطر | 8+ | 5 |
| المهام المفتوحة (Open Tasks) | [domains/open-tasks.md](domains/open-tasks.md) | ✅ مكتمل | 366 سطر | 8+ | 5 |
| الزيارات (Visits) | [domains/visits.md](domains/visits.md) | ⚠️ قديم | 202 سطر | — | — |
| الزيارات الميدانية (Field Visits) | [domains/field-visits.md](domains/field-visits.md) | ✅ مكتمل | 466 سطر | 12+ | 7 |
| المهام (Tasks) | [domains/tasks.md](domains/tasks.md) | ⚠️ قديم | 17,165 بايت | — | — |
| التخطيط (Planning) | [domains/planning.md](domains/planning.md) | ⚠️ قديم | 14,126 بايت | — | — |
| التوظيف (Jobs) | [domains/jobs-recruitment.md](domains/jobs-recruitment.md) | ⚠️ قديم | 26,418 بايت | — | — |
| الأجهزة والصيانة | [domains/devices-maintenance.md](domains/devices-maintenance.md) | ⚠️ فاضي | 241 بايت | — | — |
| المناطق الجغرافية (Geo Units) | [domains/geo-units.md](domains/geo-units.md) | ✅ مكتمل | 240 سطر | 10+ | 7 |
| التسويق الهاتفي (Telemarketing) | [domains/telemarketing.md](domains/telemarketing.md) | ✅ مكتمل | 311 سطر | 7+ | 5 |
| البنية التنظيمية | [domains/org-structure.md](domains/org-structure.md) | ⚠️ فاضي | 218 بايت | — | — |
| الصلاحيات والأدوار (Permissions & Roles) | [domains/permissions.md](domains/permissions.md) | ✅ مكتمل | 382 سطر | 12+ | 9 |
| الإعدادات الإدارية | [domains/admin-settings.md](domains/admin-settings.md) | ⚠️ فاضي | 221 بايت | — | — |
| المهام الموحدة | [domains/tasks-unified.md](domains/tasks-unified.md) | ⚠️ قديم | 10,991 بايت | — | — |

**الدومينات المتبقية (72 جدول — مش كلون مُوثقين بعد):**
[عرض الكل في CROSS-REFERENCE.md](CROSS-REFERENCE.md#الجداول)

---

## الميزات (Features)

| الميزة | الملف | الحالة |
|---|---|---|
| زيارة ميدانية | [features/marketing-visits.md](features/marketing-visits.md) | ⚠️ قديم |
| توصيل جهاز | [features/device-delivery-task.md](features/device-delivery-task.md) | ⚠️ قديم |
| تركيب جهاز | [features/device-installation-task.md](features/device-installation-task.md) | ⚠️ قديم |
| تخطيط الاتصال | [features/planning-contact-targets.md](features/planning-contact-targets.md) | ⚠️ قديم |
| جدولة الفرق | [features/team-scheduling.md](features/team-scheduling.md) | ⚠️ قديم |

---

## المراجع السريعة (Quick Reference)

### أين ألاقي...؟

| بدّك تفهم... | روح ع... |
|---|---|
| شو الحقول تبع الزبون وقيودها | [domains/clients.md §2](domains/clients.md#2-الجدول-والحقول-table--field-dictionary) |
| شو صلاحيات الزبون ونطاقاتها | [domains/clients.md §6](domains/clients.md#6-صلاحيات-الوصول-permission-matrix) |
| شو API endpoints تبع الزبون | [domains/clients.md §7](domains/clients.md#7-عقد-api-api-contract) |
| شو test cases موجودة | [domains/clients.md §8](domains/clients.md#8-حالات-الاختبار-الشاملة-test-cases) |
| شو الثغرات المكتشفة | [domains/clients.md §9](domains/clients.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |
| شو تاريخ التغييرات على الزبون | [domains/clients.md §10](domains/clients.md#10-تاريخ-التغييرات-schema-changelog) |
| العلاقات بين الجداول | [CROSS-REFERENCE.md](CROSS-REFERENCE.md) |
| الثغرات المفتوحة بكل الكيانات | [GAPS-TRACKER.md](GAPS-TRACKER.md) |
| القالب لتوثيق كيان جديد | [templates/entity-constitution.md](templates/entity-constitution.md) |

---

## قواعد التنقل

1. **البحث:** Ctrl+F بالملف — كل عنوان بيحتوي ID (مثلاً `## 3.`)
2. **الروابط:** كل قسم مرتبط برقم — استخدم `#9.3` للوصول لثغرة رقم 3
3. **التحديث:** أي تعديل بيغيّر المعنى → حدّث الدستور أولاً
4. **الكود هو الحقيقة:** الدستور عبارة عن تفسير منظم — المصدر التشغيلي = الكود

---

## الأرشيف والتسليم (Handoffs)

| التاريخ | الملف | الموضوع |
|---|---|---|
| 2026-05-11 | [handoffs/2026-05-11-planning-appointments-handoff.md](handoffs/2026-05-11-planning-appointments-handoff.md) | Planning & Appointments |
| 2026-05-12 | [handoffs/2026-05-12-p1-p4-findings-handoff.md](handoffs/2026-05-12-p1-p4-findings-handoff.md) | P1-P4 Findings |
