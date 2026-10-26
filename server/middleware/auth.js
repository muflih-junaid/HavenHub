import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { authError, getJwtConfig } from '../utils/auth.js';

export async function authenticateToken(token) {
  if (typeof token !== 'string' || !token) throw authError(401, 'Invalid or expired token');
  const { secret } = getJwtConfig();
  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw authError(401, 'Invalid or expired token');
  }

  if (typeof payload !== 'object'
      || !Number.isSafeInteger(payload.exp)
      || typeof payload.sub !== 'string'
      || !mongoose.isObjectIdOrHexString(payload.sub)) {
    throw authError(401, 'Invalid or expired token');
  }

  // Use the current database role, not a role supplied in a token or request.
  const user = await User.findById(payload.sub);
  if (!user) throw authError(401, 'Invalid or expired token');

  return { user, expiresAt: payload.exp * 1000 };
}

export async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const match = typeof authorization === 'string' && authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) throw authError(401, 'A Bearer token is required');
  const { user } = await authenticateToken(match[1]);

  req.user = user;
  next();
}

export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(authError(401, 'Authentication is required'));
    if (!roles.includes(req.user.role)) return next(authError(403, 'You do not have permission to access this resource'));
    next();
  };
}
