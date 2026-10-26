import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import app from './app.js';
import User from './models/User.js';
import DisasterReport from './models/DisasterReport.js';
import { issueToken } from './utils/auth.js';

// Only database calls are mocked. HTTP, JWT authorization, and model validation are real.
const reports = new Map();
const citizen = new User({ name: 'Citizen One', role: 'citizen' });
const otherCitizen = new User({ name: 'Citizen Two', role: 'citizen' });
const volunteer = new User({ name: 'Volunteer', role: 'volunteer' });
const admin = new User({ name: 'Admin', role: 'admin' });
const users = [citizen, otherCitizen, volunteer, admin];
const payload = {
  title: 'Flooding near Main Street', description: 'Water is rising across the road.',
  disasterType: 'flood', severity: 'high', location: { address: 'Main Street, Colombo' },
};
const originalSecret = process.env.JWT_SECRET;
let server;
let baseUrl;

function matches(report, filter) {
  return (!filter._id || report._id.toString() === filter._id.toString())
    && (!filter.reportedBy || report.reportedBy.toString() === filter.reportedBy.toString())
    && (!filter.status || (typeof filter.status === 'string' ? report.status === filter.status : filter.status.$in.includes(report.status)));
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/disasters`;
});

beforeEach(() => {
  reports.clear();
  process.env.JWT_SECRET = 'disaster-tests-only-secret-longer-than-thirty-two-bytes';
  mock.method(User, 'findById', async (id) => users.find((user) => user._id.toString() === id) || null);
  mock.method(DisasterReport.prototype, 'save', async function () {
    await this.validate();
    this.initializeTimestamps();
    reports.set(this._id.toString(), this.toObject());
    return this;
  });
  mock.method(DisasterReport, 'find', (filter) => {
    let skip = 0;
    let limit = 10;
    const query = {
      sort() { return query; },
      skip(value) { skip = value; return query; },
      limit(value) { limit = value; return query; },
      async lean() {
        return [...reports.values()].filter((report) => matches(report, filter))
          .sort((a, b) => b.createdAt - a.createdAt || b._id.toString().localeCompare(a._id.toString()))
          .slice(skip, skip + limit);
      },
    };
    return query;
  });
  mock.method(DisasterReport, 'countDocuments', async (filter) => [...reports.values()].filter((report) => matches(report, filter)).length);
  mock.method(DisasterReport, 'findOne', (filter) => ({
    async lean() { return [...reports.values()].find((report) => matches(report, filter)) || null; },
  }));
  mock.method(DisasterReport, 'findOneAndUpdate', (filter, update) => ({
    async lean() {
      const current = [...reports.values()].find((report) => matches(report, filter));
      if (!current) return null;
      const updated = new DisasterReport({ ...current, ...update.$set, updatedAt: new Date() });
      await updated.validate();
      // Simulate a conditional atomic write, including after concurrent validation.
      if (!matches(reports.get(current._id.toString()), filter)) return null;
      const stored = updated.toObject();
      reports.set(stored._id.toString(), stored);
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
    method,
    headers: { ...(user ? { Authorization: `Bearer ${issueToken(user)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function seed(values = {}) {
  const report = new DisasterReport({ ...payload, reportedBy: citizen._id, ...values });
  await report.save();
  return report;
}

test('all report endpoints require authentication', async () => {
  assert.equal((await request('', { user: null })).status, 401);
  assert.equal((await request('', { user: null, method: 'POST', body: payload })).status, 401);
  assert.equal((await request(`/${citizen._id}`, { user: null })).status, 401);
});

test('citizens create pending reports with server-owned identity, timestamps, and numeric zero coordinates', async () => {
  const result = await request('', { method: 'POST', body: { ...payload, title: '  Flood report  ', location: { address: '  Main Street  ', latitude: 0, longitude: 0 } } });
  assert.equal(result.status, 201);
  const report = result.body.report;
  assert.equal(report.title, 'Flood report');
  assert.equal(report.status, 'pending');
  assert.equal(report.reportedBy, citizen._id.toString());
  assert.deepEqual(report.location, { address: 'Main Street', latitude: 0, longitude: 0 });
  assert.ok(report.createdAt && report.updatedAt);
  assert.equal(report.__v, undefined);
  assert.equal(reports.size, 1);
});

test('volunteers and admins cannot submit reports', async () => {
  for (const user of [volunteer, admin]) assert.equal((await request('', { user, method: 'POST', body: payload })).status, 403);
  assert.equal(reports.size, 0);
});

test('clients cannot set status, reporter, IDs, or timestamps', async () => {
  for (const fields of [{ status: 'verified' }, { reportedBy: otherCitizen._id }, { _id: otherCitizen._id }, { createdAt: new Date() }]) {
    assert.equal((await request('', { method: 'POST', body: { ...payload, ...fields } })).status, 400);
  }
  assert.equal(reports.size, 0);
});

test('rejects malformed bodies, invalid enums, missing fields, and oversized text', async () => {
  for (const body of [
    [], {}, { ...payload, title: ' ' }, { ...payload, title: 42 }, { ...payload, title: 'x'.repeat(151) },
    { ...payload, description: '' }, { ...payload, description: 'x'.repeat(5001) },
    { ...payload, disasterType: 'earthquake' }, { ...payload, severity: 'urgent' },
    { ...payload, location: 'Colombo' }, { ...payload, location: { address: '' } },
    { ...payload, location: { address: 'x'.repeat(301) } }, { ...payload, location: { address: { $ne: '' } } },
  ]) assert.equal((await request('', { method: 'POST', body })).status, 400);
  assert.equal(reports.size, 0);
});

test('coordinates must be finite JSON numbers, supplied together, within geographic ranges', async () => {
  for (const coordinates of [
    { latitude: 6 }, { longitude: 79 }, { latitude: '6', longitude: '79' },
    { latitude: null, longitude: null }, { latitude: 91, longitude: 79 },
    { latitude: 6, longitude: -181 }, { latitude: {}, longitude: 79 },
  ]) {
    const result = await request('', { method: 'POST', body: { ...payload, location: { address: 'Colombo', ...coordinates } } });
    assert.equal(result.status, 400);
  }
  const valid = await request('', { method: 'POST', body: { ...payload, location: { address: 'Colombo', latitude: -90, longitude: 180 } } });
  assert.equal(valid.status, 201);
});

test('the schema also validates coordinate pairs, allowed statuses, and required ownership', async () => {
  for (const fields of [
    { location: { address: 'Colombo', latitude: 6 } }, { status: 'invalid' }, { reportedBy: undefined },
  ]) await assert.rejects(new DisasterReport({ ...payload, reportedBy: citizen._id, ...fields }).validate());
});

test('citizens list only their own reports regardless of status', async () => {
  const own = await seed({ status: 'rejected' });
  await seed({ reportedBy: otherCitizen._id, status: 'verified' });
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.deepEqual(result.body.reports.map((report) => report.id), [own.id]);
});

test('volunteers see only verified/resolved reports, without reporter identities', async () => {
  for (const status of ['pending', 'verified', 'rejected', 'resolved']) await seed({ status });
  const result = await request('', { user: volunteer });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 2);
  for (const report of result.body.reports) {
    assert.ok(['verified', 'resolved'].includes(report.status));
    assert.equal(report.reportedBy, undefined);
    const detail = await request(`/${report.id}`, { user: volunteer });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.report.reportedBy, undefined);
  }
});

