import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import { Settings, Database, Trash2, AlertTriangle, RefreshCw, CheckCircle2, Clock, Save } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import Button from '../components/ui/Button';

export default function SystemSettings() {
    const { hasPermission } = usePermissions();
    const [isClearing, setIsClearing] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const canManageSettings = hasPermission('settings.manage');

    // Daily contact_target auto-close time (DEC-005 D26). Loaded from
    // system_settings; editable only with settings.manage.
    const [cleanupTime, setCleanupTime] = useState('');
    const [savedCleanupTime, setSavedCleanupTime] = useState('');
    const [cleanupLoading, setCleanupLoading] = useState(true);
    const [cleanupSaving, setCleanupSaving] = useState(false);
    const [cleanupMsg, setCleanupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.systemSettings.list()
            .then((res) => {
                if (cancelled) return;
                const row = res.settings.find((s) => s.key === 'contact_target_cleanup_time');
                const value = (row?.value ?? '22:00').slice(0, 5);
                setCleanupTime(value);
                setSavedCleanupTime(value);
            })
            .catch(() => { if (!cancelled) setCleanupMsg({ type: 'err', text: 'تعذّر تحميل الإعداد.' }); })
            .finally(() => { if (!cancelled) setCleanupLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const handleSaveCleanupTime = async () => {
        setCleanupSaving(true);
        setCleanupMsg(null);
        try {
            const res = await api.systemSettings.setContactTargetCleanupTime(cleanupTime);
            setSavedCleanupTime(res.value);
            setCleanupTime(res.value);
            setCleanupMsg({ type: 'ok', text: 'تم الحفظ. سيُطبَّق على الكنس اليومي القادم.' });
        } catch (err: any) {
            setCleanupMsg({ type: 'err', text: err?.message ?? 'فشل الحفظ.' });
        } finally {
            setCleanupSaving(false);
        }
    };

    if (!hasPermission('settings.view')) {
        return <Navigate to="/" replace />;
    }

    const handleClearData = () => {
        setIsClearing(true);
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
                    <Settings className="w-6 h-6 text-slate-600" />
                </div>
                <div>
                    <h1 className="text-2xl mb-1 font-bold text-slate-800">إعدادات النظام</h1>
                    <p className="text-slate-500">تحكم ببيانات النظام والخيارات المتقدمة</p>
                </div>
            </div>

            <div className="space-y-6">
                {/* Telemarketing — daily contact-target auto-close time (DEC-005 D26) */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
                >
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                        <Clock className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-lg font-bold text-slate-800">إقفال جهات الاتصال التلقائي</h2>
                    </div>

                    <div className="p-6">
                        <p className="text-xs text-slate-500 leading-relaxed mb-5">
                            الوقت اليومي الذي يُغلق فيه النظام جهات الاتصال المفتوحة من الأيام السابقة تلقائياً
                            (ويعيد مهامها لقيد الانتظار). نظام 24 ساعة.
                        </p>

                        <div className="flex items-end gap-3 flex-wrap">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1.5">وقت الإقفال اليومي</label>
                                <input
                                    type="time"
                                    value={cleanupTime}
                                    onChange={(e) => setCleanupTime(e.target.value)}
                                    disabled={!canManageSettings || cleanupLoading || cleanupSaving}
                                    className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50 disabled:text-slate-400"
                                />
                            </div>
                            <Button
                                variant="primary"
                                icon={Save}
                                onClick={handleSaveCleanupTime}
                                loading={cleanupSaving}
                                disabled={!canManageSettings || cleanupLoading || !cleanupTime || cleanupTime === savedCleanupTime}
                            >
                                حفظ
                            </Button>
                        </div>

                        {cleanupMsg && (
                            <p className={`text-xs font-bold mt-3 ${cleanupMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {cleanupMsg.text}
                            </p>
                        )}
                        {!canManageSettings && (
                            <p className="text-xs text-slate-400 mt-3">للعرض فقط — تعديل الإعداد يحتاج صلاحية «تعديل إعدادات النظام».</p>
                        )}
                    </div>
                </motion.div>

                {/* Data Management Section */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
                >
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                        <Database className="w-5 h-5 text-sky-600" />
                        <h2 className="text-lg font-bold text-slate-800">إدارة البيانات</h2>
                    </div>

                    <div className="p-6">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-4 mb-6">
                            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                            <div>
                                <h3 className="text-base font-bold text-amber-800 mb-1">منطقة الخطر</h3>
                                <p className="text-xs text-amber-700 leading-relaxed">
                                    البيانات مخزنة في قاعدة البيانات. إعادة التحميل ستقوم بتحديث التطبيق وجلب أحدث البيانات من الخادم.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-4 border border-slate-100 rounded-xl bg-white hover:bg-slate-50 transition-colors">
                            <div>
                                <h3 className="text-base font-bold text-slate-800">إعادة ضبط المصنع (حذف الكل)</h3>
                                <p className="text-xs text-slate-500 mt-1">إعادة تحميل التطبيق</p>
                            </div>

                            {!showConfirm ? (
                                <Button
                                    variant="secondary"
                                    icon={Trash2}
                                    onClick={() => setShowConfirm(true)}
                                    disabled={!canManageSettings}
                                    className="text-red-600 border-red-200 hover:bg-red-50"
                                >
                                    حذف البيانات
                                </Button>
                            ) : (
                                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <span className="text-xs text-red-600 font-bold">هل أنت متأكد؟</span>
                                    <Button
                                        variant="danger"
                                        icon={CheckCircle2}
                                        onClick={handleClearData}
                                        loading={isClearing}
                                        disabled={!canManageSettings}
                                    >
                                        تأكيد الحذف
                                    </Button>
                                    <Button variant="ghost" onClick={() => setShowConfirm(false)}>
                                        إلغاء
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
