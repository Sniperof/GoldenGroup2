import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquareWarning, Plus, Search } from 'lucide-react';
import Button from '../../components/ui/Button';
import { usePermissions } from '../../hooks/usePermissions';
import { complaintsApi } from './complaintsApi';

const STATUS: Record<string,string>={new:'جديدة',triaged:'تم الفرز',assigned:'معيّنة',in_progress:'قيد المعالجة',awaiting_complainant:'بانتظار المشتكي',resolved:'محلولة',closed:'مغلقة',rejected:'مرفوضة',withdrawn:'مسحوبة'};
const TYPES:Record<string,string>={technical:'فنية',device:'جهاز',general:'عامة'};
const PRIORITY:Record<string,string>={critical:'حرجة',high:'عالية',normal:'عادية',low:'منخفضة'};

export default function ComplaintsListPage(){
  const navigate=useNavigate(); const {hasPermission}=usePermissions();
  const [items,setItems]=useState<any[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [type,setType]=useState('');
  const load=async()=>{setLoading(true);setError('');try{const q=new URLSearchParams({page:'1',pageSize:'100'});if(search)q.set('search',search);if(status)q.set('status',status);if(type)q.set('type',type);const r=await complaintsApi.list(q);setItems(r.items);}catch(e){setError((e as Error).message);}finally{setLoading(false);}};
  useEffect(()=>{void load();},[status,type]);
  return <div dir="rtl" className="p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-50 p-3 text-amber-600"><MessageSquareWarning/></div><div><h1 className="text-2xl font-bold text-slate-900">إدارة الشكاوى</h1><p className="text-sm text-slate-500">نطاق مستقل لمعالجة الشكاوى ومتابعة حالاتها</p></div></div>{hasPermission('complaints.create_internal')&&<Button icon={Plus} onClick={()=>navigate('/complaints/new')}>تسجيل شكوى</Button>}</div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3"><div className="relative min-w-64 flex-1"><Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void load()} placeholder="رقم الشكوى، الاسم أو الهاتف" className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3"/></div><select value={type} onChange={e=>setType(e.target.value)} className="rounded-lg border border-slate-200 px-3"><option value="">كل الأنواع</option>{Object.entries(TYPES).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-3"><option value="">كل الحالات</option>{Object.entries(STATUS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><Button variant="secondary" onClick={()=>void load()}>بحث</Button></div>
    {error&&<div className="rounded-lg bg-red-50 p-3 text-red-700">{error}</div>}
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['رقم الشكوى','النوع','المصدر','مقدم الشكوى','تاريخ التقديم','الحالة','الأولوية','فرع المعالجة',''].map(x=><th key={x} className="p-3 text-right font-semibold">{x}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={9} className="p-10 text-center text-slate-500">جار التحميل...</td></tr>:items.length===0?<tr><td colSpan={9} className="p-10 text-center text-slate-500">لا توجد شكاوى مطابقة</td></tr>:items.map(r=><tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="p-3 font-mono font-semibold">{r.complaintId}</td><td className="p-3">{TYPES[r.complaintType]??r.complaintType}</td><td className="p-3">{r.sourceChannel}</td><td className="p-3">{r.requesterName}</td><td className="p-3">{new Date(r.complaintDate).toLocaleDateString('ar-SY')}</td><td className="p-3"><span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">{STATUS[r.status]??r.status}</span></td><td className="p-3">{PRIORITY[r.priority]??r.priority}</td><td className="p-3">{r.handlingBranchName??'غير معيّن'}</td><td className="p-3"><Link className="text-sky-600 hover:underline" to={`/complaints/${r.id}`}>التفاصيل</Link></td></tr>)}</tbody></table></div>
  </div>;
}
