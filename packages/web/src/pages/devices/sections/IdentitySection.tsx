import { useState, type ReactNode } from 'react';
import { AlertCircle, Pencil } from '../../../components/ui/icons';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';
import { SectionShell } from './SectionShell';

interface Props {
  device: any;
  /** installed_devices.edit_details (migration 499). */
  canEditDetails?: boolean;
  onChanged?: () => void;
}

function MissingValue({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex flex-col gap-0.5">
      <span className="text-sm text-amber-700 font-bold">غير مسجل</span>
      <span className="text-xs text-slate-400 font-medium leading-relaxed">{children}</span>
    </div>
  );
}

function Field({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400 font-bold">
        {label}
        {action}
      </div>
      <div className="text-sm text-slate-700 font-semibold break-words">{value}</div>
    </div>
  );
}

// Serial number edit: a new value and the reason, kept in the device change log.
function SerialEditModal({ device, onClose, onSaved }: { device: any; onClose: () => void; onSaved: () => void }) {
  const [serial, setSerial] = useState<string>(device?.serialNumber ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!serial.trim()) { setError('أدخل الرقم التسلسلي'); return; }
    if (!reason.trim()) { setError('سبب التعديل مطلوب'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.installedDevices.updateDetails(device.id, { serialNumber: serial.trim(), reason: reason.trim() });
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'تعذّر حفظ التعديل');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      title={<span className="flex items-center gap-2"><Pencil className="h-5 w-5 text-sky-600" />تعديل الرقم التسلسلي</span>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} loading={busy}>حفظ</Button>
        </>
      )}
    >
      <div className="space-y-4 px-5 py-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          الرقم الحالي:{' '}
          {device?.serialNumber
            ? <span className="font-mono font-bold text-slate-700" dir="ltr">{device.serialNumber}</span>
            : <span className="font-bold text-amber-700">غير مسجل</span>}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-500">الرقم التسلسلي الجديد *</span>
          <input
            value={serial}
            onChange={e => setSerial(e.target.value)}
            dir="ltr"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            autoFocus
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold text-slate-500">سبب التعديل *</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="مثلاً: تصحيح خطأ إدخال بعد مطابقة الملصق على الجهاز"
          />
        </label>
        <p className="text-xs text-slate-400">يُحفظ التعديل وسببه في سجل تغييرات الجهاز.</p>
      </div>
    </Modal>
  );
}

export function IdentitySection({ device, canEditDetails = false, onChanged }: Props) {
  const missing = device?.missingFields ?? {};
  const [editingSerial, setEditingSerial] = useState(false);

  return (
    <SectionShell id="identity" title="هوية الجهاز" subtitle="القيم الثابتة التي تعرّف هذه الوحدة">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <Field
          label="الموديل"
          value={device?.deviceModelName || <MissingValue>لم يصل اسم الموديل من العقد أو سجل الجهاز.</MissingValue>}
        />
        <Field
          label="الرقم التسلسلي"
          action={canEditDetails && (
            <button
              type="button"
              onClick={() => setEditingSerial(true)}
              title="تعديل الرقم التسلسلي"
              aria-label="تعديل الرقم التسلسلي"
              className="rounded p-0.5 text-slate-400 hover:bg-sky-50 hover:text-sky-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          value={
            device?.serialNumber
              ? <span className="font-mono" dir="ltr">{device.serialNumber}</span>
              : <MissingValue>{missing.serialNumber ? 'لم يتم إدخال الرقم التسلسلي عند إنشاء أو اعتماد العقد.' : 'لا يوجد رقم تسلسلي محفوظ.'}</MissingValue>
          }
        />
        <Field label="رقم الجهاز الداخلي" value={`#${device?.id ?? 'غير معروف'}`} />
        <Field
          label="الفرع"
          value={device?.branchName || <MissingValue>{missing.branchName ? 'الجهاز غير مرتبط بفرع واضح.' : 'اسم الفرع غير متاح.'}</MissingValue>}
        />
      </div>
      {editingSerial && (
        <SerialEditModal
          device={device}
          onClose={() => setEditingSerial(false)}
          onSaved={() => { setEditingSerial(false); onChanged?.(); }}
        />
      )}
    </SectionShell>
  );
}

export default IdentitySection;
