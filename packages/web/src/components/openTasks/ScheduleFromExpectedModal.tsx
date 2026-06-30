// ============================================================
// ScheduleFromExpectedModal.tsx — DEC-004 D22 + DEC-006 D36
// ============================================================
// Books a field_visit from a needs_follow_up open_task using its captured
// expected_date / expected_time, without going through a fresh call. The
// backend rejects the request if status is not needs_follow_up or if
// expected_date is missing.
// ============================================================

import { useState } from 'react';
import { CalendarClock, Save } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import DateField from '../ui/DateField';

interface Props {
  taskId: number;
  expectedDate: string | null;
  expectedTime: string | null;
  open: boolean;
  onClose: () => void;
  onScheduled?: (fieldVisitId: number) => void;
}

export default function ScheduleFromExpectedModal({
  taskId, expectedDate, expectedTime, open, onClose, onScheduled,
}: Props) {
  const [teamKey, setTeamKey] = useState('');
  const [overrideDate, setOverrideDate] = useState(expectedDate ?? '');
  const [overrideTime, setOverrideTime] = useState(expectedTime ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!teamKey.trim()) {
      setError('teamKey مطلوب (مثل team_0 أو solo_0)');
      return;
    }
    setBusy(true);
    try {
      const res = await api.openTasks.scheduleFromExpected(taskId, {
        teamKey: teamKey.trim(),
        date: overrideDate.trim() || undefined,
        timeSlot: overrideTime.trim() || undefined,
        notes: notes.trim() || null,
      });
      onScheduled?.(res.fieldVisitId);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'فشل الجدولة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-indigo-700" />
          حجز زيارة من الموعد المتوقع
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy} icon={Save}>حجز</Button>
        </>
      }
    >
        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          <p className="text-xs text-slate-500">
            يُنشئ هذا المسار زيارة من المهمة دون مكالمة جديدة — العقد تم في المكالمة السابقة (DEC-004 D22).
            لا يُسمح إلا للمهام بحالة needs_follow_up وعليها expected_date.
          </p>

          <Input
            label="teamKey"
            value={teamKey}
            onChange={(e) => setTeamKey(e.target.value)}
            placeholder="team_0"
            inputSize="sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">التاريخ</label>
              <DateField
                value={overrideDate}
                onChange={setOverrideDate}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <Input
                label="الوقت"
                value={overrideTime}
                onChange={(e) => setOverrideTime(e.target.value)}
                placeholder="10:00-12:00"
                inputSize="sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات (اختيارية)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
    </Modal>
  );
}
