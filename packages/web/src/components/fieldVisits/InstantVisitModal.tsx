import { useEffect, useState, useMemo, useCallback } from 'react';
import { X, Loader2, Search, MapPin, Zap, AlertTriangle, Phone } from 'lucide-react';
import { api } from '../../lib/api';

// DEC-011 — Field-Initiated Instant Visit. The supervisor picks one of her
// branch's customers and starts an off-plan visit on the spot (in_progress now).
// Server enforces branch + today's-route-zone + cooldown guards; the modal just
// captures the customer + GPS.

interface ClientRow {
  id: number;
  name?: string | null;
  mobile?: string | null;
  detailed_address?: string | null;
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.clients.list();
      setClients(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setError(err?.message ?? 'تعذّر تحميل الزبائن');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) { setQuery(''); setSelectedId(null); setError(null); void load(); }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return clients.slice(0, 50);
    return clients.filter((c) =>
      (c.name ?? '').includes(q) || (c.mobile ?? '').includes(q),
    ).slice(0, 50);
  }, [clients, query]);

  if (!open) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-800">زيارة فورية</h2>
          <span className="text-xs text-slate-400">اختر زبوناً من فرعك ضمن منطقتك اليوم</span>
          <button onClick={onClose} className="mr-auto text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الجوال…"
              className="w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto custom-scroll flex-1">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">لا نتائج</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => {
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
                      {selected && <span className="text-[11px] font-bold text-amber-600">محدَّد</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {c.mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.mobile}</span>}
                      {c.detailed_address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.detailed_address}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> سيُلتقط موقعك تلقائياً عند الإنشاء
          </p>
          <button
            onClick={handleCreate}
            disabled={selectedId == null || submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            إنشاء وبدء الزيارة
          </button>
        </div>
      </div>
    </div>
  );
}
