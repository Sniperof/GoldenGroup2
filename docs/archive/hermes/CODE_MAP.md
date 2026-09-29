# خريطة الكود — Code Map

> **أهم 20 ملف + أهم function بكل ملف.**

---

## 📁 Backend Routes

| الملف | المسار | الأهمية |
|--------|--------|--------|
| `routes/clients.ts` | `/api/clients` | bulk-delete مشكلة (GAP-001), soft-delete logic |
| `routes/contracts.ts` | `/api/contracts` | bookVisit مستدعي, فحص العقود |
| `routes/openTasks.ts` | `/api/open-tasks` | `POST /:id/schedule-from-expected` (D22), syncAssignedTasks مستدعي |
| `routes/fieldVisits.ts` | `/api/field-visits` | start/end الزيارة, cancel بسبب, visit tasks |
| `routes/telemarketing.ts` | `/api/telemarketing` | book-visit, call-logs, appointments, contact targets |
| `routes/planning.ts` | `/api/planning` | day_schedule + work_scope + syncAssignedTasks مستدعي |
| `routes/routeAssignments.ts` | `/api/route-assignments` | syncAssignedTasks مستدعي |
| `routes/workScopes.ts` | `/api/work-scopes` | syncAssignedTasks مستدعي |
| `routes/geoUnits.ts` | `/api/geo-units` | CRUD geo, status toggle |
| `routes/employees.ts` | `/api/employees` | HR management |
| `routes/candidates.ts` | `/api/candidates` | GAP-007: missing GET /:id |
| `routes/permissions.ts` | `/api/permissions` | RBAC seeding |
| `routes/taskTypeConfig.ts` | `/api/task-type-config` | `location_basis` CRUD |

---

## ⚙️ Backend Services

| الملف | الـ Function | الوظيفة |
|--------|-------------|--------|
| `services/planningMarketingTargets.ts` | `getPlanningMarketingTargets()` | توليد contact_targets — يقرأ `installed_devices` عبر `customer_id` |
| `services/planningMarketingTargets.ts` | `getPlanningWorkScope()` | بناء work_scope للفريق |
| `services/assignedTasks.ts` | `syncAssignedTasks()` | الـ منسق الرئيسي — يربط open_tasks بـ field_visits |
| `services/visitBooking.ts` | `bookVisit()` | حجز زيارة موحد — بيستدعى من 3 endpoints |
| `services/visitBooking.ts` | `validateBookingD18()` | فحص الخطة محفوظة + المنطقة |
| `services/geoScopeService.ts` | `loadBranchCoveredGeoIds()` | قائمة الـ geo_ids المغطاة لـ الفرع |
| `services/geoScopeService.ts` | `resolveGeoScope()` | بناء قائمة serviceGeoIds + visibleGeoIds |
| `services/clientPolicy.ts` | `canViewClient()` | ASSIGNED scope blocked (GAP-002) |
| `services/customerOwnership.ts` | — | ownership logic جاهز لـ ASSIGNED |

---

## 🎭 Frontend Pages

| الملف | الـ Page | الوظيفة |
|--------|-----------|--------|
| `pages/TelemarketerWorkspace.tsx` | مكتب التيليماركتينج | نتائج المكالمات, expected_date, Schedule-from-Expected |
| `pages/OpenTasks.tsx` | قائمة المهام | حالات المهام بادجيت |
| `pages/visits/VisitsListPage.tsx` | قائمة الزيارات | expected_followup label |
| `pages/clientProfile/` | ملف الزبون | ClientSnapshot 3 مستويات |
| `pages/Candidates.tsx` | قائمة المرشحين | CandidateSnapshot بس flat |
| `pages/devices/` | الأجهزة المركبة | DeviceSnapshot |

---

## 🎛️ Shared Components

| الملف | الـ Component | الوظيفة |
|--------|-------------|--------|
| `components/clients/ClientAvatar.tsx` | Avatar | دائري + أيقونة حسب data_quality |
| `components/clients/MiniClientSnapshot.tsx` | Mini Snapshot | للقوائم والجداول |
| `components/clients/StandardClientSnapshot.tsx` | Standard Snapshot | للمهام والزيارات |
| `components/openTasks/ScheduleFromExpectedModal.tsx` | Schedule-from-Expected Modal | حجز زيارة من وعد سابق |
| `lib/api.ts` | API Client | كل الـ hooks المشتركة |
