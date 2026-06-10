import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../hooks/useAuthStore';
import {
  Briefcase,
  Lock,
  User,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Building2,
  Shield,
  CheckCircle2,
} from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusedField, setFocusedField] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'حدث خطأ أثناء تسجيل الدخول');
        return;
      }
      login(data.token, data.user, data.permissions || [], data.grants || []);
      navigate('/');
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-slate-50 flex items-stretch justify-center"
      dir="rtl"
    >
      {/* ── Left Panel: Branding (hidden on mobile, shown on lg+) ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative bg-gradient-to-br from-sky-600 via-sky-500 to-sky-400 overflow-hidden">
        {/* Animated background pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Floating shapes */}
        <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-32 right-32 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center text-white px-12 xl:px-20">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 backdrop-blur-sm rounded-3xl shadow-xl mb-6 transition-transform duration-300 hover:scale-105">
              <Building2 className="w-10 h-10 text-white" />
            </div>
          </div>

          <h1 className="text-4xl xl:text-5xl font-bold mb-4 text-center tracking-tight">
            Golden Group
          </h1>
          <p className="text-xl xl:text-2xl font-light text-white/90 mb-12 text-center">
            نظام إدارة العملاء والموارد
          </p>

          {/* Feature highlights */}
          <div className="space-y-4 w-full max-w-md">
            {[
              { icon: Briefcase, text: 'إدارة العملاء والعقارات' },
              { icon: Shield, text: 'نظام صلاحيات متقدم' },
              { icon: CheckCircle2, text: 'تقارير وإحصائيات فورية' },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-xl px-5 py-3 transition-all duration-300 hover:bg-white/15 hover:translate-x-[-4px]"
              >
                <item.icon className="w-5 h-5 text-white/90 flex-shrink-0" />
                <span className="text-base font-medium text-white/95">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Panel: Form ── */}
      <div className="w-full lg:w-1/2 xl:w-[45%] flex items-center justify-center p-4 sm:p-6 lg:p-8 xl:p-12">
        <div className="w-full max-w-[420px]">
          {/* Mobile-only logo */}
          <div className="lg:hidden text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-sky-500 to-sky-400 rounded-2xl shadow-lg shadow-sky-500/30 mb-3 transition-transform duration-300 hover:scale-105">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">Golden Group</h1>
            <p className="text-sm text-slate-500 mt-1">نظام إدارة العملاء والموارد</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">تسجيل الدخول</h2>
              <p className="text-sm text-slate-500 mt-1">
                أدخل بيانات حسابك للمتابعة
              </p>
            </div>

            {/* Error Alert */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${
                error ? 'max-h-24 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'
              }`}
            >
              <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username Field */}
              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-semibold text-slate-700 mb-2"
                >
                  اسم المستخدم
                </label>
                <div className="relative">
                  <div
                    className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
                      focusedField === 'username' ? 'text-sky-500' : 'text-slate-400'
                    }`}
                  >
                    <User className="w-5 h-5" />
                  </div>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setFocusedField('username')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="username"
                    autoFocus
                    disabled={loading}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-11 pl-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 transition-all duration-200 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="أدخل اسم المستخدم"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-slate-700 mb-2"
                >
                  كلمة المرور
                </label>
                <div className="relative">
                  <div
                    className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
                      focusedField === 'password' ? 'text-sky-500' : 'text-slate-400'
                    }`}
                  >
                    <Lock className="w-5 h-5" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-11 pl-12 py-3 text-sm text-slate-800 placeholder:text-slate-400 transition-all duration-200 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="أدخل كلمة المرور"
                  />
                  {/* Show/Hide toggle */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors duration-200 p-1 rounded-md hover:bg-slate-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-sky-500 hover:bg-sky-600 active:bg-sky-700 disabled:bg-sky-300 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-sky-500/25 hover:shadow-sky-500/40 hover:-translate-y-0.5 active:translate-y-0 disabled:hover:translate-y-0 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري تسجيل الدخول...</span>
                  </>
                ) : (
                  <span>تسجيل الدخول</span>
                )}
              </button>
            </form>

            {/* Footer note */}
            <div className="mt-6 text-center">
              <p className="text-xs text-slate-400">
                © {new Date().getFullYear()} Golden Group. جميع الحقوق محفوظة.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
