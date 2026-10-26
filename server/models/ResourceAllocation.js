import mongoose from 'mongoose';

const allocationSchema = new mongoose.Schema({
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true, immutable: true },
  assistanceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'AssistanceRequest', required: true, immutable: true },
  allocatedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  // Keep history understandable even when a resource's name or unit is edited later.
  resourceName: { type: String, required: true, immutable: true },
  unit: { type: String, required: true, immutable: true },
}, { timestamps: true });

allocationSchema.index({ resource: 1, createdAt: -1, _id: -1 });
allocationSchema.index({ assistanceRequest: 1, createdAt: -1, _id: -1 });
allocationSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model('ResourceAllocation', allocationSchema);
