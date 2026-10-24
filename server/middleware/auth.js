import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { authError, getJwtConfig } from '../utils/auth.js';

export async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const match = typeof authorization === 'string' && authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) throw authError(401, 'A Bearer token is required');

  const { secret } = getJwtConfig();
  let payload;
  try {
    payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch {
    throw authError(401, 'Invalid or expired token');
  }

  if (typeof payload !== 'object'
      || !Number.isInteger(payload.exp)
      || typeof payload.sub !== 'string'
      || !mongoose.isObjectIdOrHexString(payload.sub)) {
    throw authError(401, 'Invalid or expired token');
  }

  // Use the current database role, not a role supplied in a token or request.
  const user = await User.findById(payload.sub);
  if (!user) throw authError(401, 'Invalid or expired token');

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
