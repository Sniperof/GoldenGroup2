import { useEffect, useState } from 'react';
import IconButton from '../../components/ui/IconButton';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Edit, Loader2, Plus, Save, ToggleLeft, ToggleRight, Trash2, X, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

type ActionType = {
  id: number;
  arabicLabel: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
};

export default function EmergencyActionTypes() {
  const { user, hasPermission } = useAuthStore();
  const canManage = user?.isSuperAdmin === true || hasPermission('admin.emergency_action_types.manage');
  const canView   = user?.isSuperAdmin === true || hasPermission('admin.emergency_action_types.view');

  const [items, setItems] = useState<ActionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | 'new' | null>(null);

  // Edit modal state
  const [editItem, setEditItem] = useState<Partial<ActionType> | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    api.admin.emergencyActionTypes.list()
      .then(data => setItems(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [canView]);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 2500); };

  const openNew = () => { setEditItem({ arabicLabel: '', description: '', displayOrder: items.length + 1 }); setIsNew(true); };
  const openEdit = (item: ActionType) => { setEditItem({ ...item }); setIsNew(false); };
  const closeModal = () => { setEditItem(null); setIsNew(false); };

  const handleSave = async () => {
    if (!editItem?.arabicLabel?.trim()) return;
    setSavingId(isNew ? 'new' : editItem.id ?? 'new');
    try {
      if (isNew) {
        const created = await api.admin.emergencyActionTypes.create({
          arabicLabel: editItem.arabicLabel!.trim(),
          description: editItem.description?.trim() || undefined,
          displayOrder: editItem.displayOrder || items.length + 1,
        });
        setItems(prev => [...prev, created]);
        flash(`تم إضافة "${created.arabicLabel}"`);
      } else {
        const updated = await api.admin.emergencyActionTypes.update(editItem.id!, {
          arabicLabel: editItem.arabicLabel!.trim(),
          description: editItem.description?.trim() || undefined,
          displayOrder: editItem.displayOrder,
        });
        setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        flash(`تم حفظ "${updated.arabicLabel}"`);
      }
      closeModal();
    } catch (err: any) { setError(err.message); }
    finally { setSavingId(null); }
  };

  const toggleActive = async (item: ActionType) => {
    setSavingId(item.id);
    try {
      const updated = await api.admin.emergencyActionTypes.update(item.id, { isActive: !item.isActive });
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    } catch (err: any) { setError(err.message); }
    finally { setSavingId(null); }
  };

  const handleDelete = async (item: ActionType) => {
    if (!window.confirm(`حذف "${item.arabicLabel}"؟`)) return;
    setSavingId(item.id);
    try {
      await api.admin.emergencyActionTypes.delete(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      flash('تم الحذف');
    } catch (err: any) { setError(err.message); }
    finally { setSavingId(null); }
  };

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
            <Zap className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">أنواع إجراءات الصيانة الطارئة</h1>
            <p className="text-sm text-slate-500 mt-0.5">قائمة الإجراءات التي يمكن تحديدها عند طلب صيانة طارئة</p>
          </div>
        </div>
        {canManage && (
          <Button variant="danger" icon={Plus} onClick={openNew}>
            إضافة نوع
          </Button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          <IconButton icon={X} label="إغلاق" size="sm" onClick={() => setError(null)} />
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-rose-500" /></div>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 font-bold">
              <tr>
                <th className="p-3 text-right w-12">#</th>
                <th className="p-3 text-right">الإجراء</th>
                <th className="p-3 text-right">الوصف</th>
                <th className="p-3 text-center w-24">مفعّل</th>
                {canManage && <th className="p-3 text-center w-24">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400 text-sm">لا توجد أنواع بعد</td></tr>
              )}
              {items.map((item, idx) => (
                <tr key={item.id} className={`border-b border-slate-100 last:border-b-0 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''} ${!item.isActive ? 'opacity-50' : ''}`}>
                  <td className="p-3 text-slate-400 font-mono text-xs">{item.displayOrder}</td>
                  <td className="p-3 font-bold text-slate-800">{item.arabicLabel}</td>
                  <td className="p-3 text-slate-500 text-xs">{item.description || '—'}</td>
                  <td className="p-3 text-center">
                    {canManage ? (
                      <IconButton icon={X} label="إغلاق" size="sm" onClick={() => toggleActive(item)} disabled={savingId === item.id} />
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">اسم الإجراء <span className="text-red-500">*</span></label>
                <input type="text" value={editItem.arabicLabel ?? ''} onChange={e => setEditItem(p => ({ ...p, arabicLabel: e.target.value }))}
                  placeholder="مثال: تغيير فلتر"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">وصف (اختياري)</label>
                <textarea value={editItem.description ?? ''} onChange={e => setEditItem(p => ({ ...p, description: e.target.value }))}
                  rows={2} placeholder="توضيح إضافي..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">ترتيب الظهور</label>
                <input type="number" min={0} value={editItem.displayOrder ?? 0} onChange={e => setEditItem(p => ({ ...p, displayOrder: parseInt(e.target.value) || 0 }))}
                  className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-center focus:outline-none focus:border-rose-400" />
              </div>
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
              <Button variant="secondary" onClick={closeModal} className="flex-1">إلغاء</Button>
              <Button
                variant="danger"
                icon={Save}
                onClick={handleSave}
                disabled={!editItem.arabicLabel?.trim()}
                loading={savingId !== null}
                className="flex-1"
              >
                حفظ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
