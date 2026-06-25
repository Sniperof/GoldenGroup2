import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  Wrench,
  PlayCircle,
  Check,
  Plus,
  FileText,
  AlertCircle,
  MapPin,
  Calendar,
  Layers,
  ChevronLeft,
  ExternalLink
} from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../ui/Select';
import Modal from '../ui/Modal';

interface PostSaleStepperProps {
  contract: any;
  tasks: any[];
  onRefresh: () => void;
}

export const PostSaleStepper: React.FC<PostSaleStepperProps> = ({ contract, tasks, onRefresh }) => {
  const navigate = useNavigate();
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Delivery Form State
  const [outcome, setOutcome] = useState<'delivered_successfully' | 'customer_not_available' | 'wrong_address' | 'refused_delivery'>('delivered_successfully');
  const [serialNumber, setSerialNumber] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState(contract.installationAddress || '');
  const [actualDeliveryDate, setActualDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [deliveryCondition, setDeliveryCondition] = useState<'perfect' | 'minor_damage' | 'missing_accessories'>('perfect');
  const [notes, setNotes] = useState('');

  // Find linked tasks for this contract
  const deliveryTask = tasks.find(t => t.contractId === contract.id && t.taskType === 'device_delivery');
  const installationTask = tasks.find(t => t.contractId === contract.id && t.taskType === 'device_installation');
  const activationTask = tasks.find(t => t.contractId === contract.id && t.taskType === 'device_activation');

  const currentStatus = contract.deviceStatus || 'pending_delivery';

  // Determine step states
  const steps = [
    {
      id: 'delivery',
      label: 'تسليم الجهاز',
      description: 'نقل وتوصيل الجهاز للزبون',
      icon: Truck,
      status: currentStatus === 'pending_delivery' ? 'current' : 'completed',
      task: deliveryTask
    },
    {
      id: 'installation',
      label: 'تركيب الجهاز',
      description: 'تركيب الفلاتر والقطع وتثبيته',
      icon: Wrench,
      status: currentStatus === 'pending_delivery' 
        ? 'pending' 
        : currentStatus === 'delivered' ? 'current' : 'completed',
      task: installationTask
    },
    {
      id: 'activation',
      label: 'تشغيل الجهاز',
      description: 'بدء التشغيل وتنشيط العقد',
      icon: PlayCircle,
      status: (currentStatus === 'pending_delivery' || currentStatus === 'delivered')
        ? 'pending'
        : currentStatus === 'installed' ? 'current' : 'completed',
      task: activationTask
    }
  ];

  // CTAs implementation
  const handleCreateInstallationTask = async () => {
    try {
      setLoading(true);
      setError('');
      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await api.openTasks.create({
        clientId: contract.customerId,
        branchId: contract.branchId,
        taskType: 'device_installation',
        taskFamily: 'delivery',
        reason: 'service_request',
        dueDate,
        contractId: contract.id,
        notes: 'مهمة تركيب مجدولة تلقائياً بعد التسليم'
      });
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError('فشل جدولة مهمة التركيب');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateActivationTask = async () => {
    try {
      setLoading(true);
      setError('');
      const expectedDate = new Date().toISOString().split('T')[0];
      const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await api.openTasks.create({
        clientId: contract.customerId,
        branchId: contract.branchId,
        taskType: 'device_activation',
        taskFamily: 'delivery',
        reason: 'service_request',
        expectedDate,
        dueDate,
        priority: 'medium',
        contractId: contract.id,
        notes: 'مهمة تشغيل وتنشيط مجدولة تلقائياً بعد التركيب'
      });
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setError('فشل جدولة مهمة التشغيل');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitDeliveryResult = async () => {
    if (!deliveryTask) {
      setError('لا توجد مهمة تسليم جهاز مرتبطة لتسجيل نتيجتها');
      return;
    }
    const visitId = deliveryTask.fieldVisitId || deliveryTask.marketingVisitId || null;
    if (!visitId) {
      setError('يجب ربط مهمة التسليم بزيارة ميدانية أولاً لتسجيل النتيجة');
      return;
    }
    // Delivery results are recorded from the field visit detail page
    setShowDeliveryModal(false);
    navigate(`/field-visits/${visitId}`);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-50 text-emerald-600 border border-emerald-200';
      case 'open': return 'bg-sky-50 text-sky-600 border border-sky-200';
      case 'assigned': return 'bg-amber-50 text-amber-600 border border-amber-200';
      case 'scheduled': return 'bg-indigo-50 text-indigo-600 border border-indigo-200';
      default: return 'bg-slate-50 text-slate-500 border border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'مكتملة';
      case 'open': return 'مفتوحة';
      case 'assigned': return 'مكلفة لموظف';
      case 'scheduled': return 'مجدولة بزيارة';
      case 'not_completed': return 'لم تكتمل';
      default: return status;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Horizontal Progress Timeline */}
      <div className="relative flex justify-between items-center w-full">
        {/* Connection Bar */}
        <div className="absolute left-[10%] right-[10%] top-[40%] h-0.5 bg-slate-100 -translate-y-1/2 z-0">
          <div 
            className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-500" 
            style={{
              width: currentStatus === 'pending_delivery' 
                ? '0%' 
                : currentStatus === 'delivered' 
                ? '50%' 
                : currentStatus === 'installed' 
                ? '100%' 
                : '100%'
            }}
          />
        </div>

        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center w-[30%] text-center group">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                step.status === 'completed'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : step.status === 'current'
                  ? 'bg-sky-500 text-white shadow-sm animate-pulse'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {step.status === 'completed' ? (
                  <Check className="w-6 h-6" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>
              <span className={`mt-3 font-semibold text-sm transition-colors duration-300 ${
                step.status !== 'pending' ? 'text-slate-800' : 'text-slate-400'
              }`}>{step.label}</span>
              <span className="text-xs text-slate-400 hidden md:block max-w-[120px] mt-1">{step.description}</span>
            </div>
          );
        })}
      </div>

      <div className="h-px bg-slate-100 my-4" />

      {/* Dynamic CTAs / Status Sections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((step) => (
          <div key={step.id} className={`border rounded-xl p-4 space-y-3 transition-all ${
            step.status === 'current'
              ? 'bg-sky-50/50 border-sky-200'
              : step.status === 'completed'
              ? 'bg-emerald-50/30 border-emerald-100 opacity-80'
              : 'bg-slate-50/50 border-slate-100 opacity-60'
          }`}>
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm text-slate-800">{step.label}</h4>
              {step.task && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(step.task.status)}`}>
                  {getStatusLabel(step.task.status)}
                </span>
              )}
            </div>

            {/* Task Info or CTAs */}
            {step.task ? (
              <div className="text-xs text-slate-600 space-y-1 bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="flex justify-between">
                  <span>تاريخ الجدولة:</span>
                  <span className="font-semibold text-slate-800">{step.task.dueDate || 'غير محدد'}</span>
                </div>
                {step.task.assignments && step.task.assignments.length > 0 && (
                  <div className="flex justify-between">
                    <span>الموظف المكلف:</span>
                    <span className="font-semibold text-slate-800">{step.task.assignments[0].userName}</span>
                  </div>
                )}
                {step.task.visitStatus && (
                  <div className="flex justify-between">
                    <span>حالة الزيارة:</span>
                    <span className="text-sky-600 font-semibold">{step.task.visitStatus === 'scheduled' ? 'زيارة مجدولة' : step.task.visitStatus}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">لا توجد مهمة مجدولة حالياً</p>
            )}

            {/* Action Buttons */}
            {step.status === 'current' && (
              <div className="pt-2">
                {step.id === 'delivery' && (
                  <button
                    onClick={() => {
                      if (!deliveryTask?.marketingVisitId) {
                        setError('يرجى جدولة زيارة تسليم لهذه المهمة أولاً لتتمكن من تسجيل نتيجتها');
                        return;
                      }
                      setShowDeliveryModal(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3 rounded-lg transition duration-200 shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    تسجيل نتيجة التسليم
                  </button>
                )}

                {step.id === 'installation' && !step.task && (
                  <button
                    onClick={handleCreateInstallationTask}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3 rounded-lg transition duration-200 disabled:opacity-50 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة مهمة تركيب الجهاز
                  </button>
                )}

                {step.id === 'activation' && !step.task && (
                  <button
                    onClick={handleCreateActivationTask}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3 rounded-lg transition duration-200 disabled:opacity-50 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة مهمة تشغيل الجهاز
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recording Delivery Result Dialog */}
      <Modal
        isOpen={showDeliveryModal}
        onClose={() => setShowDeliveryModal(false)}
        size="lg"
        title={<span className="flex items-center gap-2"><Truck className="w-5 h-5 text-sky-600" />تسجيل نتيجة تسليم الجهاز</span>}
        footer={
          <div className="w-full flex gap-3">
            <button type="button" onClick={handleSubmitDeliveryResult} disabled={loading || (outcome === 'delivered_successfully' && !serialNumber.trim())}
              className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 rounded-xl transition duration-200 disabled:opacity-50 shadow-sm">
              {loading ? 'جاري الحفظ...' : 'تأكيد وحفظ النتيجة'}
            </button>
            <button type="button" onClick={() => setShowDeliveryModal(false)}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl transition duration-200">
              إلغاء
            </button>
          </div>
        }
      >
            <div className="p-6 space-y-3">
              {/* Outcome Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">نتيجة عملية التوصيل</label>
                <Select
                  value={outcome}
                  onChange={v => setOutcome(v as any)}
                  ariaLabel="نتيجة التوصيل"
                  className="w-full"
                  options={[
                    { value: 'delivered_successfully', label: 'تم التسليم بنجاح للعميل' },
                    { value: 'customer_not_available', label: 'العميل غير متوفر في المنزل' },
                    { value: 'wrong_address', label: 'العنوان المسجل خاطئ' },
                    { value: 'refused_delivery', label: 'رفض العميل استلام الجهاز' },
                  ]}
                />
              </div>

              {outcome === 'delivered_successfully' && (
                <>
                  {/* Serial Number */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">الرقم التسلسلي للجهاز (Serial Number)</label>
                    <input
                      type="text"
                      placeholder="أدخل الرقم التسلسلي المكتوب على الجهاز"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-slate-900 rounded-lg p-2.5 text-sm focus:outline-none focus:border-sky-500"
                      required
                    />
                  </div>

                  {/* Operational Condition */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">الحالة التشغيلية عند الاستلام</label>
                    <Select
                      value={deliveryCondition}
                      onChange={v => setDeliveryCondition(v as any)}
                      ariaLabel="الحالة التشغيلية"
                      className="w-full"
                      options={[
                        { value: 'perfect', label: 'سليم وممتاز (Perfect)' },
                        { value: 'minor_damage', label: 'ضرر خارجي طفيف (Minor Damage)' },
                        { value: 'missing_accessories', label: 'نقص في بعض الملحقات (Missing Accessories)' },
                      ]}
                    />
                  </div>
                </>
              )}

              {/* Delivery Address */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">عنوان التسليم الفعلي</label>
                <textarea
                  rows={2}
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 rounded-lg p-2.5 text-sm focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">تاريخ التسليم الفعلي</label>
                <input
                  type="date"
                  value={actualDeliveryDate}
                  onChange={(e) => setActualDeliveryDate(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 rounded-lg p-2.5 text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">ملاحظات إضافية</label>
                <textarea
                  rows={3}
                  placeholder="أية تفاصيل إضافية حول التوصيل أو حالة الاستلام..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-900 rounded-lg p-2.5 text-sm focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>
            </div>
      </Modal>
    </div>
  );
};
