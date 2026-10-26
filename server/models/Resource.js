import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, enum: ['food', 'water', 'medical', 'shelter', 'other'] },
  quantityAvailable: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  unit: { type: String, required: true, trim: true, maxlength: 40 },
  storageLocation: { type: String, required: true, trim: true, maxlength: 300 },
  active: { type: Boolean, default: true, required: true },
  stockVersion: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
}, { timestamps: true });

resourceSchema.index({ active: 1, createdAt: -1, _id: -1 });

export default mongoose.model('Resource', resourceSchema);
