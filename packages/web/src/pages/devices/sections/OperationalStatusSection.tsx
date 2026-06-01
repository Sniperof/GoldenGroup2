// DEC-CT-03/04: device operational status + activation snapshot + action buttons
// to advance the lifecycle by scheduling delivery / installation / activation
// tasks. The buttons are intentionally surfaced here (next to the status badge)
// because the actions only make sense at certain status transitions.

import { useState } from 'react';
import { Loader2, Truck, Wrench, Zap } from 'lucide-react';
import { DeviceStatusBadge } from '../../../components/devices/DeviceStatusBadge';
import { SectionShell } from './SectionShell';
import { api } from '../../../lib/api';

interface Props {
  device: any;
  onTaskCreated?: () => void;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

const ALLOWED_NEXT_TASK: Record<string, { type: 'device_delivery' | 'device_installation' | 'device_activation'; label: string; Icon: any }> = {
  pending_delivery: { type: 'device_delivery',     label: 'جدولة مهمة تسليم',  Icon: Truck },
  delivered:        { type: 'device_installation', label: 'جدولة مهمة تركيب',  Icon: Wrench },
  installed:        { type: 'device_activation',   label: 'جدولة مهمة تشغيل',  Icon: Zap },
};

export function OperationalStatusSection({ device, onTaskCreated }: Props) {
  const [busy, setBusy] = useState(false);
  const next = ALLOWED_NEXT_TASK[device?.status];

  async function handleSchedule() {
    if (!next || !device?.id) return;
    setBusy(true);
    try {
      await api.openTasks.create({
        clientId:   device.customerId,
        branchId:   device.branchId,
        taskType:   next.type,
        taskFamily: 'delivery',
        reason:     'service_request',
        contractId: device.contractId,
        dueDate:    new Date().toISOString().split('T')[0],
      });
      onTaskCreated?.();
    } catch (err: any) {
      console.error('[OperationalStatusSection] schedule failed:', err);
      alert('فشل إنشاء المهمة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionShell
      id="operational"
      title="الحالة التشغيلية"
      subtitle="حالة الجهاز الحالية وتواريخ المراحل الميدانية"
      actions={
        next && (
          <button
            onClick={handleSchedule}
            disabled={busy}
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl px-3 py-2 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <next.Icon className="w-4 h-4" />}
            {next.label}
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">الحالة</div>
          <DeviceStatusBadge status={device?.status} />
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">تاريخ التسليم</div>
          <div className="text-sm font-semibold text-slate-700">{fmt(device?.deliveryDate)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">تاريخ التركيب</div>
          <div className="text-sm font-semibold text-slate-700">{fmt(device?.installationDate)}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-bold mb-1">تاريخ التشغيل (snapshot)</div>
          <div className="text-sm font-semibold text-slate-700">{fmt(device?.activatedAt)}</div>
        </div>
      </div>
    </SectionShell>
  );
}

export default OperationalStatusSection;
