// ============================================================
// TechnicalHealthSection — device-keyed technical health record.
// Source: device_technical_states WHERE installed_device_id = X
//         (GET /installed-devices/:id/technical-states), constitution 01i.
//
// In-page: a COMPACT summary only (current health + a slim reading list) to
// keep the device page short. Full values and the per-field trend analysis open
// in a dialog over the page.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Activity, Loader2, LineChart, ListOrdered, ChevronLeft } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';

type FieldKind = 'num' | 'enum' | 'bool';
interface FieldDef { key: string; label: string; kind: FieldKind; unit?: string }
interface FieldSection { title: string; fields: FieldDef[] }

// Mirror the maintenance-result form's headings (TechStateForm) so the health
// record reads in the same structure the technician records it.
const SECTIONS: FieldSection[] = [
  {
    title: 'مصدر المياه',
    fields: [
      { key: 'waterSourceType',      label: 'نوع مصدر المياه', kind: 'enum' },
      { key: 'waterSourceTds',       label: 'عيار مصدر المياه', kind: 'num', unit: 'ppm' },
      { key: 'waterPressure',        label: 'ضغط المصدر', kind: 'enum' },
      { key: 'hasPressureRegulator', label: 'وجود كاسر', kind: 'bool' },
    ],
  },
  {
    title: 'قراءات الجهاز',
    fields: [
      { key: 'tapTdsBefore',       label: 'عيار حنفية الجهاز', kind: 'num', unit: 'ppm' },
      { key: 'pumpPressure',       label: 'ضغط المضخة', kind: 'num', unit: 'bar' },
      { key: 'membraneOutputTds',  label: 'خرج الميمبرين', kind: 'num', unit: 'ppm' },
      { key: 'membraneInputTds',   label: 'دخل الميمبرين', kind: 'num', unit: 'ppm' },
      { key: 'membraneFlow',       label: 'تدفق الميمبرين', kind: 'enum' },
      { key: 'flowCupSize',        label: 'فلو الكب', kind: 'enum' },
      { key: 'highPressureTds',    label: 'عيار الهاي برشر', kind: 'num', unit: 'ppm' },
      { key: 'tankTds',            label: 'عيار الخزان', kind: 'num', unit: 'ppm' },
      { key: 'membraneEfficiency', label: 'كفاءة الميمبرين', kind: 'num', unit: '%' },
    ],
  },
  {
    title: 'التعقيم',
    fields: [
      { key: 'sterilizationTransformer', label: 'ترانس التعقيم', kind: 'enum' },
      { key: 'uvLamp',                   label: 'لمبة التعقيم', kind: 'enum' },
      { key: 'sterilizationSleeve',      label: 'سليفة التعقيم', kind: 'enum' },
    ],
  },
  {
    title: 'الضاغطات والتوصيلات',
    fields: [
      { key: 'lowPressureSwitch', label: 'لو برشر', kind: 'enum' },
      { key: 'valveType',         label: 'نوع القسام', kind: 'enum' },
      { key: 'pumpTransformer',   label: 'ترانس مضخة', kind: 'enum' },
      { key: 'hasFifthTap',       label: 'صباب خامسة', kind: 'enum' },
      { key: 'deviceConnection',  label: 'توصيلة الجهاز', kind: 'enum' },
    ],
  },
];

const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap(s => s.fields);

