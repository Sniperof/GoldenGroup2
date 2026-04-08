import { useState, useEffect } from 'react';
import { AlertTriangle, Eye, Calendar, User, Smartphone, AlertCircle, CheckCircle2, Clock, Battery, FileText, Phone, Droplets, Zap, Gauge, PenTool, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { MaintenanceRequest } from '../../lib/types';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef, FilterDef } from '../../components/SmartTable';
import { AnimatePresence, motion } from 'framer-motion';

const priorityConfig = {
    Critical: { label: 'حرج جداً', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle },
    High: { label: 'مرتفع', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', icon: AlertTriangle },
    Normal: { label: 'اعتيادي', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: Clock },
};

const statusConfig = {
    Pending: { label: 'قيد الانتظار', style: 'bg-gray-50 text-slate-600 border-gray-200' },
    Postponed: { label: 'مؤجل', style: 'bg-amber-50 text-amber-700 border-amber-200' },
    'Solved Remote': { label: 'حل عن بعد', style: 'bg-purple-50 text-purple-700 border-purple-200' },
    Completed: { label: 'مكتمل', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export default function Emergency() {
    const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<MaintenanceRequest | null>(null);
    const [activeTab, setActiveTab] = useState<'details' | 'report' | 'calls'>('details');

    useEffect(() => {
        Promise.all([
            api.maintenanceRequests.list(),
            api.employees.list(),
        ])
            .then(([reqData, empData]) => {
                setRequests(reqData);
                setEmployees(empData);
            })
            .catch(err => console.error('Failed to fetch data:', err))
            .finally(() => setLoading(false));
    }, []);

    const technicians = employees.filter(e => e.role === 'technician');
    const telemarketers = employees.filter(e => e.role === 'telemarketer');

    const columns: ColumnDef<MaintenanceRequest>[] = [
        { key: 'id', label: 'ID', sortable: true, render: (r) => <span className="font-mono text-xs text-slate-500">#{r.id}</span> },
        {
            key: 'requestDate', label: 'تاريخ الطلب', sortable: true,
            render: (r) => (
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-700">{new Date(r.requestDate).toLocaleDateString('ar-SY')}</span>
                    <span className="text-[10px] text-slate-400">{new Date(r.requestDate).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            )
        },
        {
            key: 'customerName', label: 'الزبون والجهاز', sortable: true,
            render: (r) => (
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-800">{r.customerName}</span>
                    <span className="text-xs text-slate-500">{r.deviceModelName}</span>
                </div>
            )
        },
        {
            key: 'telemarketerId', label: 'المتابعة (الصبية)',
            render: (r) => {
                const tm = telemarketers.find(e => e.id === (r.telemarketerId || -1));
                return tm ? (
                    <div className="flex items-center gap-1.5">
                        <img src={tm.avatar} className="w-5 h-5 rounded-full" alt="" />
                        <span className="text-xs text-slate-600">{tm.name}</span>
                    </div>
                ) : <span className="text-xs text-slate-300">--</span>;
            }
        },
        {
            key: 'technicianId', label: 'الفني المسؤول',
            render: (r) => {
                const tech = technicians.find(e => e.id === (r.technicianId || -1));
                return tech ? (
                    <div className="flex items-center gap-1.5">
                        <img src={tech.avatar} className="w-5 h-5 rounded-full" alt="" />
                        <span className="text-xs text-slate-600">{tech.name}</span>
                    </div>
                ) : <span className="text-xs text-slate-300">--</span>;
            }
        },
        {
            key: 'priority', label: 'الأولوية', sortable: true,
            render: (r) => {
                const safePriority = r.priority || 'Normal';
                const p = priorityConfig[safePriority] || priorityConfig['Normal'];
                const Icon = p.icon;
                return (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full border ${p.bg} ${p.border} ${p.color} w-fit`}>
                        <Icon className="w-3 h-3" />
                        <span className="text-[10px] font-bold">{p.label}</span>
                    </div>
                );
            }
        },
        {
            key: 'resolutionStatus', label: 'الحالة', sortable: true,
            render: (r) => {
                const safeStatus = r.resolutionStatus || 'Pending';
                const s = statusConfig[safeStatus] || statusConfig['Pending'];
                return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${s.style}`}>{s.label}</span>;
            }
        },
    ];

    const filters: FilterDef[] = [
        { key: 'priority', label: 'الأولوية', options: [{ value: 'Critical', label: 'حرج جداً' }, { value: 'High', label: 'مرتفع' }, { value: 'Normal', label: 'اعتيادي' }] },
        { key: 'resolutionStatus', label: 'حالة الطلب', options: Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label })) },
        { key: 'telemarketerId', label: 'الصبية المسؤولة', options: telemarketers.map(t => ({ value: String(t.id), label: t.name })) },
    ];

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
            </div>
        );
    }

    return (
        <>
            <SmartTable<MaintenanceRequest>
                title="لوحة الطوارئ (Emergency Board)"
                icon={AlertTriangle}
                data={requests}
                columns={columns}
                filters={filters}
                searchKeys={['customerName', 'deviceModelName', 'id']}
                searchPlaceholder="بحث برقم الطلب، الزبون، أو الجهاز..."
                getId={(r) => r.id}
                onRowClick={(r) => { setSelectedRequest(r); setActiveTab('details'); }}
                emptyIcon={AlertTriangle}
                emptyMessage="لا توجد طلبات صيانة طارئة"
                headerActions={
                    <div className="flex gap-2">
                        <div className="bg-red-50 text-red-600 px-3 py-1 rounded-lg text-xs font-bold border border-red-100 flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
                            {requests.filter(r => r.priority === 'Critical' && r.resolutionStatus === 'Pending').length} حالات حرجة
                        </div>
                    </div>
                }
            />

            {/* Details Modal */}
            <AnimatePresence>
                {selectedRequest && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedRequest(null)}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-slate-50/50">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                                        طلب صيانة #{selectedRequest.id}
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1">{selectedRequest.customerName} — {selectedRequest.deviceModelName}</p>
                                </div>
                                <button onClick={() => setSelectedRequest(null)} className="p-1 hover:bg-slate-200 rounded-full transition-colors">✕</button>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-gray-100 px-5 gap-6">
                                <button onClick={() => setActiveTab('details')} className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    <FileText className="w-4 h-4 inline-block ml-1" /> التفاصيل
                                </button>
                                <button onClick={() => setActiveTab('report')} className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'report' ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    <Battery className="w-4 h-4 inline-block ml-1" /> التقرير الفني
                                </button>
                                <button onClick={() => setActiveTab('calls')} className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'calls' ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    <Phone className="w-4 h-4 inline-block ml-1" /> سجل الاتصالات
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-6 overflow-y-auto flex-1">
                                {activeTab === 'details' && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="text-xs text-slate-400 block mb-1">تاريخ الطلب</span>
                                                <div className="flex items-center gap-2 text-slate-700 font-medium text-sm">
                                                    <Calendar className="w-4 h-4 text-slate-400" />
                                                    {new Date(selectedRequest.requestDate).toLocaleString('ar-SY')}
                                                </div>
                                            </div>
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="text-xs text-slate-400 block mb-1">الموقع</span>
                                                <div className="flex items-center gap-2 text-slate-700 font-medium text-sm">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                                    {selectedRequest.location}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <h4 className="text-sm font-bold text-slate-800">وصف المشكلة</h4>
                                            <div className="p-4 bg-red-50/50 border border-red-100 rounded-xl text-slate-700 text-sm leading-relaxed">
                                                "{selectedRequest.problemDescription}"
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                                            <div>
                                                <span className="text-xs text-slate-400 block mb-2">الفني المسؤول</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                                                        <User className="w-4 h-4 text-slate-500" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-700">
                                                            {technicians.find(t => t.id === selectedRequest.technicianId)?.name || 'غير محدد'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400">فني صيانة</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-xs text-slate-400 block mb-2">الصبية المتابعة</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
                                                        <Smartphone className="w-4 h-4 text-pink-500" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-700">
                                                            {telemarketers.find(t => t.id === selectedRequest.telemarketerId)?.name || 'غير محدد'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400">Telemarketer</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'report' && (
                                    selectedRequest.technicalReport ? (
                                        <div className="space-y-6">
                                            {/* Water Readings Card */}
                                            <div className="bg-white border border-blue-100 rounded-xl overflow-hidden shadow-sm">
                                                <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex items-center gap-2">
                                                    <Droplets className="w-5 h-5 text-blue-500" />
                                                    <h3 className="text-sm font-bold text-slate-800">مؤشرات المياه (Water Readings)</h3>
                                                </div>
                                                <div className="p-4 grid grid-cols-2 gap-4">
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">المصدر</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.water.sourceType}</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">ضغط الدخول</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.water.inputPressure} Bar</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">TDS الدخول</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.water.tdsBefore} PPM</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">TDS الخروج</span>
                                                        <div className="font-bold text-emerald-600 text-sm">{selectedRequest.technicalReport.water.tdsAfter} PPM</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Components Health Card */}
                                            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                                                    <Gauge className="w-5 h-5 text-slate-500" />
                                                    <h3 className="text-sm font-bold text-slate-800">حالة القطع (Components Health)</h3>
                                                </div>
                                                <div className="p-4 grid grid-cols-2 gap-4">
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">ضغط المضخة</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.components.pumpPressure} Bar</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">الممبرين production</span>
                                                        <div className={`font-bold text-sm ${selectedRequest.technicalReport.components.membraneOutput === 'Good' ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {selectedRequest.technicalReport.components.membraneOutput}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">Flow Restrictor</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.components.flowRestrictor} cc</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">ضغط الخزان</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.components.tankPressure} Bar</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Electrical & Safety Card */}
                                            <div className="bg-white border border-amber-100 rounded-xl overflow-hidden shadow-sm">
                                                <div className="bg-amber-50/50 px-4 py-3 border-b border-amber-100 flex items-center gap-2">
                                                    <Zap className="w-5 h-5 text-amber-500" />
                                                    <h3 className="text-sm font-bold text-slate-800">الكهرباء والأمان (Safety)</h3>
                                                </div>
                                                <div className="p-4 grid grid-cols-2 gap-4">
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">Low Pressure Sw</span>
                                                        <div className={`font-bold text-sm ${selectedRequest.technicalReport.electrical.lowPressureSwitch === 'Faulty' ? 'text-red-500' : 'text-slate-700'}`}>
                                                            {selectedRequest.technicalReport.electrical.lowPressureSwitch}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">High Pressure Sw</span>
                                                        <div className={`font-bold text-sm ${selectedRequest.technicalReport.electrical.highPressureSwitch === 'Faulty' ? 'text-red-500' : 'text-slate-700'}`}>
                                                            {selectedRequest.technicalReport.electrical.highPressureSwitch}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">Solenoid Valve</span>
                                                        <div className="font-semibold text-slate-700 text-sm">{selectedRequest.technicalReport.electrical.solenoidValve}</div>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-slate-400 block mb-1">UV System</span>
                                                        <div className={`font-bold text-sm ${selectedRequest.technicalReport.electrical.uvStatus === 'Working' ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {selectedRequest.technicalReport.electrical.uvStatus}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Tech Notes */}
                                            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <PenTool className="w-4 h-4 text-yellow-600" />
                                                    <h3 className="text-sm font-bold text-yellow-800">ملاحظات الفني & التوصيات</h3>
                                                </div>
                                                <p className="text-sm text-slate-700 mb-2 font-medium">"{selectedRequest.technicalReport.technicianNotes}"</p>
                                                <div className="text-xs text-slate-500 bg-white/50 p-2 rounded-lg border border-yellow-100">
                                                    <strong>توصية: </strong> {selectedRequest.technicalReport.recommendations}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4 text-center py-8">
                                            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                                <Battery className="w-8 h-8 text-gray-400" />
                                            </div>
                                            <p className="text-slate-500 font-medium">لم يتم رفع تقرير فني بعد</p>
                                        </div>
                                    )
                                )}

                                {activeTab === 'calls' && (
                                    <div className="space-y-4">
                                        {[1, 2].map((_, i) => (
                                            <div key={i} className="flex gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                                                    <Phone className="w-4 h-4 text-green-600" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-sm font-bold text-slate-700">مكالمة صادرة - متابعة</span>
                                                        <span className="text-[10px] text-slate-400">منذ ساعتين</span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-1">تم الاتصال بالزبون للتأكد من وصول الفني. الزبون أكد الوصول والبدء بالعمل.</p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">مدة المكالمة: 02:15</span>
                                                        <span className="text-[10px] text-slate-400">سها جميل</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
