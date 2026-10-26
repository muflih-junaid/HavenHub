import { Router } from 'express';
import mongoose from 'mongoose';
import Resource from '../models/Resource.js';
import { notifyRooms } from '../realtime.js';
import ResourceAllocation from '../models/ResourceAllocation.js';
import AssistanceRequest from '../models/AssistanceRequest.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
import { authError as httpError } from '../utils/auth.js';

const router = Router();
const categories = ['food', 'water', 'medical', 'shelter', 'other'];
const resourceFields = ['name', 'category', 'quantityAvailable', 'unit', 'storageLocation'];
const pageSize = 10;

function objectBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !fields.includes(key))) throw httpError(400, 'Invalid resource fields');
}

function validId(id) {
  if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) throw httpError(400, 'Invalid resource or assistance request ID');
}

function validVersion(version) {
  if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
    throw httpError(400, 'A valid expectedVersion is required');
  }
}

function validateResource(body, partial = false) {
  for (const [field, maximum] of [['name', 120], ['unit', 40], ['storageLocation', 300]]) {
    if (partial && body[field] === undefined) continue;
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > maximum) {
      throw httpError(400, `${field} is required and must contain at most ${maximum} characters`);
    }
  }
  if ((!partial || body.category !== undefined) && !categories.includes(body.category)) throw httpError(400, 'Choose a valid resource category');
  if ((!partial || body.quantityAvailable !== undefined)
      && (!Number.isSafeInteger(body.quantityAvailable) || body.quantityAvailable < 0)) {
    throw httpError(400, 'Available quantity must be a non-negative safe whole number');
  }
}

function pagination(query, fields = []) {
  if (Object.keys(query).some((key) => !['page', ...fields].includes(key))) throw httpError(400, 'Unsupported resource query parameter');
  const raw = query.page ?? '1';
  const page = typeof raw === 'string' ? Number(raw) : NaN;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(page)
      || !Number.isSafeInteger((page - 1) * pageSize)) throw httpError(400, 'Page must be a positive integer');
  return page;
}

