# برومبت: إنشاء دستور كيان `day-schedules.md`

## الهدف
أنشئ ملف دستور كيان جديد:
`/opt/golden-crm/apps/staging/docs/constitution/domains/day-schedules.md`

بصيغة الـ 10 أقسام (Entity Constitution) — نفس صيغة `clients.md` و `contracts.md`.

---

## الملفات المرجعية اللي لازم تقرأها أولاً

اقرأ هالملفات بالتسلسل قبل ما تكتب ولا سطر:

1. `/opt/golden-crm/apps/staging/docs/constitution/templates/entity-constitution.md` — القالب (10 أقسام)
2. `/opt/golden-crm/apps/staging/docs/constitution/domains/clients.md` — مرجع للصيغة (خاصة §2 جدول الحقول و §3 القواعد)
3. `/opt/golden-crm/apps/staging/docs/constitution/domains/planning.md` — استخرج منه PL-R001 لـ PL-R008
4. `/opt/golden-crm/apps/staging/migrations/001_core_tables.sql` — سكيما `day_schedules` (سطر 226-230) + `schedules` إذا موجود
5. `/opt/golden-crm/apps/staging/migrations/077_expand_open_tasks.sql` — حقل `assigned_team_key`
6. `/opt/golden-crm/apps/staging/migrations/108_open_tasks_assigned_phase.sql` — حقول `assigned_for_date` و `assigned_at`
7. `/opt/golden-crm/apps/staging/packages/api/routes/schedules.ts` — الـ API كامل
8. `/opt/golden-crm/apps/staging/packages/api/routes/planning.ts` — endpoints التخطيط
9. `/opt/golden-crm/apps/staging/packages/api/routes/employees.ts` — `schedule-pool` endpoint
10. `/opt/golden-crm/apps/staging/packages/web/src/pages/planning/TeamScheduler.tsx` — الواجهة

---

## حقائق ثابتة (ما تغيّرها)

### الجدول الأساسي
```sql
CREATE TABLE IF NOT EXISTS day_schedules (
  date  VARCHAR(50) PRIMARY KEY,
  teams JSONB DEFAULT '[]',
  solos JSONB DEFAULT '[]'
);
```

### هيكل JSONB داخلي
`teams` = مصفوفة من `TeamSlot`:
```json
[
  {
    "supervisor": 12,
    "technician": 15,
    "telemarketers": [20, 21],
    "trainee": 30
  }
]
```

`solos` = مصفوفة من `EmergencySlot`:
```json
[
  {
    "technician": 18,
    "telemarketers": [22],
    "trainee": null
  }
]
```

### القواعد التشغيلية (من planning.md)
- **PL-R001**: لا يمكن حفظ جدول فرق بدون فرع فعّال
- **PL-R002**: كل فريق قياسي يجب أن يحتوي مشرفًا وفنيًا
- **PL-R003**: خانة الطوارئ لا تُحفظ بدون فني
- **PL-R004**: الموظف يجب أن يكون نشطًا ومؤهلًا (`canAppearInSchedule = true`)
- **PL-R005**: لا يجوز خلط موظف من فرع آخر
- **PL-R006**: الموظف الواحد لا يمكن أن يظهر في أكثر من موضع
- **PL-R007**: جدول الفرق هو مصدر الأهداف اللاحقة
- **PL-R008**: حساب الحمل يرحّل المهام المؤهلة إلى `assigned`

### الـ API Endpoints
| Method | Path | الوصف |
|--------|------|-------|
| GET | `/schedules/:date` | جلب جدول يوم |
| PUT | `/schedules/:date` | حفظ/تحديث جدول يوم |
| GET | `/employees/schedule-pool` | قائمة الموظفين المؤهلين للجدولة |
| GET | `/planning/marketing-targets?date=&teamKey=` | أهداف التسويق |

### الصلاحية
- `planning.manage` — مسؤولية مدير الفرع

### العلاقات
- `day_schedules` ← يربط بـ `open_tasks` عبر `assigned_team_key` + `assigned_for_date`
- `day_schedules` ← يربط بـ `route_assignments` عبر مفتاح مركب `{date}_{teamKey}`
- `day_schedules.teams[].supervisor/technician` ← FK منطقي لـ `employees.id` (لكن JSONB = لا FK فعلي)

