import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Clock, Edit, ExternalLink,
  GalleryHorizontal, ImageIcon, Loader2, Lock, Package, Plus, Save, Trash2, Upload, X,
} from '../../components/ui/icons';
import Button from '../../components/ui/Button';
import DateField from '../../components/ui/DateField';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import Select from '../../components/ui/Select';
import Toggle from '../../components/ui/Toggle';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { api } from '../../lib/api';
import type {
  AppHomeBanner, AppHomeBannerAudience, AppHomeBannerInput,
  AppHomeBannerTargetKind, AppHomeBannerTargetOptions,
} from '../../lib/api';
import { uploadMedia } from '../../lib/uploadMedia';
import { useAuthStore } from '../../hooks/useAuthStore';

const TARGET_KIND_LABELS: Record<AppHomeBannerTargetKind, string> = {
  none: 'بدون (صورة فقط)',
  device: 'تفاصيل جهاز من الكتالوج',
  service_request: 'فتح نموذج طلب',
  external_url: 'رابط خارجي',
};

/**
 * Audience is pinned to 'all' (2026-08-16): every banner reaches every viewer.
 * The field is shown but locked so the rule is visible rather than invisible;
 * the API rejects any other value, so this is not a client-side-only lock.
 */
const PINNED_AUDIENCE: AppHomeBannerAudience = 'all';
const PINNED_AUDIENCE_LABEL = 'الجميع (العملاء والزوار)';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function emptyDraft(sortOrder: number): AppHomeBannerInput {
  return {
    titleAr: '', imageUrl: '', sortOrder, displaySeconds: 5,
    startsAt: null, endsAt: null, targetKind: 'none',
    targetDeviceModelId: null, targetRequestType: null, targetUrl: null,
    audience: PINNED_AUDIENCE, isActive: true,
  };
}

