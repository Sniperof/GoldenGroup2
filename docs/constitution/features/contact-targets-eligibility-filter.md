# قيد حساب الحمل لـ `contact_targets` — الـ Filter الكامل

> **الحالة:** Active — موثَّق 2026-06-02 من قراءة الكود الفعلي
> **الملف المرجعي:** [`packages/api/services/planningMarketingTargets.ts`](../../../packages/api/services/planningMarketingTargets.ts) (السطور 444-535 و 546-740)
> **المرتبط:** [`features/planning-contact-targets.md`](planning-contact-targets.md) · [`decisions/DEC-005-contact-targets-filter.md`](../decisions/DEC-005-contact-targets-filter.md) · [`decisions/DEC-006-pending-resolutions-round1.md`](../decisions/DEC-006-pending-resolutions-round1.md)
> **الغرض:** تثبيت السلوك الفعلي لحساب الحمل (counts-by-zone) و استخراج جهات الاتصال (leadRows) لمنع التطوير الأعمى على افتراضات قديمة.

---

## 0. الفكرة الجوهرية في جملة

> **«لكل zone (محطة) في route الفريق، كم زبوناً يستوفي جميع شروط الـ filter؟»**

النتيجة المعادة:
```json
{
  "countsByZone": [
    { "zoneId": 123, "count": 5 },
    { "zoneId": 124, "count": 0 }
  ],
  "leads": [ /* تفاصيل كل زبون مؤهَّل */ ]
}
```

هذه هي الأرقام التي تظهر على بطاقات المحطات في `RouteAssigner` وفي `PlanOverview`.

---

## 1. الـ Pipeline الكاملة — 6 طبقات + 8 شروط

```
┌─────────────────────────────────────────────────────────────┐
│ الطبقة الخارجية: GROUP BY effective_zone → COUNT(*)          │
└─────────────────────────────────────────────────────────────┘
              ▲
┌─────────────────────────────────────────────────────────────┐
│ Subquery sub: لكل زبون يجتاز كل الشروط، احسب effective_zone   │
│ DISTINCT ON (c.id) ← زبون واحد كحد أقصى لا تكرار              │
└─────────────────────────────────────────────────────────────┘
              ▲
              │
        FROM clients c
              │
        + LATERAL ttc_eff (المهمة المؤهَّلة الواحدة)
        + LATERAL ct_loc (موقع الجهاز لو device-based)
        + LATERAL unfinished_visit (هل في زيارة معلَّقة؟)
              │
        WHERE (8 شروط — انظر §3)
              │
        effective_zone = ANY($2::int[])
```

---

## 2. الطبقات بالتفصيل

### 2.1 — حساب `effective_zone` (الموقع الجغرافي للمهمة)

```sql
CASE
  WHEN ttc_eff.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
    THEN ct_loc.installation_geo_unit_id
  ELSE c.neighborhood
END AS effective_zone
```

**القواعد:**
- المهام التي `task_type_config.location_basis = 'contract'` (حقيقياً تعني **"device"** بحسب DEC-005 D27 — مثل `device_delivery`, `periodic_maintenance`, `collection`) → الـ zone = موقع الجهاز المركَّب من `installed_devices.installation_geo_unit_id`.
- باقي المهام (مثل `device_demo`) → الـ zone = `clients.neighborhood` مباشرة (نوع INTEGER، FK لـ `geo_units` level 4).
- إذا `neighborhood = NULL` → `effective_zone = NULL` → الزبون لن يطابق أي محطة.

**⚠️ ثغرة مفهومية معروفة:** الفلتر يعمل على مستوى الحي (level 4) فقط. الزبائن المسجَّلون على مستوى الناحية (level 3) فقط — رغم أن الدستور يعتبر الحي اختيارياً — لا يدخلون الحساب. القرار البنيوي مؤجَّل (راجع §6 الفجوة CT-G-LEVEL-FALLBACK).

