import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import app from './app.js';
import AssistanceRequest from './models/AssistanceRequest.js';
import DisasterReport from './models/DisasterReport.js';
import User from './models/User.js';
import { issueToken } from './utils/auth.js';

// MongoDB calls are mocked; HTTP, JWTs, authorization, and schema validation are real.
const items = new Map();
const citizen = new User({ role: 'citizen' });
const other = new User({ role: 'citizen' });
const volunteer = new User({ role: 'volunteer' });
const admin = new User({ role: 'admin' });
const users = [citizen, other, volunteer, admin];
const disaster = new DisasterReport({ reportedBy: citizen._id, title: 'Flood report' });
const otherDisaster = new DisasterReport({ reportedBy: other._id, title: 'Private report' });
const payload = { assistanceType: 'food', urgency: 'high', description: 'Food is needed for our household.', location: '12 Main Street, Colombo' };
const originalSecret = process.env.JWT_SECRET;
let server;
let baseUrl;

function matches(item, filter) {
  return item && Object.entries(filter).every(([key, value]) => item[key]?.toString() === value.toString());
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/requests`;
});

beforeEach(() => {
  items.clear();
  process.env.JWT_SECRET = 'assistance-tests-only-secret-longer-than-thirty-two-bytes';
  mock.method(User, 'findById', async (id) => users.find((user) => user.id === id) || null);
  mock.method(DisasterReport, 'findOne', (filter) => ({
    async lean() { return [disaster, otherDisaster].find((report) => matches(report, filter))?.toObject() || null; },
  }));
  mock.method(AssistanceRequest.prototype, 'save', async function () {
    await this.validate();
    this.initializeTimestamps();
    items.set(this.id, this.toObject());
    return this;
  });
  mock.method(AssistanceRequest, 'findOne', (filter) => ({
    async lean() { return [...items.values()].find((item) => matches(item, filter)) || null; },
  }));
  mock.method(AssistanceRequest, 'find', (filter) => {
    let skip = 0;
    let limit = 10;
    const query = {
      sort() { return query; }, skip(value) { skip = value; return query; }, limit(value) { limit = value; return query; },
      async lean() {
        return [...items.values()].filter((item) => matches(item, filter))
          .sort((a, b) => b.createdAt - a.createdAt || b._id.toString().localeCompare(a._id.toString()))
          .slice(skip, skip + limit);
      },
    };
    return query;
  });
  mock.method(AssistanceRequest, 'countDocuments', async (filter) => [...items.values()].filter((item) => matches(item, filter)).length);
  mock.method(AssistanceRequest, 'findOneAndUpdate', (filter, update) => ({
    async lean() {
      const current = [...items.values()].find((item) => matches(item, filter));
      if (!current) return null;
      const updated = new AssistanceRequest({ ...current, ...update.$set, updatedAt: new Date() });
      await updated.validate();
      if (!matches(items.get(current._id.toString()), filter)) return null;
      const stored = updated.toObject();
      items.set(updated.id, stored);
      return stored;
    },
  }));
});

afterEach(() => mock.restoreAll());
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

async function request(path = '', { user = citizen, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { ...(user ? { Authorization: `Bearer ${issueToken(user)}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function seed(fields = {}) {
  const item = new AssistanceRequest({ ...payload, requester: citizen._id, ...fields });
  await item.save();
  return item;
}

test('every assistance endpoint requires authentication', async () => {
  for (const [path, method] of [['', 'POST'], ['/mine', 'GET'], ['', 'GET'], [`/${citizen.id}`, 'GET'], [`/${citizen.id}/cancel`, 'PATCH']]) {
    assert.equal((await request(path, { user: null, method, ...(method === 'POST' ? { body: payload } : {}) })).status, 401);
  }
});

test('citizens create normalized pending requests with server-owned identity and timestamps', async () => {
  const result = await request('', { method: 'POST', body: { ...payload, location: '  Main Street  ' } });
  assert.equal(result.status, 201);
  assert.equal(result.body.request.requester, citizen.id);
  assert.equal(result.body.request.status, 'pending');
  assert.equal(result.body.request.location, 'Main Street');
  assert.ok(result.body.request.createdAt && result.body.request.updatedAt);
  assert.equal(result.body.request.disaster, undefined);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('volunteers and admins cannot submit requests or use the citizen-only mine endpoint', async () => {
  for (const user of [volunteer, admin]) {
    assert.equal((await request('', { user, method: 'POST', body: payload })).status, 403);
    assert.equal((await request('/mine', { user })).status, 403);
  }
  assert.equal((await request('', { user: citizen })).status, 403);
  assert.equal(items.size, 0);
});

test('rejects malformed fields, invalid enums, and attempts to set ownership or status', async () => {
  for (const body of [
    {}, [], null, { ...payload, assistanceType: 'cash' }, { ...payload, urgency: 'urgent' },
    { ...payload, description: ' ' }, { ...payload, description: 'x'.repeat(5001) },
    { ...payload, location: {} }, { ...payload, location: ' ' }, { ...payload, location: 'x'.repeat(301) },
    { ...payload, requester: other.id }, { ...payload, status: 'assigned' }, { ...payload, assignedTo: volunteer.id },
  ]) assert.equal((await request('', { method: 'POST', body })).status, 400);
  assert.equal(items.size, 0);
});

test('optional disaster links must identify an existing report owned by the requester', async () => {
  assert.equal((await request('', { method: 'POST', body: { ...payload, disaster: disaster.id } })).body.request.disaster, disaster.id);
  for (const id of [otherDisaster.id, '000000000000000000000001']) {
    assert.equal((await request('', { method: 'POST', body: { ...payload, disaster: id } })).status, 404);
  }
  for (const id of ['invalid', '', { $ne: null }]) {
    assert.equal((await request('', { method: 'POST', body: { ...payload, disaster: id } })).status, 400);
  }
});

test('mine lists only the current citizen requests, across all lifecycle statuses', async () => {
  for (const status of ['pending', 'assigned', 'in_progress', 'completed', 'cancelled']) await seed({ status });
  await seed({ requester: other._id });
  const result = await request('/mine');
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 5);
  assert.ok(result.body.requests.every((item) => item.requester === citizen.id));
  assert.equal((await request(`/mine?requester=${other.id}`)).status, 400);
});

test('other citizens cannot read or cancel private requests and private IDs look like missing IDs', async () => {
  const item = await seed({ requester: other._id });
  for (const suffix of ['', '/cancel']) {
    const method = suffix ? 'PATCH' : 'GET';
    const hidden = await request(`/${item.id}${suffix}`, { method });
    const missing = await request(`/000000000000000000000001${suffix}`, { method });
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, missing.body);
  }
  assert.equal(items.get(item.id).status, 'pending');
});

test('admins can filter all requests by combined urgency and status without populated contact details', async () => {
  const target = await seed({ requester: other._id, urgency: 'critical' });
  await seed({ urgency: 'low' });
  await seed({ urgency: 'critical', status: 'cancelled' });
  const result = await request('?urgency=critical&status=pending', { user: admin });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.requests[0].id, target.id);
  const detail = await request(`/${target.id}`, { user: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.request.requester, other.id);
  for (const field of ['email', 'phone', 'passwordHash', '__v']) assert.equal(detail.body.request[field], undefined);
});

test('volunteers receive only pending summaries with no description, location, disaster, or requester identity', async () => {
  const pending = await seed({ disaster: disaster._id });
  for (const status of ['assigned', 'in_progress', 'completed', 'cancelled']) await seed({ status });
  const result = await request('', { user: volunteer });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  const detail = await request(`/${pending.id}`, { user: volunteer });
  assert.equal(detail.status, 200);
  const fields = ['id', 'assistanceType', 'urgency', 'status', 'createdAt', 'updatedAt'].sort();
  assert.deepEqual(Object.keys(result.body.requests[0]).sort(), fields);
  assert.deepEqual(Object.keys(detail.body.request).sort(), fields);
  assert.equal((await request('?status=assigned', { user: volunteer })).status, 403);
  assert.equal((await request('?status=cancelled', { user: volunteer })).status, 403);
  const privateRequest = await seed({ status: 'assigned' });
  assert.equal((await request(`/${privateRequest.id}`, { user: volunteer })).status, 404);
});

test('citizens can cancel only their own pending requests and cannot change other fields', async () => {
  const item = await seed();
  const result = await request(`/${item.id}/cancel`, { method: 'PATCH' });
  assert.equal(result.status, 200);
  assert.equal(result.body.request.status, 'cancelled');
  assert.equal(result.body.request.description, payload.description);
  assert.equal(result.body.request.requester, citizen.id);
  assert.equal((await request(`/${item.id}/cancel`, { method: 'PATCH' })).status, 409);
  const pending = await seed();
  assert.equal((await request(`/${pending.id}/cancel`, { method: 'PATCH', body: { status: 'completed' } })).status, 400);
  assert.equal(items.get(pending.id).status, 'pending');
});

test('admins and volunteers cannot cancel and non-pending requests cannot be cancelled', async () => {
  const pending = await seed();
  for (const user of [admin, volunteer]) assert.equal((await request(`/${pending.id}/cancel`, { user, method: 'PATCH' })).status, 403);
  for (const status of ['assigned', 'in_progress', 'completed', 'cancelled']) {
    const item = await seed({ status });
    assert.equal((await request(`/${item.id}/cancel`, { method: 'PATCH' })).status, 409);
    assert.equal(items.get(item.id).status, status);
  }
});

test('cancellation detects a concurrent state change instead of overwriting it', async () => {
  const item = await seed();
  mock.method(AssistanceRequest, 'findOneAndUpdate', (filter) => ({ async lean() {
    assert.equal(filter.requester.toString(), citizen.id);
    assert.equal(filter.status, 'pending');
    items.get(item.id).status = 'assigned';
    return null;
  } }));
  assert.equal((await request(`/${item.id}/cancel`, { method: 'PATCH' })).status, 409);
  assert.equal(items.get(item.id).status, 'assigned');
});

test('counts and pagination stay scoped to the citizen or volunteer visibility', async () => {
  for (let i = 0; i < 12; i += 1) await seed({ createdAt: new Date(2026, 0, i + 1) });
  await seed({ requester: other._id, status: 'cancelled' });
  const second = await request('/mine?page=2');
  assert.equal(second.body.requests.length, 2);
  assert.equal(second.body.total, 12);
  assert.equal(second.body.totalPages, 2);
  assert.equal((await request('', { user: volunteer })).body.total, 12);
});

test('invalid IDs and malformed queue filters are rejected without data exposure', async () => {
  assert.equal((await request('/invalid')).status, 400);
  assert.equal((await request('/invalid/cancel', { method: 'PATCH' })).status, 400);
  for (const query of ['?page=0', '?page=1.5', '?page=1&page=2', '?status=unknown', '?urgency=urgent', '?status=pending&status=completed', '?status[$ne]=cancelled', `?requester=${other.id}`]) {
    assert.equal((await request(query, { user: admin })).status, 400);
  }
});

test('assignment, generic status updates, and deletion are not exposed', async () => {
  const item = await seed();
  for (const [path, method] of [[`/${item.id}/assign`, 'PATCH'], [`/${item.id}/status`, 'PATCH'], [`/${item.id}`, 'DELETE']]) {
    assert.equal((await request(path, { method, user: admin, body: { status: 'assigned' } })).status, 404);
  }
});

test('database failures produce generic errors without raw connection details', async () => {
  mock.method(AssistanceRequest.prototype, 'save', async () => { throw new Error('private database details'); });
  const result = await request('', { method: 'POST', body: payload });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});
