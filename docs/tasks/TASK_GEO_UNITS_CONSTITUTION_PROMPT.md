# Prompt: Domain Constitution for Geo Units (المناطق الجغرافية)

## Objective

Build the **complete, authoritative Domain Constitution** for the `geo_units` entity in Golden CRM. This is a **foundational** entity — every address, branch coverage, task location, and visit route depends on it.

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources — especially the VARCHAR/INTEGER mismatch (GAP-003).

---

## Output Files

1. `docs/constitution/domains/geo-units.md` — The full Geo Units constitution
2. Update `docs/constitution/INDEX.md` — Add geo-units row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add geo_units and relationships
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-034, GAP-035, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
```
migrations/001_core_tables.sql              (CREATE TABLE geo_units — baseline)
migrations/053_geo_units_unique_constraint.sql (UNIQUE constraint added)
migrations/060_fix_branch_geo_coverage.sql    (branch geo coverage fix)
migrations/061_syrian_geo_data.sql             (Syrian governorate/district data seeded)
migrations/101_contracts_installation_address.sql (installation_geo_unit_id)
migrations/113_task_type_config_location_basis.sql (location basis for task types)
migrations/167_snapshot_backfill.sql            (geo casting in snapshots)
```

Also check how geo_units are referenced by other tables (from previous constitutions or directly from migrations):
- `clients.governorate`, `clients.district`, `clients.neighborhood` — VARCHAR but should be INTEGER FK
- `branches.location_geo_id` — INTEGER FK
- `branches.covered_geo_ids` — JSONB array of geo_unit IDs
- `contracts.installation_geo_unit_id` — INTEGER FK
- `candidates.geo_unit_id` — INTEGER FK
- `employees.residence` — VARCHAR? Or geo_unit_id?
- `field_visits` — any geo fields?
- `task_type_config.location_basis` — what does this mean?

### B. API Layer
```
packages/api/routes/geoUnits.ts          (3 endpoints only — very simple)
packages/api/services/geoScopeService.ts   (scope filtering logic)
packages/api/services/geoUnits.ts        (if exists — list functions)
```

### C. Shared Types
```
packages/shared/types.ts                (GeoUnit interface)
```

### D. System Configuration
```
migrations/054_permissions_allowed_scopes.sql (geo.view, geo.manage)
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/geo-units.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: الوحدة الجغرافية
- **الاسم الإنجليزي**: Geo Unit
- **اسم الجدول**: `geo_units`
- **الوصف**: النظام الجغرافي الهرمي للعناوين. يمثل مستويات العنوان في سوريا: محافظة (1) → منطقة/مدينة (2) → ناحية/حي (3). كل وحدة تابعة لوحدة أعلى (parent_id). هو الأساس لكل العناوين بالنظام.
- **الجداول المرتبطة**: clients (governorate, district, neighborhood), branches (location_geo_id, covered_geo_ids), contracts (installation_geo_unit_id), candidates (geo_unit_id), employees (residence), routes (route_points), field_visits...
- **الأهمية**: Foundational — بدونو ما بيشتغل عنوان الزبون، نطاق الفرع، تخطيط المسار.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `geo_units` — الوحدات الجغرافية

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | المعرف الفريد | `1` (دمشق) |
| `name` | `VARCHAR(255)` | ❌ | — | — | اسم الوحدة الجغرافية | `"دمشق"` |
| `level` | `INTEGER` | ❌ | — | — | مستوى الهرم | `1` = محافظة, `2` = منطقة, `3` = حي |
| `parent_id` | `INTEGER` | ✅ | — | `FK → geo_units(id) ON DELETE CASCADE` | الوحدة الأب | `1` (للمنطقة التابعة لدمشق) |

#### 2.2 Unique Constraint (migration 053)
```sql
UNIQUE (name, level, parent_id)
```
Or similar — read the migration to confirm exact columns.

#### 2.3 Syrian Geo Data (migration 061)
Document what was seeded:
- How many governorates (level 1)?
- How many districts (level 2)?
- How many neighborhoods (level 3)?
- Are all governorates of Syria included?

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

#### BR-1: Hierarchy Levels
```
Level 1: Governorate (محافظة) — e.g., Damascus, Aleppo, Homs
Level 2: District/City (منطقة/مدينة) — e.g., Mezzeh, Malki
Level 3: Neighborhood/Sub-district (حي/ناحية) — e.g., Western Villas, Al-Malki Villas
```

Is there a Level 0 (Country)? Check migration 001.
Can levels be extended? (Level 4 for building?)

#### BR-2: Parent-Child Integrity
```
parent_id must have level = child.level - 1
A level 3 unit cannot have a level 1 parent directly
```

Is this enforced by CHECK constraint? Or only by application logic?

#### BR-3: Geo Scope Filtering (from geoScopeService.ts)
```
When listing geo_units:
  - If user has GLOBAL scope → sees ALL geo_units
  - If user has BRANCH scope → sees only geo_units covered by their branch
