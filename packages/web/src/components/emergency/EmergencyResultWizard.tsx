import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import TechStateForm from './result-phases/TechStateForm';
import MaintenanceActionsForm from './result-phases/MaintenanceActionsForm';
import CostsForm from './result-phases/CostsForm';
import EmergencyProblemsSection from './EmergencyProblemsSection';

// ── Phase config ──────────────────────────────────────────────────────────────

const PHASES = [
  { key: 'preState',  label: 'الحالة الفنية قبل الصيانة', step: 1 },
  { key: 'actions',   label: 'إجراء الصيانة',              step: 2 },
  { key: 'postState', label: 'الحالة الفنية بعد الصيانة',  step: 3 },
  { key: 'costs',     label: 'تكاليف الصيانة والقرار',     step: 4 },
] as const;

type PhaseKey = typeof PHASES[number]['key'];

// DEC-CT-17: colour the maintenance flow by the device's ACTIVE warranty —
// blue=contract, gold=golden. Informational only; never locks costs (DEC-CT-16 §3).
type WarrantyKind = 'contract' | 'golden';
const WARRANTY_THEME: Record<WarrantyKind, { banner: string; label: string }> = {
  contract: { banner: 'border-sky-300 bg-sky-50 text-sky-800',     label: 'كفالة عقد' },
  golden:   { banner: 'border-amber-300 bg-amber-50 text-amber-800', label: 'كفالة ذهبية' },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  taskId: number;
  contractId?: number | null;
  readOnly?: boolean;
  /** Visit-level technician (executing team). Overrides open_task.team_snapshot for problem auto-fill. */
  visitTechnicianEmployeeId?: number | null;
  visitTechnicianName?: string | null;
  /** Fires after the final phase (costs) saves successfully. */
  onCostsSaved?: () => void;
}

export default function EmergencyResultWizard({ taskId, contractId, readOnly = false, visitTechnicianEmployeeId = null, visitTechnicianName = null, onCostsSaved }: Props) {
  const [result, setResult]       = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [activePhase, setActive]  = useState<PhaseKey>('preState');
  const [activeWarranty, setActiveWarranty] = useState<{ type: WarrantyKind; endDate?: string | null } | null>(null);

  const load = () => {
    setLoading(true);
    api.emergencyResult.get(taskId)
      .then(r => {
        setResult(r);
        // Auto-advance to first incomplete phase
        const first = PHASES.find(p => !r.completedPhases[p.key]);
        if (first) setActive(first.key);
        else setActive('costs'); // all done, show costs

        // Resolve the device's active warranty to colour the flow (DEC-CT-17).
        const deviceId = r?.taskMeta?.installedDeviceId;
        if (deviceId) {
          api.deviceWarranties.list(Number(deviceId))
            .then((ws: any[]) => {
              const active = Array.isArray(ws) ? ws.find(w => w.status === 'active') : null;
              setActiveWarranty(active ? { type: active.warrantyType, endDate: active.endDate } : null);
            })
            .catch(() => setActiveWarranty(null));
        } else {
          setActiveWarranty(null);
        }
      })
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [taskId]);

  if (loading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
    </div>
  );

  const completed = result?.completedPhases ?? {};
  const phases    = result?.phases ?? {};

  const warrantyTheme = activeWarranty ? WARRANTY_THEME[activeWarranty.type] : null;

  return (
    <div className="space-y-5">
      {/* Active-warranty banner — colour-coded coverage (DEC-CT-17) */}
      {warrantyTheme && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm font-bold flex items-center justify-between ${warrantyTheme.banner}`}>
          <span>
            الجهاز ضمن {warrantyTheme.label}
            {activeWarranty?.endDate ? ` · حتى ${activeWarranty.endDate}` : ''}
          </span>
          <span className="text-xs font-normal">التكلفة معدومة افتراضيًا — يمكن إدخال قيمة عند الحاجة (لا إقفال)</span>
        </div>
      )}

      {/* Progress strip */}
      <div className="flex items-center gap-0">
        {PHASES.map((p, i) => {
          const done   = completed[p.key];
          const active = activePhase === p.key;
          return (
            <button key={p.key} type="button"
              onClick={() => setActive(p.key)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 px-2 border-b-2 transition-all text-center ${
                active ? 'border-rose-500 bg-rose-50/50'
                : done  ? 'border-emerald-400 bg-emerald-50/30 hover:bg-emerald-50'
                :         'border-slate-200 hover:bg-slate-50'
              }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border-2 transition-colors ${
                active ? 'bg-rose-600 text-white border-rose-600'
                : done  ? 'bg-emerald-500 text-white border-emerald-500'
                :         'bg-white text-slate-400 border-slate-200'
              }`}>
                {done && !active ? <CheckCircle2 className="h-4 w-4" /> : p.step}
              </div>
              <span className={`text-xs font-bold leading-tight ${
                active ? 'text-rose-700' : done ? 'text-emerald-700' : 'text-slate-400'
              }`}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Phase content */}
      {activePhase === 'preState' && (
        <TechStateForm
          phase="pre"
          taskId={taskId}
          initialData={phases.preState}
          readOnly={readOnly}
          onSaved={() => load()}
          onNext={() => setActive('actions')}
        />
      )}
      {activePhase === 'actions' && (
        <>
          {/* Phase 6c.1 — Problems list visible only for new-path tasks */}
          {result?.taskMeta?.sourceServiceRequestId && (
            <EmergencyProblemsSection
              taskId={taskId}
              serviceRequestId={result.taskMeta.sourceServiceRequestId}
              installedDeviceId={result.taskMeta.installedDeviceId ?? null}
              defaultTechnicianEmployeeId={visitTechnicianEmployeeId ?? result.taskMeta.technicianEmployeeId ?? null}
              defaultTechnicianName={visitTechnicianName ?? result.taskMeta.technicianName ?? null}
              problems={result.problems ?? []}
              derivedOutcome={result.derivedOutcome ?? null}
              readOnly={readOnly}
              onChanged={() => load()}
            />
          )}
          <MaintenanceActionsForm
            taskId={taskId}
            initialData={phases.actions}
            readOnly={readOnly}
            onSaved={() => load()}
            onNext={() => setActive('postState')}
            onBack={() => setActive('preState')}
          />
        </>
      )}
      {activePhase === 'postState' && (
        <TechStateForm
          phase="post"
          taskId={taskId}
          initialData={phases.postState}
          preData={phases.preState}
          readOnly={readOnly}
          onSaved={() => load()}
          onNext={() => setActive('costs')}
          onBack={() => setActive('actions')}
        />
      )}
      {activePhase === 'costs' && (
        <CostsForm
          taskId={taskId}
          initialData={phases.costs}
          readOnly={readOnly}
          onSaved={() => {
            load();
            if (onCostsSaved) onCostsSaved();
          }}
          onBack={() => setActive('postState')}
          // Phase 6c.2 — new-path props
          sourceServiceRequestId={result?.taskMeta?.sourceServiceRequestId ?? null}
          derivedOutcome={result?.derivedOutcome ?? null}
        />
      )}
    </div>
  );
}