const PHASE_META: Record<string, { label: string; cls: string }> = {
  pre:        { label: 'قبل العمل', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  post:       { label: 'بعد العمل', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  diagnostic: { label: 'تشخيصي', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  baseline:   { label: 'مرجعي', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const TASK_TYPE_LABELS: Record<string, string> = {
  emergency_maintenance: 'صيانة طارئة',
  periodic_maintenance: 'صيانة دورية',
  device_check: 'تشييك الجهاز',
  workshop_maintenance: 'صيانة داخلية',
  device_delivery: 'تركيب',
  device_activation: 'تشغيل',
  activation: 'تشغيل',
  device_demo: 'عرض جهاز',
};

function formatDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return '—'; }
}
function formatDay(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY', { dateStyle: 'short' }); }
  catch { return '—'; }
}

function renderValue(field: FieldDef, raw: any) {
  if (raw == null || raw === '') return null;
  if (field.kind === 'bool') return raw === true ? 'نعم' : raw === false ? 'لا' : String(raw);
  if (field.kind === 'num') return `${raw}${field.unit ? ' ' + field.unit : ''}`;
  return String(raw);
}

function taskLabel(r: any) {
  // Prefer the stored snapshot — the historical truth of the source task at
  // capture time — over the live task type (constitution 01i §4).
  const t = r.taskTypeSnapshot ?? r.taskType;
  return t ? (TASK_TYPE_LABELS[t] ?? t) : null;
}

function PhaseBadge({ phase }: { phase: string }) {
  const meta = PHASE_META[phase] ?? { label: phase, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return <span className={`text-xs font-bold rounded-full border px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>;
}

// Minimal inline sparkline for a numeric series (oldest→newest left→right).
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 240, h = 48, pad = 4;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible" style={{ direction: 'ltr' }}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-sky-500" />
      {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} className="fill-sky-500" />)}
    </svg>
  );
}

/* ── Full reading card (used inside the dialog) — grouped by form headings ── */
function ReadingCard({ r }: { r: any }) {
  const groups = SECTIONS
    .map(s => ({ title: s.title, measured: s.fields.map(f => ({ f, v: renderValue(f, r[f.key]) })).filter(x => x.v != null) }))
    .filter(g => g.measured.length > 0);
  return (
    <div className="rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PhaseBadge phase={r.phase} />
          {taskLabel(r) && (
            <span className="text-xs font-bold rounded-full border border-sky-200 bg-sky-50 text-sky-700 px-2 py-0.5">{taskLabel(r)}</span>
          )}
          <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
        </div>
        {r.recordedByName && <span className="text-xs text-slate-400">سجّلها: {r.recordedByName}</span>}
      </div>
      {groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.title}>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{g.title}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {g.measured.map(({ f, v }) => (
                  <div key={f.key} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-400 font-bold">{f.label}</div>
                    <div className="text-sm font-bold text-slate-700">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-slate-400">لا قياسات في هذه القراءة</p>}
      {r.additionalNotes && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">ملاحظات إضافية</p>
          <p className="text-xs text-slate-600">{r.additionalNotes}</p>
        </div>
      )}
    </div>
  );
}

/* ── Per-field trend view (used inside the dialog) ── */
function PerFieldView({ ascending }: { ascending: any[] }) {
  const [selectedField, setSelectedField] = useState('membraneEfficiency');
  const field = ALL_FIELDS.find(f => f.key === selectedField) ?? ALL_FIELDS[0];
  const series = useMemo(() => ascending
    .map(r => ({ value: r[field.key], createdAt: r.createdAt, phase: r.phase, taskType: r.taskTypeSnapshot ?? r.taskType }))
    .filter(p => p.value != null && p.value !== ''), [ascending, field.key]);
  const numericPoints = field.kind === 'num' ? series.map(p => Number(p.value)) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-bold text-slate-600">الحقل:</label>
        <select value={selectedField} onChange={(e) => setSelectedField(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-sky-400">
          {SECTIONS.map(s => (
            <optgroup key={s.title} label={s.title}>
              {s.fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-xs text-slate-400">({series.length} قيمة)</span>
      </div>
      {series.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">لا قيم مُسجَّلة لهذا الحقل</p>
      ) : (
        <>
          {field.kind === 'num' && numericPoints.length >= 2 && (
            <div className="rounded-2xl border border-slate-100 p-4 flex items-center gap-4 flex-wrap text-slate-700">
              <Sparkline points={numericPoints} />
              <div className="text-xs space-y-0.5">
                <div>الأدنى: <span className="font-bold">{Math.min(...numericPoints)}{field.unit ? ' ' + field.unit : ''}</span></div>
                <div>الأعلى: <span className="font-bold">{Math.max(...numericPoints)}{field.unit ? ' ' + field.unit : ''}</span></div>
                <div>الأخير: <span className="font-bold">{numericPoints[numericPoints.length - 1]}{field.unit ? ' ' + field.unit : ''}</span></div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold text-slate-500 border-b border-slate-200">
                  <th className="text-right py-2 px-2">التاريخ</th>
                  <th className="text-right py-2 px-2">القيمة</th>
                  <th className="text-right py-2 px-2">الدور</th>
                  <th className="text-right py-2 px-2">المهمة</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="py-2 px-2 text-xs text-slate-500">{formatDate(p.createdAt)}</td>
                    <td className="py-2 px-2 font-bold text-slate-800">{renderValue(field, p.value)}</td>
                    <td className="py-2 px-2"><PhaseBadge phase={p.phase} /></td>
                    <td className="py-2 px-2 text-xs text-slate-600">{p.taskType ? (TASK_TYPE_LABELS[p.taskType] ?? p.taskType) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Dialog over the page ── */
function HealthDialog({ rows, ascending, initialReading, onClose }: { rows: any[]; ascending: any[]; initialReading: any | null; onClose: () => void }) {
  const [tab, setTab] = useState<'readings' | 'field'>(initialReading ? 'readings' : 'field');
  const [openReading, setOpenReading] = useState<any | null>(initialReading);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="4xl"
      title={<span className="flex items-center gap-2"><Activity className="w-5 h-5 text-sky-500" />الصحة الفنية للجهاز <span className="text-xs font-bold text-slate-400">({rows.length} قراءة)</span></span>}
    >
        <div className="px-5 pt-4 sticky top-0 z-10 bg-white">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
            <button onClick={() => { setTab('readings'); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'readings' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'}`}>
              <ListOrdered className="w-3.5 h-3.5" /> القراءات
            </button>
            <button onClick={() => { setTab('field'); setOpenReading(null); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'field' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'}`}>
              <LineChart className="w-3.5 h-3.5" /> حسب الحقل
            </button>
          </div>
        </div>

        <div className="p-5">
          {tab === 'field' ? (
            <PerFieldView ascending={ascending} />
          ) : openReading ? (
            <div className="space-y-3">
              <button onClick={() => setOpenReading(null)} className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:underline">
                <ChevronLeft className="w-3.5 h-3.5" /> كل القراءات
              </button>
              <ReadingCard r={openReading} />
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <button key={r.id} onClick={() => setOpenReading(r)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-100 hover:border-sky-200 hover:bg-sky-50/40 px-4 py-3 text-right transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <PhaseBadge phase={r.phase} />
                    {taskLabel(r) && <span className="text-xs font-bold rounded-full border border-sky-200 bg-sky-50 text-sky-700 px-2 py-0.5">{taskLabel(r)}</span>}
                    <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                  </div>
                  {r.membraneEfficiency != null && <span className="text-xs font-bold text-slate-700">كفاءة {r.membraneEfficiency}%</span>}
                </button>
              ))}
            </div>
          )}
        </div>
    </Modal>
  );
}

export function TechnicalHealthSection({ deviceId }: { deviceId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; reading: any | null }>({ open: false, reading: null });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.installedDevices
      .technicalStates(deviceId)
      .then((data) => { if (!cancelled) setRows(data ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deviceId]);

  const ascending = useMemo(() => [...rows].reverse(), [rows]);
  const latest = rows[0] ?? null; // newest first from the API

  return (
    <section id="technical-health" className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <header className="flex items-center justify-between gap-3 p-5 border-b border-slate-100 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-sky-500" />
          <h2 className="text-lg font-bold text-slate-800">الصحة الفنية للجهاز</h2>
          <span className="text-xs font-bold text-slate-400">({rows.length} قراءة)</span>
        </div>
        {rows.length > 0 && (
          <button onClick={() => setDialog({ open: true, reading: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors">
            عرض السجل الكامل
          </button>
        )}
      </header>

      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400">
            <Activity className="w-8 h-8 mb-2" />
            <p className="text-sm">لا قراءات فنية مُسجَّلة على هذا الجهاز</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current health summary */}
            <div className="flex items-center gap-4 flex-wrap">
              {latest?.membraneEfficiency != null && (
                <div className="rounded-2xl border border-slate-100 px-4 py-3">
                  <div className="text-xs text-slate-400 font-bold mb-0.5">كفاءة الميمبرين الحالية</div>
                  <div className="text-2xl font-black text-sky-600 leading-none">{latest.membraneEfficiency}<span className="text-sm">%</span></div>
                </div>
              )}
              <div className="text-xs text-slate-500 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">آخر قراءة:</span>
                  <PhaseBadge phase={latest.phase} />
                  {taskLabel(latest) && <span className="text-slate-600 font-bold">{taskLabel(latest)}</span>}
                </div>
                <div><span className="text-slate-400">بتاريخ:</span> {formatDate(latest.createdAt)}{latest.recordedByName ? ` · ${latest.recordedByName}` : ''}</div>
              </div>
            </div>

            {/* Slim recent-readings list (max 3) */}
            <div className="space-y-1.5">
              {rows.slice(0, 3).map((r) => (
                <button key={r.id} onClick={() => setDialog({ open: true, reading: r })}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-100 hover:border-sky-200 hover:bg-sky-50/40 px-4 py-2.5 text-right transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <PhaseBadge phase={r.phase} />
                    {taskLabel(r) && <span className="text-xs text-slate-600">{taskLabel(r)}</span>}
                    <span className="text-xs text-slate-400">{formatDay(r.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.membraneEfficiency != null && <span className="text-xs font-bold text-slate-700">كفاءة {r.membraneEfficiency}%</span>}
                    <span className="text-xs text-sky-600 font-bold">تفاصيل</span>
                  </div>
                </button>
              ))}
              {rows.length > 3 && (
                <button onClick={() => setDialog({ open: true, reading: null })}
                  className="w-full text-center text-xs font-bold text-sky-600 hover:underline py-1.5">
                  + {rows.length - 3} قراءة أخرى — عرض السجل الكامل
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {dialog.open && (
        <HealthDialog rows={rows} ascending={ascending} initialReading={dialog.reading} onClose={() => setDialog({ open: false, reading: null })} />
      )}
    </section>
  );
}
