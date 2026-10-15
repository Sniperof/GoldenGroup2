import { useEffect, useState } from 'react';
import { Loader2, Search, MapPin, Zap, AlertTriangle, Phone } from '../ui/icons';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';

// DEC-011 — Field-Initiated Instant Visit. The server-side operation lookup
// exposes only customers that pass today's team, route, branch and contact guards.

interface ClientRow {
  id: number;
  name?: string | null;
  mobile?: string | null;
  detailedAddress?: string | null;
}

function captureGps(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30000 },
    );
  });
}

export default function InstantVisitModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (fieldVisitId: number) => void;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedId(null);
    setError(null);
    setUnavailableReason(null);
  }, [open]);

  useEffect(() => {
    if (!open || unavailableReason) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.fieldVisits.instantVisitOptions(query, controller.signal);
        setClients(result.clients);
        setSelectedId((current) => result.clients.some((client) => client.id === current) ? current : null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setClients([]);
        setSelectedId(null);
        setUnavailableReason(err?.message ?? 'تعذّر التحقق من جاهزية الزيارة الفورية');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, unavailableReason]);

  const handleCreate = async () => {
    if (selectedId == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const gps = await captureGps();
      if (!gps) {
        setError('يتعذّر تحديد موقعك — فعّل GPS/الموقع للمتابعة. الزيارة الفورية تتطلّب الموقع.');
        setSubmitting(false);
        return;
      }
      const res = await api.fieldVisits.createInstant({
        clientId: selectedId,
        lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy,
      });
      onCreated(res.fieldVisitId);
    } catch (err: any) {
      setError(err?.message ?? 'فشل إنشاء الزيارة الفورية');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          زيارة فورية
        </span>
      }
      subtitle="الزبائن المؤهلون ضمن مسار فريقك اليوم فقط"
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> سيُلتقط موقعك تلقائياً عند الإنشاء
          </p>
          <button
            onClick={handleCreate}
            disabled={selectedId == null || submitting || unavailableReason != null}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            إنشاء وبدء الزيارة
          </button>
        </div>
      }
    >
        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={unavailableReason != null}
              placeholder="ابحث ضمن الزبائن المؤهلين بالاسم أو الجوال…"
              className="w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-5">
          {unavailableReason && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
              <p className="text-sm font-bold text-amber-800">الزيارة الفورية غير متاحة الآن</p>
              <p className="mt-1 text-xs leading-5 text-amber-700">{unavailableReason}</p>
            </div>
          )}

          {error && !unavailableReason && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {unavailableReason ? null : loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            </div>
          ) : clients.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-bold text-slate-500">لا يوجد زبائن مؤهلون ضمن مسار فريقك اليوم</p>
              <p className="mt-1 text-xs text-slate-400">قد يكون الزبائن خارج المنطقة أو ضمن فترة تهدئة أو منع تواصل.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => {
                const selected = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-right rounded-xl border p-3 transition-colors ${
                      selected ? 'border-amber-400 bg-amber-50/60' : 'border-slate-200 hover:border-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800">{c.name || `زبون #${c.id}`}</span>
                      {selected && <span className="text-xs font-bold text-amber-600">محدَّد</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {c.mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.mobile}</span>}
                      {c.detailedAddress && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.detailedAddress}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
    </Modal>
  );
}
