# Prompt: فلترة خادمية لزيارات الفريق (Field Visits Team Filter)

## الهدف
حالياً `GET /api/field-visits/` بيرجع كل زيارات الفرع لأي حدا عنده `field_visits.view`. الفريق الميداني (مشرف/فني/متدرب) بيفلتر جانبياً (client-side) بالـ `isUserInTeam()` — هذا بيعني إن البيانات كاملة بتنحمّل للكل وبتتفلتر بالواجهة. المطلوب: ننقل الفلترة للخادم بحيث يبعت `mineOnly=true` فتفلتر SQL حسب `team_snapshot` IDs + `reassigned_*` IDs.

## الملفات

### 1. `packages/web/src/lib/api.ts`

أضف `mineOnly?: boolean` لـ `api.fieldVisits.list`:

```typescript
fieldVisits: {
    list: (params: {
      clientId?: number;
      date?: string;
      branchId?: number;
      status?: string;
      visitType?: string;
      taskType?: string;
      mineOnly?: boolean;   // ← NEW
    }) => {
      const qs = new URLSearchParams();
      if (params.clientId) qs.append('clientId', String(params.clientId));
      if (params.date) qs.append('date', params.date);
      if (params.branchId) qs.append('branchId', String(params.branchId));
      if (params.status) qs.append('status', params.status);
      if (params.visitType) qs.append('visitType', params.visitType);
      if (params.taskType) qs.append('taskType', params.taskType);
      if (params.mineOnly) qs.append('mineOnly', 'true');   // ← NEW
      return request<any[]>(`/field-visits/?${qs.toString()}`);
    },
```

### 2. `packages/web/src/pages/visits/VisitsListPage.tsx`

#### 2.1. `load` callback — ضيف `mineOnly` حسب `activeView` و `teamMineOnly`:

```typescript
const load = useCallback(async () => {
    if (!date) return;
    if (!canGlobal && !selectedBranchId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.fieldVisits.list({
        date,
        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(visitTypeFilter ? { visitType: visitTypeFilter } : {}),
        ...(taskTypeFilter ? { taskType: taskTypeFilter } : {}),
        // ← NEW: فلترة الفريق بالخادم
        ...(activeView === 'team' && teamMineOnly ? { mineOnly: true } : {}),
      });
      setRows(data as VisitRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الزيارات');
    } finally {
      setLoading(false);
    }
  }, [canGlobal, date, effectiveBranchId, selectedBranchId, statusFilter, taskTypeFilter, visitTypeFilter, activeView, teamMineOnly]); // ← activeView + teamMineOnly added to deps
```

#### 2.2. `visibleRows` memo — شيل `isUserInTeam` من `team` view لأنه صار بالخادم:

```typescript
if (activeView === 'team') {
      // Field team view: actionable visits (not cancelled/closed).
      // The mineOnly filtering is now server-side; we only filter by status here.
      return rows
        .filter((row) => !['cancelled', 'closed'].includes(row.status));
    }
```

#### 2.3. `headerKpis` — الـ `team` view KPIs still compute `mine` from `rows` (already filtered by server when mineOnly=true), so keep the same calculation logic but remove `user?.employeeId` dependency from the team branch since it's not needed for filtering anymore:

```typescript
if (activeView === 'team') {
      const mine = rows; // already server-filtered when mineOnly=true
      const myTotal = mine.length;
      const myInField = mine.filter((r) => r.status === 'in_progress' || r.status === 'ended').length;
      const myDone = mine.filter((r) => r.status === 'completed').length;
      const myRemaining = mine.filter((r) => ['scheduled', 'in_progress', 'ended'].includes(r.status)).length
        - mine.filter((r) => r.status === 'completed').length;
      const myUrgent = mine.filter(isVisitStuck).length;
      return [
        { label: 'زياراتي اليوم', value: myTotal,                  icon: CalendarDays,  color: 'text-sky-700 bg-sky-50' },
        { label: 'بدأت',          value: myInField,                icon: Activity,      color: 'text-indigo-700 bg-indigo-50' },
        { label: 'مكتملة',         value: myDone,                   icon: CheckCircle2,  color: 'text-emerald-700 bg-emerald-50' },
        { label: 'المتبقّي',       value: Math.max(0, myRemaining), icon: ClipboardList, color: 'text-slate-700 bg-slate-100' },
        { label: 'يحتاج إجراء',    value: myUrgent,                 icon: AlertTriangle, color: 'text-rose-700 bg-rose-50' },
      ];
    }
```

