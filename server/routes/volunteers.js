import { Router } from 'express';
import User from '../models/User.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { authError as httpError } from '../utils/auth.js';

const router = Router();

router.get('/', authenticate, authorizeRoles('admin'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rawPage = req.query.page ?? '1';
  const page = typeof rawPage === 'string' ? Number(rawPage) : NaN;
  if (Object.keys(req.query).some((key) => key !== 'page') || typeof rawPage !== 'string'
      || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * 10)) {
    throw httpError(400, 'Page must be a positive integer');
  }
  const [people, total] = await Promise.all([
    User.find({ role: 'volunteer' }).select('name location').sort({ name: 1, _id: 1 }).skip((page - 1) * 10).limit(10).lean(),
    User.countDocuments({ role: 'volunteer' }),
  ]);
  res.json({
    volunteers: people.map((person) => ({ id: person._id.toString(), name: person.name, location: person.location || '' })),
    page, total, totalPages: Math.max(1, Math.ceil(total / 10)),
  });
});

export default router;