```

How is branch coverage determined? `branches.covered_geo_ids` JSONB array.

#### BR-4: Address Assembly
```
Full address = governorate.name + district.name + neighborhood.name + detailed_address
Example: "دمشق، المزة، فيلات غربية، بناية ٥"
```

How is this assembled? In frontend? Or API? Check clients.ts address formatting.

#### BR-5: The VARCHAR Problem (GAP-003) ⭐ CRITICAL

```
clients.governorate  = VARCHAR(255) — stores geo_unit.id as STRING
clients.district     = VARCHAR(255) — stores geo_unit.id as STRING
clients.neighborhood = VARCHAR(255) — stores geo_unit.id as STRING

But:
branches.location_geo_id = INTEGER — correct
candidates.geo_unit_id   = INTEGER — correct
contracts.installation_geo_unit_id = INTEGER — correct
```

Why are client geo fields VARCHAR? Migration 001 created them as VARCHAR with DEFAULT ''. They were never migrated to INTEGER.

Migration 167 does: `NULLIF(c.governorate, '')::int` — CASTING! This proves the intent was INTEGER all along.

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
geo_units ||--o{ geo_units : "parent → children"
geo_units ||--o{ clients : "as governorate"
geo_units ||--o{ clients : "as district"
geo_units ||--o{ clients : "as neighborhood"
geo_units ||--o{ branches : "location"
geo_units ||--o{ branches : "covered areas"
geo_units ||--o{ contracts : "installation location"
geo_units ||--o{ candidates : "residence"
geo_units ||--o{ route_points : "route point"
```

---

### Section 5: آلة الحالات (State Machine)

Geo units are relatively static — no complex state machine. But document:

```
Hierarchy integrity:
[valid parent] → can have → [valid children]
[level 1] → can have → [level 2]
[level 2] → can have → [level 3]
```

Deletion rule:
```
DELETE geo_unit → CASCADE deletes children
→ But what about clients referencing it as VARCHAR?
→ clients.governorate = '1' (string) won't be cascade-updated!
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض الوحدات الجغرافية | `geo.view` | GLOBAL, BRANCH | عرض القائمة |
| إدارة الوحدات الجغرافية | `geo.manage` | GLOBAL | إضافة/حذف |

**CRITICAL:** Check if `geo.manage` is only GLOBAL (reasonable — geo is system-wide). Can branch managers add level 3 units (neighborhoods) for their branch?

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/geo-units` | `geo.view` | قائمة الوحدات الجغرافية |
| POST | `/api/geo-units` | `geo.manage` | إنشاء وحدة جديدة |
| DELETE | `/api/geo-units/:id` | `geo.manage` | حذف وحدة + children |

**CRITICAL NOTE:** There is NO PUT /:id endpoint! Geo units cannot be edited via API — only created and deleted. Document this as a gap.

Also missing: GET /:id (individual geo unit detail).

Query parameters: None — simple list.

