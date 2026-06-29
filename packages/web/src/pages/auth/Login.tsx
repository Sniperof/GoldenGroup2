import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../hooks/useAuthStore';
import {
  Lock,
  User,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import logoMark from '../../assets/logo-mark.png';
import logoName from '../../assets/logo-name.svg';
import companyArt from '../../assets/company-illustration.svg';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

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
      {/* ── Branding / Stats panel (right side in RTL; hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative overflow-hidden bg-gradient-to-br from-sky-700 via-sky-600 to-indigo-600">
        {/* Soft glow accents */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-sky-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-[28rem] w-[28rem] rounded-full bg-indigo-400/25 blur-3xl" />

        {/* Subtle line grid */}
        <div className="absolute inset-0 opacity-[0.07]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
                <path d="M64 0H0V64" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex w-full flex-col items-center justify-center px-12 py-16 text-center text-white xl:px-20">
          {/* Header — centered mark + name wordmark */}
          <div className="mb-10">
            <div className="mx-auto mb-5 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 shadow-lg backdrop-blur-sm">
              <img src={logoMark} alt="" className="h-14 w-14 object-contain" />
            </div>
            <img src={logoName} alt="Golden Group" className="mx-auto h-9 w-auto object-contain xl:h-10" />
            <p className="mt-4 text-lg font-light text-white/80">نظام إدارة العملاء والموارد المتكامل</p>
          </div>

          {/* Company illustration — unified operations hub */}
          <img
            src={companyArt}
            alt="منظومة Golden Group الموحّدة: عملاء وأجهزة وفرق وفروع حول لوحة تحكم مركزية"
            className="w-full max-w-md drop-shadow-xl"
          />
        </div>
      </div>

      {/* ── Right Panel: Form ── */}
      <div className="w-full lg:w-1/2 xl:w-[45%] flex items-center justify-center p-4 sm:p-6 lg:p-8 xl:p-12">
        <div className="w-full max-w-[420px]">
          {/* Mobile-only logo */}
          <div className="lg:hidden text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg shadow-sky-500/20 mb-3 transition-transform duration-300 hover:scale-105 border border-slate-100">
              <img src={logoMark} alt="Golden Group" className="w-11 h-11 object-contain" />
            </div>
            <h1 className="text-lg font-bold text-slate-800">Golden Group</h1>
            <p className="text-sm text-slate-500 mt-1">نظام إدارة العملاء والموارد</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-6 sm:p-8">
            <div className="text-center mb-6">
              <h2 className="text-lg font-bold text-slate-800">تسجيل الدخول</h2>
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
              <Input
                id="username"
                label="اسم المستخدم"
                inputSize="lg"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                autoComplete="username"
                autoFocus
                disabled={loading}
                placeholder="أدخل اسم المستخدم"
                leading={<User className={`w-4 h-4 ${focusedField === 'username' ? 'text-sky-500' : ''}`} />}
              />

              <Input
                id="password"
                label="كلمة المرور"
                inputSize="lg"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                autoComplete="current-password"
                disabled={loading}
                placeholder="أدخل كلمة المرور"
                leading={<Lock className={`w-4 h-4 ${focusedField === 'password' ? 'text-sky-500' : ''}`} />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="pointer-events-auto text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </Button>
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