---

## التعليمات لكل قسم (10 أقسام)

### §1 هوية الكيان
- الاسم: "الجداول اليومية" / "Day Schedule"
- الجدول: `day_schedules`
- وصف: الجدول اليومي التشغيلي يلي بيحدد الفرق الميدانية والطوارئ لكل يوم. هو المصدر الأولي لكل العمليات اللاحقة (أهداف، مهام، زيارات).
- جداول مرتبطة: `open_tasks`, `route_assignments`, `employees`, `branches`

### §2 معجم الحقول
- 3 حقول فقط: `date`, `teams`, `solos`
- وثّق `teams` و `solos` كـ JSONB بشكل مفصّل (هيكلهم الداخلي، الأنواع، القيود)
- استخدم نفس جدول `clients.md` §2 (Markdown table مع 7 أعمدة)

### §3 القيود والقواعد
- ضمّن PL-R001 لـ PL-R008
- أضف قاعدة: "الـ JSONB لا يخضع لـ FK validation — هذا gap معروف"
- أضف قاعدة: "عند حفظ جدول، يتم تسجيل `created_at` ضمن `schedules` table (legacy) أو مباشرة بـ `day_schedules`" ← تحقق من الكود

### §4 العلاقات
- رسم Mermaid ER
- اشرح العلاقة مع `open_tasks` (assigned_team_key, assigned_for_date)
- اشرح العلاقة مع `route_assignments` (key = `{date}_{teamKey}`)

### §5 آلة الحالات
- presence/absence فقط (لا حالات انتقالية داخل الجدول)
- بس عند الـ PUT: `draft` (غير محفوظ) → `saved` (محفوظ)

### §6 صلاحيات الوصول
- `planning.manage` بـ scope `BRANCH`
- لا يوجد `ASSIGNED` (الجدولة للفرع كامل)

### §7 عقد API
- document `GET /schedules/:date` و `PUT /schedules/:date` بالتفصيل
- request/response schemas (JSON)

### §8 حالات الاختبار
- TC-01: حفظ جدول صحيح (happy path)
- TC-02: محاولة حفظ بدون مشرف (PL-R002)
- TC-03: محاولة حفظ بدون فني بالطوارئ (PL-R003)
- TC-04: موظف مكرر بفريقين (PL-R006)
- TC-05: موظف من فرع آخر (PL-R005)
- TC-06: جلب جدول غير موجود (404)

### §9 الثغرات والتضاربات
- **GAP-DS-001**: `teams` JSONB لا يملك FK validation للـ `employees.id` — يمكن حفظ IDs غير موجودة
- **GAP-DS-002**: لا يوجد `created_by` أو `updated_at` على `day_schedules` — لا أرشيف للتغييرات
- **GAP-DS-003**: `solos` لا يملك CHECK constraint — يمكن حفظ أي JSON

### §10 تاريخ التغييرات
- 001_core_tables.sql: إنشاء الجدول
- 077_expand_open_tasks.sql: إضافة assigned_team_key (ربط بالمهام)
- 108_open_tasks_assigned_phase.sql: إضافة assigned_for_date

---

## قواعد الكتابة

1. **اللغة**: عربية فقط (الحقول التقنية بالإنجليزية)
2. **الصيغة**: Markdown — نفس `clients.md` بالضبط
3. **الحجم المستهدف**: 300-400 سطر
4. **لا تختلق معلومات**: أي شي ما لقيته بالكود، سجله كـ "غير مؤكد" أو "يحتاج تحقق"
5. **احفظ الملف**: `/opt/golden-crm/apps/staging/docs/constitution/domains/day-schedules.md`

---

## قائمة التحقق قبل التسليم

- [ ] كل الحقول وثّقت بجدول §2
- [ ] PL-R001 لـ PL-R008 موجودة بـ §3
- [ ] رسم Mermaid ER بـ §4
- [ ] 6 test cases بـ §8
- [ ] 3 gaps بـ §9
- [ ] الملف محفوظ بالمسار الصحيح