test('admins can read all reports without receiving user contact details or password hashes', async () => {
  await seed();
  const other = await seed({ reportedBy: otherCitizen._id, status: 'rejected' });
  const result = await request('', { user: admin });
  assert.equal(result.body.total, 2);
  const detail = await request(`/${other.id}`, { user: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.report.reportedBy, otherCitizen._id.toString());
  assert.equal(detail.body.report.email, undefined);
  assert.equal(detail.body.report.phone, undefined);
  assert.equal(detail.body.report.passwordHash, undefined);
});

test('private and missing report IDs return the same 404 response', async () => {
  const other = await seed({ reportedBy: otherCitizen._id });
  const hidden = await request(`/${other.id}`);
  const missing = await request('/000000000000000000000001');
  assert.equal(hidden.status, 404);
  assert.deepEqual(hidden, missing);
  assert.equal((await request(`/${other.id}`, { user: volunteer })).status, 404);
  assert.equal((await request('/not-an-object-id')).status, 400);
});

test('lists are paginated newest first and scoped counts do not leak other citizens', async () => {
  for (let i = 0; i < 12; i += 1) await seed({ title: `Report ${i}`, createdAt: new Date(2026, 0, i + 1) });
  await seed({ reportedBy: otherCitizen._id });
  const first = await request();
  const second = await request('?page=2');
  assert.equal(first.body.reports.length, 10);
  assert.equal(second.body.reports.length, 2);
  assert.equal(first.body.total, 12);
  assert.equal(first.body.totalPages, 2);
  assert.equal(first.body.reports[0].title, 'Report 11');
  assert.equal(second.body.reports[1].title, 'Report 0');
});

test('rejects invalid pagination and query attempts to override visibility', async () => {
  for (const query of ['?page=0', '?page=-1', '?page=1.5', '?page=abc', '?page=9007199254740991', '?page=1&page=2', '?page[$gt]=0', `?reportedBy=${otherCitizen._id}`]) {
    assert.equal((await request(query)).status, 400);
  }
});

test('generic report updates and deletion remain unavailable', async () => {
  const report = await seed();
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    assert.equal((await request(`/${report.id}`, { method, user: admin, body: { status: 'verified' } })).status, 404);
  }
  assert.equal(reports.get(report.id).status, 'pending');
});

