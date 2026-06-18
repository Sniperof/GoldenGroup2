// ============================================================
// SuggestedMatchesPanel — fuzzy suggestions for unlinked requests
// Constitution: maintenance.md §٠.١١ (Suggested Records List)
// ============================================================
import { useEffect, useState } from 'react';
import { Search, User, UserPlus, ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../ui/Button';

interface SuggestedMatch {
  source: 'client' | 'candidate';
  id: number;
  name: string;
  phone: string | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  branchId: number | null;
}

function confidenceBadge(c: 'high' | 'medium' | 'low') {
  const m = {
    high: 'bg-green-100 text-green-700 border-green-300',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    low: 'bg-gray-100 text-gray-600 border-gray-300',
  };
  const l = { high: 'تَطابق عالٍ', medium: 'تَطابق متوسط', low: 'تَطابق ضعيف' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${m[c]}`}>
      {l[c]}
    </span>
  );
}

export default function SuggestedMatchesPanel({
  serviceRequestId,
  onLink,
}: {
  serviceRequestId: number;
  onLink: (m: { source: 'client' | 'candidate'; id: number }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<SuggestedMatch[]>([]);
  const [candidates, setCandidates] = useState<SuggestedMatch[]>([]);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.serviceRequests
      .suggestedMatches(serviceRequestId)
      .then((res) => {
        if (cancelled) return;
        setClients(res.clients as SuggestedMatch[]);
        setCandidates(res.candidates as SuggestedMatch[]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [serviceRequestId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
        <Search className="h-4 w-4 animate-pulse" />
        جاري البحث عن مُطابقات...
      </div>
    );
  }

  const allEmpty = clients.length === 0 && candidates.length === 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1">
        <Search className="h-4 w-4" />
        مُطابقات مُقترَحة
      </h3>
      {allEmpty && (
        <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded">
          لا توجد مُطابقات قريبة. يُمكن إنشاء Candidate جديد أو ربط يدوي.
        </p>
      )}

      {clients.length > 0 && (
        <section>
          <h4 className="text-xs font-medium text-gray-500 mb-1">عملاء مُقترَحون</h4>
          <ul className="space-y-1">
            {clients.map((m) => (
              <li
                key={`client-${m.id}`}
                className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 hover:bg-blue-50"
              >
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.phone ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confidenceBadge(m.confidence)}
                  <Button
                    size="sm"
                    icon={ArrowLeft}
                    disabled={linkingId === m.id}
                    onClick={async () => {
                      setLinkingId(m.id);
                      try {
                        await onLink({ source: 'client', id: m.id });
                      } finally {
                        setLinkingId(null);
                      }
                    }}
                  >
                    ربط
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {candidates.length > 0 && (
        <section>
          <h4 className="text-xs font-medium text-gray-500 mb-1">مرشّحون مُقترَحون</h4>
          <ul className="space-y-1">
            {candidates.map((m) => (
              <li
                key={`candidate-${m.id}`}
                className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 hover:bg-yellow-50"
              >
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-yellow-600" />
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.phone ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confidenceBadge(m.confidence)}
                  <Button
                    variant="gold"
                    size="sm"
                    icon={ArrowLeft}
                    disabled={linkingId === m.id}
                    onClick={async () => {
                      setLinkingId(m.id);
                      try {
                        await onLink({ source: 'candidate', id: m.id });
                      } finally {
                        setLinkingId(null);
                      }
                    }}
                  >
                    ربط
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
