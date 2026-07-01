// ============================================================
// timeWindow.ts — البُعد الزمني لعقد النطاق (reporting-analytics §1.1)
// ============================================================
// يحوّل preset زمني (اليوم/الأسبوع/الشهر/الربع) أو مدى مخصّص إلى نافذتين:
//   [from, to)         النافذة الحالية
//   [prevFrom, prevTo) النافذة السابقة المساوية بالطول (لحساب الدلتا)
// ويحدّد:
//   cacheable  — المدى المخصّص (custom) لا يُكتب في الكاش (§7.5 ضبط التضخّم).
//   bucketKey  — مفتاح يتغيّر مع تدحرج الفترة فيُبطل الكاش تلقائيًا (مثلاً
//                "today" → التاريخ، "month" → YYYY-MM).
// ============================================================

export type TimePreset = 'today' | 'week' | 'month' | 'quarter' | 'custom';

export interface TimeWindow {
  preset: TimePreset;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  cacheable: boolean;
  bucketKey: string;
}

const PRESETS: readonly TimePreset[] = ['today', 'week', 'month', 'quarter', 'custom'];

function normalizePreset(value: string | undefined): TimePreset {
  return (PRESETS as readonly string[]).includes(value ?? '') ? (value as TimePreset) : 'month';
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveTimeWindow(presetInput: string | undefined, fromStr?: string, toStr?: string): TimeWindow {
  const preset = normalizePreset(presetInput);
  const now = new Date();

  // المدى المخصّص: يُحسب حيًّا ولا يُكتب في الكاش.
  if (preset === 'custom') {
    const from = fromStr ? new Date(fromStr) : startOfUtcDay(now);
    const to = toStr ? new Date(toStr) : now;
    const span = Math.max(1, to.getTime() - from.getTime());
    return {
      preset,
      from,
      to,
      prevFrom: new Date(from.getTime() - span),
      prevTo: from,
      cacheable: false,
      bucketKey: `${ymd(from)}_${ymd(to)}`,
    };
  }

  let from: Date;
  let bucketKey: string;
  const to = now;

  switch (preset) {
    case 'today':
      from = startOfUtcDay(now);
      bucketKey = ymd(from);
      break;
    case 'week':
      from = new Date(startOfUtcDay(now).getTime() - 6 * 86_400_000); // آخر ٧ أيام شاملةً اليوم
      bucketKey = ymd(startOfUtcDay(now));
      break;
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3);
      from = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      bucketKey = `${now.getUTCFullYear()}-Q${q + 1}`;
      break;
    }
    case 'month':
    default:
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      bucketKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      break;
  }

  // النافذة السابقة = مساوية بالطول مباشرةً قبل الحالية (مقارنة متّسقة لكل الـ presets).
  const span = Math.max(1, to.getTime() - from.getTime());
  return {
    preset,
    from,
    to,
    prevFrom: new Date(from.getTime() - span),
    prevTo: from,
    cacheable: true,
    bucketKey,
  };
}
