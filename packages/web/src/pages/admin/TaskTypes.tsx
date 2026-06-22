import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Settings2, Save, Loader2, Info, AlertTriangle,
  Clock, Calendar, CalendarClock, Zap, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import Select from '../../components/ui/Select';
import {
  TASK_SCHEDULING_PATTERN_LABELS,
  TASK_SCHEDULING_PATTERN_DESCRIPTIONS,
  TASK_WINDOW_BASIS_LABELS,
  TASK_LOCATION_BASIS_LABELS,
  TASK_LOCATION_BASIS_DESCRIPTIONS,
  type TaskTypeConfig,
  type TaskSchedulingPattern,
  type TaskLocationBasis,
} from '@golden-crm/shared';

const PATTERN_ICONS: Record<TaskSchedulingPattern, React.ReactNode> = {
  immediate:       <Zap className="w-4 h-4 text-red-500" />,
  short_window:    <Clock className="w-4 h-4 text-amber-500" />,
  long_window:     <CalendarClock className="w-4 h-4 text-indigo-500" />,
  expected_window: <Calendar className="w-4 h-4 text-emerald-500" />,
};

const PATTERN_COLORS: Record<TaskSchedulingPattern, string> = {
  immediate:       'bg-red-50 text-red-700 border-red-200',
  short_window:    'bg-amber-50 text-amber-700 border-amber-200',
  long_window:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  expected_window: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const FAMILY_LABELS: Record<string, string> = {
  marketing:   'تسويق',
  sales:       'مبيعات',
  delivery:    'توصيل وتركيب',
  maintenance: 'صيانة',
  emergency:   'طوارئ',
  collection:  'تحصيل',
  service:     'خدمة',
  warranty:    'كفالة',
};

type DraftState = {
  planningWindowDays: string;
  isActive: boolean;
  locationBasis: TaskLocationBasis;
};

export default function TaskTypes() {
  const { user, hasPermission } = useAuthStore();
  const canManage = user?.isSuperAdmin === true || hasPermission('admin.task_types.manage');

  const [configs, setConfigs] = useState<TaskTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await api.admin.taskTypes.list();
        setConfigs(data);
        const initialDrafts: Record<string, DraftState> = {};
        data.forEach(c => {
          initialDrafts[c.taskType] = {
            planningWindowDays: c.planningWindowDays != null ? String(c.planningWindowDays) : '',
            isActive: c.isActive,
            locationBasis: c.locationBasis ?? 'client',
          };
        });
        setDrafts(initialDrafts);
      } catch (err: any) {
        setError(err.message || 'تعذر تحميل إعدادات أنواع المهام');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const groupedByPattern = useMemo(() => {
    const groups: Record<TaskSchedulingPattern, TaskTypeConfig[]> = {
      immediate:       [],
      short_window:    [],
      long_window:     [],
      expected_window: [],
    };
    configs.forEach(c => groups[c.schedulingPattern].push(c));
    return groups;
  }, [configs]);

  const isDirty = (config: TaskTypeConfig) => {
    const draft = drafts[config.taskType];
    if (!draft) return false;
    const currentDays = config.planningWindowDays != null ? String(config.planningWindowDays) : '';
    return draft.planningWindowDays !== currentDays
      || draft.isActive !== config.isActive
      || draft.locationBasis !== (config.locationBasis ?? 'client');
  };

  const handleSave = async (config: TaskTypeConfig) => {
    const draft = drafts[config.taskType];
    if (!draft) return;

    setError(null);
    setSuccessMessage(null);
    setSavingType(config.taskType);
    try {
      const payload: { planningWindowDays?: number | null; isActive?: boolean; locationBasis?: TaskLocationBasis } = {};

      if (config.schedulingPattern !== 'immediate') {
        const days = Number(draft.planningWindowDays);
        if (!Number.isInteger(days) || days < 0 || days > 3650) {
          throw new Error('قيمة N يجب أن تكون عدداً صحيحاً بين 0 و 3650');
        }
        payload.planningWindowDays = days;
      }
      payload.isActive = draft.isActive;
      payload.locationBasis = draft.locationBasis;

      const updated = await api.admin.taskTypes.update(config.taskType, payload);
      setConfigs(prev => prev.map(c => (c.taskType === updated.taskType ? updated : c)));
      setSuccessMessage(`تم حفظ "${config.arabicLabel}"`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      setError(err.message || 'تعذر الحفظ');
    } finally {
      setSavingType(null);
    }
  };

  if (!user || (!user.isSuperAdmin && !hasPermission('admin.task_types.view'))) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-8 custom-scroll">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">إعدادات أنواع المهام</h1>
              <p className="text-slate-500 text-sm">
                تحكم في النوافذ الزمنية (N) وتفعيل/تعطيل كل نوع — حسب نمطه الزمني.
              </p>
            </div>
          </div>
        </div>

        {/* Info card */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6 flex gap-3">
          <Info className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-700 space-y-1">
            <p className="font-bold text-slate-900">ما معنى نافذة العمل (N)؟</p>
            <p>
              N = عدد الأيام قبل موعد المهمة التي تظهر فيها ضمن نطاق عمل الفريق اليومي.
              مثلاً: صيانة دورية موعدها بعد 6 شهور، N=30 تعني أنها تظهر قبل موعدها بـ30 يوم.
            </p>
            <p className="text-xs text-slate-500">
              المهام بنمط "فوري" لا تستخدم N — تظهر فور إنشائها دائماً.
            </p>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> {successMessage}
          </div>
        )}

        {/* Pattern sections */}
        {(Object.keys(groupedByPattern) as TaskSchedulingPattern[]).map(pattern => {
          const items = groupedByPattern[pattern];
          if (items.length === 0) return null;

          return (
            <div key={pattern} className="mb-8">
              {/* Pattern header */}
              <div className={`rounded-t-xl border-x border-t px-4 py-3 flex items-center gap-3 ${PATTERN_COLORS[pattern]}`}>
                {PATTERN_ICONS[pattern]}
                <div className="flex-1">
                  <div className="font-bold">{TASK_SCHEDULING_PATTERN_LABELS[pattern]}</div>
                  <div className="text-xs opacity-90">{TASK_SCHEDULING_PATTERN_DESCRIPTIONS[pattern]}</div>
                </div>
                <span className="text-xs font-bold bg-white/50 px-2 py-1 rounded-full">
                  {items.length} نوع
                </span>
              </div>

              {/* Items table */}
              <div className="bg-white rounded-b-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="text-right p-3 font-bold">نوع المهمة</th>
                      <th className="text-right p-3 font-bold">العائلة</th>
                      <th className="text-right p-3 font-bold">الفلتر على</th>
                      <th className="text-right p-3 font-bold w-40">موقع الزيارة</th>
                      <th className="text-center p-3 font-bold w-32">N (أيام)</th>
                      <th className="text-center p-3 font-bold w-24">مفعّل</th>
                      <th className="text-center p-3 font-bold w-24">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((config, idx) => {
                      const draft = drafts[config.taskType];
                      if (!draft) return null;
                      const dirty = isDirty(config);
                      const saving = savingType === config.taskType;
                      const isImmediate = config.schedulingPattern === 'immediate';

                      return (
                        <tr
                          key={config.taskType}
                          className={`border-b border-slate-100 last:border-b-0 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                        >
                          <td className="p-3">
                            <div className="font-bold text-slate-900">{config.arabicLabel}</div>
                            <div className="text-xs text-slate-400 font-mono">{config.taskType}</div>
                          </td>
                          <td className="p-3 text-slate-600">
                            {FAMILY_LABELS[config.taskFamily] || config.taskFamily}
                          </td>
                          <td className="p-3 text-slate-600 text-xs">
                            {TASK_WINDOW_BASIS_LABELS[config.windowBasis]}
                          </td>
                          {/* Location basis selector */}
                          <td className="p-3">
                            {canManage ? (
                              <Select<TaskLocationBasis>
                                value={draft.locationBasis}
                                onChange={v => setDrafts(prev => ({
                                  ...prev,
                                  [config.taskType]: { ...prev[config.taskType], locationBasis: v },
                                }))}
                                ariaLabel="أساس الموقع"
                                size="sm"
                                className="w-full"
                                options={(Object.keys(TASK_LOCATION_BASIS_LABELS) as TaskLocationBasis[]).map(b => ({
                                  value: b,
                                  label: TASK_LOCATION_BASIS_LABELS[b],
                                }))}
                              />
                            ) : (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                                config.locationBasis === 'contract'
                                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                                  : 'border-sky-200 bg-sky-50 text-sky-700'
                              }`}>
                                {TASK_LOCATION_BASIS_LABELS[config.locationBasis ?? 'client']}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {isImmediate ? (
                              <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
                                <XCircle className="w-3 h-3" /> لا ينطبق
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                max={3650}
                                disabled={!canManage || saving}
                                value={draft.planningWindowDays}
                                onChange={e =>
                                  setDrafts(prev => ({
                                    ...prev,
                                    [config.taskType]: { ...prev[config.taskType], planningWindowDays: e.target.value },
                                  }))
                                }
                                className="w-24 bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800 text-center focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none disabled:opacity-60"
                              />
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              disabled={!canManage || saving}
                              onClick={() =>
                                setDrafts(prev => ({
                                  ...prev,
                                  [config.taskType]: { ...prev[config.taskType], isActive: !prev[config.taskType].isActive },
                                }))
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold transition-all ${
                                draft.isActive
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                              } disabled:opacity-60 disabled:cursor-not-allowed`}
                            >
                              {draft.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {draft.isActive ? 'مفعّل' : 'معطّل'}
                            </button>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              disabled={!canManage || !dirty || saving}
                              onClick={() => handleSave(config)}
                              className="inline-flex items-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              حفظ
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 flex items-center gap-2">
            <Info className="w-4 h-4" /> أنت تعرض هذه الصفحة فقط — لا تملك صلاحية التعديل.
          </div>
        )}
      </div>
    </div>
  );
}
