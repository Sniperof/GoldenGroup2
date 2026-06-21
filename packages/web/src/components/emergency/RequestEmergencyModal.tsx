import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Image, Loader2, Paperclip, Send, Video, X, Zap } from 'lucide-react';
import IconButton from '../ui/IconButton';
import Select from '../ui/Select';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/uploadFile';

interface Contract {
  id: number;
  contractNumber: string;
  deviceModelName: string;
  installationAddressText?: string | null;
  status: string;
}

interface Props {
  clientId: number;
  clientName: string;
  clientRating?: string | null;
  contracts: Contract[];
  onClose: () => void;
  onCreated: (ticketId: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function validateVideo(file: File): Promise<string | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (video.duration > 20) resolve(`مدة الفيديو ${video.duration.toFixed(0)} ثانية — الحد الأقصى 20 ثانية`);
      else resolve(null);
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RequestEmergencyModal({ clientId, clientName, clientRating, contracts, onClose, onCreated }: Props) {
  const [actionTypes, setActionTypes]       = useState<{ id: number; arabicLabel: string }[]>([]);
  const [actionTypeId, setActionTypeId]     = useState<number | ''>('');
  const [problemDesc, setProblemDesc]       = useState('');
  const [priority, setPriority]             = useState<'Critical' | 'High' | 'Normal'>('High');
  const [contractId, setContractId]         = useState<number | ''>(contracts.length === 1 ? contracts[0].id : '');
  const [attachments, setAttachments]       = useState<{ file: File; url?: string; uploading: boolean; error?: string; type: 'image' | 'video' }[]>([]);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState('');
  const photoInputRef                       = useRef<HTMLInputElement>(null);
  const videoInputRef                       = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.admin.emergencyActionTypes.active().then(setActionTypes).catch(() => {});
  }, []);

  const descRequired = !actionTypeId;
  const photos = attachments.filter(a => a.type === 'image');
  const videos = attachments.filter(a => a.type === 'video');
  const canAddPhoto = photos.length < 3;
  const canAddVideo = videos.length < 1;

  const addFiles = async (files: FileList | null, type: 'image' | 'video') => {
    if (!files) return;
    const newItems = Array.from(files).slice(0, type === 'image' ? 3 - photos.length : 1);
    const pending = newItems.map(f => ({ file: f, uploading: true, type }));
    setAttachments(prev => [...prev, ...pending]);

    for (const item of pending) {
      // Video duration check
      if (type === 'video') {
        const err = await validateVideo(item.file);
        if (err) {
          setAttachments(prev => prev.map(a => a.file === item.file ? { ...a, uploading: false, error: err } : a));
          continue;
        }
      }
      try {
        const url = await uploadFile(item.file);
        setAttachments(prev => prev.map(a => a.file === item.file ? { ...a, url, uploading: false } : a));
      } catch (e: any) {
        setAttachments(prev => prev.map(a => a.file === item.file ? { ...a, uploading: false, error: e.message } : a));
      }
    }
  };

  const removeAttachment = (file: File) => setAttachments(prev => prev.filter(a => a.file !== file));

