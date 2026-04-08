import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, UserCheck, Route, MapPin, TrendingUp, Clock } from 'lucide-react';
import { api } from '../lib/api';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

export default function Dashboard() {
    const [loading, setLoading] = useState(true);
    const [dashboardData, setDashboardData] = useState<any>(null);
    const [employees, setEmployees] = useState<any[]>([]);

    useEffect(() => {
        Promise.all([
            api.dashboard.get(),
            api.employees.list(),
        ]).then(([dashboard, emps]) => {
            setDashboardData(dashboard);
            setEmployees(emps);
        }).finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-slate-500 text-lg">جاري التحميل...</p>
            </div>
        );
    }

    const stats = [
        { label: 'الزبائن', value: dashboardData?.totalClients ?? 0, icon: Users, color: 'from-sky-500 to-blue-600', delta: '+12%' },
        { label: 'الموظفون النشطون', value: dashboardData?.activeEmployees ?? 0, icon: UserCheck, color: 'from-emerald-500 to-teal-600', delta: '+3' },
        { label: 'المسارات', value: dashboardData?.totalRoutes ?? 0, icon: Route, color: 'from-amber-500 to-orange-600', delta: `${dashboardData?.totalRoutes ?? 0}` },
        { label: 'الأحياء المغطاة', value: dashboardData?.coveredNeighborhoods ?? 0, icon: MapPin, color: 'from-rose-500 to-pink-600', delta: 'محطة' },
    ];

    const recentClients = dashboardData?.recentClients ?? [];
    const activeSupervisors = employees.filter((e: any) => e.role === 'supervisor' && e.status === 'active').length;
    const activeTechnicians = employees.filter((e: any) => e.role === 'technician' && e.status === 'active').length;

    return (
        <div className="h-full overflow-y-auto p-8 custom-scroll">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 mb-1">نظرة عامة</h1>
                <p className="text-slate-500 text-sm">نظرة عامة على أداء النظام والبيانات.</p>
            </div>

            {/* Stats Grid */}
            <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
                {stats.map((s, i) => (
                    <motion.div key={i} variants={item} className="bg-white shadow-sm border border-gray-200 rounded-xl p-5 hover:shadow-md transition-all group">
                        <div className="flex items-center justify-between mb-4">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-lg`}>
                                <s.icon className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-bold border border-emerald-100">{s.delta}</span>
                        </div>
                        <p className="text-2xl font-bold text-slate-800">{s.value}</p>
                        <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                    </motion.div>
                ))}
            </motion.div>

            {/* Recent Activity Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden h-full">
                    <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
                        <Clock className="w-4 h-4 text-sky-500" />
                        <h3 className="text-slate-700 font-bold text-sm">آخر الزبائن المسجلين</h3>
                    </div>
                    <div className="p-4">
                        {recentClients.length === 0 ? (
                            <p className="text-center text-slate-400 py-6 text-sm">لا توجد بيانات بعد</p>
                        ) : (
                            <div className="space-y-3">
                                {recentClients.map((c: any) => (
                                    <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-sky-50 transition-colors cursor-pointer group">
                                        <div className="relative">
                                            <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(c?.name || '')}&background=0ea5e9&color=fff&size=32`} alt="" className="w-9 h-9 rounded-full border border-gray-100 group-hover:border-sky-200 transition-colors" />
                                            <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${c?.candidateStatus === 'Qualified' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-slate-800 font-semibold truncate group-hover:text-sky-700 transition-colors">{c?.name || 'بدون اسم'}</p>
                                            <p className="text-xs text-slate-500">{c?.mobile || '--'}</p>
                                        </div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${c?.candidateStatus === 'Qualified' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                            {c?.candidateStatus === 'Qualified' ? 'فعّال' : 'جديد'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden h-full">
                    <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
                        <TrendingUp className="w-4 h-4 text-sky-500" />
                        <h3 className="text-slate-700 font-bold text-sm">ملخص سريع</h3>
                    </div>
                    <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors">
                            <span className="text-sm text-slate-600 font-medium">المشرفون المتاحون</span>
                            <span className="text-slate-900 font-bold bg-white px-2.5 py-0.5 rounded-md border border-gray-200 shadow-sm">{activeSupervisors}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors">
                            <span className="text-sm text-slate-600 font-medium">الفنيون المتاحون</span>
                            <span className="text-slate-900 font-bold bg-white px-2.5 py-0.5 rounded-md border border-gray-200 shadow-sm">{activeTechnicians}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors">
                            <span className="text-sm text-slate-600 font-medium">المسارات المعرّفة</span>
                            <span className="text-slate-900 font-bold bg-white px-2.5 py-0.5 rounded-md border border-gray-200 shadow-sm">{dashboardData?.totalRoutes ?? 0}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors">
                            <span className="text-sm text-slate-600 font-medium">الزبائن الجدد</span>
                            <span className="text-slate-900 font-bold bg-white px-2.5 py-0.5 rounded-md border border-gray-200 shadow-sm">{recentClients.length}</span>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
