import React, { useState, useEffect, useCallback } from 'react';
import { 
  Truck, 
  Wrench, 
  PlayCircle, 
  CheckCircle2, 
  Search, 
  Filter, 
  Loader2,
  AlertCircle,
  FileText,
  User,
  ShoppingBag,
  Layers
} from 'lucide-react';
import { api } from '../../lib/api';
import { PostSaleStepper } from '../../components/tasks/PostSaleStepper';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import Customer360Modal from '../../components/Customer360Modal';

export default function PostSaleTasksPage() {
  const { branchId } = useBranchContextStore();
  
  const [contracts, setContracts] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters and Search
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending_delivery' | 'delivered' | 'installed' | 'active'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const [contractsData, tasksData] = await Promise.all([
        api.contracts.list(),
        api.openTasks.list({ branchId, taskFamily: 'delivery' })
      ]);
      
      // Filter out cancelled contracts and only keep those that have post-sale tracking (deviceStatus is defined)
      const postSaleContracts = contractsData.filter((c: any) => 
        c.deviceStatus !== null && 
        c.status !== 'cancelled'
      );
      
      setContracts(postSaleContracts);
      setTasks(tasksData);
    } catch (err: any) {
      console.error('Error fetching post-sale services data:', err);
      setError('فشل في تحميل بيانات خدمات ما بعد البيع. يرجى التحقق من اتصال الشبكة.');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Search and Filter
  const filteredContracts = contracts.filter((contract) => {
    const matchesSearch = 
      contract.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.contractNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.deviceModelName?.toLowerCase().includes(searchTerm.toLowerCase());
      
    const currentStatus = contract.deviceStatus || 'pending_delivery';
    const matchesFilter = activeFilter === 'all' || currentStatus === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  // Calculate quick stats
  const stats = {
    total: contracts.length,
    pendingDelivery: contracts.filter(c => (c.deviceStatus || 'pending_delivery') === 'pending_delivery').length,
    pendingInstallation: contracts.filter(c => c.deviceStatus === 'delivered').length,
    pendingActivation: contracts.filter(c => c.deviceStatus === 'installed').length,
    active: contracts.filter(c => c.deviceStatus === 'active').length,
  };

  if (!branchId) {
    return (
      <div className="h-full flex items-center justify-center p-8 bg-slate-50 min-h-screen">
        <div className="text-center space-y-3 bg-white border border-slate-200 rounded-2xl p-8 max-w-md shadow-sm">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h3 className="text-lg font-bold text-slate-900">لم يتم تحديد فرع</h3>
          <p className="text-sm text-slate-500">يرجى اختيار الفرع الفعال من أعلى الشاشة للمتابعة.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50 text-slate-900">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-3">
            <Truck className="w-7 h-7 text-sky-600" />
            خدمات ما بعد البيع (تسليم وتركيب الأجهزة)
          </h1>
          <p className="text-sm text-slate-500 mt-1">تتبع دورة حياة الأجهزة المباعة بدءاً من التسليم والتركيب وحتى التشغيل الفعلي وتنشيط العقود.</p>
        </div>
        
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm transition-all shadow-sm"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
          ) : (
            <Layers className="w-4 h-4 text-sky-600" />
          )}
          تحديث البيانات
        </button>
      </div>

      {/* Stats Cards Section */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all duration-300">
          <span className="text-xs font-semibold text-slate-500">إجمالي الأجهزة المباعة</span>
          <div className="flex items-end justify-between mt-4">
            <span className="text-3xl font-extrabold text-slate-900">{stats.total}</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Pending Delivery */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all duration-300">
          <span className="text-xs font-semibold text-slate-500">قيد التسليم والترحيل</span>
          <div className="flex items-end justify-between mt-4">
            <span className="text-3xl font-extrabold text-amber-600">{stats.pendingDelivery}</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <Truck className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Pending Installation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all duration-300">
          <span className="text-xs font-semibold text-slate-500">قيد التركيب وتوصيل الفلاتر</span>
          <div className="flex items-end justify-between mt-4">
            <span className="text-3xl font-extrabold text-sky-600">{stats.pendingInstallation}</span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Pending Activation */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all duration-300">
          <span className="text-xs font-semibold text-slate-500">قيد التشغيل وتفعيل العقد</span>
          <div className="flex items-end justify-between mt-4">
            <span className="text-3xl font-extrabold text-pink-600">{stats.pendingActivation}</span>
            <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center text-pink-600">
              <PlayCircle className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Activated/Active */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all duration-300 col-span-2 lg:col-span-1">
          <span className="text-xs font-semibold text-slate-500">أجهزة نشطة بالكامل</span>
          <div className="flex items-end justify-between mt-4">
            <span className="text-3xl font-extrabold text-emerald-600">{stats.active}</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم الزبون، رقم العقد، الموديل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:border-sky-500 placeholder:text-slate-400 transition-colors"
          />
        </div>

        {/* Quick Arabic status filters */}
        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-thin scrollbar-thumb-slate-200">
          <Filter className="w-4 h-4 text-sky-600 shrink-0 hidden md:block" />
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition duration-200 shrink-0 ${
              activeFilter === 'all'
                ? 'bg-sky-50 border-sky-200 text-sky-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            الكل
          </button>
          <button
            onClick={() => setActiveFilter('pending_delivery')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition duration-200 shrink-0 ${
              activeFilter === 'pending_delivery'
                ? 'bg-amber-50 border-amber-200 text-amber-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            قيد التسليم ({stats.pendingDelivery})
          </button>
          <button
            onClick={() => setActiveFilter('delivered')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition duration-200 shrink-0 ${
              activeFilter === 'delivered'
                ? 'bg-sky-50 border-sky-200 text-sky-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            قيد التركيب ({stats.pendingInstallation})
          </button>
          <button
            onClick={() => setActiveFilter('installed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition duration-200 shrink-0 ${
              activeFilter === 'installed'
                ? 'bg-pink-50 border-pink-200 text-pink-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            قيد التشغيل ({stats.pendingActivation})
          </button>
          <button
            onClick={() => setActiveFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition duration-200 shrink-0 ${
              activeFilter === 'active'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            نشط ({stats.active})
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm">حدث خطأ أثناء تحميل البيانات</h4>
            <p className="text-xs opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Main List */}
      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center gap-4 bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <Loader2 className="w-10 h-10 text-sky-600 animate-spin" />
          <span className="text-sm text-slate-500">جاري تحميل بيانات وتتبع الأجهزة المبيعة...</span>
        </div>
      ) : filteredContracts.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center gap-3 bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <ShoppingBag className="w-12 h-12 text-slate-400" />
          <h3 className="text-base font-bold text-slate-800">لا توجد أجهزة مطابقة للبحث أو التصفية</h3>
          <p className="text-xs text-slate-500 max-w-sm">تأكد من كتابة معلومات صحيحة أو قم باختيار فلاتر أخرى لعرض عقود الأجهزة.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredContracts.map((contract) => (
            <div 
              key={contract.id} 
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-slate-300 transition duration-300 shadow-sm"
            >
              {/* Card Title Banner */}
              <div className="bg-slate-50/50 border-b border-slate-100 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setSelectedCustomer(contract.customerName)}
                      className="text-base font-bold text-slate-900 hover:text-sky-600 transition flex items-center gap-2 group text-right"
                    >
                      <User className="w-4 h-4 text-sky-600 group-hover:scale-110 transition duration-200" />
                      {contract.customerName}
                    </button>
                    <span className="text-xs bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-semibold">
                      عقد #{contract.contractNumber}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>موديل الجهاز: <strong className="text-slate-800">{contract.deviceModelName || 'غير محدد'}</strong></span>
                    {contract.serialNumber && (
                      <span>الرقم التسلسلي: <strong className="text-sky-600 font-mono font-semibold">{contract.serialNumber}</strong></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* General Status Badge */}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    contract.deviceStatus === 'active'
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : contract.deviceStatus === 'installed'
                      ? 'bg-pink-50 text-pink-600 border-pink-200'
                      : contract.deviceStatus === 'delivered'
                      ? 'bg-sky-50 text-sky-600 border-sky-200'
                      : 'bg-amber-50 text-amber-600 border-amber-200'
                  }`}>
                    {contract.deviceStatus === 'active' 
                      ? 'نشط بالكامل' 
                      : contract.deviceStatus === 'installed' 
                      ? 'تم التركيب / قيد التشغيل' 
                      : contract.deviceStatus === 'delivered' 
                      ? 'تم التسليم / قيد التركيب' 
                      : 'قيد التسليم والترحيل'}
                  </span>

                  <button
                    onClick={() => setSelectedCustomer(contract.customerName)}
                    className="flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg text-xs transition duration-200 shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-600" />
                    الملف الكامل
                  </button>
                </div>
              </div>

              {/* Stepper block */}
              <div className="p-6">
                <PostSaleStepper 
                  contract={contract}
                  tasks={tasks}
                  onRefresh={loadData}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Customer 360 Degree View Modal */}
      {selectedCustomer && (
        <Customer360Modal
          isOpen={!!selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          customerName={selectedCustomer}
        />
      )}
    </div>
  );
}
