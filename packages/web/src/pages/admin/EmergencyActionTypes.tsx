import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Edit, Loader2, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import IconButton from '../../components/ui/IconButton';
import Modal from '../../components/ui/Modal';
import Toggle from '../../components/ui/Toggle';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';

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

  const columns: ColumnDef<ActionType>[] = [
    {
      key: 'displayOrder', label: '#', width: 'w-12',
      render: (item) => <span className="text-slate-400 font-mono text-xs">{item.displayOrder}</span>,
    },
    {
      key: 'arabicLabel', label: 'الإجراء',
      render: (item) => <span className="font-bold text-slate-800">{item.arabicLabel}</span>,
    },
    {
      key: 'description', label: 'الوصف',
      render: (item) => <span className="text-slate-500 text-xs">{item.description || '—'}</span>,
    },
    {
      key: 'isActive', label: 'مفعّل', width: 'w-24',
      render: (item) => (
        canManage ? (
          <Toggle checked={item.isActive} onCheckedChange={() => toggleActive(item)} disabled={savingId === item.id} size="sm" label={item.isActive ? 'تعطيل' : 'تفعيل'} />
        ) : (
          <span className={`text-xs font-bold ${item.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
            {item.isActive ? 'مفعّل' : 'معطّل'}
          </span>
        )
      ),
    },
  ];

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <PageHeader
        className="mb-6"
        title="أنواع إجراءات الصيانة الطارئة"
        subtitle="قائمة الإجراءات التي يمكن تحديدها عند طلب صيانة طارئة"
        icon={
          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
            <Zap className="w-5 h-5 text-rose-600" />
          </div>
        }
        actions={canManage && (
          <Button variant="danger" icon={Plus} onClick={openNew}>
            إضافة نوع
          </Button>
        )}
      />

      {/* Messages */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          <IconButton icon={X} label="إغلاق" size="sm" className="mr-auto" onClick={() => setError(null)} />
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
        <SmartTable<ActionType>
          title="أنواع الإجراءات"
          icon={Zap}
          data={items}
          columns={columns}
          getId={(item) => item.id}
          hideFilterBar
          paginated={false}
          tableMinWidth={620}
          rowClassName={(item) => (!item.isActive ? 'opacity-50 hover:bg-sky-50' : '')}
          emptyIcon={Zap}
          emptyMessage="لا توجد أنواع بعد"
          actions={canManage ? (item) => (
            <div className="flex items-center justify-center gap-1.5">
              <button onClick={() => openEdit(item)} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-colors">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(item)} disabled={savingId === item.id} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : undefined}
        />
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={editItem !== null}
        onClose={closeModal}
        size="sm"
        title={isNew ? 'إضافة نوع إجراء' : 'تعديل نوع الإجراء'}
        footer={
          <div className="w-full flex gap-3">
            <Button variant="secondary" onClick={closeModal} className="flex-1">إلغاء</Button>
            <Button
              variant="danger"
              icon={Save}
              onClick={handleSave}
              disabled={!editItem?.arabicLabel?.trim()}
              loading={savingId !== null}
              className="flex-1"
            >
              حفظ
            </Button>
          </div>
        }
      >
            {editItem && (
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
            )}
      </Modal>
    </div>
  );
}
