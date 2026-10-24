import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { authError, isValidPassword } from '../utils/auth.js';

export async function bootstrapAdmin() {
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password,
    ADMIN_PHONE: phone, ADMIN_LOCATION: location } = process.env;

  if ([name, email, phone].some((value) => typeof value !== 'string' || !value.trim())) {
    throw authError(400, 'Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_PHONE in the environment');
  }
  if (!isValidPassword(password)) {
    throw authError(400, 'ADMIN_PASSWORD must contain at least 8 characters and at most 72 UTF-8 bytes');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (existing.role !== 'admin') {
      throw authError(409, 'That email belongs to a non-admin account; it will not be promoted');
    }
    return false;
  }

  const user = new User({ name, email: normalizedEmail, role: 'admin', phone, location });
  await user.validate(['name', 'email', 'role', 'phone', 'location']);
  user.passwordHash = await bcrypt.hash(password, 12);
  try {
    await user.save();
  } catch (error) {
    // A concurrent run may have inserted the same email after the initial lookup.
    if (error.code !== 11000) throw error;
    const concurrent = await User.findOne({ email: normalizedEmail });
    if (concurrent?.role !== 'admin') {
      throw authError(409, 'That email belongs to a non-admin account; it will not be promoted');
    }
    return false;
  }
  return true;
}

async function main() {
  try {
    if (!process.env.MONGODB_URI?.trim()) {
      throw authError(400, 'MONGODB_URI is required');
    }
    await mongoose.connect(process.env.MONGODB_URI.trim());
    await User.init();
    const created = await bootstrapAdmin();
    console.log(created ? 'Admin created.' : 'Admin already exists; no changes made.');
  } catch (error) {
    console.error(error.status === 400 || error.status === 409
      ? error.message
      : 'Admin bootstrap failed. Check MongoDB access and the admin profile configuration.');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
