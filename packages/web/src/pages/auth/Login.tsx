import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionStyle,
} from 'framer-motion';
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

  // ── Cursor-reactive 3D parallax for the branding illustration ──
  const reduceMotion = useReducedMotion();
  const px = useMotionValue(0); // -0.5 … 0.5 (pointer X within the art)
  const py = useMotionValue(0); // -0.5 … 0.5 (pointer Y within the art)
  const spring = { stiffness: 140, damping: 18, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [9, -9]), spring);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-12, 12]), spring);

  function handleArtPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  function resetArtPointer() {
    px.set(0);
    py.set(0);
  }

  // ── Staggered entrance for the form card (per-item delay so the
  //    cascade survives the <form> wrapper; matches the art's spring). ──
  const cardItem = {
    hidden: { opacity: 0, y: 14 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 130, damping: 18, delay: 0.18 + i * 0.07 },
    }),
  };

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

          {/* Company illustration — cursor-reactive 3D parallax hub.
              Outer = perspective + spring entrance; inner = live tilt + idle float. */}
          <motion.div
            onPointerMove={handleArtPointer}
            onPointerLeave={resetArtPointer}
            className="w-full max-w-md [perspective:1100px]"
            initial={reduceMotion ? false : { opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 80, damping: 15, mass: 0.9, delay: 0.1 }}
          >
            <motion.div
              style={reduceMotion ? undefined : ({ rotateX, rotateY } as MotionStyle)}
              animate={reduceMotion ? undefined : { y: [0, -9, 0] }}
              transition={
                reduceMotion
                  ? undefined
                  : { duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }
              }
            >
              <img
                src={companyArt}
                alt="منظومة Golden Group الموحّدة: عملاء وأجهزة وفرق وفروع حول لوحة تحكم مركزية"
                className="w-full drop-shadow-2xl"
                draggable={false}
              />
            </motion.div>
          </motion.div>
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
          <motion.div
            className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-6 sm:p-8"
            initial={reduceMotion ? false : 'hidden'}
            animate="visible"
          >
            <motion.div variants={cardItem} custom={0} className="text-center mb-6">
              <h2 className="text-lg font-bold text-slate-800">تسجيل الدخول</h2>
              <p className="text-sm text-slate-500 mt-1">
                أدخل بيانات حسابك للمتابعة
              </p>
            </motion.div>

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
              <motion.div variants={cardItem} custom={1}>
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
              </motion.div>

              <motion.div variants={cardItem} custom={2}>
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
              </motion.div>

              <motion.div variants={cardItem} custom={3}>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
              >
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </Button>
              </motion.div>
            </form>

            {/* Footer note */}
            <motion.div variants={cardItem} custom={4} className="mt-6 text-center">
              <p className="text-xs text-slate-400">
                © {new Date().getFullYear()} Golden Group. جميع الحقوق محفوظة.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
