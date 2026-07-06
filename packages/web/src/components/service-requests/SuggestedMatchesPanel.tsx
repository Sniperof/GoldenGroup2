// ============================================================
// SuggestedMatchesPanel - fuzzy suggestions + required comparison
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, Search, User, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface SuggestedMatch {
  source: 'client' | 'candidate';
  id: number;
  clientType?: 'Client' | 'Candidate';
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  phone: string | null;
  secondaryPhones?: string[];
  score: number;
  confidence: 'high' | 'medium' | 'low';
  branchId: number | null;
  governorateId?: number | null;
  regionId?: number | null;
  subdistrictId?: number | null;
  neighborhoodId?: number | null;
  detailedAddress?: string | null;
}

type ComparisonStatus = 'match' | 'close' | 'partial' | 'mismatch' | 'missing';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (/^009639\d{8}$/.test(digits)) return `0${digits.slice(-9)}`;
  if (/^9639\d{8}$/.test(digits)) return `0${digits.slice(-9)}`;
  if (/^9\d{8}$/.test(digits)) return `0${digits}`;
  return digits;
}

function normalizeArabic(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

function numberValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function confidenceBadge(c: 'high' | 'medium' | 'low') {
  const m = {
    high: 'bg-green-100 text-green-700 border-green-300',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    low: 'bg-slate-100 text-slate-600 border-slate-300',
  };
  const l = { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${m[c]}`}>
      {l[c]}
    </span>
  );
}

function statusBadge(status: ComparisonStatus) {
  const m: Record<ComparisonStatus, string> = {
    match: 'bg-green-50 text-green-700 border-green-200',
    close: 'bg-sky-50 text-sky-700 border-sky-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    mismatch: 'bg-red-50 text-red-700 border-red-200',
    missing: 'bg-slate-50 text-slate-500 border-slate-200',
  };
  const l: Record<ComparisonStatus, string> = {
    match: 'مطابقة',
    close: 'تقارب',
    partial: 'جزئي',
    mismatch: 'اختلاف',
    missing: 'غير كاف',
  };
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${m[status]}`}>{l[status]}</span>;
}

function getRequestSnapshot(request: any) {
  const external = asRecord(request?.beneficiaryExternal ?? request?.requesterExternal);
  const submitted = asRecord(asRecord(request?.submittedPayload).data);
  const address = asRecord(request?.serviceAddress);
  const compatible = asRecord(external.clientCompatible);

  return {
    firstName: readText(external.firstName) || readText(submitted.firstName) || readText(compatible.firstName),
    lastName: readText(external.lastName) || readText(submitted.lastName) || readText(compatible.lastName),
    primaryMobile: readText(external.primary_phone) || readText(submitted.phoneNumber) || readText(compatible.mobile),
    secondaryMobile: readText(external.secondary_phone) || readText(submitted.secondaryPhone),
    governorateId: numberValue(address.governorateId ?? submitted.governorateId ?? compatible.governorate),
    regionId: numberValue(address.regionId ?? submitted.regionId ?? compatible.district),
    subdistrictId: numberValue(address.subdistrictId ?? submitted.subdistrictId),
    neighborhoodId: numberValue(address.neighborhoodId ?? submitted.neighborhoodId ?? compatible.neighborhood),
    detailedAddress: readText(address.detailedAddress)
      || readText(address.detailed_address)
      || readText(submitted.detailedAddress)
      || readText(compatible.detailedAddress),
  };
}

function exactStatus(a: unknown, b: unknown): ComparisonStatus {
  if (a == null || a === '' || b == null || b === '') return 'missing';
  return String(a) === String(b) ? 'match' : 'mismatch';
}

function phoneStatus(a: unknown, b: unknown): ComparisonStatus {
  const aa = normalizePhone(a);
  const bb = normalizePhone(b);
  if (!aa || !bb) return 'missing';
  return aa === bb ? 'match' : 'mismatch';
}

function secondaryPhoneStatus(requestPhone: unknown, recordPhones: string[] | undefined): ComparisonStatus {
  const requestNormalized = normalizePhone(requestPhone);
  if (!requestNormalized || !recordPhones || recordPhones.length === 0) return 'missing';
  return recordPhones.some((phone) => normalizePhone(phone) === requestNormalized) ? 'match' : 'mismatch';
}

function fuzzyNameStatus(a: unknown, b: unknown): ComparisonStatus {
  const aa = normalizeArabic(a);
  const bb = normalizeArabic(b);
  if (!aa || !bb) return 'missing';
  if (aa === bb) return 'match';
  if (aa.includes(bb) || bb.includes(aa)) return 'close';
  if (aa[0] && aa[0] === bb[0]) return 'partial';
  return 'mismatch';
}

function addressStatus(a: unknown, b: unknown): ComparisonStatus {
  const aa = normalizeArabic(a);
  const bb = normalizeArabic(b);
  if (!aa || !bb) return 'missing';
  if (aa === bb) return 'match';
  const aWords = new Set(aa.split(' ').filter((word) => word.length > 2));
  const bWords = bb.split(' ').filter((word) => word.length > 2);
  if (aWords.size === 0 || bWords.length === 0) return 'missing';
  const hits = bWords.filter((word) => aWords.has(word)).length;
  return hits > 0 ? 'partial' : 'mismatch';
}

function comparisonRows(request: any, match: SuggestedMatch) {
  const snap = getRequestSnapshot(request);
  return [
    {
      label: 'رقم الموبايل الرئيسي',
      requestValue: snap.primaryMobile,
      recordValue: match.phone,
      status: phoneStatus(snap.primaryMobile, match.phone),
    },
    {
      label: 'رقم الموبايل الثانوي',
      requestValue: snap.secondaryMobile,
      recordValue: match.secondaryPhones?.join(' / ') || '',
      status: secondaryPhoneStatus(snap.secondaryMobile, match.secondaryPhones),
    },
    {
      label: 'الاسم الأول',
      requestValue: snap.firstName,
      recordValue: match.firstName,
      status: fuzzyNameStatus(snap.firstName, match.firstName),
    },
    {
      label: 'الكنية',
      requestValue: snap.lastName,
      recordValue: match.lastName,
      status: fuzzyNameStatus(snap.lastName, match.lastName),
    },
    {
      label: 'المحافظة',
      requestValue: snap.governorateId,
      recordValue: match.governorateId,
      status: exactStatus(snap.governorateId, match.governorateId),
    },
    {
      label: 'المنطقة',
      requestValue: snap.regionId,
      recordValue: match.regionId,
      status: exactStatus(snap.regionId, match.regionId),
    },
    {
      label: 'الناحية',
      requestValue: snap.subdistrictId,
      recordValue: match.subdistrictId,
      status: exactStatus(snap.subdistrictId, match.subdistrictId),
    },
    {
      label: 'الحي',
      requestValue: snap.neighborhoodId,
      recordValue: match.neighborhoodId,
      status: exactStatus(snap.neighborhoodId, match.neighborhoodId),
    },
    {
      label: 'العنوان التفصيلي',
      requestValue: snap.detailedAddress,
      recordValue: match.detailedAddress,
      status: addressStatus(snap.detailedAddress, match.detailedAddress),
    },
  ];
}

export default function SuggestedMatchesPanel({
  serviceRequestId,
  request,
  onLink,
  sources = 'all',
  canCreateFromRequest = false,
  createBusy = false,
  onCreateFromRequest,
}: {
  serviceRequestId: number;
  request?: any;
  onLink: (m: { source: 'client' | 'candidate'; id: number }) => Promise<void>;
  sources?: 'all' | 'clients';
  canCreateFromRequest?: boolean;
  createBusy?: boolean;
  onCreateFromRequest?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<SuggestedMatch[]>([]);
  const [candidates, setCandidates] = useState<SuggestedMatch[]>([]);
  const [selected, setSelected] = useState<SuggestedMatch | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.serviceRequests
      .suggestedMatches(serviceRequestId)
      .then((res) => {
        if (cancelled) return;
        setClients((res.clients as SuggestedMatch[]).slice(0, 10));
        setCandidates(sources === 'clients' ? [] : (res.candidates as SuggestedMatch[]));
        setSelected(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [serviceRequestId, sources]);

  const records = useMemo(
    () => [...clients, ...candidates].sort((a, b) => b.score - a.score).slice(0, 10),
    [clients, candidates],
  );
  const allEmpty = records.length === 0;
  const selectedRows = request && selected ? comparisonRows(request, selected) : [];
  const highConfidenceRecords = records.filter((record) => record.score > 0.75 || record.confidence === 'high');

  const requestCreate = async () => {
    if (!onCreateFromRequest) return;
    if (highConfidenceRecords.length > 0) {
      setConfirmCreateOpen(true);
      return;
    }
    await onCreateFromRequest();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
        <Search className="h-4 w-4 animate-pulse" />
        جاري البحث عن سجلات مقترحة...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1 text-base font-bold text-slate-800">
        <Search className="h-4 w-4" />
        سجلات مقترحة
      </h3>

      {allEmpty && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          لا توجد سجلات متقاربة.
          {canCreateFromRequest && onCreateFromRequest && (
            <div className="mt-3">
              <Button
                size="sm"
                icon={Plus}
                loading={createBusy}
                onClick={requestCreate}
              >
                إنشاء سجل جديد من بيانات الطلب
              </Button>
            </div>
          )}
        </div>
      )}

      {records.length > 0 && (
        <ul className="space-y-1">
          {records.map((m) => {
            const key = `${m.source}-${m.id}`;
            const isSelected = selected?.source === m.source && selected.id === m.id;
            return (
              <li
                key={key}
                className={`flex items-center justify-between rounded border p-2 ${
                  isSelected ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {m.source === 'client' ? (
                    <User className="h-4 w-4 text-blue-600" />
                  ) : (
                    <UserPlus className="h-4 w-4 text-amber-600" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-slate-500">
                      #{m.id} · {m.source === 'client' ? 'زبون' : 'مرشح'} · {m.phone ?? '-'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confidenceBadge(m.confidence)}
                  <span className="text-xs text-slate-500">{Math.round(m.score * 100)}%</span>
                  <Button
                    variant={isSelected ? 'primary' : 'secondary'}
                    size="sm"
                    icon={Search}
                    onClick={() => setSelected(m)}
                  >
                    مقارنة
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <section className="rounded border border-sky-200 bg-white p-3">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-800">{selected.name}</div>
              <div className="text-xs text-slate-500">
                {selected.source === 'client' ? 'سجل زبون' : 'سجل مرشح'} #{selected.id}
              </div>
            </div>
            <Button
              size="sm"
              icon={CheckCircle2}
              disabled={linkingKey === `${selected.source}-${selected.id}`}
              onClick={async () => {
                const key = `${selected.source}-${selected.id}`;
                setLinkingKey(key);
                try {
                  await onLink({ source: selected.source, id: selected.id });
                } finally {
                  setLinkingKey(null);
                }
              }}
            >
              اعتماد الربط
            </Button>
          </div>

          {request ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-2 py-2 text-right font-semibold">الحقل</th>
                    <th className="px-2 py-2 text-right font-semibold">بيانات الطلب</th>
                    <th className="px-2 py-2 text-right font-semibold">بيانات السجل</th>
                    <th className="px-2 py-2 text-right font-semibold">النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map((row) => (
                    <tr key={row.label} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 font-medium text-slate-700">{row.label}</td>
                      <td className="px-2 py-2 text-slate-600">{row.requestValue || '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{row.recordValue || '-'}</td>
                      <td className="px-2 py-2">{statusBadge(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded bg-amber-50 p-3 text-sm text-amber-800">
              بيانات الطلب غير محملة للمقارنة، لكن اعتماد الربط ما زال يتطلب اختيار هذا السجل من القائمة.
            </div>
          )}
        </section>
      )}

      {records.length > 0 && canCreateFromRequest && onCreateFromRequest && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <Button
            variant="secondary"
            size="sm"
            icon={ArrowLeft}
            loading={createBusy}
            onClick={requestCreate}
          >
            لا توجد نتيجة مناسبة، إنشاء سجل جديد
          </Button>
        </div>
      )}

      <Modal
        isOpen={confirmCreateOpen}
        onClose={() => setConfirmCreateOpen(false)}
        title="تأكيد إنشاء سجل جديد"
        subtitle="توجد نتائج ذات ثقة عالية"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCreateOpen(false)}>مراجعة النتائج</Button>
            <Button
              variant="danger"
              loading={createBusy}
              onClick={async () => {
                setConfirmCreateOpen(false);
                await onCreateFromRequest?.();
              }}
            >
              المتابعة وإنشاء سجل جديد
            </Button>
          </>
        }
      >
        <div className="space-y-3 p-5">
          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              يوجد {highConfidenceRecords.length} سجل مقترح بثقة أعلى من 75%. إنشاء سجل جديد قد يسبب تكراراً إن لم تكن هذه النتائج تخص شخصاً مختلفاً.
            </div>
          </div>
          <ul className="space-y-1">
            {highConfidenceRecords.slice(0, 5).map((record) => (
              <li key={`${record.source}-${record.id}`} className="flex items-center justify-between rounded border border-slate-200 p-2 text-sm">
                <span>{record.name} · #{record.id}</span>
                <span className="font-semibold text-slate-600">{Math.round(record.score * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
