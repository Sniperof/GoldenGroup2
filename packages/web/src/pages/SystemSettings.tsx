import { useState } from 'react';
import { motion } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import { Settings, Database, Trash2, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import Button from '../components/ui/Button';

export default function SystemSettings() {
    const { hasPermission } = usePermissions();
    const [isClearing, setIsClearing] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const canManageSettings = hasPermission('settings.manage');

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
