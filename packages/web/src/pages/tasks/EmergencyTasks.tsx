import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Eye, Loader2 } from 'lucide-react';
import SmartTable from '../../components/SmartTable';
import ClientCardPopup from '../../components/ClientCardPopup';
import { useOpenTaskStore } from '../../hooks/useOpenTaskStore';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import type { OpenTask } from '@golden-crm/shared';
import Button from '../../components/ui/Button';

const EMERGENCY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'جديد', color: 'bg-blue-50 text-blue-700 border border-blue-200' },
  in_scheduling: { label: 'قيد الجدولة', color: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  scheduled: { label: 'تم تحديد موعد', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  needs_follow_up: { label: 'بحاجة متابعة', color: 'bg-amber-50 text-amber-700 border border-amber-200' },
  completed: { label: 'انتهت', color: 'bg-green-50 text-green-700 border border-green-200' },
  cancelled: { label: 'لم تتم', color: 'bg-rose-50 text-rose-700 border border-rose-200' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: 'حرج', color: 'bg-red-500 text-white' },
  medium: { label: 'عالي', color: 'bg-orange-500 text-white' },
  low: { label: 'عادي', color: 'bg-sky-100 text-sky-700' },
  Normal: { label: 'عادي', color: 'bg-sky-100 text-sky-700' },
};

function getStatusMeta(status: string) {
  return EMERGENCY_STATUS_CONFIG[status] || { label: status || '—', color: 'bg-slate-50 text-slate-600 border border-slate-200' };
}

function getPriorityMeta(priority: string | null) {
  if (!priority) return { label: 'عادي', color: 'bg-slate-100 text-slate-600' };
  return PRIORITY_CONFIG[priority] || { label: priority, color: 'bg-slate-100 text-slate-600' };
}

function getLocation(task: OpenTask): string {
  const addr = task.clientSnapshot?.address;
  if (!addr) return '—';
  const parts = [addr.subArea, addr.neighborhood].filter(Boolean);
  return parts.join(' > ') || '—';
}

function getPrimaryContact(task: OpenTask): string {
  const contacts = task.clientSnapshot?.contacts;
  if (!contacts || contacts.length === 0) return '—';
  const primary = contacts.find((c: any) => c.isPrimary);
  if (primary) return primary.number;
  return contacts[0]?.number || '—';
}

function truncate(str: string | null | undefined, maxLen: number): string {
  if (!str) return '—';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export default function EmergencyTasks() {
  const { tasks, loading, error, fetchTasks } = useOpenTaskStore();
  const { effectiveBranchId, needsBranchSelection } = useBranchListScope();
  const navigate = useNavigate();
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);

  useEffect(() => {
    if (needsBranchSelection) return;
    fetchTasks(effectiveBranchId ?? null, { taskType: 'emergency_maintenance' });
  }, [effectiveBranchId, needsBranchSelection, fetchTasks]);

  const emergencyTasks = useMemo(() => {
    return tasks.filter((t) => t.taskType === 'emergency_maintenance');
  }, [tasks]);

  const columns = useMemo(() => [
    {
      key: 'clientName',
      label: 'اسم الزبون',
      width: '180px',
      sortable: true,
      getValue: (t: OpenTask) => t.clientSnapshot?.name || '',
      render: (t: OpenTask) => (
        <button
          onClick={(e) => { e.stopPropagation(); setClientPopupId(t.clientId); }}
          className="font-bold text-slate-800 hover:text-sky-700 hover:underline transition-colors"
        >
          {t.clientSnapshot?.name || t.clientName || '—'}
        </button>
      ),
    },
    {
      key: 'mobile',
      label: 'رقم الهاتف',
      width: '130px',
      render: (t: OpenTask) => (
        <span className="font-mono text-sm text-slate-600" dir="ltr">
          {t.clientSnapshot?.mobile || '—'}
        </span>
      ),
    },
    {
      key: 'primaryContact',
      label: 'الرقم الرئيسي',
      width: '130px',
      render: (t: OpenTask) => (
        <span className="font-mono text-sm text-slate-600" dir="ltr">
          {getPrimaryContact(t)}
        </span>
      ),
    },
    {
      key: 'contractNumber',
      label: 'رقم العقد',
      width: '110px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600">
          {t.contractSnapshot?.contractNumber || '—'}
        </span>
      ),
    },
    {
      key: 'deviceModel',
      label: 'الجهاز',
      width: '180px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600">
          {t.contractSnapshot?.device?.modelName || '—'}
        </span>
      ),
    },
    {
      key: 'location',
      label: 'العنوان',
      width: '160px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600">{getLocation(t)}</span>
      ),
    },
    {
      key: 'problem',
      label: 'وصف المشكلة',
      width: '200px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600" title={t.notes || ''}>
          {truncate(t.notes, 45)}
        </span>
      ),
    },
    {
      key: 'supervisor',
      label: 'المشرف',
      width: '120px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600">
          {t.teamSnapshot?.supervisor?.name || '—'}
        </span>
      ),
    },
    {
      key: 'technician',
      label: 'الفني',
      width: '120px',
      render: (t: OpenTask) => (
        <span className="text-sm text-slate-600">
          {t.teamSnapshot?.technician?.name || '—'}
        </span>
      ),
    },
    {
      key: 'lastVisit',
      label: 'آخر زيارة',
      width: '110px',
      render: () => <span className="text-sm text-slate-400">—</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      width: '130px',
      sortable: true,
      render: (t: OpenTask) => {
        const cfg = getStatusMeta(t.status);
        return (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${cfg.color}`}>
            {cfg.label}
          </span>
        );
      },
    },
  ], []);

  const filters = useMemo(() => [
    {
      key: 'priority',
      label: 'الأولوية',
      options: [
        { value: '', label: 'الكل' },
        { value: 'high', label: 'حرج' },
        { value: 'medium', label: 'عالي' },
        { value: 'low', label: 'عادي' },
      ],
    },
    {
      key: 'status',
      label: 'الحالة',
      options: [
        { value: '', label: 'الكل' },
        { value: 'open', label: 'جديد' },
        { value: 'scheduled', label: 'تم تحديد موعد' },
        { value: 'needs_follow_up', label: 'بحاجة متابعة' },
        { value: 'completed', label: 'انتهت' },
        { value: 'cancelled', label: 'لم تتم' },
      ],
    },
  ], []);

  if (needsBranchSelection) {
    return (
      <div className="p-8 text-center text-slate-500">
        <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p className="text-lg">يرجى اختيار فرع لعرض طوارئ الصيانة</p>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          <span className="mr-3 text-slate-600">جارٍ التحميل...</span>
        </div>
      )}

      {!loading && (
        <SmartTable<OpenTask>
          title="طوارئ الصيانة"
          icon={ShieldAlert}
          data={emergencyTasks}
          columns={columns}
          filters={filters}
          searchKeys={['clientName', 'notes']}
          searchPlaceholder="بحث بالاسم أو الجهاز أو المشكلة..."
          getId={(t) => t.id}
          emptyIcon={ShieldAlert}
          emptyMessage="لا توجد طلبات طوارئ حالياً"
          tableMinWidth={1600}
          actions={(t) => (
            <Button
              variant="secondary"
              size="sm"
              icon={Eye}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/tasks/emergency/${t.id}`);
              }}
            >
              عرض التفاصيل
            </Button>
          )}
        />
      )}

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}
    </div>
  );
}