### 2.2 — LATERAL `ttc_eff` (المهمة المؤهَّلة)

```sql
LEFT JOIN LATERAL (
  SELECT ot_inner.id, ttc_inner.location_basis
  FROM open_tasks ot_inner
  INNER JOIN task_type_config ttc_inner ON ttc_inner.task_type = ot_inner.task_type
  WHERE ot_inner.client_id = c.id
    AND (Branch 1 OR Branch 2)
  ORDER BY ot_inner.created_at DESC
  LIMIT 1
) ttc_eff ON TRUE
```

يبحث عن **مهمة واحدة كحد أقصى** للزبون تستوفي:

#### Branch 1 — مهمة في طور الانتظار
```sql
ot_inner.status IN ('open', 'needs_follow_up')
AND ttc_inner.is_active = TRUE
AND (window check based on N-days)
AND (ot_inner.excluded_for_date IS NULL OR != today)
```

#### Branch 2 — مهمة مُسندة لهذا الفريق
```sql
ot_inner.status = 'assigned'
AND ot_inner.assigned_team_key = $5
AND ttc_inner.is_active = TRUE
AND (ot_inner.excluded_for_date IS NULL OR != today)
```

> Branch 2 يحلّ مشكلة post-sync idempotency: بعد ما النظام ينقل المهام إلى `assigned`، Branch 1 ما يطابقها مجدداً، فنحتاج Branch 2 ليبقى الـ count ثابتاً.

### 2.3 — Window Check (نافذة N — `buildOpenTaskEligibilityPredicate`)

```sql
(
  scheduling_pattern = 'immediate'           -- نافذة 0 (طوارئ مثلاً)
  OR (
    window_basis = 'due_date'
    AND (due_date IS NULL OR due_date <= CURRENT_DATE + (
      CASE WHEN status = 'needs_follow_up' THEN '1'
           ELSE planning_window_days::text
      END || ' days'
    )::INTERVAL)
  )
  OR (
    window_basis = 'expected_date'
    AND (expected_date IS NULL OR expected_date <= CURRENT_DATE + (
      CASE WHEN status = 'needs_follow_up' THEN '1'
           ELSE planning_window_days::text
      END || ' days'
    )::INTERVAL)
  )
)
```

**القاعدة:**
- `status = 'open'` → النافذة = `task_type_config.planning_window_days` (7 لـ `device_demo`).
- `status = 'needs_follow_up'` → النافذة **يوم واحد ثابتة** (DEC-006 D36 — universal across all task types).
- التاريخ المرجعي حسب `window_basis`:
  - `due_date` = `required_date` (الحالة العامة).
  - `expected_date` = موعد الزبون الموعود به.

### 2.4 — LATERAL `ct_loc` (موقع الجهاز للمهام `device`-based)

```sql
LEFT JOIN LATERAL (
  SELECT inst.installation_geo_unit_id
  FROM installed_devices inst
  WHERE inst.customer_id = c.id
    AND inst.installation_geo_unit_id IS NOT NULL
  ORDER BY inst.created_at DESC
  LIMIT 1
) ct_loc ON ttc_eff.location_basis = 'contract'
```

> **ملاحظة DEC-005 D27:** القيمة `'contract'` في `location_basis` معنوياً تعني **"device"** (موقع الجهاز). الـ JOIN يقرأ من `installed_devices`، ليس من `contracts`. هذا الجدول الأخير لا يحوي `installation_geo_unit_id`. أُصلح هذا الخطأ في `28221e2` (يونيو 2026).

### 2.5 — LATERAL `unfinished_visit` (هل في زيارة معلَّقة سابقة؟)

```sql
LEFT JOIN LATERAL (
  SELECT 1 AS has_unfinished_visit
  FROM visit_tasks vt
  JOIN field_visits fv ON fv.id = vt.field_visit_id
  WHERE vt.source_open_task_id = ttc_eff.id
    AND fv.status IN ('scheduled', 'in_progress', 'ended', 'not_completed')
    AND fv.scheduled_date < $4::date
  LIMIT 1
) unfinished_visit ON TRUE
```

