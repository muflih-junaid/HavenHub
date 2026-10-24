import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
      unique: true,
    },
    // Accept a precomputed password hash; password handling belongs to future auth endpoints.
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: ['citizen', 'volunteer', 'admin'],
      default: 'citizen',
      required: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      maxlength: 30,
      validate: {
        validator(value) {
          const digits = value.replace(/\D/g, '');
          return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
        },
        message: 'Please provide a valid phone number',
      },
    },
    location: {
      type: String,
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true },
);

export default mongoose.model('User', userSchema);
