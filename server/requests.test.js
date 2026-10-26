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
const secondVolunteer = new User({ role: 'volunteer', name: 'Second volunteer', location: 'Colombo' });
const admin = new User({ role: 'admin' });
const secondAdmin = new User({ role: 'admin' });
const users = [citizen, other, volunteer, secondVolunteer, admin, secondAdmin];
const disaster = new DisasterReport({ reportedBy: citizen._id, title: 'Flood report' });
const otherDisaster = new DisasterReport({ reportedBy: other._id, title: 'Private report' });
const payload = { assistanceType: 'food', urgency: 'high', description: 'Food is needed for our household.', location: '12 Main Street, Colombo' };
const originalSecret = process.env.JWT_SECRET;
let server;
let baseUrl;

function matches(item, filter) {
  return item && Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((part) => matches(item, part));
    if (value && typeof value === 'object' && '$exists' in value) return (item[key] !== undefined) === value.$exists;
    if (value && typeof value === 'object' && '$in' in value) return value.$in.some((entry) => item[key]?.toString() === entry.toString());
    return item[key]?.toString() === value?.toString();
  });
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
  mock.method(User, 'find', (filter) => {
    let skip = 0;
    let limit = 10;
    const query = {
      select(fields) { assert.equal(fields, 'name location'); return query; },
      sort() { return query; }, skip(value) { skip = value; return query; }, limit(value) { limit = value; return query; },
      async lean() { return users.filter((user) => matches(user, filter)).slice(skip, skip + limit).map((user) => user.toObject()); },
    };
    return query;
  });
  mock.method(User, 'countDocuments', async (filter) => users.filter((user) => matches(user, filter)).length);
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
      const updated = new AssistanceRequest({
        ...current, ...update.$set, updatedAt: new Date(),
        assignmentVersion: (current.assignmentVersion ?? 0) + (update.$inc?.assignmentVersion ?? 0),
      });
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