### 3. `packages/api/routes/fieldVisits.ts`

#### 3.1. في `GET /` (الـ list endpoint) — أضف قراءة `mineOnly` query param:

```typescript
router.get('/', requirePermission('field_visits.view'), async (req, res) => {
  try {
    const authContext = getAuthContext(req);
    const clientId = req.query.clientId ? Number(req.query.clientId) : null;
    const date = typeof req.query.date === 'string' ? req.query.date : null;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const visitType = typeof req.query.visitType === 'string' ? req.query.visitType : null;
    const taskType = typeof req.query.taskType === 'string' ? req.query.taskType : null;
    const mineOnly = req.query.mineOnly === 'true'; // ← NEW
```

#### 3.2. حلّل `employeeId` تبع المستخدم الحالي:

```typescript
    let employeeId: number | null = null;
    if (mineOnly) {
      const { rows: userRows } = await pool.query(
        `SELECT employee_id FROM hr_users WHERE id = $1 AND is_active = TRUE`,
        [authContext.userId],
      );
      const rawId = userRows[0]?.employee_id;
      employeeId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
    }
```

#### 3.3. أضف `mineOnly` condition للـ `conditions` array:

```typescript
    if (mineOnly && employeeId != null) {
      conditions.push(`(
        COALESCE(fv.reassigned_supervisor_id, NULLIF((fv.team_snapshot->>'supervisorEmployeeId')::text, '')::int) = $${idx++}
        OR COALESCE(fv.reassigned_technician_id, NULLIF((fv.team_snapshot->>'technicianEmployeeId')::text, '')::int) = $${idx++}
        OR COALESCE(fv.reassigned_trainee_id, NULLIF((fv.team_snapshot->>'traineeEmployeeId')::text, '')::int) = $${idx++}
      )`);
      params.push(employeeId, employeeId, employeeId);
    }
```

**ملاحظة:** إذا `mineOnly=true` و `employeeId=null` (مثلاً سوبر أدمن ما عنده employee_id)، لا تضف condition — بيرجع كل الزيارات (نفس سلوك `BRANCH` العادي). هذا يمنع أن يطلع جدول فاضي للأدمن.

#### 3.4. الترتيب الصحيح للـ conditions array:

- `clientId` (إن وُجد)
- `date` (إن وُجد)
- `status`
- `visitType`
- `taskType` ( EXISTS subquery )
- `branchId` (سوبر أدمن أو العادي)
- `mineOnly` (الجديد)

#### 3.5. لا تنسَ التأكد إن الـ `branchId` condition ما يتأثر:

```typescript
    if (branchId !== null && authContext.isSuperAdmin) {
      conditions.push(`fv.branch_id = $${idx++}`);
      params.push(branchId);
    }
    if (!authContext.isSuperAdmin && authContext.actingBranchId != null) {
      conditions.push(`fv.branch_id = $${idx++}`);
      params.push(authContext.actingBranchId);
    }
```

## قواعد
- `requirePermission('field_visits.view')` + `BRANCH` scope = ما يتغير.
- `mineOnly` = opt-in query param — لو مش موجود، كل شيء زي ما كان.
- لا تغيير على `GET /:id` (detail endpoint) بهالمرحلة.
- `mineOnly` يفلتر حسب `team_snapshot` IDs (الأصلي) و `reassigned_*` (إن وجدت).

## التحقق
1. فريق ميداني (مشرف/فني) بفتح `team view` → يبعت `mineOnly=true` → بيجيه بس زيارات فريقه.
2. مدير الفرع بفتح `branch view` → ما بيبعت `mineOnly` → بيجيه كل زيارات الفرع.
3. تبديل toggle "زياراتي فقط" بالـ team view → يغير `mineOnly` ويعيد التحميل.
