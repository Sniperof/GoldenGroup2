import { Router } from 'express';
import { loginUser } from '../services/authService.js';

const router = Router();

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
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
