import { Router } from 'express';
import { loginUser } from '../services/authService.js';

const router = Router();

function getDatabaseErrorDetails(err: any): { userMessage: string; logDetails: Record<string, unknown> } | null {
  const message = String(err?.message || '');
  const code = String(err?.code || '');

  const logDetails = {
    code: err?.code ?? null,
    errno: err?.errno ?? null,
    syscall: err?.syscall ?? null,
    hostname: err?.hostname ?? null,
    address: err?.address ?? null,
    port: err?.port ?? null,
    message,
    detail: err?.detail ?? null,
  };

  if (message.includes('client password must be a string') || message.includes('SASL') || code === '28P01') {
    return {
      userMessage: 'فشل الاتصال بقاعدة البيانات: اسم مستخدم PostgreSQL أو كلمة المرور غير صحيحة، أو كلمة المرور داخل DATABASE_URL مكتوبة بصيغة غير صالحة.',
      logDetails,
    };
  }

  if (code === '3D000') {
    return {
      userMessage: 'فشل الاتصال بقاعدة البيانات: اسم قاعدة البيانات في DATABASE_URL غير موجود.',
      logDetails,
    };
  }

  if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
    return {
      userMessage: 'فشل الاتصال بقاعدة البيانات: خادم PostgreSQL لا يستجيب على المنفذ المحدد.',
      logDetails,
    };
  }

  if (code === 'ENOTFOUND' || message.includes('ENOTFOUND')) {
    return {
      userMessage: 'فشل الاتصال بقاعدة البيانات: اسم المضيف في DATABASE_URL غير صحيح أو غير قابل للوصول.',
      logDetails,
    };
  }

  if (message.includes('DATABASE_URL')) {
    return {
      userMessage: 'فشل الاتصال بقاعدة البيانات: المتغير DATABASE_URL غير موجود أو لم يتم تحميل ملف البيئة الصحيح.',
      logDetails,
    };
  }

  if (
    message.includes('connect') ||
    message.includes('password authentication failed') ||
    message.includes('database') ||
    message.includes('getaddrinfo')
  ) {
    return {
      userMessage: `فشل الاتصال بقاعدة البيانات: ${message}`,
      logDetails,
    };
  }

  return null;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const result = await loginUser(username, password);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message });
    }

    const dbError = getDatabaseErrorDetails(err);
    if (dbError) {
      console.error('Login database error:', dbError.logDetails);
      return res.status(500).json({ error: dbError.userMessage });
    }

    console.error('Login error:', {
      code: err?.code ?? null,
      message: err?.message ?? 'Unknown error',
      stack: err?.stack ?? null,
    });
    res.status(500).json({ error: err?.message || 'حدث خطأ غير متوقع أثناء تسجيل الدخول' });
  }
});

export default router;
