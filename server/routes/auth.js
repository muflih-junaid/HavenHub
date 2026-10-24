import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { authError, isValidPassword, issueToken, sanitizeUser } from '../utils/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/register', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw authError(400, 'A JSON object is required');
  }

  const { name, email, password, role = 'citizen', phone, location } = body;
  if (role === 'admin') throw authError(403, 'Public admin registration is not allowed');
  if (!['citizen', 'volunteer'].includes(role)) {
    throw authError(400, 'Role must be citizen or volunteer');
  }
  if ([name, email, phone].some((value) => typeof value !== 'string' || !value.trim())
      || (location !== undefined && typeof location !== 'string')) {
    throw authError(400, 'Name, email, and phone are required strings; location must be a string if provided');
  }
  if (!isValidPassword(password)) {
    throw authError(400, 'Password must contain at least 8 characters and at most 72 UTF-8 bytes');
  }

  // Pick permitted fields explicitly so callers cannot set hashes, IDs, or timestamps.
  const user = new User({ name, email, role, phone, location });
  await user.validate(['name', 'email', 'role', 'phone', 'location']);
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();

  res.status(201).json({ token: issueToken(user), user: sanitizeUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    throw authError(400, 'A valid email and password are required');
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw authError(401, 'Invalid email or password');
  }

  res.status(200).json({ token: issueToken(user), user: sanitizeUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.status(200).json({ user: sanitizeUser(req.user) });
});

export default router;
