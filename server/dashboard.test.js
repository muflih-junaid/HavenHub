import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import app from './app.js';
import DisasterReport from './models/DisasterReport.js';
import AssistanceRequest from './models/AssistanceRequest.js';
import Resource from './models/Resource.js';
import User from './models/User.js';
import { issueToken } from './utils/auth.js';

// Only MongoDB queries are mocked. Requests use real HTTP, JWTs, and role middleware.
const admin = new User({ role: 'admin' });
const citizen = new User({ role: 'citizen' });
const volunteer = new User({ role: 'volunteer' });
const originalSecret = process.env.JWT_SECRET;
let reports;
let requests;
let resources;
let people;
let queries;
let server;
let baseUrl;

function matches(item, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(item[key]);
    if (value && typeof value === 'object' && '$lte' in value) return item[key] <= value.$lte;
    return item[key] === value;
  });
}
function query(items, filter, model) {
  queries.push({ model, filter, type: 'find' });
  let projection; let order; let limit;
  const result = {
    select(value) { projection = value.split(' '); return result; },
    sort(value) { order = value; return result; }, limit(value) { limit = value; return result; },
    async lean() {
      assert.equal(limit, 5, 'overview lists must be bounded');
      return items.filter((item) => matches(item, filter)).sort((a, b) => {
        for (const [key, direction] of Object.entries(order)) {
          const first = key === '_id' ? a[key].toString() : a[key];
          const second = key === '_id' ? b[key].toString() : b[key];
          if (first < second) return -direction;
          if (first > second) return direction;
        }
        return 0;
      }).slice(0, limit).map((item) => Object.fromEntries(['_id', ...projection].map((key) => [key, item[key]])));
    },
  };
  return result;
}
function report(fields = {}) {
  const item = new DisasterReport({ title: `Report ${reports.length}`, disasterType: 'flood', severity: 'high', status: 'pending', description: 'Private narrative', reportedBy: citizen._id, location: { address: 'Private address' }, createdAt: new Date('2026-01-01'), ...fields }).toObject();
  reports.push(item); return item;
}
function request(fields = {}) {
  const item = new AssistanceRequest({ assistanceType: 'water', urgency: 'high', status: 'pending', description: 'Private request', location: 'Private address', requester: citizen._id, createdAt: new Date('2026-01-01'), ...fields }).toObject();
  requests.push(item); return item;
}
function resource(fields = {}) {
  const item = new Resource({ name: 'Water bottles', category: 'water', quantityAvailable: 10, unit: 'bottles', storageLocation: 'Community centre', ...fields }).toObject();
  resources.push(item); return item;
}

