import { Router } from 'express';
import { loginUser } from '../services/authService.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ù…Ø·Ù„ÙˆØ¨Ø§Ù†' });
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
