import jwt from 'jsonwebtoken';

export function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  const expiresIn = Number(process.env.JWT_EXPIRES_IN_SECONDS || 3600);

  if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !secret.trim()) {
    throw new Error('JWT_SECRET must contain at least 32 bytes. Generate a random secret before starting the API.');
  }
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1) {
    throw new Error('JWT_EXPIRES_IN_SECONDS must be a positive integer');
  }

  return { secret, expiresIn };
}

export function issueToken(user) {
  const { secret, expiresIn } = getJwtConfig();
  return jwt.sign({}, secret, {
    subject: user._id.toString(),
    algorithm: 'HS256',
    expiresIn,
  });
}

export function isValidPassword(password) {
  // bcrypt only uses the first 72 UTF-8 bytes; reject longer passwords.
  return typeof password === 'string'
    && password.length >= 8
    && password.trim().length > 0
    && Buffer.byteLength(password, 'utf8') <= 72;
}

export function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    location: user.location,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
