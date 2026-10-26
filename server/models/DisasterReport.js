import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  address: { type: String, required: true, trim: true, maxlength: 300 },
  latitude: { type: Number, min: -90, max: 90, validate: Number.isFinite },
  longitude: { type: Number, min: -180, max: 180, validate: Number.isFinite },
}, { _id: false });

const disasterReportSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  disasterType: { type: String, required: true, enum: ['flood', 'landslide', 'fire', 'storm', 'other'] },
  severity: { type: String, required: true, enum: ['low', 'medium', 'high', 'critical'] },
  location: {
    type: locationSchema,
    required: true,
    validate: {
      validator(location) {
        return !location || (location.latitude === undefined) === (location.longitude === undefined);
      },
      message: 'Latitude and longitude must be supplied together',
    },
  },
  status: { type: String, enum: ['pending', 'verified', 'rejected', 'resolved'], default: 'pending', required: true },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true });

disasterReportSchema.index({ reportedBy: 1, createdAt: -1, _id: -1 });
disasterReportSchema.index({ status: 1, createdAt: -1, _id: -1 });
disasterReportSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model('DisasterReport', disasterReportSchema);