test('generic status updates, legacy assign endpoint, and request deletion are not exposed', async () => {
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

async function assign(item, person = volunteer, version = 0, actingAdmin = admin) {
  return request(`/${item.id}/assignment`, { user: actingAdmin, method: 'PATCH', body: { volunteerId: person.id, expectedVersion: version } });
}

async function task(item, action, version, user = volunteer) {
  return request(`/${item.id}/task`, { user, method: 'PATCH', body: { action, expectedVersion: version } });
}

test('only admins can list registered volunteers, with no email, phone, or credentials', async () => {
  async function catalog(user, query = '') {
    const response = await fetch(`${baseUrl.replace('/requests', '/volunteers')}${query}`, { headers: user ? { Authorization: `Bearer ${issueToken(user)}` } : {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  for (const user of [null, citizen, volunteer]) assert.equal((await catalog(user)).status, user ? 403 : 401);
  const result = await catalog(admin);
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 2);
  assert.deepEqual(result.body.volunteers.map((person) => person.id), [volunteer.id, secondVolunteer.id]);
  for (const person of result.body.volunteers) assert.ok(Object.keys(person).every((key) => ['id', 'name', 'location'].includes(key)));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  for (const query of ['?page=0', '?page=1&page=2', '?role=admin']) assert.equal((await catalog(admin, query)).status, 400);
  assert.deepEqual((await catalog(admin, '?page=2')).body.volunteers, []);
});

test('admin assigns a registered volunteer to pending requests with timestamps and a version', async () => {
  const item = await seed();
  const result = await assign(item);
  assert.equal(result.status, 200);
  assert.equal(result.body.request.status, 'assigned');
  assert.equal(result.body.request.assignedVolunteer, volunteer.id);
  assert.equal(result.body.request.assignmentVersion, 1);
  assert.ok(result.body.request.assignedAt);
  assert.equal(result.body.request.acceptedAt, null);
  assert.equal((await request(`/${item.id}`)).body.request.assignedVolunteer, volunteer.id);
  assert.equal((await request(`/${item.id}/cancel`, { method: 'PATCH' })).status, 409);
});

test('assignment endpoints require authentication and restrict admin and volunteer actions', async () => {
  const item = await seed();
  for (const [suffix, method, body] of [
    ['assignment', 'PATCH', { volunteerId: volunteer.id, expectedVersion: 0 }],
    ['assignment', 'DELETE', { expectedVersion: 0 }],
    ['task', 'PATCH', { action: 'accept', expectedVersion: 0 }],
  ]) {
    assert.equal((await request(`/${item.id}/${suffix}`, { user: null, method, body })).status, 401);
    const deniedUsers = suffix === 'task' ? [citizen, admin] : [citizen, volunteer];
    for (const user of deniedUsers) assert.equal((await request(`/${item.id}/${suffix}`, { user, method, body })).status, 403);
  }
  for (const user of [null, citizen, admin]) assert.equal((await request('/tasks', { user })).status, user ? 403 : 401);
});

test('assignment validates IDs, roles, version numbers, and rejects extra fields', async () => {
  const item = await seed();
  for (const body of [null, [], {}, { volunteerId: volunteer.id },
    ...[-1, 0.5, '0', Number.MAX_SAFE_INTEGER].map((expectedVersion) => ({ volunteerId: volunteer.id, expectedVersion })),
    { volunteerId: citizen.id, expectedVersion: 0 }, { volunteerId: admin.id, expectedVersion: 0 },
    { volunteerId: '000000000000000000000001', expectedVersion: 0 },
    { volunteerId: { $ne: null }, expectedVersion: 0 },
    { volunteerId: volunteer.id, expectedVersion: 0, status: 'completed' },
  ]) assert.equal((await request(`/${item.id}/assignment`, { user: admin, method: 'PATCH', body })).status, 400);
  assert.equal((await request('/invalid/assignment', { user: admin, method: 'PATCH', body: { volunteerId: volunteer.id, expectedVersion: 0 } })).status, 400);
  assert.equal((await assign({ id: '000000000000000000000001' })).status, 404);
  for (const status of ['completed', 'cancelled']) assert.equal((await assign(await seed({ status }))).status, 409);
  assert.equal(items.get(item.id).status, 'pending');
});

test('only the assigned volunteer sees task details; My Tasks is scoped, including completed work', async () => {
  const own = await seed({ disaster: disaster._id });
  const theirs = await seed();
  await assign(own);
  await assign(theirs, secondVolunteer);
  await seed({ status: 'completed', assignedVolunteer: volunteer._id });
  await seed();
  const result = await request('/tasks', { user: volunteer });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 2);
  assert.ok(result.body.requests.every((item) => item.assignedVolunteer === volunteer.id));
  const detail = (await request(`/${own.id}`, { user: volunteer })).body.request;
  assert.equal(detail.description, payload.description);
  assert.equal(detail.location, payload.location);
  for (const field of ['requester', 'email', 'phone', 'passwordHash', 'disaster']) assert.equal(detail[field], undefined);
  assert.equal((await request(`/${theirs.id}`, { user: volunteer })).status, 404);
  assert.equal((await task(theirs, 'accept', 1)).status, 404);
  assert.equal((await request('/tasks?assignedVolunteer=other', { user: volunteer })).status, 400);
});

test('volunteers must accept, start, then complete; repeated or skipped actions fail', async () => {
  const item = await seed();
  await assign(item);
  assert.equal((await task(item, 'start', 1)).status, 409);
  assert.equal((await task(item, 'complete', 1)).status, 409);
  const accepted = await task(item, 'accept', 1);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.request.status, 'assigned');
  assert.ok(accepted.body.request.acceptedAt);
  assert.equal(accepted.body.request.assignmentVersion, 2);
  assert.equal((await task(item, 'accept', 2)).status, 409);
  const started = await task(item, 'start', 2);
  assert.equal(started.status, 200);
  assert.equal(started.body.request.status, 'in_progress');
  assert.ok(started.body.request.startedAt);
  assert.equal((await task(item, 'start', 3)).status, 409);
  const completed = await task(item, 'complete', 3);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.request.status, 'completed');
  assert.ok(completed.body.request.completedAt);
  assert.equal(completed.body.request.assignmentVersion, 4);
  assert.equal((await task(item, 'complete', 4)).status, 409);
  assert.equal((await assign(item, secondVolunteer, 4)).status, 409);
  assert.equal((await request(`/${item.id}/assignment`, { user: admin, method: 'DELETE', body: { expectedVersion: 4 } })).status, 409);
});

test('admin reassignment resets progress and removes previous volunteer access immediately', async () => {
  const item = await seed();
  await assign(item);
  await task(item, 'accept', 1);
  await task(item, 'start', 2);
  const reassigned = await assign(item, secondVolunteer, 3);
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.request.status, 'assigned');
  assert.equal(reassigned.body.request.assignedVolunteer, secondVolunteer.id);
  assert.equal(reassigned.body.request.acceptedAt, null);
  assert.equal(reassigned.body.request.startedAt, null);
  assert.equal((await request(`/${item.id}`, { user: volunteer })).status, 404);
  assert.equal((await request('/tasks', { user: volunteer })).body.total, 0);
  assert.equal((await task(item, 'complete', 3)).status, 404);
  assert.equal((await task(item, 'accept', 4, secondVolunteer)).status, 200);
});

test('cancelling an assignment returns it to pending, redacts volunteers again, and permits citizen cancellation', async () => {
  const item = await seed();
  await assign(item);
  await task(item, 'accept', 1);
  await task(item, 'start', 2);
  const result = await request(`/${item.id}/assignment`, { user: admin, method: 'DELETE', body: { expectedVersion: 3 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.request.status, 'pending');
  assert.equal(result.body.request.assignedVolunteer, null);
  for (const field of ['assignedAt', 'acceptedAt', 'startedAt', 'completedAt']) assert.equal(result.body.request[field], null);
  assert.ok(result.body.request.assignmentCancelledAt);
  assert.equal(result.body.request.assignmentVersion, 4);
  assert.equal((await request(`/${item.id}`, { user: volunteer })).body.request.description, undefined);
  assert.equal((await task(item, 'accept', 4)).status, 404);
  assert.equal((await request(`/${item.id}/cancel`, { method: 'PATCH' })).status, 200);
});

test('two concurrent admins cannot assign over each other and stale reassignments fail', async () => {
  const item = await seed();
  const results = await Promise.all([assign(item), assign(item, secondVolunteer, 0, secondAdmin)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200).body.request;
  const next = winner.assignedVolunteer === volunteer.id ? secondVolunteer : volunteer;
  assert.equal((await assign(item, next, 0)).status, 409);
  assert.equal(items.get(item.id).assignedVolunteer.toString(), winner.assignedVolunteer);
  assert.equal(items.get(item.id).assignmentVersion, 1);
});

test('version checks detect stale pages even when assignment returns to the same volunteer', async () => {
  const item = await seed();
  await assign(item);
  await assign(item, secondVolunteer, 1);
  await assign(item, volunteer, 2);
  assert.equal((await task(item, 'accept', 1)).status, 409);
  assert.equal((await assign(item, secondVolunteer, 1)).status, 409);
  assert.equal((await request(`/${item.id}/assignment`, { user: admin, method: 'DELETE', body: { expectedVersion: 1 } })).status, 409);
  assert.equal(items.get(item.id).acceptedAt, null);
});

test('acceptance and reassignment races yield one success and reject the other update', async () => {
  const item = await seed();
  await assign(item);
  const results = await Promise.all([task(item, 'accept', 1), assign(item, secondVolunteer, 1)]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  // If reassignment wins before the volunteer read, the ownership check returns 404.
  assert.ok(results.some((result) => [404, 409].includes(result.status)));
  assert.equal(items.get(item.id).assignmentVersion, 2);
});

test('legacy requests without an assignment version can be assigned without a migration', async () => {
  const item = await seed();
  delete items.get(item.id).assignmentVersion;
  assert.equal((await request(`/${item.id}`, { user: admin })).body.request.assignmentVersion, 0);
  assert.equal((await assign(item)).status, 200);
  assert.equal(items.get(item.id).assignmentVersion, 1);
});

test('invalid volunteer actions and assignment cancellation payloads fail validation', async () => {
  const item = await seed();
  await assign(item);
  for (const body of [{ action: 'complete', expectedVersion: '1' }, { action: 'reject', expectedVersion: 1 }, { action: 'accept', expectedVersion: 1, assignedVolunteer: secondVolunteer.id }]) {
    assert.equal((await request(`/${item.id}/task`, { user: volunteer, method: 'PATCH', body })).status, 400);
  }
  for (const body of [undefined, null, {}, { expectedVersion: 1, status: 'cancelled' }]) {
    assert.equal((await request(`/${item.id}/assignment`, { user: admin, method: 'DELETE', body })).status, 400);
  }
  const pending = await seed();
  assert.equal((await request(`/${pending.id}/assignment`, { user: admin, method: 'DELETE', body: { expectedVersion: 0 } })).status, 409);
  assert.equal((await assign(item, volunteer, 1)).status, 409);
});
