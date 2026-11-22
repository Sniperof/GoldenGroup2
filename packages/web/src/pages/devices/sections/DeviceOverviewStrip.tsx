// The operational strip at the top of the device page (2026-11-20): where the
// device is on its journey, then four indicators — next maintenance, warranty
// in force, what is owed, open work. Served by GET /installed-devices/:id/overview;
// a block the user may not see is hidden.
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Award, CalendarClock, Check, ClipboardList, PackageCheck, Power, Truck, Wallet, Wrench,
  type LucideIcon,
} from '../../../components/ui/icons';
import type { DeviceOverview } from '../../../lib/api';
import { getOpenTaskDetailPath } from '../../../lib/taskRoutes';

const LOCALE = 'ar-SY-u-nu-latn';

function fmtDate(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(LOCALE, { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function syp(n: number) {
  return `${Math.round(n).toLocaleString('en-US')} ل.س`;
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return Math.round((new Date(date).getTime() - today) / 86_400_000);
}

// ── Journey ─────────────────────────────────────────────────────────────────
const STEPS: Array<{ key: string; label: string; icon: LucideIcon; dateField: string }> = [
  { key: 'pending_delivery', label: 'بانتظار التوصيل', icon: Truck, dateField: '' },
  { key: 'delivered', label: 'تم التوصيل', icon: PackageCheck, dateField: 'deliveryDate' },
  { key: 'installed', label: 'مركّب', icon: Wrench, dateField: 'installationDate' },
  { key: 'active', label: 'نشط', icon: Power, dateField: 'activatedAt' },
];

// States off the main path, shown as a flag on the journey.
const SIDE_STATES: Record<string, { label: string; tone: string }> = {
  delivery_suspended: { label: 'التسليم معلّق', tone: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  faulty: { label: 'الجهاز معطل', tone: 'bg-red-50 text-red-700 border-red-200' },
  in_workshop: { label: 'الجهاز في الورشة', tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  ready: { label: 'جاهز بعد الصيانة', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  out_of_service: { label: 'خارج الخدمة', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  retrieved: { label: 'مسحوب إلى الشركة', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  contract_cancelled: { label: 'عقده ملغى', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  registered: { label: 'مسجل ولم يبدأ مساره', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
};

function reachedStep(device: any): number {
  const byStatus: Record<string, number> = { pending_delivery: 0, delivery_suspended: 0, delivered: 1, installed: 2, active: 3 };
  if (device?.status in byStatus) return byStatus[device.status];
  // Off the main path: how far the dates say it went.
  if (device?.activatedAt) return 3;
  if (device?.installationDate) return 2;
  if (device?.deliveryDate) return 1;
  return 0;
}

function Journey({ device }: { device: any }) {
  const reached = reachedStep(device);
  const side = SIDE_STATES[device?.status];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <ol className="flex min-w-0 flex-1 items-center">
        {STEPS.map((step, i) => {
          const done = i < reached || (i === reached && !side && device?.status === 'active');
          const current = i === reached;
          const Icon = done ? Check : step.icon;
          // A step not reached in the current round may hold a date from an
          // earlier one (returned after a pickup): show dates only up to here.
          const date = step.dateField && i <= reached ? fmtDate(device?.[step.dateField]) : null;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1 text-center">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                  done ? 'border-emerald-500 bg-emerald-500 text-white'
                    : current ? (side ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-sky-500 bg-sky-50 text-sky-600')
                      : 'border-slate-200 bg-white text-slate-300'
                }`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className={`whitespace-nowrap text-[11px] font-bold ${done || current ? 'text-slate-700' : 'text-slate-400'}`}>{step.label}</span>
                <span className="h-3 text-[10px] text-slate-400">{date ?? ''}</span>
              </div>
              {i < STEPS.length - 1 && (
                <span className={`mx-1 mb-6 h-0.5 min-w-4 flex-1 ${i < reached ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              )}
            </li>
          );
        })}
      </ol>
      {side && (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${side.tone}`}>
          <AlertTriangle className="h-3.5 w-3.5" /> {side.label}
        </span>
      )}
    </div>
  );
}

// ── Indicators ──────────────────────────────────────────────────────────────
function Indicator({ icon: Icon, label, tone, children }: { icon: LucideIcon; label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-slate-500">{label}</div>
        {children}
      </div>
    </div>
  );
}

function Main({ children, tone = 'text-slate-800' }: { children: React.ReactNode; tone?: string }) {
  return <div className={`truncate text-sm font-black ${tone}`}>{children}</div>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mt-0.5 truncate text-[11px] text-slate-500">{children}</div>;
}

function MaintenanceIndicator({ m }: { m: NonNullable<DeviceOverview['maintenance']> }) {
  const next = m.next;
  const days = daysUntil(next?.dueDate ?? null);
  const last = fmtDate(m.lastDoneAt);
  return (
    <Indicator icon={CalendarClock} label="الصيانة الدورية القادمة" tone="bg-sky-100 text-sky-700">
      {next ? (
        <Link to={getOpenTaskDetailPath('periodic_maintenance', next.taskId) ?? '#'} className="hover:underline">
          <Main tone={days != null && days < 0 ? 'text-red-600' : 'text-slate-800'}>
            {fmtDate(next.dueDate) ?? 'بلا تاريخ'}
          </Main>
        </Link>
      ) : (
        <Main tone="text-slate-400">لا توجد صيانة مجدولة</Main>
      )}
      <Sub>
        {days != null && (days < 0 ? `متأخرة ${-days} يوماً` : days === 0 ? 'اليوم' : `بعد ${days} يوماً`)}
        {days != null && last ? ' · ' : ''}
        {last ? `آخر صيانة ${last}` : (!next ? 'لم تُسجَّل صيانة سابقة' : '')}
      </Sub>
    </Indicator>
  );
}

function WarrantyIndicator({ w }: { w: DeviceOverview['warranty'] }) {
  if (!w) {
    return (
      <Indicator icon={Award} label="الكفالة" tone="bg-slate-100 text-slate-500">
        <Main tone="text-slate-400">لا كفالة</Main>
      </Indicator>
    );
  }
  const label = w.type === 'golden' ? 'كفالة ذهبية' : 'كفالة العقد';
  const tone = w.type === 'golden' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
  if (w.status === 'pending') {
    return (
      <Indicator icon={Award} label={label} tone={tone}>
        <Main tone="text-slate-500">بانتظار التشغيل</Main>
        <Sub>تبدأ عند تشغيل الجهاز</Sub>
      </Indicator>
    );
  }
  const expired = w.daysLeft != null && w.daysLeft < 0;
  return (
    <Indicator icon={Award} label={label} tone={tone}>
      <Main tone={expired ? 'text-red-600' : w.daysLeft != null && w.daysLeft <= 30 ? 'text-amber-600' : 'text-slate-800'}>
        {w.daysLeft == null ? 'سارية' : expired ? 'منتهية' : `${w.daysLeft} يوماً متبقية`}
      </Main>
      <Sub>{w.endDate ? `${expired ? 'انتهت' : 'تنتهي'} ${fmtDate(w.endDate)}` : ''}</Sub>
    </Indicator>
  );
}

function BalanceIndicator({ b }: { b: NonNullable<DeviceOverview['balance']> }) {
  const remaining = b.contractRemaining + b.warrantyRemaining;
  const overdue = b.contractOverdue + b.warrantyOverdue;
  return (
    <Indicator icon={Wallet} label="المستحق على الجهاز" tone="bg-emerald-100 text-emerald-700">
      {remaining > 0 ? (
        <>
          <Main tone={overdue > 0 ? 'text-red-600' : 'text-slate-800'}>
            {overdue > 0 ? `${syp(overdue)} مستحقة` : 'لا مستحق حالياً'}
          </Main>
          <Sub>المتبقي الكلي {syp(remaining)}{b.payerName ? ` · على ${b.payerName}` : ''}</Sub>
        </>
      ) : (
        <Main tone="text-emerald-700">لا ذمم على الجهاز</Main>
      )}
    </Indicator>
  );
}

function OpenWorkIndicator({ o }: { o: NonNullable<DeviceOverview['openTasks']> }) {
  return (
    <Indicator icon={ClipboardList} label="العمل المفتوح" tone="bg-violet-100 text-violet-700">
      <Main tone={o.count > 0 ? 'text-slate-800' : 'text-slate-400'}>
        {o.count > 0 ? `${o.count} مهمة مفتوحة` : 'لا مهام مفتوحة'}
      </Main>
      <Sub>{o.nearestDueDate ? `أقرب استحقاق ${fmtDate(o.nearestDueDate)}` : ''}</Sub>
    </Indicator>
  );
}

export function DeviceOverviewStrip({ device, overview }: { device: any; overview: DeviceOverview | null }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <Journey device={device} />
      {overview && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
          {overview.maintenance && <MaintenanceIndicator m={overview.maintenance} />}
          <WarrantyIndicator w={overview.warranty} />
          {overview.balance && <BalanceIndicator b={overview.balance} />}
          {overview.openTasks && <OpenWorkIndicator o={overview.openTasks} />}
        </div>
      )}
    </section>
  );
}

export default DeviceOverviewStrip;