**القاعدة:**
- لو هذه المهمة لها زيارة سابقة في حالة غير منتهية → الزبون **مستثنى**.
- المنطق: لا نضع زبوناً في خطة اليوم إذا له زيارة قديمة معلَّقة لم تُغلق.

---

## 3. شروط الـ WHERE (8 شروط مجتمعة)

```sql
WHERE
  c.is_candidate = FALSE                                    -- ① زبون فعلي
  AND c.do_not_contact = FALSE                                -- ② DEC-005 D29
  AND (c.cooldown_until IS NULL OR c.cooldown_until < CURRENT_DATE)  -- ③
  AND c.branch_id = $1                                        -- ④ الفرع الحالي
  AND ${buildTeamOwnedClientScopePredicate('c')}              -- ⑤ ملكية الفريق
  AND ttc_eff.id IS NOT NULL                                  -- ⑥ المهمة وُجدت
  AND unfinished_visit.has_unfinished_visit IS NULL           -- ⑦ لا زيارة معلَّقة
  AND ( TRUE OR EXISTS (...) )                                -- ⑧ DEC-005 §4 (legacy، الفرع الثاني ميت)
```

### الشرط ⑤ بالتفصيل — `buildTeamOwnedClientScopePredicate`

```sql
(
  EXISTS (
    SELECT 1 FROM client_assignments ca
    WHERE ca.client_id = c.id
      AND ca.hr_user_id = ANY($3::int[])  -- actorHrUserIds (المشرف + الفني)
  )
  OR NOT EXISTS (
    SELECT 1 FROM client_assignments ca
    JOIN hr_users hu ON hu.id = ca.hr_user_id
    WHERE ca.client_id = c.id
      AND hu.employee_id IS NOT NULL
  )
)
```

**خلاصة:** الزبون مرئي للفريق إذا:
- **(أ)** مُسند شخصياً لأحد أعضاء الفريق (مشرف/فني)، **أو**
- **(ب)** ليس مُسنداً شخصياً لأي موظف نشط → fallback إلى "ملكية الشركة/الفرع".

---

## 4. الطبقة الأخيرة — Zone Filter

```sql
WHERE effective_zone = ANY($2::int[])
```

`$2::int[]` = قائمة `zone_ids` المحفوظة في `route_assignments` للفريق (محطات + extraZones).

---

## 5. ملخّص الشروط الـ 11 الواجبة الاجتماع للزبون

ليدخل زبون واحد في عدّ محطة معيّنة:

| # | الشرط | الجدول |
|---|---|---|
| 1 | `is_candidate = FALSE` | `clients` |
| 2 | `do_not_contact = FALSE` | `clients` |
| 3 | لا cooldown نشط (`cooldown_until IS NULL OR < CURRENT_DATE`) | `clients` |
| 4 | ضمن الفرع الحالي (`branch_id = $1`) | `clients` |
| 5 | ضمن ملكية الفريق (شخصية أو fallback شركة) | `client_assignments` + `hr_users` |
| 6 | له `open_task` بـ `task_type_config.is_active = TRUE` | `open_tasks` + `task_type_config` |
| 7 | المهمة في `status ∈ (open, needs_follow_up)` أو `assigned` لهذا الفريق | `open_tasks` |
| 8 | المهمة تجتاز window check (N-days للحالة الحالية) | `task_type_config` |
| 9 | المهمة ليست مستثناة اليوم (`excluded_for_date ≠ today`) | `open_tasks` |
| 10 | لا توجد زيارة سابقة معلَّقة لهذه المهمة | `visit_tasks` + `field_visits` |
| 11 | موقعه (حسب location_basis) داخل `zoneIds` المحفوظة للفريق | computed + `route_assignments` |

---

## 6. الفجوات والقيود المعروفة

