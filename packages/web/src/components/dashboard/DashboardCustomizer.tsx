import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ArrowDown, ArrowUp, BarChart3, GripVertical, LayoutGrid, Plus, RotateCcw,
  Save, Search, X,
} from '../ui/icons';
import type { WidgetDef } from './widgetRegistry';

interface Props {
  open: boolean;
  availableWidgets: WidgetDef[];
  selectedKeys: string[];
  defaultKeys: string[];
  onClose: () => void;
  onSave: (keys: string[]) => Promise<void>;
}

export default function DashboardCustomizer({ open, availableWidgets, selectedKeys, defaultKeys, onClose, onSave }: Props) {
  const [draftKeys, setDraftKeys] = useState(selectedKeys);
  const [department, setDepartment] = useState('الكل');
  const [query, setQuery] = useState('');
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftKeys(selectedKeys);
    setDepartment('الكل');
    setQuery('');
    setError(null);
  }, [open, selectedKeys]);

  const byKey = useMemo(() => new Map(availableWidgets.map(widget => [widget.key, widget])), [availableWidgets]);
  const selected = draftKeys.map(key => byKey.get(key)).filter((widget): widget is WidgetDef => Boolean(widget));
  const departments = useMemo(() => ['الكل', ...Array.from(new Set(availableWidgets.map(widget => widget.department)))], [availableWidgets]);
  const available = availableWidgets.filter(widget => {
    if (draftKeys.includes(widget.key)) return false;
    if (department !== 'الكل' && widget.department !== department) return false;
    const needle = query.trim().toLocaleLowerCase('ar');
    return !needle || widget.titleAr.toLocaleLowerCase('ar').includes(needle) || widget.description.toLocaleLowerCase('ar').includes(needle);
  });

  if (!open) return null;

  const move = (key: string, offset: number) => {
    setDraftKeys(current => {
      const from = current.indexOf(key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const dropBefore = (event: DragEvent, targetKey: string) => {
    event.preventDefault();
    if (!draggedKey || draggedKey === targetKey) return;
    setDraftKeys(current => {
      const next = current.filter(key => key !== draggedKey);
      next.splice(next.indexOf(targetKey), 0, draggedKey);
      return next;
    });
    setDraggedKey(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draftKeys);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ تخطيط اللوحة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-end bg-slate-950/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label="تخصيص لوحة المتابعة">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="إغلاق نافذة التخصيص" />
      <section className="relative flex h-full w-full max-w-5xl flex-col bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <h2 className="text-lg font-black text-slate-900">تخصيص لوحة المتابعة</h2>
            <p className="mt-1 text-xs text-slate-500">اختر ما يفيد عملك ورتّبه بالطريقة التي تناسبك.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,0.8fr)_minmax(420px,1.2fr)]">
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white p-5 lg:border-b-0 lg:border-l lg:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div><h3 className="font-black text-slate-800">العناصر المختارة</h3><p className="text-xs text-slate-500">{selected.length} عنصر</p></div>
              <button type="button" onClick={() => setDraftKeys(defaultKeys)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><RotateCcw className="h-3.5 w-3.5" />الافتراضي</button>
            </div>
            <div className="space-y-2">
              {selected.map((widget, index) => (
                <div key={widget.key} draggable onDragStart={() => setDraggedKey(widget.key)} onDragOver={event => event.preventDefault()} onDrop={event => dropBefore(event, widget.key)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <GripVertical className="h-4 w-4 cursor-grab text-slate-400" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{widget.titleAr}</p><p className="truncate text-[11px] text-slate-500">{widget.department}</p></div>
                  <button type="button" onClick={() => move(widget.key, -1)} disabled={index === 0} className="rounded-md p-1.5 text-slate-400 hover:bg-white disabled:opacity-25" aria-label={`رفع ${widget.titleAr}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => move(widget.key, 1)} disabled={index === selected.length - 1} className="rounded-md p-1.5 text-slate-400 hover:bg-white disabled:opacity-25" aria-label={`خفض ${widget.titleAr}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setDraftKeys(keys => keys.filter(key => key !== widget.key))} className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50" aria-label={`حذف ${widget.titleAr}`}><X className="h-4 w-4" /></button>
                </div>
              ))}
              {selected.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">لم تختر أي عنصر بعد.</div>}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5 lg:p-6">
            <div className="sticky top-0 z-10 -mx-1 mb-4 bg-slate-50 px-1 pb-3">
              <h3 className="mb-3 font-black text-slate-800">العناصر المتاحة</h3>
              <label className="relative block"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث عن مؤشر أو مخطط" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{departments.map(name => <button key={name} type="button" onClick={() => setDepartment(name)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${department === name ? 'bg-sky-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-sky-200'}`}>{name}</button>)}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {available.map(widget => {
                const ChartIcon = widget.kind && widget.kind !== 'kpi' ? BarChart3 : LayoutGrid;
                return <article key={widget.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start gap-3"><span className="rounded-lg bg-sky-50 p-2 text-sky-600"><ChartIcon className="h-4 w-4" /></span><div className="min-w-0"><h4 className="text-sm font-black text-slate-800">{widget.titleAr}</h4><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{widget.description}</p></div></div><button type="button" onClick={() => setDraftKeys(keys => [...keys, widget.key])} className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-sky-200 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-50"><Plus className="h-3.5 w-3.5" />إضافة</button></article>;
              })}
              {available.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400">لا توجد عناصر أخرى مطابقة.</p>}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
          <p className="text-xs text-slate-500">يمكنك تغيير الاختيارات لاحقاً في أي وقت.</p>
          <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button><button type="button" onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'جارٍ الحفظ…' : 'حفظ التخطيط'}</button></div>
          {error && <p className="absolute bottom-16 left-6 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        </footer>
      </section>
    </div>
  );
}