function serializeResource(item) {
  return {
    id: item._id.toString(), name: item.name, category: item.category, quantityAvailable: item.quantityAvailable,
    unit: item.unit, storageLocation: item.storageLocation, active: item.active,
    stockVersion: item.stockVersion, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

function serializeAllocation(item) {
  return {
    id: item._id.toString(), resource: item.resource.toString(), assistanceRequest: item.assistanceRequest.toString(),
    allocatedQuantity: item.allocatedQuantity, allocatedBy: item.allocatedBy.toString(),
    resourceName: item.resourceName, unit: item.unit, createdAt: item.createdAt, updatedAt: item.updatedAt,
  };
}

router.use(authenticate, authorizeRoles('admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/', async (req, res) => {
  objectBody(req.body, resourceFields);
  validateResource(req.body);
  const resource = new Resource(Object.fromEntries(resourceFields.map((field) => [field, req.body[field]])));
  await resource.save();
  await notifyRooms(req, ['role:admin'], 'resources:changed', { id: resource.id });
  res.status(201).json({ resource: serializeResource(resource) });
});

router.get('/', async (req, res) => {
  const page = pagination(req.query, ['active']);
  if (req.query.active !== undefined && !['true', 'false', 'all'].includes(req.query.active)) throw httpError(400, 'Choose a valid active filter');
  const filter = req.query.active && req.query.active !== 'all' ? { active: req.query.active === 'true' } : {};
  const [resources, total] = await Promise.all([
    Resource.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Resource.countDocuments(filter),
  ]);
  res.json({ resources: resources.map(serializeResource), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

router.get('/allocations', async (req, res) => {
  const page = pagination(req.query, ['resource', 'assistanceRequest']);
  const filter = {};
  for (const field of ['resource', 'assistanceRequest']) {
    if (req.query[field] !== undefined) { validId(req.query[field]); filter[field] = req.query[field]; }
  }
  const [allocations, total] = await Promise.all([
    ResourceAllocation.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ResourceAllocation.countDocuments(filter),
  ]);
  res.json({ allocations: allocations.map(serializeAllocation), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

router.patch('/:id', async (req, res) => {
  validId(req.params.id);
  objectBody(req.body, [...resourceFields, 'expectedVersion']);
  validVersion(req.body.expectedVersion);
  validateResource(req.body, true);
  const changes = Object.fromEntries(resourceFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
  if (!Object.keys(changes).length) throw httpError(400, 'Submit at least one resource field');
  const resource = await Resource.findOneAndUpdate(
    { _id: req.params.id, active: true, stockVersion: req.body.expectedVersion },
    { $set: changes, $inc: { stockVersion: 1 } }, { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!resource) {
    if (!await Resource.exists({ _id: req.params.id })) throw httpError(404, 'Resource not found');
    throw httpError(409, 'Resource unavailable or changed. Refresh inventory before editing');
  }
  await notifyRooms(req, ['role:admin'], 'resources:changed', { id: resource._id.toString() });
  res.json({ resource: serializeResource(resource) });
});

router.patch('/:id/deactivate', async (req, res) => {
  validId(req.params.id);
  objectBody(req.body, ['expectedVersion']);
  validVersion(req.body.expectedVersion);
  const resource = await Resource.findOneAndUpdate(
    { _id: req.params.id, active: true, stockVersion: req.body.expectedVersion },
    { $set: { active: false }, $inc: { stockVersion: 1 } }, { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!resource) {
    if (!await Resource.exists({ _id: req.params.id })) throw httpError(404, 'Resource not found');
    throw httpError(409, 'Resource unavailable or changed. Refresh inventory before deactivating');
  }
  await notifyRooms(req, ['role:admin'], 'resources:changed', { id: resource._id.toString() });
  res.json({ resource: serializeResource(resource) });
});

router.post('/:id/allocations', async (req, res) => {
  validId(req.params.id);
  objectBody(req.body, ['assistanceRequest', 'allocatedQuantity']);
  validId(req.body.assistanceRequest);
  const quantity = req.body.allocatedQuantity;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw httpError(400, 'Allocation quantity must be a positive safe whole number');

  let result;
  try {
    result = await mongoose.connection.transaction(async (session) => {
      // Write to the request as well as checking status. This prevents a completion or
      // cancellation racing between a status read and the stock deduction.
      const request = await AssistanceRequest.findOneAndUpdate(
        { _id: req.body.assistanceRequest, status: { $in: ['pending', 'assigned', 'in_progress'] } },
        { $inc: { __v: 1 } }, { session, returnDocument: 'after' },
      ).lean();
      if (!request) {
        if (!await AssistanceRequest.exists({ _id: req.body.assistanceRequest }).session(session)) throw httpError(404, 'Assistance request not found');
        throw httpError(409, 'Request completed or cancelled. Refresh the request');
      }
      const resource = await Resource.findOneAndUpdate(
        { _id: req.params.id, active: true, quantityAvailable: { $gte: quantity } },
        { $inc: { quantityAvailable: -quantity, stockVersion: 1 } },
        { session, returnDocument: 'after', runValidators: true },
      ).lean();
      if (!resource) {
        if (!await Resource.exists({ _id: req.params.id }).session(session)) throw httpError(404, 'Resource not found');
        throw httpError(409, 'Resource unavailable or insufficient stock. Refresh available resources');
      }
      const [allocation] = await ResourceAllocation.create([{
        resource: resource._id, assistanceRequest: request._id, allocatedQuantity: quantity,
        allocatedBy: req.user._id, resourceName: resource.name, unit: resource.unit,
      }], { session });
      return { resource: serializeResource(resource), allocation: serializeAllocation(allocation) };
    }, { readPreference: 'primary', writeConcern: { w: 'majority' } });
  } catch (error) {
    if (error.code === 20) throw httpError(503, 'Allocations require a MongoDB deployment that supports transactions');
    if (error.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      throw httpError(503, 'Allocation outcome could not be confirmed. Refresh stock and allocation history before retrying');
    }
    // Let the transaction abort; never issue a separate refund that could double-credit stock.
    throw error;
  }
  // Emit only after the stock deduction and allocation record have committed.
  await notifyRooms(req, ['role:admin'], 'allocations:changed', { resourceId: result.resource.id, requestId: result.allocation.assistanceRequest });
  res.status(201).json(result);
});

export default router;
