// ============================================================
// ContactControlCard.tsx — "حالة التواصل" panel for ClientProfile
// ============================================================
// Constitution source:
//   DEC-005 D29  — cooldown على مستوى الزبون + do_not_contact
//   DEC-006 D32  — فك cooldown اليدوي حصراً لمدير الفرع (clients.cooldown_unlock)
// ============================================================

import { useState } from 'react';
import { Ban, Clock, ShieldOff, Lock, Unlock } from '../ui/icons';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import type { Client } from '../../lib/types';
import Button from '../ui/Button';
import Input from '../ui/Input';

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
  const canEdit = hasPermission('clients.contact_control.edit');
  const canUnlock = hasPermission('clients.cooldown_unlock'); // DEC-006 D32

  const [busy, setBusy] = useState(false);
  const [showDoNotContactForm, setShowDoNotContactForm] = useState(false);
  const [doNotContactReason, setDoNotContactReason] = useState('');
  const [showCooldownForm, setShowCooldownForm] = useState(false);
  const [days, setDays] = useState(7);
  const [cooldownReasonDraft, setCooldownReasonDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cooldownUntil = client.cooldownUntil ?? null;
  const cooldownReason = client.cooldownReason ?? null;
  const cooldownActive = cooldownUntil != null && cooldownUntil >= new Date().toISOString().slice(0, 10);
  const doNotContact = client.doNotContact === true;

  async function activateCooldown() {
    if (!canEdit) return;
    setError(null);
    if (!cooldownReasonDraft.trim()) {
      setError('السبب مطلوب');
      return;
    }
    if (days <= 0) {
      setError('المدة يجب أن تكون أكبر من صفر');
      return;
    }
    setBusy(true);
    try {
      await api.clients.setCooldown(client.id, { days, reason: cooldownReasonDraft.trim() });
      setShowCooldownForm(false);
      setCooldownReasonDraft('');
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

  async function submitDoNotContactChange() {
    if (!canEdit) return;
    const reason = doNotContactReason.trim();
    if (!reason) {
      setError(`سبب ${doNotContact ? 'إلغاء' : 'تفعيل'} عدم التواصل مطلوب`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.clients.setDoNotContact(client.id, !doNotContact, reason);
      setShowDoNotContactForm(false);
      setDoNotContactReason('');
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
        <h3 className="text-base font-bold text-slate-800">حالة التواصل</h3>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {/* ── do_not_contact (permanent) ─────────────────────────── */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <Ban className="w-3.5 h-3.5" />
              عدم التواصل (حظر دائم)
            </div>
            <p className="text-xs text-slate-500">
              عند تفعيله، يُحجب الزبون من كل قوائم التواصل بشكل دائم.
            </p>
          </div>
          {!showDoNotContactForm && (
            <Button
              variant={doNotContact ? 'danger' : 'secondary'}
              size="sm"
              disabled={busy || !canEdit}
              onClick={() => {
                setShowDoNotContactForm(true);
                setDoNotContactReason('');
                setError(null);
              }}
              className="shrink-0"
            >
              {doNotContact ? 'إلغاء الحظر' : 'تفعيل الحظر'}
            </Button>
          )}
        </div>

        {!canEdit && (
          <div className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Lock className="h-3 w-3" />
            يتطلب تغيير عدم التواصل صلاحية التحكم بحالة تواصل الزبون.
          </div>
        )}

        {showDoNotContactForm && canEdit && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <Input
              label={`سبب ${doNotContact ? 'إلغاء' : 'تفعيل'} عدم التواصل`}
              value={doNotContactReason}
              onChange={(event) => setDoNotContactReason(event.target.value)}
              placeholder={doNotContact
                ? 'مثال: وافق الزبون صراحة على استئناف التواصل'
                : 'مثال: طلب الزبون عدم التواصل مجددًا'}
              maxLength={500}
              inputSize="sm"
            />
            <p className="text-[11px] text-slate-500">
              هذا السبب يسجّل مع القرار الدائم وهو مستقل عن سبب فترة التهدئة.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant={doNotContact ? 'gold' : 'danger'}
                size="sm"
                disabled={busy || !doNotContactReason.trim()}
                onClick={submitDoNotContactChange}
              >
                {doNotContact ? 'تأكيد إلغاء الحظر' : 'تأكيد تفعيل الحظر'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setShowDoNotContactForm(false);
                  setDoNotContactReason('');
                  setError(null);
                }}
              >
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── cooldown (temporary) ───────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <Clock className="w-3.5 h-3.5" />
          فترة التهدئة (Cooldown)
        </div>

        {cooldownActive ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs">
              <div className="font-bold text-amber-800">نشطة حتى: {formatDate(cooldownUntil)}</div>
              {cooldownReason && (
                <div className="mt-1 text-amber-700">السبب: {cooldownReason}</div>
              )}
            </div>
            {canUnlock ? (
              <Button
                size="sm"
                fullWidth
                disabled={busy}
                icon={Unlock}
                onClick={clearCooldown}
              >
                فك التهدئة (مدير الفرع)
              </Button>
            ) : (
              <div className="text-xs text-slate-500 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> فك التهدئة محصور بصلاحية مدير الفرع.
              </div>
            )}
          </div>
        ) : showCooldownForm ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <Input
                  label="عدد الأيام"
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 0))}
                  inputSize="sm"
                />
              </div>
              <div className="col-span-2">
                <Input
                  label="السبب"
                  value={cooldownReasonDraft}
                  onChange={(e) => setCooldownReasonDraft(e.target.value)}
                  placeholder="مثال: عدم اهتمام متكرر"
                  inputSize="sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="gold"
                size="sm"
                disabled={busy}
                onClick={activateCooldown}
              >
                تفعيل
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setShowCooldownForm(false);
                  setError(null);
                  setCooldownReasonDraft('');
                }}
              >
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            disabled={busy}
            onClick={() => setShowCooldownForm(true)}
          >
            تفعيل فترة تهدئة جديدة
          </Button>
        )}
      </div>
    </div>
  );
}
