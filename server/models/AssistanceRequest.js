import mongoose from 'mongoose';

const assistanceRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  disaster: { type: mongoose.Schema.Types.ObjectId, ref: 'DisasterReport' },
  assistanceType: { type: String, required: true, enum: ['food', 'water', 'shelter', 'medical', 'rescue', 'other'] },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  location: { type: String, required: true, trim: true, maxlength: 300 },
  urgency: { type: String, required: true, enum: ['low', 'medium', 'high', 'critical'] },
  status: { type: String, required: true, enum: ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  assignedVolunteer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt: { type: Date, default: null },
  acceptedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  assignmentCancelledAt: { type: Date, default: null },
  assignmentVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

assistanceRequestSchema.index({ requester: 1, createdAt: -1, _id: -1 });
assistanceRequestSchema.index({ assignedVolunteer: 1, createdAt: -1, _id: -1 });
assistanceRequestSchema.index({ status: 1, urgency: 1, createdAt: -1, _id: -1 });
assistanceRequestSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model('AssistanceRequest', assistanceRequestSchema);