Response format for GET /:
```json
[
  { "id": 1, "name": "دمشق", "level": 1, "parentId": null },
  { "id": 12, "name": "المزة", "level": 2, "parentId": 1 }
]
```

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | عرض كل الوحدات | GET / | — | يعيد array مرتبة |
| TC-02 | إنشاء محافظة | POST / | {name:"حلب", level:1} | 200 + id |
| TC-03 | إنشاء منطقة تابعة | POST / | {name:"حلب الجديدة", level:2, parentId:16} | 200 + parent validated |
| TC-04 | محاولة إنشاء منطقة بدون parent | POST / | {name:"xxx", level:2} | 400 أو 200 (nullable?) |
| TC-05 | إنشاء مكرر | POST / | {name:"دمشق", level:1} | 409 (unique constraint) |
| TC-06 | حذف وحدة مع children | DELETE /:id | id=1 (دمشق) | 200 + CASCADE delete children |
| TC-07 | حذف وحدة مرتبطة بـ client | DELETE /:id | id=12 (منطقة) | ??? (clients.governorate='12' as string won't be updated!) |
| TC-08 | عرض بـ scope فرع | GET / | user with BRANCH scope | يعيد بس covered_geo_ids |
| TC-09 | إنشاء level 0 | POST / | {name:"سوريا", level:0} | ??? (if not blocked) |
| TC-10 | client address assembly | (implicit) | governorate=1, district=12, neighborhood=123 | "دمشق، المزة، فيلات غربية" |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **GAP-003 reinforcement** — clients.governorate/district/neighborhood as VARCHAR. This is the most critical gap related to geo. Document its full impact:
   - No FK constraint from clients to geo_units
   - No referential integrity
   - CASTing required for joins (migration 167)
   - Risk of orphaned string values

2. **No PUT endpoint** — Geo units cannot be renamed. Must delete + recreate (losing children references).

3. **No GET /:id endpoint** — Can't view individual geo unit details.

4. **No level validation** — Can someone create level 4? level -1? No CHECK constraint on level values.

5. **No parent level validation** — Can a level 3 unit have a level 1 parent directly? (Skipping level 2)

6. **Syrian data completeness** — Does migration 061 include ALL governorates? What about newly formed districts?

7. **branches.covered_geo_ids as JSONB** — Not normalized. No FK constraint. Risk of invalid IDs.

8. **employees.residence** — Is it VARCHAR or INTEGER FK? Check migration 017.

9. **Deletion cascade** — `ON DELETE CASCADE` on parent_id means deleting a governorate deletes ALL districts and neighborhoods. Is this safe?

10. **task_type_config.location_basis** — What does this field do? How does it relate to geo_units?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document every migration that touched geo_units or geo-related fields in other tables.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| المناطق الجغرافية (Geo Units) | [domains/geo-units.md](domains/geo-units.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `geo_units` to Table Inventory
- `geo_unit_id` / `governorate` / `district` / `neighborhood` references across all tables
- Document the VARCHAR vs INTEGER inconsistency pattern
- Update `branch_id` table to note `covered_geo_ids` JSONB

### GAPS-TRACKER.md
If new gaps found (GAP-034+), add them. If GAP-003 is reinforced with new findings, update its description.

---

## Verification Checklist

- [ ] `geo-units.md` contains all 10 sections
- [ ] `geo_units` table: 4 fields documented
- [ ] Hierarchy levels (1, 2, 3) documented with examples
- [ ] Syrian geo data from migration 061 documented
- [ ] UNIQUE constraint from migration 053 documented
- [ ] GAP-003 fully documented with all impacted tables
- [ ] All 3 endpoints documented
- [ ] Missing PUT and GET /:id documented as gaps
- [ ] At least 10 test cases
- [ ] At least 5 gaps identified (including GAP-003 reinforcement)
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete geo-units domain constitution`

---

## Notes for the Executor

1. **Geo is small but foundational.** Only 4 fields, 3 endpoints, 1 table. BUT it impacts almost every other entity.
2. **GAP-003 is the star here.** Document it thoroughly — it's the biggest structural issue in the database.
3. **Read migration 061 carefully.** What Syrian geo data was seeded? How many units per level?
4. **Check geoScopeService.ts.** How does scope filtering work? This is important for understanding BRANCH-scoped geo visibility.
5. **task_type_config.location_basis** — What does it mean? Read migration 113.
6. **Use exact SQL types** from migrations.
7. **Examples must be realistic** — Syrian governorates, real district names.
