# برومبت: إنشاء دستور كيان `work-scopes.md`

## الهدف
أنشئ ملف دستور كيان جديد:
`/opt/golden-crm/apps/staging/docs/constitution/domains/work-scopes.md`

بصيغة الـ 10 أقسام — نفس صيغة `day-schedules.md`.

---

## الملفات المرجعية

اقرأ هالملفات بالتسلسل:

1. `/opt/golden-crm/apps/staging/docs/constitution/templates/entity-constitution.md` — القالب
2. `/opt/golden-crm/apps/staging/docs/constitution/domains/day-schedules.md` — مرجع الصيغة (جديد، نفس الأسلوب)
3. `/opt/golden-crm/apps/staging/migrations/078_work_scopes.sql` — سكيما work_scopes
4. `/opt/golden-crm/apps/staging/packages/api/routes/planning.ts` — endpoints التخطيط
5. `/opt/golden-crm/apps/staging/packages/api/services/planningMarketingTargets.ts` — حساب الأهداف
6. `/opt/golden-crm/apps/staging/packages/api/services/assignedTasks.ts` — syncAssignedTasks

---

## حقائق ثابتة

### الجدول
```sql
CREATE TABLE work_scopes (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL,
    date DATE NOT NULL,
    team_key VARCHAR(50) NOT NULL,
    zone_ids INTEGER[] DEFAULT '{}',
    scope_type VARCHAR(50) DEFAULT 'mixed',
    status VARCHAR(50) DEFAULT 'draft',
    generated_at TIMESTAMP DEFAULT NOW(),
    generated_by INTEGER,
    UNIQUE(date, team_key, branch_id)
);
```

### القواعد
- **WS-R001**: `work_scopes` ينتج عن حساب الحمل (planning mode) — ليس يدوي
- **WS-R002**: كل `work_scope` تابع لـ `branch_id` + `date` + `team_key`
- **WS-R003**: `zone_ids[]` = مصفوفة `geo_units.id` — فرع الفريق بالمسار
- **WS-R004**: `status` = `draft` → `generated` (ما بيتحول لـ `active`)
- **WS-R005**: عند `mode=planning` بـ `GET /planning/marketing-targets` → بيولّد `work_scope` + `syncAssignedTasks`

### العلاقات
- `work_scopes` ← يربط بـ `day_schedules` عبر `date` + `team_key`
- `work_scopes` ← يربط بـ `routes` عبر `zone_ids[]`
- `work_scopes` ← ينتج → `open_tasks` (assigned_team_key, assigned_for_date)

### API
| Method | Path | وصف |
| GET | `/planning/marketing-targets?date=&teamKey=&mode=planning` | يولّد work_scope + يرجع الأهداف |
| GET | `/planning/marketing-targets?date=&teamKey=&mode=assigned` | بس بيجيب المهام المسندة |

### الصلاحية
- `planning.manage`

---

## التعليمات لكل قسم

### §1 هوية
- الاسم: "نطاقات العمل" / "Work Scope"
- الجدول: `work_scopes`
- وصف: ناتج حساب التخطيط — يحدد المناطق الجغرافية (zone_ids) التي يغطيها فريق محدد بتاريخ محدد

### §2 الحقول
- 8 حقول: id, branch_id, date, team_key, zone_ids, scope_type, status, generated_at, generated_by
- `zone_ids` = `INTEGER[]` Postgres array — وثّقها كـ FK منطقي لـ `geo_units.id`

### §3 القواعد
- WS-R001 لـ WS-R005
- "zone_ids[] لا يملك FK validation — gap معروف"
- "scope_type = 'mixed' ثابت حالياً — لا خيارات أخرى"

### §4 العلاقات
- Mermaid ER
- ربط `day_schedules` (date + team_key)
- ربط `routes`/`geo_units` عبر zone_ids[]
- ربط `open_tasks` (assigned_team_key)

### §5 آلة الحالات
```
draft → generated
```
لا حذف ناعم.

### §6 صلاحيات
- `planning.manage` بـ `BRANCH`

### §7 API
- document `GET /planning/marketing-targets` بالتفصيل
- الفرق بين mode=planning و mode=assigned
- request/response schemas

### §8 Test Cases
- TC-01: توليد work_scope بـ mode=planning (happy path)
- TC-02: توليد work_scope بدون day_schedule محفوظ (يفشل)
- TC-03: zone_ids تحتوي geo_unit غير موجود (gap)
- TC-04: فرع مختلف عن الفرع المسجل بالـ JWT
- TC-05: تكرار (date, team_key, branch_id) — يخالف UNIQUE constraint

### §9 Gaps
- **GAP-WS-001**: `zone_ids[]` لا يملك FK validation — يمكن حفظ IDs غير موجودة
- **GAP-WS-002**: لا يوجد soft-delete — الحذف فيزيائي
- **GAP-WS-003**: `scope_type` = 'mixed' ثابت — لا دعم لأنواع أخرى

### §10 Changelog
- 078_work_scopes.sql: إنشاء الجدول

---

## قواعد
1. عربية فقط (حقول تقنية بالإنجليزية)
2. Markdown — نفس day-schedules.md
3. الحجم: 200-250 سطر
4. لا تختلق معلومات
5. احفظ: `/opt/golden-crm/apps/staging/docs/constitution/domains/work-scopes.md`

---

## قائمة التحقق
- [ ] 8 حقول وثّقت بجدول §2
- [ ] WS-R001 لـ WS-R005 بـ §3
- [ ] Mermaid ER بـ §4
- [ ] 5 test cases بـ §8
- [ ] 3 gaps بـ §9
- [ ] الملف محفوظ بالمسار الصحيح
