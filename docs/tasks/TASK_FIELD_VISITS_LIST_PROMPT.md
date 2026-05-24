# TASK: بناء صفحة قائمة الزيارات الميدانية (Field Visits List)

## الهدف
صفحة جديدة واحترافية تعرض كل الزيارات الميدانية (`field_visits`) بترتيب تنظيمي، بفلاتر، وببطاقات ملونة حسب الحالة.

## الموقع
- **URL:** `/field-visits`
- **اسم الدراور:** "الزيارات الميدانية"
- **المسار بـ App.tsx:** `<Route path="/field-visits" element={<FieldVisitsListPage />} />`
- **الأيقونة:** `MapPin` أو `CalendarCheck`

## ملاحظة مهمة
لا يوجد أي رابط لـ `marketing_visits` أو `marketing_visits_tasks` في هذه الصفحة — الكيان الوحيد هو `field_visits`.

---

## الجزء 1: API Endpoint

### GET /api/field-visits

**الفلاتر المتاحة:**
| Query Param | النوع | الوصف |
|-------------|-------|-------|
| `?date=YYYY-MM-DD` | string | فلتر حسب التاريخ |
| `?status=` | string | حالة الزيارة |
| `?clientId=` | number | فلتر حسب الزبون |

**Response fields:**
```json
{
  "id": 1,
  "visitType": "sales|service|emergency",
  "visitFamily": "sales|service|emergency|maintenance|collection",
  "status": "scheduled|in_progress|ended|completed|not_completed|cancelled|postponed_by_company|postponed_by_customer|needs_reschedule",
  "scheduledDate": "2026-05-24",
  "scheduledTime": "10:00",
  "clientId": 21,
  "branchId": 2,
  "teamSnapshot": {
    "supervisorName": "...",
    "technicianName": "...",
    "traineeName": "..."
  },
  "customerSnapshot": {
    "name": "...",
    "mobile": "...",
    "addressText": "..."
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## الجزء 2: تصميم الصفحة

### الهيكل العام

```
┌────────────────────────────────────────────────────────────────┐
│  📍 الزيارات الميدانية                      [زر +زيارة جديدة] │
├────────────────────────────────────────────────────────────────┤
│  📅 الفلاتر:  [اليوم ▼]  [الحالة ▼]  [الفرع ▼]  [تطبيق]       │
├────────────────────────────────────────────────────────────────┤
│  📆 اليوم — الجمعة ٢٤ مايو ٢٠٢٦                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 🕙 10:00 │ 🟢 مجدولة │ أحمد العلي │ فريق: خالد - سامر     │ │
│  │ 📱 0999123456 │ 🏠 حلب - السكري - شارع الثورة            │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 🕙 14:00 │ 🔵 جارية │ محمد خالد │ فريق: عمر - فادي        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  📆 غداً — السبت ٢٥ مايو ٢٠٢٦                                   │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 🕙 09:00 │ 🟢 مجدولة │ فاطمة حسن │ فريق: خالد - سامر      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  📆 هذا الأسبوع                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 🕙 11:00 │ 🟠 مؤجلة (الشركة) │ عمر داوود                  │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### ألوان الحالات

| الحالة | اللون | الـ Badge |
|--------|-------|-----------|
| مجدولة | 🟢 أخضر | `bg-emerald-50 text-emerald-700` |
| جارية | 🔵 أزرق | `bg-blue-50 text-blue-700` |
| انتهت ميدانياً | 🟡 أصفر | `bg-amber-50 text-amber-700` |
| مكتملة | 🟢 أخضر غامق | `bg-emerald-100 text-emerald-800` |
| لم تتم | 🔴 أحمر | `bg-rose-50 text-rose-700` |
| مؤجلة | 🟠 برتقالي | `bg-orange-50 text-orange-700` |
| ملغاة | ⚫ رمادي | `bg-slate-100 text-slate-500` |
| تحتاج إعادة جدولة | 🟡 أصفر فاقع | `bg-yellow-50 text-yellow-700` |

### تصميم بطاقة الزيارة

```jsx
<div className="bg-white rounded-2xl border border-slate-200 p-4 hover:shadow-md transition-shadow cursor-pointer">
  {/* الصف العلوي */}
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-slate-400" />
      <span className="text-sm font-bold text-slate-700">{visit.scheduledTime || '--:--'}</span>
    </div>
    <StatusBadge status={visit.status} />
  </div>
  
  {/* اسم الزبون */}
  <h3 className="text-base font-black text-slate-800 mb-1">
    {visit.customerSnapshot?.name || 'زبون غير معروف'}
  </h3>
  
  {/* معلومات التواصل والعنوان */}
  <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
    {visit.customerSnapshot?.mobile && (
      <span className="flex items-center gap-1">
        <Phone className="w-3 h-3" /> {visit.customerSnapshot.mobile}
      </span>
    )}
    {visit.customerSnapshot?.addressText && (
      <span className="flex items-center gap-1">
        <MapPin className="w-3 h-3" /> {visit.customerSnapshot.addressText}
      </span>
    )}
  </div>
  
  {/* الفريق */}
  {visit.teamSnapshot && (
    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
      <Users className="w-3 h-3" />
      <span>الفريق:</span>
      <span className="font-medium text-slate-700">
        {visit.teamSnapshot.supervisorName || '--'}
        {visit.teamSnapshot.technicianName && ` / ${visit.teamSnapshot.technicianName}`}
      </span>
    </div>
  )}
</div>
```

