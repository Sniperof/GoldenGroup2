# TASK: إضافة "موعد محجوز" لشريط إحصائيات جهات الاتصال

## المشكلة

شريط الإحصائيات أعلى صفحة داشبورد جهات الاتصال (`/planning/contact-targets`) فاقد مرحلة **"موعد محجوز" (booked)**.

لما مهمة بتوصل لحالة `scheduled` (أو `waiting_execution`/`in_execution`/`ended`)، الـ backend بيحسبها ضمن `summary.booked`، بس الـ frontend ما بيعرضها — فبتختفي من الإحصائيات.

## الملف المستهدف

`packages/web/src/pages/planning/PlanningContactTargets.tsx`

## التعديل المطلوب

### السطر ~375 (tabs array):

من:
```tsx
const tabs: { key: Phase | 'all'; count: number }[] = [
    { key: 'all',      count: allClients.length },
    { key: 'assigned', count: assignedCount },
    { key: 'in_list',  count: summary?.inList   ?? 0 },
    { key: 'closed',   count: summary?.closed   ?? 0 },
    { key: 'excluded', count: summary?.excluded ?? 0 },
];
```

إلى:
```tsx
const tabs: { key: Phase | 'all'; count: number }[] = [
    { key: 'all',      count: allClients.length },
    { key: 'assigned', count: assignedCount },
    { key: 'in_list',  count: summary?.inList   ?? 0 },
    { key: 'booked',   count: summary?.booked   ?? 0 },
    { key: 'closed',   count: summary?.closed   ?? 0 },
    { key: 'excluded', count: summary?.excluded ?? 0 },
];
```

### التحقق:

- `Phase` type (سطر 61) بيشمل `'booked'` ✅
- `PHASE_META` (سطر 75-81) معرّف لـ `booked` ✅
- `StatCard` component بيقبل `'booked'` ✅

## Deliverables

- [ ] إضافة `{ key: 'booked', count: summary?.booked ?? 0 }` للـ tabs array
- [ ] Build passed
- [ ] Test: مهمة `scheduled` → بتظهر بـ tab "موعد محجوز" بالإحصائيات
