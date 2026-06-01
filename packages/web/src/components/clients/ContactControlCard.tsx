// ============================================================
// ContactControlCard.tsx — "حالة التواصل" panel for ClientProfile
// ============================================================
// Constitution source:
//   DEC-005 D29  — cooldown على مستوى الزبون + do_not_contact
//   DEC-006 D32  — فك cooldown اليدوي حصراً لمدير الفرع (clients.cooldown_unlock)
// ============================================================

import { useState } from 'react';
import { Ban, Clock, ShieldOff, Lock, Unlock } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import type { Client } from '../../lib/types';

interface Props {
  client: Client;
  onChange: () => void; // re-fetch caller's client object after mutation
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export default function ContactControlCard({ client, onChange }: Props) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUnlock = hasPermission('clients.cooldown_unlock'); // DEC-006 D32

  const [busy, setBusy] = useState(false);
  const [showCooldownForm, setShowCooldownForm] = useState(false);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cooldownUntil = client.cooldownUntil ?? null;
  const cooldownReason = client.cooldownReason ?? null;
  const cooldownActive = cooldownUntil != null && cooldownUntil >= new Date().toISOString().slice(0, 10);
  const doNotContact = client.doNotContact === true;

  async function activateCooldown() {
    setError(null);
    if (!reason.trim()) {
      setError('السبب مطلوب');
      return;
    }
    if (days <= 0) {
      setError('المدة يجب أن تكون أكبر من صفر');
      return;
    }
    setBusy(true);
    try {
      await api.clients.setCooldown(client.id, { days, reason: reason.trim() });
      setShowCooldownForm(false);
      setReason('');
      setDays(7);
      onChange();
    } catch (e: any) {
      setError(e?.message ?? 'فشل تفعيل التهدئة');
    } finally {
      setBusy(false);
    }
  }

  async function clearCooldown() {
    setBusy(true);
    setError(null);
    try {
      await api.clients.clearCooldown(client.id);
      onChange();
    } catch (e: any) {
      setError(e?.message ?? 'فشل فك التهدئة');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDoNotContact() {
    setBusy(true);
    setError(null);
    try {
      await api.clients.setDoNotContact(client.id, !doNotContact);
      onChange();
    } catch (e: any) {
      setError(e?.message ?? 'فشل تحديث حالة التواصل');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldOff className="w-4 h-4 text-slate-600" />
        <h3 className="text-sm font-bold text-slate-800">حالة التواصل</h3>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {/* ── do_not_contact (permanent) ─────────────────────────── */}
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <Ban className="w-3.5 h-3.5" />
              عدم التواصل (حظر دائم)
            </div>
            <p className="text-[11px] text-slate-500">
              عند تفعيله، يُحجب الزبون من كل قوائم التواصل بشكل دائم.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={toggleDoNotContact}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
              doNotContact
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {doNotContact ? 'مُفعَّل — اضغط للإلغاء' : 'تفعيل الحظر'}
          </button>
        </div>
      </div>

      {/* ── cooldown (temporary) ───────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Clock className="w-3.5 h-3.5" />
          فترة التهدئة (Cooldown)
        </div>

        {cooldownActive ? (
          <div className="space-y-2">
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs">
              <div className="font-bold text-amber-800">نشطة حتى: {formatDate(cooldownUntil)}</div>
              {cooldownReason && (
                <div className="mt-1 text-amber-700">السبب: {cooldownReason}</div>
              )}
            </div>
            {canUnlock ? (
              <button
                type="button"
                disabled={busy}
                onClick={clearCooldown}
                className="w-full px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center justify-center gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5" /> فك التهدئة (مدير الفرع)
              </button>
            ) : (
              <div className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> فك التهدئة محصور بصلاحية مدير الفرع.
              </div>
            )}
          </div>
        ) : showCooldownForm ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="block text-[11px] font-bold text-slate-600 mb-0.5">عدد الأيام</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 0))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 mb-0.5">السبب</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: عدم اهتمام متكرر"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={activateCooldown}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700"
              >
                تفعيل
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowCooldownForm(false); setError(null); setReason(''); }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowCooldownForm(true)}
            className="w-full px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            تفعيل فترة تهدئة جديدة
          </button>
        )}
      </div>
    </div>
  );
}