  const handleSubmit = async () => {
    if (descRequired && !problemDesc.trim()) { setError('وصف المشكلة مطلوب عند عدم تحديد نوع الإجراء'); return; }
    if (attachments.some(a => a.uploading)) { setError('انتظر اكتمال رفع الملفات'); return; }
    if (attachments.some(a => a.error)) { setError('يوجد ملفات بها أخطاء — احذفها أو استبدلها'); return; }

    const selectedContract = contracts.find(c => c.id === contractId);
    setSaving(true);
    setError('');
    try {
      const ticket = await api.emergencyTickets.create({
        clientId,
        clientName,
        clientRating: clientRating || 'Undefined',
        contractId:   contractId   || null,
        deviceModelName: selectedContract?.deviceModelName || null,
        clientAddress: selectedContract?.installationAddressText || null,
        problemDescription: problemDesc.trim() || null,
        actionTypeId: actionTypeId || null,
        priority,
        attachments: attachments.filter(a => a.url).map(a => ({ url: a.url!, type: a.type, name: a.file.name })),
        dueWithinHours: 48,
      });
      onCreated(ticket.id);
    } catch (err: any) {
      setError(err.message || 'تعذر إرسال الطلب');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      dir="rtl" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 bg-rose-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">طلب صيانة طارئة</h3>
              <p className="text-xs text-slate-500 mt-0.5">{clientName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              <Clock className="h-3 w-3" /> 48 ساعة
            </span>
            <IconButton icon={X} label="إغلاق" size="sm" onClick={onClose} />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Contract */}
          {contracts.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">العقد / الجهاز</label>
              <Select
                value={contractId === '' ? '' : String(contractId)}
                onChange={v => setContractId(v === '' ? '' : Number(v))}
                placeholder="— اختر العقد —"
                ariaLabel="العقد / الجهاز"
                className="w-full"
                options={contracts.map(c => ({ value: String(c.id), label: `${c.contractNumber} — ${c.deviceModelName || 'جهاز'}` }))}
              />
              {contractId && contracts.find(c => c.id === contractId)?.installationAddressText && (
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <span className="font-bold text-slate-500">موقع الجهاز:</span>
                  {contracts.find(c => c.id === contractId)?.installationAddressText}
                </p>
              )}
            </div>
          )}

          {/* Action type */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              نوع الإجراء المطلوب
              <span className="font-normal text-slate-400 mr-1">(اختياري)</span>
            </label>
            <Select
              value={actionTypeId === '' ? '' : String(actionTypeId)}
              onChange={v => setActionTypeId(v === '' ? '' : Number(v))}
              placeholder="— لم يُحدَّد —"
              ariaLabel="نوع الإجراء"
              className="w-full"
              options={actionTypes.map(t => ({ value: String(t.id), label: t.arabicLabel }))}
            />
          </div>

          {/* Problem description */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              وصف المشكلة
              {descRequired
                ? <span className="text-red-500 mr-1">* مطلوب</span>
                : <span className="font-normal text-slate-400 mr-1">(اختياري)</span>}
            </label>
            <textarea
              value={problemDesc}
              onChange={e => setProblemDesc(e.target.value)}
              rows={3}
              placeholder="اشرح المشكلة بالتفصيل..."
              className={`w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 resize-none ${
                descRequired && !problemDesc.trim()
                  ? 'border-amber-300 focus:border-amber-400 focus:ring-amber-400/20'
                  : 'border-slate-200 focus:border-rose-400 focus:ring-rose-400/20'
              }`}
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">الأولوية</label>
            <div className="flex gap-2">
              {([
                { v: 'Critical', label: 'حرجة',   cls: 'border-red-400 bg-red-500 text-white' },
                { v: 'High',     label: 'عالية',   cls: 'border-amber-400 bg-amber-500 text-white' },
                { v: 'Normal',   label: 'عادية',   cls: 'border-slate-400 bg-slate-500 text-white' },
              ] as { v: 'Critical'|'High'|'Normal'; label: string; cls: string }[]).map(opt => (
                <button key={opt.v} type="button"
                  onClick={() => setPriority(opt.v)}
                  className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                    priority === opt.v ? opt.cls : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              المرفقات
              <span className="font-normal text-slate-400 mr-1">(اختيارية — حتى 3 صور + فيديو واحد ≤20 ثانية)</span>
            </label>

            {/* Upload buttons */}
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => photoInputRef.current?.click()}
                disabled={!canAddPhoto}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-xs font-bold text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <Image className="h-3.5 w-3.5" />
                صور ({photos.length}/3)
              </button>
              <button type="button" onClick={() => videoInputRef.current?.click()}
                disabled={!canAddVideo}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-xs font-bold text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <Video className="h-3.5 w-3.5" />
                فيديو ({videos.length}/1)
              </button>
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => addFiles(e.target.files, 'image')} />
            <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
              onChange={e => addFiles(e.target.files, 'video')} />

            {/* File list */}
            {attachments.length > 0 && (
              <div className="space-y-1.5">
                {attachments.map((a, i) => (
                  <div key={i} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    a.error ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'
                  }`}>
                    {a.type === 'image' ? <Image className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <Video className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                    <span className="flex-1 truncate font-medium text-slate-700">{a.file.name}</span>
                    <span className="text-slate-400 shrink-0">{formatFileSize(a.file.size)}</span>
                    {a.uploading && <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500 shrink-0" />}
                    {a.url && !a.error && <span className="text-emerald-500 shrink-0">✓</span>}
                    {a.error && <span className="text-red-600 shrink-0 max-w-[120px] truncate" title={a.error}>!</span>}
                    <button onClick={() => removeAttachment(a.file)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Policy note */}
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>سياسة الشركة: يجب تنفيذ الصيانة الطارئة خلال <strong>48 ساعة</strong> من تسجيل الطلب.</span>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-100 px-5 py-4 shrink-0">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">إلغاء</button>
          <button onClick={handleSubmit} disabled={saving || attachments.some(a => a.uploading)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 shadow-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? 'جاري الإرسال...' : 'إرسال الطلب'}
          </button>
        </div>
      </div>
    </div>
  );
}
