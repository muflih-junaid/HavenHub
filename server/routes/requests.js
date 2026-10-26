import { Router } from 'express';
import mongoose from 'mongoose';
import AssistanceRequest from '../models/AssistanceRequest.js';
import DisasterReport from '../models/DisasterReport.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { authError as httpError } from '../utils/auth.js';

const router = Router();
const pageSize = 10;
const assistanceTypes = ['food', 'water', 'shelter', 'medical', 'rescue', 'other'];
const urgencies = ['low', 'medium', 'high', 'critical'];
const statuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];

function serializeRequest(item, user) {
  const summary = {
    id: item._id.toString(), assistanceType: item.assistanceType,
    urgency: item.urgency, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
  // Until assignments exist, volunteers see pending summaries, without free text or identifying data.
  if (user.role === 'volunteer') return summary;
  return {
    ...summary, requester: item.requester.toString(),
    ...(item.disaster ? { disaster: item.disaster.toString() } : {}),
    description: item.description, location: item.location,
  };
}

function visibleRequests(user) {
  if (user.role === 'citizen') return { requester: user._id };
  if (user.role === 'volunteer') return { status: 'pending' };
  if (user.role === 'admin') return {};
  throw httpError(403, 'You do not have permission to view assistance requests');
}

async function sendList(req, res, mine = false) {
  const allowed = mine ? ['page'] : ['page', 'urgency', 'status'];
  if (Object.keys(req.query).some((key) => !allowed.includes(key))) throw httpError(400, 'Unsupported request query parameter');
  const rawPage = req.query.page ?? '1';
  const page = typeof rawPage === 'string' ? Number(rawPage) : NaN;
  if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page)
      || !Number.isSafeInteger((page - 1) * pageSize)) throw httpError(400, 'Page must be a positive integer');

  const filter = visibleRequests(req.user);
  if (req.query.urgency !== undefined) {
    if (!urgencies.includes(req.query.urgency)) throw httpError(400, 'Choose a valid urgency');
    filter.urgency = req.query.urgency;
  }
  if (req.query.status !== undefined) {
    if (!statuses.includes(req.query.status)) throw httpError(400, 'Choose a valid request status');
    if (req.user.role === 'volunteer' && req.query.status !== 'pending') {
      throw httpError(403, 'Volunteers can only view pending request summaries');
    }
    filter.status = req.query.status;
  }
  const [items, total] = await Promise.all([
    AssistanceRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    AssistanceRequest.countDocuments(filter),
  ]);
  res.status(200).json({
    requests: items.map((item) => serializeRequest(item, req.user)),
    page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

router.use(authenticate, authorizeRoles('citizen', 'volunteer', 'admin'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/', authorizeRoles('citizen'), async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'A JSON object is required');
  if (Object.keys(body).some((key) => !['assistanceType', 'description', 'location', 'urgency', 'disaster'].includes(key))) {
    throw httpError(400, 'Only assistance type, description, location, urgency, and an optional disaster may be submitted');
  }
  if (!assistanceTypes.includes(body.assistanceType)) throw httpError(400, 'Choose a valid assistance type');
  if (!urgencies.includes(body.urgency)) throw httpError(400, 'Choose a valid urgency');
  for (const [field, maximum] of [['description', 5000], ['location', 300]]) {
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > maximum) {
      throw httpError(400, `${field} is required and must contain at most ${maximum} characters`);
    }
  }
  if (body.disaster !== undefined && body.disaster !== null) {
    if (typeof body.disaster !== 'string' || !mongoose.isObjectIdOrHexString(body.disaster)) {
      throw httpError(400, 'Invalid disaster report ID');
    }
    const disaster = await DisasterReport.findOne({ _id: body.disaster, reportedBy: req.user._id }).lean();
    if (!disaster) throw httpError(404, 'Disaster report not found or unavailable');
  }

  const item = new AssistanceRequest({
    requester: req.user._id, status: 'pending', disaster: body.disaster || undefined,
    assistanceType: body.assistanceType, description: body.description, location: body.location, urgency: body.urgency,
  });
  await item.save();
  res.status(201).json({ request: serializeRequest(item, req.user) });
});

router.get('/mine', authorizeRoles('citizen'), (req, res) => sendList(req, res, true));
router.get('/', authorizeRoles('admin', 'volunteer'), (req, res) => sendList(req, res));

router.patch('/:id/cancel', authorizeRoles('citizen'), async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid assistance request ID');
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw httpError(400, 'Cancellation does not accept any fields');
  }
  const current = await AssistanceRequest.findOne({ _id: req.params.id, requester: req.user._id }).lean();
  if (!current) throw httpError(404, 'Assistance request not found');
  if (current.status !== 'pending') throw httpError(409, 'Only pending requests can be cancelled');
  const item = await AssistanceRequest.findOneAndUpdate(
    { _id: current._id, requester: req.user._id, status: 'pending' },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!item) throw httpError(409, 'This request changed. Refresh it before trying again');
  res.status(200).json({ request: serializeRequest(item, req.user) });
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid assistance request ID');
  const item = await AssistanceRequest.findOne({ _id: req.params.id, ...visibleRequests(req.user) }).lean();
  if (!item) throw httpError(404, 'Assistance request not found');
  res.status(200).json({ request: serializeRequest(item, req.user) });
});

export default router;
