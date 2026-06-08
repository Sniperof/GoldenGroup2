# خطة تقسيم دومين التخطيط (Planning Domain Split Plan)

> **التاريخ:** 2026-05-27
> **المعتمد:** إبراهيم عبيد (معلق — awaiting approval)
> **الهدف:** تقسيم `domains/planning.md` (304 سطر، قديم) → 4 كيانات منفصلة

---

## 1. لماذا التقسيم؟

| المشكلة | التأثير |
|---------|---------|
| `planning.md` يغطي 5+ جداول بملف واحد | فوضى، صعب الصيانة |
| الصيغة الحالية "domain overview" مش "entity constitution" | ما بيتبع الـ 10-section template |
| `day_schedules.teams` JSONB معقد | يستحق دستور مستقل |
| `work_scopes` table منفصل تماماً | ما له علاقة مباشرة بالـ scheduling |

---

## 2. الكيانات الجديدة (4 ملفات)

| # | الملف | الجدول/الجداول | الحجم المتوقع | الأولوية |
|---|-------|---------------|---------------|----------|
| 1 | `domains/day-schedules.md` | `day_schedules` | 300-400 سطر | 🔴 عالية |
| 2 | `domains/route-assignments.md` | `route_assignments` | 200-250 سطر | 🟡 متوسطة |
| 3 | `domains/routes.md` | `routes` + `route_points` | 200-250 سطر | 🟡 متوسطة |
| 4 | `domains/work-scopes.md` | `work_scopes` | 150-200 سطر | 🟢 منخفضة |

---

## 3. مصادر المعلومات (Data Sources)

| الكيان | Migrations | API Routes | Frontend |
|--------|-----------|------------|----------|
| day-schedules | `001_core_tables.sql` (226-230) | `schedules.ts` (371 سطر) | `TeamScheduler.tsx` |
| | | `planning.ts` (537 سطر) | `PlanOverview.tsx` |
| route-assignments | `001_core_tables.sql` (232-236) | `planning.ts` | `RouteAssigner.tsx` |
| routes | `001_core_tables.sql` (113-125) | — | — |
| work-scopes | `078_work_scopes.sql` | `planning.ts` | — |

---

## 4. ما يصير بكل ملف (10 أقسام)

### 4.1 day-schedules.md
```
§1 هوية الكيان: الجدول اليومي + الفرق JSONB
§2 الحقول: date, teams[], solos[]
§3 القواعد: PL-R001 → PL-R008 (من planning.md القديم)
§4 العلاقات: يربط بـ employees, route_assignments, open_tasks
§5 آلة الحالات: لا يوجد ( presence/absence )
§6 الصلاحيات: planning.manage
§7 API: GET/PUT /schedules/:date
§8 Test Cases: 6+ سيناريوهات
§9 Gaps: teams JSONB = لا FK validation
§10 Changelog: 001 → 077 → 108
```

### 4.2 route-assignments.md
```
§1 هوية: ربط الفريق بالمسار والجغرافيا
§2 الحقول: key, routes[], extra_zones[]
§3 القواعد: PL-R007 (مصدر الأهداف)
§4 العلاقات: day_schedules, routes, work_scopes
§5 آلة الحالات: لا يوجد
§6 الصلاحيات: planning.manage
§7 API: GET/PUT /route-assignments/:key
§8 Test Cases: 4+ سيناريوهات
§9 Gaps: لا FK لـ geo_unit داخل extra_zones JSONB
§10 Changelog: 001
```

### 4.3 routes.md
```
§1 هوية: المسارات الجغرافية
§2 الحقول: id, name, status / route_points: id, route_id, geo_unit_id, level, point_order
§3 القواعد: لا يوجد (simple CRUD)
§4 العلاقات: route_points (1:N), route_assignments
§5 آلة الحالات: active/inactive
§6 الصلاحيات: planning.manage أو admin
§7 API: محتاج تحقق — مش واضح من الكود
§8 Test Cases: 3+ سيناريوهات
§9 Gaps: routes API غير واضح بالكود
§10 Changelog: 001
```

### 4.4 work-scopes.md
```
§1 هوية: نطاق العمل اليومي للفريق
§2 الحقول: id, branch_id, date, team_key, zone_ids[], scope_type, status
§3 القواعد: PL-R008 (حساب الحمل)
§4 العلاقات: day_schedules, routes, open_tasks
§5 آلة الحالات: draft → generated
§6 الصلاحيات: planning.manage
§7 API: planning/marketing-targets (mode=planning)
§8 Test Cases: 3+ سيناريوهات
§9 Gaps: zone_ids[] = INTEGER array بدون FK
§10 Changelog: 078
```

---

## 5. التعديلات على الملفات الحالية

| الملف | التعديل |
|-------|---------|
| `INDEX.md` | حذف `planning.md` من الدومينات، إضافة 4 كيانات جديدة |
| `planning.md` | إما (أ) حذف أو (ب) تحويل لـ `planning-overview.md` index فقط |
| `CROSS-REFERENCE.md` | تحديث §5.3 الجداول 26-32 |
| `GAPS-TRACKER.md` | إضافة gaps جديدة إذا اكتشفنا |

---

## 6. التسلسل الزمني المقترح

| المرحلة | الملف | الوقت المتوقع |
|---------|-------|--------------|
| 1 | `day-schedules.md` | الجلسة الحالية |
| 2 | `work-scopes.md` | الجلسة الحالية |
| 3 | `route-assignments.md` | الجلسة الجاية |
| 4 | `routes.md` | الجلسة الجاية |
| 5 | تحديث INDEX + CROSS-REFERENCE | نهاية الجلسة الجاية |

---

## 7. ملاحظات خطيرة

> ⚠️ **لا نحذف `planning.md` فوراً** — نحتفظ فيه لحتى نتأكد إن كل المعلومات انتقلت صح.
> 
> ⚠️ **PL-R007 و PL-R008** من `planning.md` بيشتغلوا عبر `planning.ts` + `planningMarketingTargets.ts` — بدنا نقراهم كويس قبل التوثيق.
> 
> ⚠️ **`assigned_team_key` على `open_tasks`** (migration 077) — هاد الحقل بيربط المهمة بالفريق. رح نحتاج نذكره بـ `day-schedules.md`.

---

## 8. قرار

| الخيار | الحالة |
|--------|--------|
| ✅ ابدأ بالمرحلة 1 (day-schedules.md) | [ ] |
| ⏸️ أوقف — بدي أراجع الخطة | [ ] |
| 🔄 عدّل التسلسل | [ ] |
