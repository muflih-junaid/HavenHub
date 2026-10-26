import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import mongoose from 'mongoose';
import app from './app.js';
import Resource from './models/Resource.js';
import ResourceAllocation from './models/ResourceAllocation.js';
import AssistanceRequest from './models/AssistanceRequest.js';
import User from './models/User.js';
import { issueToken } from './utils/auth.js';

// Real HTTP, JWTs, and model validation. The database mock isolates transaction
// writes until commit; it does not replace MongoDB integration testing.
let resources;
let allocations;
let requests;
let transactionQueue;
let recordFailure;
let commitFailure;
let unknownCommit;
let server;
let baseUrl;
const admin = new User({ role: 'admin' });
const citizen = new User({ role: 'citizen' });
const volunteer = new User({ role: 'volunteer' });
const originalSecret = process.env.JWT_SECRET;
const payload = { name: 'Water bottles', category: 'water', quantityAvailable: 10, unit: 'bottles', storageLocation: 'Community centre' };

function matches(item, filter) {
  return item && Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$gte' in value) return item[key] >= value.$gte;
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(item[key]);
    return item[key]?.toString() === value?.toString();
  });
}
function cloneMap(map) { return new Map([...map].map(([id, item]) => [id, { ...item }])); }
function listQuery(map, filter) {
  let skip = 0;
  let limit = 10;
  const query = {
    sort() { return query; }, skip(value) { skip = value; return query; }, limit(value) { limit = value; return query; },
    async lean() { return [...map.values()].filter((item) => matches(item, filter)).sort((a, b) => b.createdAt - a.createdAt || b._id.toString().localeCompare(a._id.toString())).slice(skip, skip + limit); },
  };
  return query;
}
function existsQuery(map, filter, sessionKey) {
  const find = (target) => [...target.values()].some((item) => matches(item, filter)) ? { _id: filter._id } : null;
  return { then(resolve, reject) { return Promise.resolve(find(map)).then(resolve, reject); }, async session(session) { return find(session[sessionKey]); } };
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/resources`;
});
beforeEach(() => {
  resources = new Map(); allocations = new Map(); requests = new Map();
  transactionQueue = Promise.resolve(); recordFailure = false; commitFailure = false; unknownCommit = false;
  process.env.JWT_SECRET = 'resource-tests-only-secret-longer-than-thirty-two-bytes';
  mock.method(User, 'findById', async (id) => [admin, citizen, volunteer].find((user) => user.id === id) || null);
  mock.method(Resource.prototype, 'save', async function () {
    await this.validate(); this.initializeTimestamps(); resources.set(this.id, this.toObject()); return this;
  });
  mock.method(Resource, 'find', (filter) => listQuery(resources, filter));
  mock.method(ResourceAllocation, 'find', (filter) => listQuery(allocations, filter));
  mock.method(Resource, 'countDocuments', async (filter) => [...resources.values()].filter((item) => matches(item, filter)).length);
  mock.method(ResourceAllocation, 'countDocuments', async (filter) => [...allocations.values()].filter((item) => matches(item, filter)).length);
  mock.method(Resource, 'exists', (filter) => existsQuery(resources, filter, 'resources'));
  mock.method(AssistanceRequest, 'exists', (filter) => existsQuery(requests, filter, 'requests'));
  mock.method(Resource, 'findOneAndUpdate', (filter, update, options) => ({ async lean() {
    const target = options.session?.resources || resources;
    const current = [...target.values()].find((item) => matches(item, filter));
    if (update.$inc?.quantityAvailable !== undefined) {
      assert.ok(options.session, 'stock deductions must use the transaction session');
      assert.equal(filter.quantityAvailable.$gte, -update.$inc.quantityAvailable);
      assert.equal(filter.active, true);
    }
    if (!current) return null;
    const values = { ...current, ...update.$set, updatedAt: new Date() };
    for (const [key, amount] of Object.entries(update.$inc || {})) values[key] = (values[key] || 0) + amount;
    const model = new Resource(values);
    await model.validate();
    if (!matches(target.get(model.id), filter)) return null;
    target.set(model.id, model.toObject());
    return model.toObject();
  } }));
  mock.method(AssistanceRequest, 'findOneAndUpdate', (filter, update, options) => ({ async lean() {
    assert.ok(options.session);
    assert.equal(update.$inc.__v, 1, 'write-lock the eligible request inside the transaction');
    const current = [...options.session.requests.values()].find((item) => matches(item, filter));
    if (!current) return null;
    const updated = { ...current, __v: (current.__v || 0) + 1 };
    options.session.requests.set(current._id.toString(), updated);
    return updated;
  } }));
  mock.method(ResourceAllocation, 'create', async (values, options) => {
    assert.ok(options.session, 'allocation records must use the same transaction');
    const created = [];
    for (const value of values) {
      const model = new ResourceAllocation(value);
      await model.validate(); model.initializeTimestamps();
      options.session.allocations.set(model.id, model.toObject()); created.push(model);
    }
    if (recordFailure) throw new Error('private allocation database failure');
    return created;
  });
  mock.method(mongoose.connection, 'transaction', (callback, options) => {
    assert.equal(options.writeConcern.w, 'majority');
    const run = transactionQueue.then(async () => {
      const session = { resources: cloneMap(resources), allocations: cloneMap(allocations), requests: cloneMap(requests) };
      const result = await callback(session);
      if (commitFailure) throw new Error('private commit failure');
      resources = session.resources; allocations = session.allocations; requests = session.requests;
      if (unknownCommit) {
        const error = new Error('private commit acknowledgement failure');
        error.hasErrorLabel = (label) => label === 'UnknownTransactionCommitResult';
        throw error;
      }
      return result;
    });
    transactionQueue = run.catch(() => {});
    return run;
  });
});
afterEach(() => { app.set('io', undefined); mock.restoreAll(); });
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
async function http(path = '', { user = admin, method = 'GET', body, rawBody } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { ...(user ? { Authorization: `Bearer ${issueToken(user)}` } : {}), ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined || rawBody !== undefined ? { body: rawBody ?? JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function seedResource(fields = {}) { const model = new Resource({ ...payload, ...fields }); await model.save(); return model; }
function seedRequest(status = 'pending') {
  const model = new AssistanceRequest({ requester: citizen._id, assistanceType: 'water', urgency: 'high', description: 'Water needed', location: 'Main Street', status });
  requests.set(model.id, model.toObject()); return model;
}
async function allocate(resource, request, quantity = 1) {
  return http(`/${resource.id}/allocations`, { method: 'POST', body: { assistanceRequest: request.id, allocatedQuantity: quantity } });
}

test('all resource endpoints require an authenticated admin', async () => {
  const resource = await seedResource(); const request = seedRequest();
  for (const [path, method, body] of [
    ['', 'GET'], ['', 'POST', payload], ['/allocations', 'GET'],
    [`/${resource.id}`, 'PATCH', { quantityAvailable: 5, expectedVersion: 0 }],
    [`/${resource.id}/deactivate`, 'PATCH', { expectedVersion: 0 }],
    [`/${resource.id}/allocations`, 'POST', { assistanceRequest: request.id, allocatedQuantity: 1 }],
  ]) for (const user of [null, citizen, volunteer]) assert.equal((await http(path, { user, method, body })).status, user ? 403 : 401);
  assert.equal(resources.get(resource.id).quantityAvailable, 10);
});

test('admins create, list, edit and deactivate stock; history and inactive records remain', async () => {
  const created = await http('', { method: 'POST', body: { ...payload, name: '  Water bottles  ' } });
  assert.equal(created.status, 201); const resource = created.body.resource;
  assert.equal(resource.name, 'Water bottles'); assert.equal(resource.stockVersion, 0); assert.equal(resource.active, true);
  assert.ok(resource.createdAt && resource.updatedAt);
  assert.equal((await http()).body.total, 1);
  assert.equal((await http()).headers.get('cache-control'), 'no-store');
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { quantityAvailable: 0, storageLocation: 'New storage', expectedVersion: 0 } })).status, 200);
  assert.equal((await http(`/${resource.id}/deactivate`, { method: 'PATCH', body: { expectedVersion: 1 } })).status, 200);
  assert.equal((await http('?active=true')).body.total, 0);
  assert.equal((await http('?active=false')).body.resources[0].active, false);
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { name: 'Changed', expectedVersion: 2 } })).status, 409);
  assert.equal((await http(`/${resource.id}`, { method: 'DELETE' })).status, 404);
});

test('rejects invalid stock, malformed fields, and user-controlled internal fields', async () => {
  for (const body of [null, [], {}, { ...payload, category: 'cash' }, { ...payload, name: ' ' }, { ...payload, unit: ' ' }, { ...payload, storageLocation: 'x'.repeat(301) },
    ...[-1, 0.5, null, '10', 'NaN', Number.MAX_SAFE_INTEGER + 1, Infinity, NaN].map((quantityAvailable) => ({ ...payload, quantityAvailable })),
    { ...payload, active: false }, { ...payload, stockVersion: 5 },
  ]) assert.equal((await http('', { method: 'POST', body })).status, 400);
  assert.equal((await http('', { method: 'POST', body: { ...payload, quantityAvailable: 0 } })).status, 201);
});

test('schemas also reject fractional, negative, unsafe, and non-finite quantities', async () => {
  for (const quantity of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(new Resource({ ...payload, quantityAvailable: quantity }).validate());
    await assert.rejects(new ResourceAllocation({ resource: admin._id, assistanceRequest: citizen._id, allocatedBy: admin._id, resourceName: 'Water', unit: 'bottles', allocatedQuantity: quantity }).validate());
  }
  await assert.rejects(new ResourceAllocation({ resource: admin._id, assistanceRequest: citizen._id, allocatedBy: admin._id, resourceName: 'Water', unit: 'bottles', allocatedQuantity: 0 }).validate());
});

test('allocation deducts stock once and creates a sanitized record with server-owned admin and unit', async () => {
  const resource = await seedResource(); const request = seedRequest();
  const result = await allocate(resource, request, 4);
  assert.equal(result.status, 201); assert.equal(result.body.resource.quantityAvailable, 6);
  assert.equal(result.body.resource.stockVersion, 1);
  assert.equal(result.body.allocation.allocatedQuantity, 4); assert.equal(result.body.allocation.allocatedBy, admin.id);
  assert.equal(result.body.allocation.unit, 'bottles'); assert.equal(result.body.allocation.resourceName, payload.name);
  assert.ok(result.body.allocation.createdAt && result.body.allocation.updatedAt);
  for (const field of ['email', 'phone', 'requester', 'passwordHash', '__v']) assert.equal(result.body.allocation[field], undefined);
  assert.equal(allocations.size, 1);
});

test('exact remaining stock can be allocated, but oversubscription and depleted stock fail', async () => {
  const resource = await seedResource(); const request = seedRequest();
  assert.equal((await allocate(resource, request, 11)).status, 409);
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(allocations.size, 0);
  assert.equal((await allocate(resource, request, 10)).status, 201);
  assert.equal((await allocate(resource, request)).status, 409);
  assert.equal(resources.get(resource.id).quantityAvailable, 0); assert.equal(allocations.size, 1);
});

test('two concurrent allocations cannot overspend the same resource', async () => {
  const resource = await seedResource(); const first = seedRequest(); const second = seedRequest();
  const results = await Promise.all([allocate(resource, first, 7), allocate(resource, second, 7)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(resources.get(resource.id).quantityAvailable, 3);
  assert.equal([...allocations.values()].reduce((sum, item) => sum + item.allocatedQuantity, 0), 7);
});

test('allocations accept only positive safe whole numbers and valid IDs', async () => {
  const resource = await seedResource(); const request = seedRequest();
  for (const quantity of [0, -1, 0.5, '1', 'NaN', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await allocate(resource, request, quantity)).status, 400);
  for (const body of [null, [], {}, { assistanceRequest: request.id, allocatedQuantity: 1, allocatedBy: citizen.id }, { assistanceRequest: { $ne: null }, allocatedQuantity: 1 }]) {
    assert.equal((await http(`/${resource.id}/allocations`, { method: 'POST', body })).status, 400);
  }
  assert.equal((await http(`/${resource.id}/allocations`, { method: 'POST', rawBody: `{"assistanceRequest":"${request.id}","allocatedQuantity":1e999}` })).status, 400);
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(allocations.size, 0);
});

test('completed, cancelled, inactive, and missing records cannot receive allocations', async () => {
  const resource = await seedResource();
  for (const status of ['completed', 'cancelled']) assert.equal((await allocate(resource, seedRequest(status))).status, 409);
  assert.equal((await allocate(resource, { id: '000000000000000000000001' })).status, 404);
  const request = seedRequest();
  assert.equal((await allocate({ id: '000000000000000000000001' }, request)).status, 404);
  resources.get(resource.id).active = false;
  assert.equal((await allocate(resource, request)).status, 409);
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(allocations.size, 0);
});

test('pending, assigned, and in-progress requests are eligible', async () => {
  const resource = await seedResource();
  for (const status of ['pending', 'assigned', 'in_progress']) assert.equal((await allocate(resource, seedRequest(status))).status, 201);
  assert.equal(resources.get(resource.id).quantityAvailable, 7);
});

test('allocation-record failure rolls back stock and the request write', async () => {
  const resource = await seedResource(); const request = seedRequest(); recordFailure = true;
  const result = await allocate(resource, request, 5);
  assert.equal(result.status, 500); assert.deepEqual(result.body, { message: 'Internal server error' });
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(resources.get(resource.id).stockVersion, 0);
  assert.equal(requests.get(request.id).__v, undefined); assert.equal(allocations.size, 0);
});

test('commit failure cannot publish only the stock deduction', async () => {
  const resource = await seedResource(); const request = seedRequest(); commitFailure = true;
  assert.equal((await allocate(resource, request, 5)).status, 500);
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(allocations.size, 0);
});

test('uncertain commit results never trigger a separate refund or duplicate allocation', async () => {
  const resource = await seedResource(); const request = seedRequest(); unknownCommit = true;
  assert.equal((await allocate(resource, request, 3)).status, 503);
  assert.equal(resources.get(resource.id).quantityAvailable, 7); assert.equal(allocations.size, 1);
});

test('unsupported transactions fail safely without falling back to unprotected stock writes', async () => {
  const resource = await seedResource(); const request = seedRequest();
  mock.method(mongoose.connection, 'transaction', async () => { const error = new Error('private deployment details'); error.code = 20; throw error; });
  assert.equal((await allocate(resource, request)).status, 503);
  assert.equal(resources.get(resource.id).quantityAvailable, 10); assert.equal(allocations.size, 0);
});

test('stale inventory edits and deactivations cannot overwrite stock changed by allocations', async () => {
  const resource = await seedResource(); const request = seedRequest(); await allocate(resource, request, 4);
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { ...payload, expectedVersion: 0 } })).status, 409);
  assert.equal((await http(`/${resource.id}/deactivate`, { method: 'PATCH', body: { expectedVersion: 0 } })).status, 409);
  assert.equal(resources.get(resource.id).quantityAvailable, 6);
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { name: 'Water', expectedVersion: 1 } })).status, 200);
  assert.equal(resources.get(resource.id).quantityAvailable, 6);
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { expectedVersion: 2 } })).status, 400);
});

test('paginated allocation history supports resource and request filters and retains original names and units', async () => {
  const resource = await seedResource(); const request = seedRequest(); const other = seedRequest();
  await allocate(resource, request, 2); await allocate(resource, other);
  assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body: { name: 'Renamed', unit: 'packs', expectedVersion: 2 } })).status, 200);
  const result = await http(`/allocations?resource=${resource.id}&assistanceRequest=${request.id}`);
  assert.equal(result.body.total, 1); assert.equal(result.body.allocations[0].resourceName, payload.name); assert.equal(result.body.allocations[0].unit, 'bottles');
  assert.equal((await http('/allocations?page=2')).body.allocations.length, 0);
  await http(`/${resource.id}/deactivate`, { method: 'PATCH', body: { expectedVersion: 3 } });
  assert.equal((await http('/allocations')).body.total, 2);
});

test('malformed filters, IDs, edit quantities, and versions are rejected', async () => {
  const resource = await seedResource();
  for (const query of ['?page=0', '?page=1&page=2', '?active[$ne]=false', '?active=yes', '?category=other']) assert.equal((await http(query)).status, 400);
  for (const query of ['?page=0', '?resource=bad', '?assistanceRequest[$ne]=null', '?allocatedBy=any']) assert.equal((await http(`/allocations${query}`)).status, 400);
  for (const body of [{ quantityAvailable: 0.2, expectedVersion: 0 }, { quantityAvailable: -1, expectedVersion: 0 }, { active: false, expectedVersion: 0 }, { name: 'New', expectedVersion: '0' }, { name: 'New', expectedVersion: -1 }]) assert.equal((await http(`/${resource.id}`, { method: 'PATCH', body })).status, 400);
  assert.equal((await http('/bad', { method: 'PATCH', body: { name: 'New', expectedVersion: 0 } })).status, 400);
  assert.equal((await http('/000000000000000000000001', { method: 'PATCH', body: { name: 'New', expectedVersion: 0 } })).status, 404);
});


test('allocation notifications are admin-only and emitted only after a successful commit', async () => {
  const resource = await seedResource(); const request = seedRequest();
  const emitted = [];
  const socket = {
    connected: true, data: { userId: admin.id, role: 'admin' }, handshake: { auth: { token: issueToken(admin) } },
    emit(event, payload) {
      assert.equal(resources.get(resource.id).quantityAvailable, 6);
      assert.equal(allocations.size, 1, 'the allocation must already be committed before notifying');
      emitted.push({ event, payload });
    },
    disconnect() { assert.fail('valid admin should remain connected'); },
  };
  app.set('io', { in(rooms) { assert.deepEqual(rooms, ['role:admin']); return { async fetchSockets() { return [socket]; } }; } });
  recordFailure = true;
  assert.equal((await allocate(resource, request, 4)).status, 500);
  assert.deepEqual(emitted, []);
  recordFailure = false;
  assert.equal((await allocate(resource, request, 4)).status, 201);
  assert.deepEqual(emitted, [{ event: 'allocations:changed', payload: { resourceId: resource.id, requestId: request.id } }]);
});
