import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import Button from '../ui/Button';
import DateField from '../ui/DateField';
import Modal from '../ui/Modal';
import Select from '../ui/Select';

function deviceName(interest: any): string {
  return interest?.snapshot?.name ?? interest?.snapshot?.label ?? `#${interest?.deviceModelId ?? '?'}`;
}

export function DeviceRequestDetailPanel({ request, onOpenTask }: { request: any; onOpenTask: (id: number) => void }) {
  const interests = Array.isArray(request.deviceInterests) ? request.deviceInterests : [];
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
        <h3 className="font-bold text-slate-800">تفاصيل طلب الجهاز</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold text-slate-500">غرض الطلب</div>
            <div className="mt-1 font-bold text-slate-800">{request.deviceRequestPurposeSnapshot?.label ?? 'غير محدد'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold text-slate-500">الملاحظات</div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{request.problemDescription || 'لا توجد'}</div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-500">الأجهزة التي اختارها مقدم الطلب</div>
          {interests.length === 0 ? (
            <div className="mt-2 text-sm text-slate-500">لم يحدد جهازاً.</div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {interests.map((interest: any, index: number) => (
                <span key={`${interest.deviceModelId}-${index}`} className={`rounded-full border px-3 py-1 text-sm ${interest.currentActive === false ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
                  {deviceName(interest)}{interest.currentActive === false ? ' — غير نشط حالياً' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
      {request.activeDeviceDemo && !request.linkedOpenTaskId && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <div className="font-bold">توجد مهمة عرض جهاز نشطة للمستفيد</div>
          <p className="mt-1 text-sm">لن يتم إلحاق الطلب بها. راجعها قبل اختيار الحل عند الاستلام.</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => onOpenTask(Number(request.activeDeviceDemo.id))}>
            فتح المهمة #{request.activeDeviceDemo.id}
          </Button>
        </section>
      )}
    </div>
  );
}

export function DeviceRequestHandoffModal({ request, onClose, onCompleted }: {
  request: any;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const requestedIds = useMemo(() => (Array.isArray(request.deviceInterests) ? request.deviceInterests : [])
    .map((interest: any) => Number(interest.deviceModelId)).filter((id: number) => Number.isInteger(id) && id > 0), [request.deviceInterests]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>(requestedIds);
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [operatorNote, setOperatorNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.employees.list(request.branchId), api.deviceModels.list()])
      .then(([employeeRows, modelRows]) => {
        setEmployees((employeeRows ?? []).filter((employee: any) => employee.status === 'active'));
        setModels(modelRows ?? []);
      })
      .catch((cause) => setError(cause?.message ?? 'تعذر تحميل خيارات المهمة'));
  }, [request.branchId]);

  async function submit(inactiveModelsConfirmed = false) {
    if (!employeeId || selectedIds.length === 0) {
      setError('اختر الموظف وجهازاً واحداً على الأقل.');
      return;
    }
    if (requestedIds.length > 0 && !selectedIds.some((id) => requestedIds.includes(id))) {
      setError('يجب أن تتضمن المهمة جهازاً واحداً على الأقل مما اختاره مقدم الطلب.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.serviceRequests.handoffDeviceRequest(Number(request.id), {
        employeeId: Number(employeeId), deviceModelIds: selectedIds,
        inactiveModelsConfirmed, priority, dueDate: dueDate || null, operatorNote: operatorNote.trim() || null,
      });
      onCompleted();
    } catch (cause: any) {
      if (cause?.code === 'inactive_device_models_confirmation_required' && window.confirm('بعض الأجهزة غير نشطة حالياً. هل تريد المتابعة بعد المراجعة؟')) {
        setBusy(false);
        return submit(true);
      }
      setError(cause?.message ?? 'تعذر إنشاء المهمة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="إنشاء مهمة عرض جهاز" size="lg" footer={<>
      <Button variant="secondary" onClick={onClose} disabled={busy}>إلغاء</Button>
      <Button onClick={() => submit(false)} disabled={busy}>إنشاء المهمة</Button>
    </>}>
      <div className="space-y-4 p-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <Select value={employeeId} onChange={setEmployeeId} placeholder="اختر الموظف" ariaLabel="الموظف" options={employees.map((employee) => ({ value: String(employee.id), label: employee.name ?? `#${employee.id}` }))} />
        <div>
          <div className="mb-2 text-sm font-bold text-slate-700">أجهزة المهمة</div>
          <div className="grid max-h-56 gap-2 overflow-auto rounded-xl border border-slate-200 p-2 md:grid-cols-2">
            {models.map((model) => {
              const id = Number(model.id);
              const checked = selectedIds.includes(id);
              return <label key={id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={checked} onChange={() => setSelectedIds((current) => checked ? current.filter((value) => value !== id) : [...current, id])} />
                <span>{model.nameAr ?? model.name_ar ?? model.name ?? `#${id}`}{requestedIds.includes(id) ? ' — مختار في الطلب' : ''}</span>
              </label>;
            })}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Select value={priority} onChange={setPriority} ariaLabel="الأولوية" options={[
            { value: 'high', label: 'عالية' }, { value: 'medium', label: 'متوسطة' }, { value: 'low', label: 'منخفضة' },
          ]} />
          <DateField value={dueDate} onChange={setDueDate} />
        </div>
        <textarea value={operatorNote} onChange={(event) => setOperatorNote(event.target.value)} rows={3} placeholder="ملاحظة الموظف (اختياري)" className="w-full rounded-xl border border-slate-300 p-2 text-sm" />
      </div>
    </Modal>
  );
}