test('status changes require authentication and an admin role, including for the report owner', async () => {
  const report = await seed();
  const path = `/${report.id}/status`;
  assert.equal((await request(path, { user: null, method: 'PATCH', body: { status: 'verified' } })).status, 401);
  for (const user of [citizen, otherCitizen, volunteer]) {
    assert.equal((await request(path, { user, method: 'PATCH', body: { status: 'verified' } })).status, 403);
  }
  assert.equal(reports.get(report.id).status, 'pending');
});

test('admins can perform each allowed transition and citizens can read their updated statuses', async () => {
  for (const [from, to] of [['pending', 'verified'], ['pending', 'rejected'], ['verified', 'resolved']]) {
    const report = await seed({ status: from, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') });
    const result = await request(`/${report.id}/status`, { user: admin, method: 'PATCH', body: { status: to } });
    assert.equal(result.status, 200);
    assert.equal(result.body.report.status, to);
    assert.equal(result.body.report.id, report.id);
    assert.equal(result.body.report.reportedBy, citizen.id);
    assert.equal(result.body.report.severity, payload.severity);
    assert.equal(result.body.report.title, payload.title);
    assert.equal(result.body.report.createdAt, report.createdAt.toISOString());
    assert.ok(new Date(result.body.report.updatedAt) > report.updatedAt);
    assert.equal((await request(`/${report.id}`)).body.report.status, to);
    const list = await request();
    assert.equal(list.body.reports.find((item) => item.id === report.id).status, to);
  }
});

test('rejects all unsupported transitions, including repeats and changes from terminal statuses', async () => {
  const allowed = new Set(['pending:verified', 'pending:rejected', 'verified:resolved']);
  for (const from of ['pending', 'verified', 'rejected', 'resolved']) {
    for (const to of ['pending', 'verified', 'rejected', 'resolved']) {
      if (allowed.has(`${from}:${to}`)) continue;
      const report = await seed({ status: from });
      const result = await request(`/${report.id}/status`, { user: admin, method: 'PATCH', body: { status: to } });
      assert.equal(result.status, 409, `${from} -> ${to} must be rejected`);
      assert.equal(reports.get(report.id).status, from);
    }
  }
});

test('rejects invalid status payloads and attempts to change other report fields', async () => {
  const report = await seed();
  for (const body of [
    {}, [], { status: null }, { status: 'approved' }, { status: 'Verified' },
    { status: ['verified'] }, { status: { $ne: 'pending' } }, { status: 'toString' },
    { status: 'verified', reportedBy: admin.id }, { status: 'verified', severity: 'critical' },
  ]) assert.equal((await request(`/${report.id}/status`, { user: admin, method: 'PATCH', body })).status, 400);
  assert.equal(reports.get(report.id).status, 'pending');
});

test('status updates reject malformed IDs and return 404 for missing reports', async () => {
  assert.equal((await request('/invalid/status', { user: admin, method: 'PATCH', body: { status: 'verified' } })).status, 400);
  assert.equal((await request('/000000000000000000000001/status', { user: admin, method: 'PATCH', body: { status: 'verified' } })).status, 404);
});

test('competing admin reviews cannot overwrite each other', async () => {
  const report = await seed();
  const results = await Promise.all(['verified', 'rejected'].map((status) => request(`/${report.id}/status`, {
    user: admin, method: 'PATCH', body: { status },
  })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200);
  assert.equal(reports.get(report.id).status, winner.body.report.status);
});

test('admins can filter pending reports and the queue updates after review', async () => {
  const pending = await seed();
  await seed({ status: 'verified' });
  await seed({ status: 'rejected' });
  const queue = await request('?status=pending', { user: admin });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.total, 1);
  assert.deepEqual(queue.body.reports.map((report) => report.id), [pending.id]);
  await request(`/${pending.id}/status`, { user: admin, method: 'PATCH', body: { status: 'verified' } });
  assert.equal((await request('?status=pending', { user: admin })).body.total, 0);
  assert.equal((await request('', { user: volunteer })).body.total, 2);
});

test('status filters do not let citizens or volunteers bypass visibility restrictions', async () => {
  await seed({ reportedBy: otherCitizen._id });
  for (const user of [citizen, volunteer]) {
    assert.equal((await request('?status=pending', { user })).status, 403);
    assert.equal((await request('?status=verified', { user })).status, 403);
  }
  for (const query of ['?status=unknown', '?status=pending&status=verified', '?status[$ne]=resolved']) {
    assert.equal((await request(query, { user: admin })).status, 400);
  }
});

test('status update database errors return 500 without changing the report', async () => {
  const report = await seed();
  mock.method(DisasterReport, 'findOneAndUpdate', () => { throw new Error('internal database error'); });
  const result = await request(`/${report.id}/status`, { user: admin, method: 'PATCH', body: { status: 'verified' } });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
  assert.equal(reports.get(report.id).status, 'pending');
});

test('database failures return a generic 500 response', async () => {
  mock.method(DisasterReport.prototype, 'save', async () => { throw new Error('internal connection details'); });
  const result = await request('', { method: 'POST', body: payload });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});