### CT-G-LEVEL-FALLBACK — الفلتر يعمل على الحي فقط (level 4)
**الحالة:** Open — قرار منتج معلَّق.
- الـ `effective_zone = c.neighborhood` فقط.
- الزبائن بلا حي مسجَّل (NULL) لا يدخلون أي محطة إطلاقاً.
- يتضارب مع `components/client-snapshot.md` الذي ينص أن «الحي اختياري، الناحية إجبارية».
- **الخيارات:**
  - **(أ)** الإبقاء كما هو (الحي إجباري عملياً للتخطيط).
  - **(ب)** Fallback إلى الناحية + توسيع `$2::int[]` ليشمل أيضاً ancestors المحطات (الناحية، المنطقة).

### CT-G-LOCATION-NAMING — اسم القيمة `'contract'` مضلِّل
- في `task_type_config.location_basis` القيمة `'contract'` معنوياً = **"device"**.
- التسمية القديمة محفوظة لأسباب توافق. يجب إعادة تسميتها لاحقاً (Phase 12+).

### CT-G-SOURCE-TYPE-PIN — `target_stage` و `source_type` مدفونتان بقيمة `'lead'`
- DEC-005 D30 ينص على حذفهما.
- في الـ schema لا يزال موجوداً مع CHECK لقيمة `'lead'` ثابتة.
- في الكود، الـ JOIN في `planning.ts` كان يفلتر عليهما — أُزيلت الإشارة في commit `18aa68f`.

### CT-G-NULL-LOCATION — `effective_zone = NULL` ابتلاع صامت
- زبون بلا حي ولا جهاز مركَّب → يُستثنى بدون رسالة.
- المدير لا يعرف أن الزبون موجود لكن خارج النطاق.

---

## 7. الأخطاء التي صُلِحت مؤخّراً (مرجع تاريخي)

| التاريخ | Commit | الخطأ | الإصلاح |
|---|---|---|---|
| 2026-06-02 | `28221e2` | `contracts.installation_geo_unit_id` غير موجود | استبدل الـ JOIN بـ `installed_devices` |
| 2026-06-02 | `18aa68f` | `NULLIF(c.neighborhood, '')` يفشل لأن النوع INTEGER | حذف الـ NULLIF + cast، استخدم `c.neighborhood` مباشرة |

---

## 8. النموذج النفسي للمطور

عند تعديل هذا الـ filter، اسأل نفسك بهذا الترتيب:

1. **ما الزبائن الذين أريد إدخالهم؟** (ضمن الفرع، نشطون، غير محظورين)
2. **ما المهام التي تجعلهم مؤهَّلين؟** (افعَل، ضمن النافذة، غير مستبعدة، لا زيارة معلَّقة)
3. **ما موقع المهمة؟** (حي الزبون أو حي الجهاز)
4. **هل الموقع داخل خطة الفريق المحفوظة؟**

أي حيد عن هذا التسلسل يكسر القاعدة الذهبية: **"المهمة هي المعيار، لا الزبون"** (PC-R003).

---

## 9. تنبيه عن تضارب الكيانات (Entity Conflation Warning)

**خطأ شائع في القراءة:** الخلط بين `contact_targets` و `open_tasks` على هذا الـ dashboard.

- هذا الـ Filter يولّد **bucket** من الزبائن المؤهَّلين.
- الـ Bucket ثم يُمرَّر لـ `syncAssignedTasks()` الذي يحوّل المهام إلى `assigned`.
- ثم `generateTaskListFromPlan()` يُولّد `contact_targets` و `telemarketing_task_list_items`.

أي:
- المرحلة 1 (هذا الـ Filter) = **اكتشاف** الزبائن المؤهَّلين.
- المرحلة 2 (sync) = **تحديث** `open_tasks.status` لـ `assigned`.
- المرحلة 3 (generate) = **إنشاء** `contact_targets` و list items.

الخلط بين هذه المراحل = سوء تشغيل.
