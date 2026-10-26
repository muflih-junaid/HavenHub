import { Router } from 'express';
import mongoose from 'mongoose';
import AssistanceRequest from '../models/AssistanceRequest.js';
import DisasterReport from '../models/DisasterReport.js';
import User from '../models/User.js';
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
  const isAssignedVolunteer = item.assignedVolunteer?.toString() === user.id;
  if (user.role === 'volunteer' && !isAssignedVolunteer) return summary;
  const assignment = {
    assignedVolunteer: item.assignedVolunteer?.toString() || null,
    assignmentVersion: item.assignmentVersion ?? 0,
    assignedAt: item.assignedAt || null, acceptedAt: item.acceptedAt || null,
    startedAt: item.startedAt || null, completedAt: item.completedAt || null,
    assignmentCancelledAt: item.assignmentCancelledAt || null,
  };
  if (user.role === 'volunteer') return { ...summary, ...assignment, description: item.description, location: item.location };
  return {
    ...summary, ...assignment, requester: item.requester.toString(),
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

async function sendList(req, res, mine = false, tasks = false) {
  const allowed = mine || tasks ? ['page'] : ['page', 'urgency', 'status'];
  if (Object.keys(req.query).some((key) => !allowed.includes(key))) throw httpError(400, 'Unsupported request query parameter');
  const rawPage = req.query.page ?? '1';
  const page = typeof rawPage === 'string' ? Number(rawPage) : NaN;
  if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page)
      || !Number.isSafeInteger((page - 1) * pageSize)) throw httpError(400, 'Page must be a positive integer');

  const filter = tasks ? { assignedVolunteer: req.user._id, status: { $in: ['assigned', 'in_progress', 'completed'] } } : visibleRequests(req.user);
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

router.get('/tasks', authorizeRoles('volunteer'), (req, res) => sendList(req, res, false, true));
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
    { $set: { status: 'cancelled' }, $inc: { assignmentVersion: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!item) throw httpError(409, 'This request changed. Refresh it before trying again');
  res.status(200).json({ request: serializeRequest(item, req.user) });
});

// The client version is compared inside the same atomic update as the state change.
// The missing-field case supports requests created before assignments were added.
function versionFilter(version) {
  return version === 0
    ? { $or: [{ assignmentVersion: 0 }, { assignmentVersion: { $exists: false } }] }
    : { assignmentVersion: version };
}

function validateUpdate(req, fields) {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid assistance request ID');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !fields.includes(key))) throw httpError(400, 'Invalid assignment update fields');
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || body.expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw httpError(400, 'A valid expectedVersion is required');
  }
}

async function updateAssignment(req, res, current, changes) {
  if ((current.assignmentVersion ?? 0) !== req.body.expectedVersion) {
    throw httpError(409, 'This request changed. Refresh it before trying again');
  }
  const item = await AssistanceRequest.findOneAndUpdate(
    { _id: current._id, status: current.status, ...versionFilter(req.body.expectedVersion),
      ...(req.user.role === 'volunteer' ? { assignedVolunteer: req.user._id } : {}) },
    { $set: changes, $inc: { assignmentVersion: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!item) throw httpError(409, 'This request changed. Refresh it before trying again');
  res.status(200).json({ request: serializeRequest(item, req.user) });
}

router.patch('/:id/assignment', authorizeRoles('admin'), async (req, res) => {
  validateUpdate(req, ['volunteerId', 'expectedVersion']);
  if (typeof req.body.volunteerId !== 'string' || !mongoose.isObjectIdOrHexString(req.body.volunteerId)) {
    throw httpError(400, 'Choose a registered volunteer');
  }
  const person = await User.findById(req.body.volunteerId);
  if (!person || person.role !== 'volunteer') throw httpError(400, 'Choose a registered volunteer');
  const current = await AssistanceRequest.findOne({ _id: req.params.id }).lean();
  if (!current) throw httpError(404, 'Assistance request not found');
  if (!['pending', 'assigned', 'in_progress'].includes(current.status)) throw httpError(409, 'This request cannot be assigned');
  if (current.assignedVolunteer?.toString() === person.id) throw httpError(409, 'This volunteer is already assigned');
  await updateAssignment(req, res, current, {
    assignedVolunteer: person._id, status: 'assigned', assignedAt: new Date(),
    acceptedAt: null, startedAt: null, completedAt: null, assignmentCancelledAt: null,
  });
});

router.delete('/:id/assignment', authorizeRoles('admin'), async (req, res) => {
  validateUpdate(req, ['expectedVersion']);
  const current = await AssistanceRequest.findOne({ _id: req.params.id }).lean();
  if (!current) throw httpError(404, 'Assistance request not found');
  if (!current.assignedVolunteer || !['assigned', 'in_progress'].includes(current.status)) {
    throw httpError(409, 'Only an active assignment can be cancelled');
  }
  await updateAssignment(req, res, current, {
    status: 'pending', assignedVolunteer: null, assignedAt: null, acceptedAt: null,
    startedAt: null, completedAt: null, assignmentCancelledAt: new Date(),
  });
});

router.patch('/:id/task', authorizeRoles('volunteer'), async (req, res) => {
  validateUpdate(req, ['action', 'expectedVersion']);
  if (!['accept', 'start', 'complete'].includes(req.body.action)) throw httpError(400, 'Choose a valid task action');
  const current = await AssistanceRequest.findOne({ _id: req.params.id, assignedVolunteer: req.user._id }).lean();
  if (!current) throw httpError(404, 'Assistance request not found');
  const action = req.body.action;
  const canAccept = action === 'accept' && current.status === 'assigned' && !current.acceptedAt;
  const canStart = action === 'start' && current.status === 'assigned' && current.acceptedAt;
  const canComplete = action === 'complete' && current.status === 'in_progress' && current.acceptedAt;
  if (!canAccept && !canStart && !canComplete) throw httpError(409, 'This task action is not available in its current state');
  const changes = canAccept ? { acceptedAt: new Date() }
    : canStart ? { status: 'in_progress', startedAt: new Date() }
      : { status: 'completed', completedAt: new Date() };
  await updateAssignment(req, res, current, changes);
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw httpError(400, 'Invalid assistance request ID');
  const visibility = req.user.role === 'volunteer'
    ? { $or: [{ status: 'pending' }, { assignedVolunteer: req.user._id, status: { $in: ['assigned', 'in_progress', 'completed'] } }] }
    : visibleRequests(req.user);
  const item = await AssistanceRequest.findOne({ _id: req.params.id, ...visibility }).lean();
  if (!item) throw httpError(404, 'Assistance request not found');
  res.status(200).json({ request: serializeRequest(item, req.user) });
});

export default router;