---

## الجزء 3: الفلاتر

### فلتر التاريخ
- **اليوم** (افتراضي)
- **غداً**
- **هذا الأسبوع**
- **اختيار تاريخ** (Date picker)

```jsx
const dateFilterOptions = [
  { key: 'today', label: 'اليوم', getDate: () => new Date().toISOString().split('T')[0] },
  { key: 'tomorrow', label: 'غداً', getDate: () => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; } },
  { key: 'week', label: 'هذا الأسبوع', getDate: null },
  { key: 'custom', label: 'تاريخ محدد', getDate: null }
];
```

### فلتر الحالة
- الكل (افتراضي)
- مجدولة
- جارية
- انتهت
- مكتملة
- ملغاة
- مؤجلة

### فلتر الفرع (للسوبر أدمن فقط)

---

## الجزء 4: تجميع حسب التاريخ

الزيارات لازم تتجمع وتُعرض مجمعة حسب التاريخ:

```
📆 اليوم — الجمعة ٢٤ مايو ٢٠٢٦
    [زيارة 1]
    [زيارة 2]

📆 غداً — السبت ٢٥ مايو ٢٠٢٦
    [زيارة 3]

📆 الأحد ٢٦ مايو ٢٠٢٦
    [زيارة 4]
    [زيارة 5]
```

### تنسيق التاريخ
```typescript
function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (date.toDateString() === today.toDateString()) return 'اليوم';
  if (date.toDateString() === tomorrow.toDateString()) return 'غداً';
  
  return date.toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    numberingSystem: 'latn'  // أرقام غربية
  });
}
```

---

## الجزء 5: تفاعل — فتح التفاصيل

بالضغط على بطاقة الزيارة:
```typescript
navigate(`/field-visits/${visit.id}`);
```

هاد بيفتح `VisitDetailPage.tsx` اللي موجودة وفيها سجل المشتريات.

---

## الجزء 6: الدراور (MainLayout.tsx)

أضف بين "إدارة المواعيد" و "إدارة العقود":

```jsx
{can('marketing_visits.view') && (
  <NavLink
    to="/field-visits"
    onClick={() => setIsMobileMenuOpen(false)}
    className={({ isActive }: { isActive: boolean }) =>
      `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-right ${isActive
        ? 'bg-sky-50 text-sky-600 border-r-4 border-sky-500 font-bold'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      } ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''}`
    }
  >
    <MapPin className={`w-5 h-5 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
    <span className={`${isCollapsed ? 'lg:hidden' : 'block'}`}>الزيارات الميدانية</span>
  </NavLink>
)}
```

---

## الجزء 7: ملفات للتعديل/الإنشاء

| # | الملف | التعديل |
|---|-------|---------|
| 1 | `packages/web/src/pages/visits/FieldVisitsListPage.tsx` | **إنشاء جديد** |
| 2 | `packages/web/src/App.tsx` | إضافة route `/field-visits` |
| 3 | `packages/web/src/layout/MainLayout.tsx` | إضافة رابط الدراور |
| 4 | `packages/web/src/lib/api.ts` | إضافة `fieldVisits.list()` (إذا مش موجود) |

---

## الجزء 8: API Client (`api.ts`)

إذا مش موجود:

```typescript
fieldVisits: {
  list: (params?: { date?: string; status?: string; clientId?: number }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    if (params?.status) q.set('status', params.status);
    if (params?.clientId) q.set('clientId', String(params.clientId));
    return request<any[]>(`/field-visits?${q}`);
  }
}
```

---

## ملاحظات تنفيذية

1. **الأرقام دائماً Western:** `numberingSystem: 'latn'`
2. **لا `marketing_visits`:** كل البيانات من `field_visits` فقط
3. **الـ snapshot:** الزبون والفريق بيجوا من `customer_snapshot` و `team_snapshot`
4. **التحميل:** skeleton loading while fetching
5. **فارغة:** إذا ما فيه زيارات — رسالة "لا توجد زيارات مسجلة"
6. **خطأ:** رسالة "تعذّر تحميل الزيارات" مع زر إعادة المحاولة

---

## Deliverables

- [ ] `FieldVisitsListPage.tsx` — صفحة قائمة الزيارات
- [ ] `App.tsx` — route `/field-visits`
- [ ] `MainLayout.tsx` — رابط "الزيارات الميدانية"
- [ ] `api.ts` — `fieldVisits.list()`
- [ ] Build passed
- [ ] الضغط على الزيارة بيفتح `/field-visits/:id`
- [ ] سجل المشتريات يظهر بصفحة التفاصيل