/** DateField is day-granular; a window ending on day D should include all of D. */
function dayToIsoStart(day: string): string | null {
  return day ? new Date(`${day}T00:00:00`).toISOString() : null;
}
function dayToIsoEnd(day: string): string | null {
  return day ? new Date(`${day}T23:59:59`).toISOString() : null;
}
function isoToDay(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

/** Why a banner is not currently on screen — the admin's most common question. */
function publishState(banner: AppHomeBanner): { label: string; tone: string } {
  if (!banner.isActive) return { label: 'معطّل', tone: 'text-slate-400' };
  const now = Date.now();
  if (banner.startsAt && Date.parse(banner.startsAt) > now) return { label: 'مجدول', tone: 'text-amber-600' };
  if (banner.endsAt && Date.parse(banner.endsAt) <= now) return { label: 'منتهي', tone: 'text-slate-400' };
  return { label: 'ظاهر الآن', tone: 'text-emerald-600' };
}

export default function AppHomeBanners() {
  const { user, hasPermission } = useAuthStore();
  const canView = user?.isSuperAdmin === true || hasPermission('admin.app_home_banners.view');
  const canManage = user?.isSuperAdmin === true || hasPermission('admin.app_home_banners.manage');

  const [items, setItems] = useState<AppHomeBanner[]>([]);
  const [options, setOptions] = useState<AppHomeBannerTargetOptions>({ devices: [], requestTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  const [draft, setDraft] = useState<AppHomeBannerInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    Promise.all([api.admin.appHomeBanners.list(), api.admin.appHomeBanners.targetOptions()])
      .then(([banners, targetOptions]) => { setItems(banners); setOptions(targetOptions); })
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [canView]);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 2500); };

  const deviceOptions = useMemo(
    () => options.devices.map(d => ({ value: d.id, label: d.category ? `${d.nameAr} — ${d.category}` : d.nameAr })),
    [options.devices],
  );
  const requestTypeOptions = useMemo(
    () => options.requestTypes.map(t => ({ value: t.requestType, label: t.labelAr })),
    [options.requestTypes],
  );

  const openNew = () => {
    setDraft(emptyDraft(items.length + 1));
    setEditingId(null);
  };
  const openEdit = (banner: AppHomeBanner) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...input } = banner;
    setDraft(input);
    setEditingId(banner.id);
  };
  const closeModal = () => { setDraft(null); setEditingId(null); };

  const patchDraft = (patch: Partial<AppHomeBannerInput>) =>
    setDraft(prev => (prev ? { ...prev, ...patch } : prev));

  /** Switching kind clears the other kinds' values so a stale id can't be sent. */
  const changeTargetKind = (targetKind: AppHomeBannerTargetKind) =>
    patchDraft({ targetKind, targetDeviceModelId: null, targetRequestType: null, targetUrl: null });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError('الصورة يجب أن تكون بصيغة JPG أو PNG أو WEBP');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('حجم الصورة يجب ألا يتجاوز 3 ميغابايت');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const media = await uploadMedia(file);
      patchDraft({ imageUrl: media.url });
    } catch (err: any) { setError(err.message); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const draftIsValid = (() => {
    if (!draft?.imageUrl) return false;
    if (draft.targetKind === 'device') return draft.targetDeviceModelId != null;
    if (draft.targetKind === 'service_request') return !!draft.targetRequestType;
    if (draft.targetKind === 'external_url') return /^https:\/\/\S+$/.test(draft.targetUrl ?? '');
    return true;
  })();

  const handleSave = async () => {
    if (!draft || !draftIsValid) return;
    setSaving(true);
    setError(null);
    try {
      const payload: AppHomeBannerInput = { ...draft, titleAr: draft.titleAr?.trim() || null };
      if (editingId == null) {
        const created = await api.admin.appHomeBanners.create(payload);
        setItems(prev => [...prev, created]);
        flash('تمت إضافة البانر');
      } else {
        const updated = await api.admin.appHomeBanners.update(editingId, payload);
        setItems(prev => prev.map(b => (b.id === updated.id ? updated : b)));
        flash('تم حفظ البانر');
      }
      closeModal();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (banner: AppHomeBanner) => {
    setBusyId(banner.id);
    try {
      const { id: _id, createdAt: _c, updatedAt: _u, ...input } = banner;
      const updated = await api.admin.appHomeBanners.update(banner.id, { ...input, isActive: !banner.isActive });
      setItems(prev => prev.map(b => (b.id === updated.id ? updated : b)));
    } catch (err: any) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const handleDelete = async (banner: AppHomeBanner) => {
    if (!window.confirm(`حذف البانر "${banner.titleAr || banner.imageUrl}"؟`)) return;
    setBusyId(banner.id);
    try {
      await api.admin.appHomeBanners.delete(banner.id);
      setItems(prev => prev.filter(b => b.id !== banner.id));
      flash('تم الحذف');
    } catch (err: any) { setError(err.message); }
    finally { setBusyId(null); }
  };

  /** Sends the whole ordered list; the server rewrites sort_order in one transaction. */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    const previous = items;
    setItems(next);                      // optimistic — the strip reorders instantly
    setReordering(true);
    try {
      setItems(await api.admin.appHomeBanners.reorder(next.map(b => b.id)));
    } catch (err: any) {
      setItems(previous);
      setError(err.message);
    } finally { setReordering(false); }
  };

  const describeTarget = (banner: AppHomeBanner) => {
    if (banner.targetKind === 'device') {
      const device = options.devices.find(d => d.id === banner.targetDeviceModelId);
      return { icon: Package, text: device?.nameAr ?? `جهاز #${banner.targetDeviceModelId}` };
    }
    if (banner.targetKind === 'service_request') {
      const type = options.requestTypes.find(t => t.requestType === banner.targetRequestType);
      // Not in the options list = the app can no longer open this form, so the
      // banner is silently skipped on the mobile side. Say so here.
      return {
        icon: type ? ImageIcon : AlertTriangle,
        text: type?.labelAr ?? `${banner.targetRequestType} (غير متاح في التطبيق)`,
        warn: !type,
      };
    }
    if (banner.targetKind === 'external_url') return { icon: ExternalLink, text: banner.targetUrl ?? '' };
    return { icon: ImageIcon, text: '—' };
  };

  const columns: ColumnDef<AppHomeBanner>[] = [
    {
      key: 'order', label: 'الترتيب', width: 'w-24',
      render: (banner) => {
        const index = items.findIndex(b => b.id === banner.id);
        return (
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs text-slate-400 w-4">{index + 1}</span>
            {canManage && (
              <>
                <button onClick={() => move(index, -1)} disabled={index === 0 || reordering}
                  className="p-1 text-slate-400 hover:text-sky-500 disabled:opacity-30" aria-label="تحريك لأعلى">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(index, 1)} disabled={index === items.length - 1 || reordering}
                  className="p-1 text-slate-400 hover:text-sky-500 disabled:opacity-30" aria-label="تحريك لأسفل">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        );
      },
    },
    {
      key: 'image', label: 'الصورة', width: 'w-28',
      render: (banner) => (
        <img src={banner.imageUrl} alt={banner.titleAr ?? ''}
          className="w-20 h-11 object-cover rounded-lg border border-slate-200 bg-slate-50" />
      ),
    },
    {
      key: 'titleAr', label: 'العنوان',
      render: (banner) => (
        <span className="font-bold text-slate-800">{banner.titleAr || <span className="text-slate-400">بدون عنوان</span>}</span>
      ),
    },
    {
      key: 'target', label: 'عند الضغط',
      render: (banner) => {
        const { icon: Icon, text, warn } = describeTarget(banner) as any;
        return (
          <div className={`flex items-center gap-1.5 text-xs ${warn ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">{text}</span>
          </div>
        );
      },
    },
    {
      key: 'displaySeconds', label: 'المدة', width: 'w-20',
      render: (banner) => <span className="text-xs text-slate-500 font-mono">{banner.displaySeconds} ث</span>,
    },
    {
      key: 'state', label: 'الحالة', width: 'w-28',
      render: (banner) => {
        const state = publishState(banner);
        return <span className={`text-xs font-bold ${state.tone}`}>{state.label}</span>;
      },
    },
    {
      key: 'isActive', label: 'مفعّل', width: 'w-20',
      render: (banner) => (
        canManage
          ? <Toggle checked={banner.isActive} onCheckedChange={() => toggleActive(banner)}
              disabled={busyId === banner.id} size="sm" label={banner.isActive ? 'تعطيل' : 'تفعيل'} />
          : <span className="text-xs text-slate-400">{banner.isActive ? 'مفعّل' : 'معطّل'}</span>
      ),
    },
  ];

  if (!canView) return <Navigate to="/" replace />;

  const inputClass = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20';

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      <PageHeader
        className="mb-6"
        title="بانرات الشاشة الرئيسية للتطبيق"
        subtitle="الصور المتحركة أعلى الصفحة الرئيسية في تطبيق العملاء، وما يفتحه الضغط عليها"
        icon={
          <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
            <GalleryHorizontal className="w-5 h-5 text-sky-600" />
          </div>
        }
        actions={canManage && <Button variant="primary" icon={Plus} onClick={openNew}>إضافة بانر</Button>}
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="mr-auto p-1 text-red-400 hover:text-red-600" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-sky-500" /></div>
      ) : (
        <SmartTable<AppHomeBanner>
          title="البانرات"
          icon={GalleryHorizontal}
          data={items}
          columns={columns}
          getId={(banner) => banner.id}
          hideFilterBar
          tableMinWidth={860}
          rowClassName={(banner) => (publishState(banner).label === 'ظاهر الآن' ? '' : 'opacity-60 hover:bg-sky-50')}
          emptyIcon={GalleryHorizontal}
          emptyMessage="لا توجد بانرات بعد"
          actions={canManage ? (banner) => (
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={() => openEdit(banner)}
                className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-colors">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(banner)} disabled={busyId === banner.id}
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : undefined}
        />
      )}

      <Modal
        isOpen={draft !== null}
        onClose={closeModal}
        size="lg"
        title={editingId == null ? 'إضافة بانر' : 'تعديل البانر'}
        footer={
          <div className="w-full flex gap-3">
            <Button variant="secondary" onClick={closeModal} className="flex-1">إلغاء</Button>
            <Button variant="primary" icon={Save} onClick={handleSave}
              disabled={!draftIsValid || uploading} loading={saving} className="flex-1">
              حفظ
            </Button>
          </div>
        }
      >
        {draft && (
          <div className="px-5 py-4 space-y-4">
            {/* Image */}
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                الصورة <span className="text-red-500">*</span>
                <span className="font-normal text-slate-400"> — يُفضّل مقاس عريض 16:9، حتى 3 ميغابايت</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="w-40 h-24 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                  {draft.imageUrl
                    ? <img src={draft.imageUrl} alt="معاينة" className="w-full h-full object-cover" />
                    : <ImageIcon className="w-6 h-6 text-slate-300" />}
                </div>
                <div>
                  <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')}
                    className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                  <Button variant="secondary" icon={uploading ? Loader2 : Upload}
                    disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? 'جارٍ الرفع…' : draft.imageUrl ? 'تغيير الصورة' : 'رفع صورة'}
                  </Button>
                  {draft.imageUrl && <p className="mt-1.5 text-[11px] text-slate-400 font-mono">{draft.imageUrl}</p>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">العنوان (اختياري)</label>
                <input type="text" maxLength={120} value={draft.titleAr ?? ''}
                  onChange={e => patchDraft({ titleAr: e.target.value })}
                  placeholder="مثال: عرض الفلتر السباعي" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  مدة العرض <span className="font-normal text-slate-400">(2–60 ثانية)</span>
                </label>
                <input type="number" min={2} max={60} value={draft.displaySeconds}
                  onChange={e => patchDraft({ displaySeconds: parseInt(e.target.value) || 5 })}
                  className={inputClass} />
              </div>
            </div>

            {/* Tap target */}
            <div className="rounded-xl border border-slate-200 p-3 space-y-3">
              <label className="block text-xs font-bold text-slate-600">عند الضغط على الصورة</label>
              <Select<AppHomeBannerTargetKind>
                value={draft.targetKind}
                onChange={changeTargetKind}
                options={(Object.keys(TARGET_KIND_LABELS) as AppHomeBannerTargetKind[])
                  .map(kind => ({ value: kind, label: TARGET_KIND_LABELS[kind] }))}
                ariaLabel="نوع الهدف"
              />

              {draft.targetKind === 'device' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">الجهاز</label>
                  <Select<number>
                    value={draft.targetDeviceModelId ?? 0}
                    onChange={(id) => patchDraft({ targetDeviceModelId: id || null })}
                    options={deviceOptions}
                    placeholder="اختر جهازاً من الكتالوج"
                    ariaLabel="الجهاز"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    يفتح صفحة الجهاز في كتالوج التطبيق — وليس جهاز عميل بعينه.
                  </p>
                </div>
              )}

              {draft.targetKind === 'service_request' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">نوع الطلب</label>
                  <Select<string>
                    value={draft.targetRequestType ?? ''}
                    onChange={(requestType) => patchDraft({ targetRequestType: requestType || null })}
                    options={requestTypeOptions}
                    placeholder="اختر نوع الطلب"
                    ariaLabel="نوع الطلب"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    القائمة تعرض الأنواع التي يستطيع التطبيق فتح نموذجها حالياً فقط.
                  </p>
                </div>
              )}

              {draft.targetKind === 'external_url' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">الرابط</label>
                  <input type="url" dir="ltr" value={draft.targetUrl ?? ''}
                    onChange={e => patchDraft({ targetUrl: e.target.value })}
                    placeholder="https://example.com" className={inputClass} />
                  <p className="mt-1.5 text-[11px] text-slate-400">يجب أن يبدأ بـ https://</p>
                </div>
              )}
            </div>

            {/* Publish window + audience */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <Clock className="w-3 h-3 inline ml-1" />بداية النشر (اختياري)
                </label>
                <DateField value={isoToDay(draft.startsAt)}
                  onChange={(day) => patchDraft({ startsAt: dayToIsoStart(day) })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <Clock className="w-3 h-3 inline ml-1" />نهاية النشر (اختياري)
                </label>
                <DateField value={isoToDay(draft.endsAt)}
                  min={isoToDay(draft.startsAt) || undefined}
                  onChange={(day) => patchDraft({ endsAt: dayToIsoEnd(day) })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">الجمهور</label>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                  <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  {PINNED_AUDIENCE_LABEL}
                </div>
              </div>
              <div className="flex items-center gap-2 pb-2.5">
                <Toggle checked={draft.isActive} onCheckedChange={(isActive) => patchDraft({ isActive })} label="تفعيل" />
                <span className="text-xs font-bold text-slate-600">مفعّل</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
