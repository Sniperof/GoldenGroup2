import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Globe2, Link2, Loader2,
  MessageCircle, Save, Send, Share2, Trash2,
} from '../../components/ui/icons';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../hooks/useAuthStore';
import { api, type AppContactLinksInput } from '../../lib/api';

const EMPTY: AppContactLinksInput = {
  facebookUrl: null,
  websiteUrl: null,
  instagramUrl: null,
  whatsappNumber: null,
  telegramNumber: null,
};

type FieldKey = keyof AppContactLinksInput;

const FIELD_KEYS: FieldKey[] = [
  'facebookUrl',
  'websiteUrl',
  'instagramUrl',
  'whatsappNumber',
  'telegramNumber',
];

const FIELDS: Array<{
  key: FieldKey;
  label: string;
  hint: string;
  placeholder: string;
  kind: 'url' | 'phone';
  icon: typeof Link2;
}> = [
  { key: 'facebookUrl', label: 'Facebook', hint: 'رابط صفحة Facebook الرسمي بصيغة HTTPS', placeholder: 'https://facebook.com/goldengroup', kind: 'url', icon: Share2 },
  { key: 'websiteUrl', label: 'Website', hint: 'رابط الموقع الرسمي بصيغة HTTPS', placeholder: 'https://example.com', kind: 'url', icon: Globe2 },
  { key: 'instagramUrl', label: 'Instagram', hint: 'رابط حساب Instagram الرسمي بصيغة HTTPS', placeholder: 'https://instagram.com/goldengroup', kind: 'url', icon: Share2 },
  { key: 'whatsappNumber', label: 'WhatsApp', hint: 'رقم دولي يبدأ بعلامة +. يسمح بالمسافات والشرطات عند الإدخال.', placeholder: '+963912345687', kind: 'phone', icon: MessageCircle },
  { key: 'telegramNumber', label: 'Telegram', hint: 'رقم دولي يبدأ بعلامة +. يُعاد للموبايل كرقم خام بصيغة E.164.', placeholder: '+963912345687', kind: 'phone', icon: Send },
];

function editable(value: AppContactLinksInput): Record<FieldKey, string> {
  return Object.fromEntries(FIELD_KEYS.map(key => [key, value[key] ?? ''])) as Record<FieldKey, string>;
}

function payload(value: Record<FieldKey, string>): AppContactLinksInput {
  return Object.fromEntries(FIELD_KEYS.map(key => [key, value[key].trim() || null])) as AppContactLinksInput;
}

function fieldError(field: typeof FIELDS[number], value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (field.kind === 'phone') {
    const normalized = raw.replace(/[\s\-().]/g, '');
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? null : 'يجب إدخال رقم دولي صالح، مثال: +963912345687';
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return 'يجب أن يكون الرابط HTTPS بلا بيانات دخول';
    const host = url.hostname.toLowerCase();
    if (field.key === 'facebookUrl' && !(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com'))) {
      return 'يجب أن يكون رابط Facebook رسمياً';
    }
    if (field.key === 'instagramUrl' && !(host === 'instagram.com' || host.endsWith('.instagram.com'))) {
      return 'يجب أن يكون رابط Instagram رسمياً';
    }
    return null;
  } catch {
    return 'الرابط غير صالح';
  }
}

export default function AppContactLinks() {
  const { user, hasPermission } = useAuthStore();
  const canView = user?.isSuperAdmin === true || hasPermission('admin.app_contact_links.view');
  const canManage = user?.isSuperAdmin === true || hasPermission('admin.app_contact_links.manage');
  const [values, setValues] = useState<Record<FieldKey, string>>(editable(EMPTY));
  const [saved, setSaved] = useState<Record<FieldKey, string>>(editable(EMPTY));
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    api.admin.appContactLinks.get()
      .then(result => {
        const next = editable(result);
        setValues(next);
        setSaved(next);
        setUpdatedAt(result.updatedAt);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [canView]);

  const errors = useMemo(
    () => Object.fromEntries(FIELDS.map(field => [field.key, fieldError(field, values[field.key])])) as Record<FieldKey, string | null>,
    [values],
  );
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const valid = Object.values(errors).every(value => value === null);

  const save = async () => {
    if (!canManage || !dirty || !valid) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await api.admin.appContactLinks.update(payload(values));
      const next = editable(result);
      setValues(next);
      setSaved(next);
      setUpdatedAt(result.updatedAt);
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <PageHeader
        className="mb-6"
        title="روابط التواصل في التطبيق"
        subtitle="إدارة الروابط والأرقام التي يستقبلها تطبيق العملاء. الحقل الفارغ يخفي المنصة من التطبيق."
        icon={<div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center"><Link2 className="w-5 h-5 text-sky-600" /></div>}
        actions={canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={Trash2} disabled={saving} onClick={() => setValues(editable(EMPTY))}>مسح</Button>
            <Button variant="primary" icon={Save} disabled={!dirty || !valid} loading={saving} onClick={save}>حفظ الروابط</Button>
          </div>
        )}
      />

      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"><AlertTriangle className="w-4 h-4" />{error}</div>}
      {success && <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"><CheckCircle2 className="w-4 h-4" />تم حفظ روابط التطبيق</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-sky-500" /></div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-100">
            {FIELDS.map(field => {
              const Icon = field.icon;
              const value = values[field.key];
              return (
                <div key={field.key} className="grid gap-3 p-5 md:grid-cols-[180px_minmax(0,1fr)] md:items-start">
                  <div className="flex items-center gap-3 pt-2">
                    <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center"><Icon className="w-4 h-4 text-slate-500" /></div>
                    <span className="font-bold text-slate-700" dir="ltr">{field.label}</span>
                  </div>
                  <div>
                    <div className="flex gap-2">
                      <input
                        type={field.kind === 'url' ? 'url' : 'tel'}
                        dir="ltr"
                        value={value}
                        disabled={!canManage || saving}
                        maxLength={field.kind === 'url' ? 2048 : 32}
                        onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
                        placeholder={field.placeholder}
                        className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${errors[field.key] ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-slate-200 focus:border-sky-400 focus:ring-sky-400/20'}`}
                      />
                      {field.kind === 'url' && value.trim() && !errors[field.key] && (
                        <a href={value.trim()} target="_blank" rel="noreferrer" aria-label={`فتح ${field.label}`} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-500 hover:bg-slate-50 hover:text-sky-600"><ExternalLink className="w-4 h-4" /></a>
                      )}
                    </div>
                    <p className={`mt-1.5 text-xs ${errors[field.key] ? 'font-bold text-red-600' : 'text-slate-400'}`}>{errors[field.key] ?? field.hint}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-400">
            {updatedAt ? `آخر تحديث: ${new Date(updatedAt).toLocaleString('ar-SY')}` : 'لم تُحدّث الروابط بعد'}
            {!canManage && <span className="mr-2 font-bold text-amber-600">— لديك صلاحية العرض فقط</span>}
          </div>
        </div>
      )}
    </div>
  );
}
