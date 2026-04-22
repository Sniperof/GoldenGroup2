import { useEffect, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { api } from '../lib/api';

interface Branch {
  id: number;
  name: string;
}

/**
 * Shown only to super admins. Picks which branch's data the UI should scope
 * reads/writes to. Selection is persisted in localStorage and attached as
 * `X-Branch-Id` to every API call by api.ts / authFetch.ts.
 *
 * Non-super users don't see this — the server pins them to their own branch.
 */
export default function BranchSwitcher() {
  const user = useAuthStore(s => s.user);
  const { branchId, setBranchId } = useBranchContextStore();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (user?.isSuperAdmin !== true) return;
    api.branches.list().then(rows => setBranches(rows as Branch[])).catch(() => setBranches([]));
  }, [user?.isSuperAdmin]);

  // Non-super users: read-only indicator of their pinned branch.
  if (user?.isSuperAdmin !== true) {
    if (!user?.branchId) return null;
    return (
      <div className="mx-3 my-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-sm">
        <Building2 className="w-4 h-4" />
        <span className="flex-1 text-right truncate">
          الفرع: <span className="font-semibold text-slate-800">#{user.branchId}</span>
        </span>
      </div>
    );
  }

  const current = branches.find(b => b.id === branchId);

  function handleSelect(id: number | null) {
    setBranchId(id);
    setOpen(false);
    // Force a soft reload so every open list refetches with the new header.
    window.location.reload();
  }

  return (
    <div className="relative mx-3 my-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 transition-colors text-sm"
      >
        <Building2 className="w-4 h-4" />
        <span className="flex-1 text-right truncate font-medium">
          {current ? current.name : 'كل الفروع (HQ)'}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-right text-sm"
          >
            {branchId == null ? <Check className="w-4 h-4 text-sky-600" /> : <span className="w-4" />}
            <span className="flex-1 text-slate-700">كل الفروع (HQ)</span>
          </button>
          {branches.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleSelect(b.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-right text-sm"
            >
              {b.id === branchId ? <Check className="w-4 h-4 text-sky-600" /> : <span className="w-4" />}
              <span className="flex-1 text-slate-700">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
