// Installed parts (accessories + maintenance parts).
//
// Two data sources coexist today:
//   1. contract.lineItems       — the commercial line items (with is_installed toggle).
//   2. /api/device-parts        — the historical record of parts mounted on the device.
//
// This section surfaces (1) for installation actions (we keep the toggle UX
// from the legacy ContractsTab), and uses (2) for a separate "تاريخ القطع" sub-list.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PartCard } from '../../../components/devices/PartCard';
import { SectionShell } from './SectionShell';
import { api } from '../../../lib/api';
import Button from '../../../components/ui/Button';

interface Props {
  contract: any | null;
  deviceParts: any[];
  onChanged?: () => void;
}

export function InstalledPartsSection({ contract, deviceParts, onChanged }: Props) {
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const lineItems = (contract?.lineItems ?? []).filter((li: any) => li.itemType !== 'device');
  const installed = lineItems.filter((li: any) => !!li.isInstalled);
  const pending   = lineItems.filter((li: any) => !li.isInstalled);

  async function handleToggle(itemId: number, currentInstalled: boolean) {
    if (!contract?.id) return;
    setUpdatingId(itemId);
    try {
      await api.contracts.toggleLineItemInstallation(contract.id, itemId, !currentInstalled);
      onChanged?.();
    } catch (err) {
      console.error('[InstalledPartsSection] toggle failed:', err);
      alert('فشل تحديث حالة التركيب.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <SectionShell
      id="parts"
      title="القطع والملحقات"
      subtitle="حالة تركيب الملحقات العقدية + سجل القطع الفنية على الجهاز"
    >
      {/* Commercial parts (from contract.lineItems) */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-black text-slate-500 mb-2">بانتظار التركيب ({pending.length})</h4>
          {pending.length === 0 ? (
            <p className="text-xs text-slate-400 italic">لا قطع بانتظار التركيب.</p>
          ) : (
            <div className="space-y-2">
              {pending.map((it: any) => (
                <div key={it.id} className="flex items-center gap-2">
                  <PartCard item={it} contract={contract} installed={false} />
                  <Button
                    size="sm"
                    onClick={() => handleToggle(it.id, false)}
                    loading={updatingId === it.id}
                  >
                    ✓ تم التركيب
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-black text-slate-500 mb-2">مركّبة ({installed.length})</h4>
          {installed.length === 0 ? (
            <p className="text-xs text-slate-400 italic">لا قطع مركّبة بعد.</p>
          ) : (
            <div className="space-y-2">
              {installed.map((it: any) => (
                <div key={it.id} className="flex items-center gap-2">
                  <PartCard item={it} contract={contract} installed={true} />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleToggle(it.id, true)}
                    disabled={updatingId === it.id}
                  >
                    تراجع
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historical device-parts log (separate concern: emergency / replacement events) */}
        {deviceParts?.length > 0 && (
          <div className="pt-4 mt-4 border-t border-slate-100">
            <h4 className="text-xs font-black text-slate-500 mb-2">سجل القطع الفنية ({deviceParts.length})</h4>
            <ul className="space-y-1.5 text-xs text-slate-600">
              {deviceParts.map(p => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{p.partNameSnapshot || `#${p.sparePartId}`}</span>
                  <span className="text-slate-400">•</span>
                  <span>{p.maintenanceType || '—'}</span>
                  <span className="text-slate-400">•</span>
                  <span>{p.eventType}</span>
                  <span className="text-slate-400">•</span>
                  <span>{p.eventDate ? new Date(p.eventDate).toLocaleDateString('ar-SY') : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

export default InstalledPartsSection;
