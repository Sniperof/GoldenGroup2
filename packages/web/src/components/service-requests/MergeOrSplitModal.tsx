// ============================================================
// MergeOrSplitModal — EM-UNIQ-02 dual-choice on promote collision
// Constitution: maintenance.md §EM-UNIQ-01..06
// ============================================================
import { useEffect, useState } from 'react';
import { X, GitMerge, Split, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';

interface Props {
  serviceRequestId: number;
  existingOpenTaskId: number;
  installedDeviceId: number;
  onClose: () => void;
  onResolved: () => void;
}

interface OverrideReason {
  id: number;
  value: string;
}

export default function MergeOrSplitModal({
  serviceRequestId,
  existingOpenTaskId,
  installedDeviceId,
  onClose,
  onResolved,
}: Props) {
  const [mode, setMode] = useState<'idle' | 'merging' | 'splitting'>('idle');
  const [mergeNote, setMergeNote] = useState('');
  const [splitReason, setSplitReason] = useState('');
  const [splitNote, setSplitNote] = useState('');
  const [reasons, setReasons] = useState<OverrideReason[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load override reasons from system_lists.
    fetch('/api/system-lists?category=emergency_uniqueness_override_reasons', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('hr_token') ?? ''}`,
      },
    })
      .then((r) => r.json())
      .then((rows) => setReasons(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  async function doMerge() {
    setMode('merging');
    setError(null);
    try {
      await api.serviceRequests.merge(serviceRequestId, existingOpenTaskId, mergeNote || null);
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل الدمج');
      setMode('idle');
    }
  }

  async function doSplit() {
    if (!splitReason) {
      setError('السبب إلزامي للـ split');
      return;
    }
    setMode('splitting');
    setError(null);
    try {
      const result = await api.serviceRequests.promote(serviceRequestId, {
        splitAuthorized: true,
        splitReason,
      });
      if ('collision' in result) {
        setError('حدث collision آخر — راجع البيانات');
        setMode('idle');
        return;
      }
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل الـ split');
      setMode('idle');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
        <header className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            الجهاز عليه مُهمة طارئة نشطة
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
            <p className="text-gray-700">
              الجهاز <strong>#{installedDeviceId}</strong> عليه مُهمة طارئة نشطة:
              <strong> open_task #{existingOpenTaskId}</strong>.
            </p>
            <p className="text-gray-600 mt-1 text-xs">
              يَجب اختيار أحد المسارَين قبل المتابعة (EM-UNIQ-02).
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 rounded">
              {error}
            </div>
          )}

          {/* Merge — default path */}
          <section className="border border-green-200 rounded-lg p-4 bg-green-50">
            <h3 className="font-medium text-gray-800 flex items-center gap-2 mb-2">
              <GitMerge className="h-4 w-4 text-green-700" />
              (أ) دمج مع المهمة القائمة <span className="text-xs text-green-700">(الافتراضي)</span>
            </h3>
            <p className="text-xs text-gray-600 mb-2">
              نفس العطل أو متعلَّق — الفني نفسه يُمكنه معالجته.
            </p>
            <textarea
              value={mergeNote}
              onChange={(e) => setMergeNote(e.target.value)}
              placeholder="ملاحظة (اختياري)"
              className="w-full text-sm border border-gray-300 rounded p-2 mb-2"
              rows={2}
            />
            <button
              disabled={mode !== 'idle'}
              onClick={doMerge}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
            >
              {mode === 'merging' ? 'جاري الدمج...' : 'دَمج'}
            </button>
          </section>

          {/* Split — exception */}
          <section className="border border-orange-200 rounded-lg p-4 bg-orange-50">
            <h3 className="font-medium text-gray-800 flex items-center gap-2 mb-2">
              <Split className="h-4 w-4 text-orange-700" />
              (ب) فتح طلب منفصل <span className="text-xs text-orange-700">(استثناء — يَلزم سبب)</span>
            </h3>
            <p className="text-xs text-gray-600 mb-2">
              عطل مختلف يَحتاج تخصُّصاً آخر أو فترة زمنية مختلفة (EM-UNIQ-04).
            </p>
            <select
              value={splitReason}
              onChange={(e) => setSplitReason(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded p-2 mb-2"
            >
              <option value="">— اختر السبب —</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.value}>
                  {r.value}
                </option>
              ))}
            </select>
            <textarea
              value={splitNote}
              onChange={(e) => setSplitNote(e.target.value)}
              placeholder="ملاحظة إضافية"
              className="w-full text-sm border border-gray-300 rounded p-2 mb-2"
              rows={2}
            />
            <button
              disabled={mode !== 'idle' || !splitReason}
              onClick={doSplit}
              className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
            >
              {mode === 'splitting' ? 'جاري الـ split...' : 'فَتح طلب منفصل'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
