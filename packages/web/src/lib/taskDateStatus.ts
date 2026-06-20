/**
 * Temporal status for task dates (dueDate / expectedDate).
 *
 * dueDate  = تاريخ الاستحقاق (صارم) — تجاوزه يعني المهمة متأخرة رسمياً
 * expectedDate = الموعد المتوقع (ليّن) — تجاوزه إشارة بصرية فقط، المهمة تبقى مفتوحة
 */

export type DateTone = 'overdue' | 'today' | 'soon' | 'later' | 'past_soft' | 'upcoming_soft';

export interface DateStatus {
  tone: DateTone;
  label: string;          // e.g. "متأخرة 3 أيام"
  shortLabel: string;     // e.g. "−3 أيام"
  daysOffset: number;     // negative = past, 0 = today, positive = future
  badgeClass: string;     // tailwind classes for the badge background
  textClass: string;      // tailwind classes when used inline as text only
}

function arabicDays(n: number): string {
  const abs = Math.abs(n);
  if (abs === 1) return 'يوم';
  if (abs === 2) return 'يومين';
  if (abs >= 3 && abs <= 10) return 'أيام';
  return 'يوماً';
}

function diffDays(dateStr: string, referenceDate?: string | Date | null): number {
  const today = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(today.getTime())) return 0;
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return 0;
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Status for a HARD due_date — overdue is a formal red state. */
export function getDueDateStatus(date: string | null | undefined, referenceDate?: string | Date | null): DateStatus | null {
  if (!date) return null;
  const days = diffDays(date, referenceDate);

  if (days < 0) {
    return {
      tone: 'overdue',
      label: `متأخرة ${Math.abs(days)} ${arabicDays(days)}`,
      shortLabel: `−${Math.abs(days)} ${arabicDays(days)}`,
      daysOffset: days,
      badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
      textClass: 'text-rose-700 font-bold',
    };
  }
  if (days === 0) {
    return {
      tone: 'today',
      label: 'مستحقة اليوم',
      shortLabel: 'اليوم',
      daysOffset: 0,
      badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
      textClass: 'text-orange-700 font-bold',
    };
  }
  if (days <= 7) {
    return {
      tone: 'soon',
      label: `بعد ${days} ${arabicDays(days)}`,
      shortLabel: `+${days} ${arabicDays(days)}`,
      daysOffset: days,
      badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      textClass: 'text-emerald-700 font-medium',
    };
  }
  return {
    tone: 'later',
    label: `بعد ${days} ${arabicDays(days)}`,
    shortLabel: `+${days} ${arabicDays(days)}`,
    daysOffset: days,
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    textClass: 'text-sky-700',
  };
}

/** Status for a SOFT expected_date — past is informational (violet), not red. */
export function getExpectedDateStatus(date: string | null | undefined, referenceDate?: string | Date | null): DateStatus | null {
  if (!date) return null;
  const days = diffDays(date, referenceDate);

  if (days < 0) {
    return {
      tone: 'past_soft',
      label: `تجاوزت الموعد المتوقع بـ ${Math.abs(days)} ${arabicDays(days)}`,
      shortLabel: `تجاوزت ${Math.abs(days)} ${arabicDays(days)}`,
      daysOffset: days,
      badgeClass: 'bg-violet-50 text-violet-700 border border-violet-200',
      textClass: 'text-violet-700 font-medium',
    };
  }
  if (days === 0) {
    return {
      tone: 'today',
      label: 'الموعد المتوقع اليوم',
      shortLabel: 'اليوم',
      daysOffset: 0,
      badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
      textClass: 'text-amber-700 font-bold',
    };
  }
  if (days <= 7) {
    return {
      tone: 'upcoming_soft',
      label: `بعد ${days} ${arabicDays(days)}`,
      shortLabel: `+${days} ${arabicDays(days)}`,
      daysOffset: days,
      badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
      textClass: 'text-teal-700',
    };
  }
  return {
    tone: 'later',
    label: `بعد ${days} ${arabicDays(days)}`,
    shortLabel: `+${days} ${arabicDays(days)}`,
    daysOffset: days,
    badgeClass: 'bg-slate-50 text-slate-600 border border-slate-200',
    textClass: 'text-slate-600',
  };
}
