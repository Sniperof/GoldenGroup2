import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useSystemListItems } from '../../hooks/useSystemListItems';
import Button from '../ui/Button';

export default function NameNominationPanel({ request, canDecide, canCreateCandidates, onChanged }:{
  request:any; canDecide:boolean; canCreateCandidates:boolean; onChanged:()=>Promise<void>|void;
}) {
  const items=Array.isArray(request.nameNominationItems)?request.nameNominationItems:[];
  const [selected,setSelected]=useState<number[]>([]);
  const [reasonId,setReasonId]=useState('');
  const [busy,setBusy]=useState(false);
  const {items:reasons}=useSystemListItems('name_nomination_item_exclusion_reasons');
  const pending=useMemo(()=>items.filter((item:any)=>item.status==='pending'),[items]);
  const toggle=(id:number)=>setSelected((current)=>current.includes(id)?current.filter((x)=>x!==id):[...current,id]);
  async function run(action:()=>Promise<any>,message:string){
    setBusy(true); try{await action();toast.success(message);setSelected([]);await onChanged();}
    catch(error:any){toast.error(error?.message||'تعذر تنفيذ الإجراء');} finally{setBusy(false);}
  }
  return <div className="space-y-3" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-sm font-semibold text-slate-700">الأسماء: {items.length} · قيد المراجعة: {pending.length}</div>
      {request.status==='in_review'&&canDecide&&<div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={()=>run(()=>api.serviceRequests.refreshNameNominationBranches(request.id),'تم تحديث تغطية الفروع')}>تحديث تغطية الفروع</Button>
        <Button size="sm" disabled={busy||!selected.length||!canCreateCandidates} title={!canCreateCandidates?'تتطلب candidates.create بنطاق GLOBAL':''}
          onClick={()=>run(()=>api.serviceRequests.convertNameNominationItems(request.id,selected),'تم تحويل الأسماء المحددة')}>تحويل المحدد لأسماء مقترحة</Button>
        <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={reasonId} onChange={(e)=>setReasonId(e.target.value)}>
          <option value="">سبب الاستبعاد</option>{reasons.map((reason)=><option key={reason.id} value={reason.id}>{reason.value}</option>)}
        </select>
        <Button size="sm" variant="danger" disabled={busy||!selected.length||!reasonId}
          onClick={()=>run(()=>api.serviceRequests.skipNameNominationItems(request.id,selected,Number(reasonId)),'تم استبعاد الأسماء المحددة')}>استبعاد المحدد</Button>
      </div>}
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50"><tr>
        <th className="p-3 text-right">اختيار</th><th className="p-3 text-right">الاسم</th><th className="p-3 text-right">الهاتف</th>
        <th className="p-3 text-right">الموقع</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">الحالة</th>
      </tr></thead><tbody className="divide-y divide-slate-100 bg-white">{items.map((item:any)=><tr key={item.id}>
        <td className="p-3"><input type="checkbox" checked={selected.includes(Number(item.id))} disabled={busy||item.status!=='pending'} onChange={()=>toggle(Number(item.id))}/></td>
        <td className="p-3 font-semibold">{[item.firstName,item.lastName].filter(Boolean).join(' ')}</td>
        <td className="p-3" dir="ltr">{item.primaryPhone}</td>
        <td className="p-3">{Object.values(item.geoSnapshot?.labels??{}).filter(Boolean).join(' / ')}</td>
        <td className="p-3">{item.branchName??(item.branchResolutionStatus==='ambiguous'?'تغطية ملتبسة':'خارج التغطية')}</td>
        <td className="p-3">{item.status==='pending'?'قيد المراجعة':item.status==='converted'?`تم التحويل #${item.candidateId}`:`مستبعد: ${item.exclusionReason?.label??''}`}</td>
      </tr>)}</tbody></table>
    </div>
  </div>;
}
