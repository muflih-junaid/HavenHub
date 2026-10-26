import { Router } from 'express';
import mongoose from 'mongoose';
import DisasterReport from '../models/DisasterReport.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { authError as httpError } from '../utils/auth.js';

const router = Router();
const pageSize = 10;
const disasterTypes = ['flood', 'landslide', 'fire', 'storm', 'other'];
const severities = ['low', 'medium', 'high', 'critical'];
const transitions = {
  pending: ['verified', 'rejected'],
  verified: ['resolved'],
  rejected: [],
  resolved: [],
};

function visibleReports(user) {
  if (user.role === 'citizen') return { reportedBy: user._id };
  if (user.role === 'volunteer') return { status: { $in: ['verified', 'resolved'] } };
  if (user.role === 'admin') return {};
  throw httpError(403, 'You do not have permission to view disaster reports');
}

function serializeReport(report, user) {
  return {
    id: report._id.toString(),
    title: report.title,
    description: report.description,
    disasterType: report.disasterType,
    severity: report.severity,
    location: {
      address: report.location.address,
      latitude: report.location.latitude,
      longitude: report.location.longitude,
    },
    status: report.status,
    // Volunteers need incident information, not the identity of its reporter.
    ...(user.role !== 'volunteer' ? { reportedBy: report.reportedBy.toString() } : {}),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function validateReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'A JSON object is required');
  const allowedFields = ['title', 'description', 'disasterType', 'severity', 'location'];
  if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
    throw httpError(400, 'Only title, description, disasterType, severity, and location may be submitted');
  }
  for (const [field, maximum] of [['title', 150], ['description', 5000]]) {
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > maximum) {
      throw httpError(400, `${field} is required and must contain at most ${maximum} characters`);
    }
  }
  if (!disasterTypes.includes(body.disasterType)) throw httpError(400, 'Choose a valid disaster type');
  if (!severities.includes(body.severity)) throw httpError(400, 'Choose a valid severity');

  const location = body.location;
  if (!location || typeof location !== 'object' || Array.isArray(location)
      || Object.keys(location).some((key) => !['address', 'latitude', 'longitude'].includes(key))) {
    throw httpError(400, 'Location must contain an address and optional latitude and longitude');
  }
  if (typeof location.address !== 'string' || !location.address.trim() || location.address.trim().length > 300) {
    throw httpError(400, 'A location address of at most 300 characters is required');
  }
  const hasLatitude = location.latitude !== undefined;
  const hasLongitude = location.longitude !== undefined;
  if (hasLatitude !== hasLongitude) throw httpError(400, 'Provide both latitude and longitude, or leave both out');
  if (hasLatitude && (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90
      || !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180)) {
    throw httpError(400, 'Latitude must be a number from -90 to 90 and longitude from -180 to 180');
  }
}

router.use(authenticate, authorizeRoles('citizen', 'volunteer', 'admin'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/', authorizeRoles('citizen'), async (req, res) => {
  validateReport(req.body);
  const { title, description, disasterType, severity, location } = req.body;
  const report = new DisasterReport({
    title, description, disasterType, severity,
    location: { address: location.address, latitude: location.latitude, longitude: location.longitude },
    status: 'pending', reportedBy: req.user._id,
  });
  await report.save();
  res.status(201).json({ report: serializeReport(report, req.user) });
});

router.get('/', async (req, res) => {
  if (Object.keys(req.query).some((key) => !['page', 'status'].includes(key))) throw httpError(400, 'Only page and status query parameters are supported');
  const rawPage = req.query.page ?? '1';
  const page = typeof rawPage === 'string' ? Number(rawPage) : NaN;
  if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page)
      || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw httpError(400, 'Page must be a positive integer');
  }
  const filter = visibleReports(req.user);
  if (req.query.status !== undefined) {
    if (req.user.role !== 'admin') throw httpError(403, 'Only admins can filter reports by status');
    if (typeof req.query.status !== 'string' || !Object.hasOwn(transitions, req.query.status)) {
      throw httpError(400, 'Choose a valid report status');
    }
    filter.status = req.query.status;
  }
  const [reports, total] = await Promise.all([
    DisasterReport.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    DisasterReport.countDocuments(filter),
  ]);
  res.status(200).json({
    reports: reports.map((report) => serializeReport(report, req.user)),
    page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

router.patch('/:id/status', authorizeRoles('admin'), async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid disaster report ID');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'status')
      || typeof body.status !== 'string' || !Object.hasOwn(transitions, body.status)) {
    throw httpError(400, 'Provide only a valid status: pending, verified, rejected, or resolved');
  }

  const current = await DisasterReport.findOne({ _id: req.params.id }).lean();
  if (!current) throw httpError(404, 'Disaster report not found');
  if (!transitions[current.status]?.includes(body.status)) {
    throw httpError(409, `Cannot change a ${current.status} report to ${body.status}`);
  }

  // Match the previous status as part of the write, so a concurrent review cannot be overwritten.
  const report = await DisasterReport.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { status: body.status } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!report) throw httpError(409, 'This report changed during review. Refresh it and try again');
  res.status(200).json({ report: serializeReport(report, req.user) });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid disaster report ID');
  const report = await DisasterReport.findOne({ _id: req.params.id, ...visibleReports(req.user) }).lean();
  // Treat private and nonexistent reports identically, without revealing their existence.
  if (!report) throw httpError(404, 'Disaster report not found');
  res.status(200).json({ report: serializeReport(report, req.user) });
});

export default router;