before(async () => {
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dashboard/summary`;
});
beforeEach(() => {
  reports = []; requests = []; resources = []; people = []; queries = [];
  process.env.JWT_SECRET = 'dashboard-tests-only-secret-longer-than-thirty-two-bytes';
  mock.method(User, 'findById', async (id) => [admin, citizen, volunteer].find((person) => person.id === id) || null);
  for (const [model, getItems] of [[DisasterReport, () => reports], [AssistanceRequest, () => requests], [Resource, () => resources], [User, () => people]]) {
    mock.method(model, 'countDocuments', async (filter) => {
      queries.push({ model: model.modelName, filter, type: 'count' });
      return getItems().filter((item) => matches(item, filter)).length;
    });
  }
  mock.method(DisasterReport, 'find', (filter) => query(reports, filter, 'DisasterReport'));
  mock.method(AssistanceRequest, 'find', (filter) => query(requests, filter, 'AssistanceRequest'));
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
async function summary(user = admin, suffix = '', method = 'GET') {
  const response = await fetch(`${baseUrl}${suffix}`, { method, headers: user ? { Authorization: `Bearer ${issueToken(user)}` } : {} });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('only authenticated admins can access the summary; denied callers do not query operational data', async () => {
  for (const user of [null, citizen, volunteer]) assert.equal((await summary(user)).status, user ? 403 : 401);
  assert.deepEqual(queries, []);
  assert.equal((await summary()).status, 200);
});

test('each metric counts matching stored records, including all reports and resource entries', async () => {
  for (const status of ['pending', 'pending', 'verified', 'rejected', 'resolved']) report({ status });
  for (const status of ['pending', 'pending', 'assigned', 'assigned', 'in_progress', 'completed', 'cancelled']) request({ status });
  people.push(admin.toObject(), citizen.toObject(), volunteer.toObject(), new User({ role: 'volunteer' }).toObject());
  resource({ quantityAvailable: 0 }); resource({ quantityAvailable: 10 }); resource({ quantityAvailable: 11 }); resource({ active: false, quantityAvailable: 0 });
  const result = await summary();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.metrics, {
    disasters: { total: 5, pending: 2, verified: 1 }, requests: { pending: 2, active: 3, completed: 1 },
    volunteers: { total: 2 }, resources: { totalTypes: 4, lowStock: 2 },
  });
  assert.equal(result.body.lowStockThreshold, 10);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.ok(Number.isFinite(Date.parse(result.body.generatedAt)));
  assert.equal(queries.filter((entry) => entry.type === 'count').length, 9);
});

test('empty collections produce actual zero counts and empty lists', async () => {
  const result = await summary();
  assert.deepEqual(result.body.metrics, {
    disasters: { total: 0, pending: 0, verified: 0 }, requests: { pending: 0, active: 0, completed: 0 },
    volunteers: { total: 0 }, resources: { totalTypes: 0, lowStock: 0 },
  });
  assert.deepEqual(result.body.recentDisasters, []); assert.deepEqual(result.body.urgentPendingRequests, []);
});

test('summary counts reflect status changes and stock changes on the next request', async () => {
  const incident = report(); const assistance = request(); const stock = resource({ quantityAvailable: 11 });
  const first = await summary(); assert.equal(first.body.metrics.disasters.pending, 1); assert.equal(first.body.metrics.resources.lowStock, 0);
  incident.status = 'verified'; assistance.status = 'assigned'; stock.quantityAvailable = 9;
  people.push(volunteer.toObject());
  const second = await summary();
  assert.equal(second.body.metrics.disasters.pending, 0); assert.equal(second.body.metrics.disasters.verified, 1);
  assert.equal(second.body.metrics.requests.pending, 0); assert.equal(second.body.metrics.requests.active, 1);
  assert.equal(second.body.metrics.resources.lowStock, 1); assert.equal(second.body.metrics.volunteers.total, 1);
});

test('recent disasters are the five newest reports across all statuses with deterministic ties', async () => {
  for (let day = 1; day <= 7; day += 1) report({ title: `Day ${day}`, status: day % 2 ? 'resolved' : 'pending', createdAt: new Date(2026, 0, day) });
  const tied = report({ title: 'Same newest date', createdAt: new Date(2026, 0, 7) });
  const result = await summary();
  assert.equal(result.body.recentDisasters.length, 5);
  assert.equal(result.body.recentDisasters[0].id, tied._id.toString());
  assert.deepEqual(result.body.recentDisasters.map((item) => item.title), ['Same newest date', 'Day 7', 'Day 6', 'Day 5', 'Day 4']);
});

test('urgent pending requests prioritize critical, then oldest, excluding other statuses and urgencies', async () => {
  request({ urgency: 'high', createdAt: new Date(2025, 0, 1) });
  const critical = request({ urgency: 'critical', createdAt: new Date(2026, 0, 2) });
  const olderCritical = request({ urgency: 'critical', createdAt: new Date(2026, 0, 1) });
  for (const status of ['assigned', 'in_progress', 'completed', 'cancelled']) request({ status, urgency: 'critical' });
  for (const urgency of ['low', 'medium']) request({ urgency });
  const result = await summary();
  assert.deepEqual(result.body.urgentPendingRequests.map((item) => item.id), [olderCritical._id.toString(), critical._id.toString(), requests[0]._id.toString()]);
  assert.ok(result.body.urgentPendingRequests.every((item) => item.status === 'pending' && ['high', 'critical'].includes(item.urgency)));
  for (let i = 0; i < 8; i += 1) request({ urgency: 'critical' });
  assert.equal((await summary()).body.urgentPendingRequests.length, 5);
});

test('overview lists exclude citizen identity, contact details, and private free text', async () => {
  report(); request();
  const result = await summary();
  assert.deepEqual(Object.keys(result.body.recentDisasters[0]).sort(), ['id', 'title', 'disasterType', 'severity', 'status', 'createdAt'].sort());
  assert.deepEqual(Object.keys(result.body.urgentPendingRequests[0]).sort(), ['id', 'assistanceType', 'urgency', 'status', 'createdAt'].sort());
  for (const text of ['Private narrative', 'Private request', 'Private address', citizen.id]) assert.ok(!JSON.stringify(result.body).includes(text));
});

test('query attempts to alter filters, thresholds, or list sizes are rejected', async () => {
  for (const suffix of ['?status=completed', '?limit=1000', '?lowStockThreshold=999', '?role=citizen', '?status[$ne]=pending']) assert.equal((await summary(admin, suffix)).status, 400);
  assert.deepEqual(queries, []);
  assert.equal((await summary(admin, '', 'POST')).status, 404);
});

test('a database query failure returns a generic error instead of partial or invented statistics', async () => {
  mock.method(Resource, 'countDocuments', async () => { throw new Error('private database credentials'); });
  const result = await summary(); assert.equal(result.status, 500); assert.deepEqual(result.body, { message: 'Internal server error' });
});
