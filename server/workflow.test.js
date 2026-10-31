import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { io as connectClient } from 'socket.io-client';
import app from './app.js';
import User from './models/User.js';
import DisasterReport from './models/DisasterReport.js';
import AssistanceRequest from './models/AssistanceRequest.js';
import Resource from './models/Resource.js';
import ResourceAllocation from './models/ResourceAllocation.js';
import { issueToken } from './utils/auth.js';
import { attachRealtime } from './realtime.js';

// Opt in with MONGODB_TEST_URI pointing to a LOCAL replica set. Never load .env
// or fall back to MONGODB_URI. Only this run's random test database is dropped.
const uri = process.env.MONGODB_TEST_URI;
const models = [User, DisasterReport, AssistanceRequest, Resource, ResourceAllocation];
const password = 'Workflow test password 123!';
const profile = { name: 'Test Citizen', email: 'story@example.com', password, phone: '+94771234567' };
const reportInput = { title: 'Flood at Main Street', description: 'Water is rising near homes.', disasterType: 'flood', severity: 'high', location: { address: 'Main Street', latitude: 0, longitude: 0 } };
const requestInput = { assistanceType: 'water', description: 'Our household needs clean water.', location: 'Main Street', urgency: 'critical' };
const resourceInput = { name: 'Water bottles', category: 'water', quantityAvailable: 10, unit: 'bottles', storageLocation: 'Community centre' };

if (!uri) {
  console.info('MongoDB workflow suite not run: set MONGODB_TEST_URI to a local replica set.');
  test('MongoDB-backed HavenHub workflow', (context) => {
    context.skip('Set MONGODB_TEST_URI to run against an isolated local replica set');
  });
} else {
  describe('MongoDB-backed HavenHub workflow', { concurrency: false }, () => {
    let server; let io; let baseUrl; let hash; let actors; let clients;
    const databaseName = `havenhub_test_${randomUUID().replaceAll('-', '')}`;
    const originalSecret = process.env.JWT_SECRET;
    const originalExpiry = process.env.JWT_EXPIRES_IN_SECONDS;

    before(async () => {
      const target = new URL(uri);
      assert.equal(target.protocol, 'mongodb:', 'Only local MongoDB test deployments are supported');
      assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'MONGODB_TEST_URI must use a loopback host');
      process.env.JWT_SECRET = 'workflow-tests-only-secret-longer-than-thirty-two-bytes';
      process.env.JWT_EXPIRES_IN_SECONDS = '3600';
      await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 5000 });
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      assert.ok(hello.setName, 'Resource tests require a MongoDB replica set');
      await Promise.all(models.map((model) => model.init()));
      hash = await bcrypt.hash(password, 12);
      server = createServer(app); io = attachRealtime(server, app);
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });
    beforeEach(async () => {
      clients = [];
      await Promise.all(models.map((model) => model.deleteMany({})));
      actors = {};
      for (const [key, role] of [['admin', 'admin'], ['citizen', 'citizen'], ['other', 'citizen'], ['volunteer', 'volunteer']]) {
        const user = await User.create({ name: `Test ${key}`, email: `${key}@example.com`, passwordHash: hash, phone: '+94771234567', role });
        actors[key] = { user, token: issueToken(user) };
      }
    });
    afterEach(() => { clients?.forEach((socket) => socket.disconnect()); mock.restoreAll(); });
    after(async () => {
      if (io) await new Promise((resolve) => io.close(resolve));
      app.set('io', undefined);
      if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
      if (originalExpiry === undefined) delete process.env.JWT_EXPIRES_IN_SECONDS; else process.env.JWT_EXPIRES_IN_SECONDS = originalExpiry;
    });

    async function http(path, { actor = actors.admin, method = 'GET', body } = {}) {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method, signal: AbortSignal.timeout(10000),
        headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    async function assistance(actor = actors.citizen) {
      const result = await http('/requests', { actor, method: 'POST', body: requestInput });
      assert.equal(result.status, 201); return result.body.request;
    }
    async function stock() {
      const result = await http('/resources', { method: 'POST', body: resourceInput });
      assert.equal(result.status, 201); return result.body.resource;
    }
    const assign = (item, expectedVersion = 0, volunteerId = actors.volunteer.user.id, actor = actors.admin) => http(`/requests/${item.id}/assignment`, { actor, method: 'PATCH', body: { volunteerId, expectedVersion } });
    const task = (item, action, expectedVersion) => http(`/requests/${item.id}/task`, { actor: actors.volunteer, method: 'PATCH', body: { action, expectedVersion } });
    const allocate = (resource, item, allocatedQuantity) => http(`/resources/${resource.id}/allocations`, { method: 'POST', body: { assistanceRequest: item.id, allocatedQuantity } });

    test('citizen registration, login, verified disaster, assistance assignment, allocation, and volunteer completion work together', async () => {
      const registered = await http('/auth/register', { actor: null, method: 'POST', body: { ...profile, email: '  STORY@EXAMPLE.COM  ' } });
      assert.equal(registered.status, 201); assert.equal(registered.body.user.role, 'citizen');
      assert.equal(registered.body.user.email, profile.email); assert.equal(registered.body.user.passwordHash, undefined);
      const storedUser = await User.findById(registered.body.user.id).select('+passwordHash');
      assert.equal(await bcrypt.compare(password, storedUser.passwordHash), true);
      const login = await http('/auth/login', { actor: null, method: 'POST', body: { email: ' STORY@EXAMPLE.COM ', password } });
      assert.equal(login.status, 200); const citizen = { token: login.body.token };
      assert.equal((await http('/auth/me', { actor: citizen })).body.user.id, storedUser.id);
      const reported = await http('/disasters', { actor: citizen, method: 'POST', body: reportInput });
      assert.equal(reported.status, 201); const report = reported.body.report;
      assert.equal(report.status, 'pending'); assert.equal(report.reportedBy, storedUser.id);
      const reviewed = await http(`/disasters/${report.id}/status`, { method: 'PATCH', body: { status: 'verified' } });
      assert.equal(reviewed.status, 200);
      assert.equal((await http(`/disasters/${report.id}`, { actor: citizen })).body.report.status, 'verified');
      const created = await http('/requests', { actor: citizen, method: 'POST', body: { ...requestInput, disaster: report.id } });
      assert.equal(created.status, 201); const item = created.body.request;
      assert.equal(item.requester, storedUser.id); assert.equal(item.disaster, report.id);
      assert.equal((await assign(item)).status, 200);
      const tasks = await http('/requests/tasks', { actor: actors.volunteer });
      assert.deepEqual(tasks.body.requests.map((entry) => entry.id), [item.id]);
      assert.equal(tasks.body.requests[0].requester, undefined);
      const accepted = await task(item, 'accept', 1); assert.equal(accepted.status, 200); assert.ok(accepted.body.request.acceptedAt);
      const started = await task(item, 'start', 2); assert.equal(started.status, 200); assert.equal(started.body.request.status, 'in_progress');
      const resource = await stock(); const allocation = await allocate(resource, item, 4);
      assert.equal(allocation.status, 201); assert.equal(allocation.body.resource.quantityAvailable, 6);
      assert.equal(allocation.body.allocation.allocatedBy, actors.admin.user.id);
      const completed = await task(item, 'complete', 3); assert.equal(completed.status, 200); assert.equal(completed.body.request.status, 'completed');
      const citizenView = await http(`/requests/${item.id}`, { actor: citizen });
      assert.equal(citizenView.body.request.status, 'completed'); assert.ok(citizenView.body.request.completedAt);
      assert.equal((await allocate(resource, item, 1)).status, 409);
      assert.equal((await Resource.findById(resource.id)).quantityAvailable, 6);
      assert.equal(await ResourceAllocation.countDocuments({ assistanceRequest: item.id }), 1);
    });

    test('concurrent duplicate registrations are stopped by the real normalized-email unique index', async () => {
      const results = await Promise.all([profile.email, ` ${profile.email.toUpperCase()} `].map((email) => http('/auth/register', { actor: null, method: 'POST', body: { ...profile, email } })));
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal(await User.countDocuments({ email: profile.email }), 1);
    });

    test('assignment and volunteer transitions reject stale, repeated, or skipped actions without altering stored state', async () => {
      const item = await assistance();
      assert.equal((await assign(item)).status, 200);
      assert.equal((await task(item, 'start', 1)).status, 409);
      assert.equal((await task(item, 'complete', 1)).status, 409);
      const raced = await Promise.all([task(item, 'accept', 1), task(item, 'accept', 1)]);
      assert.deepEqual(raced.map((result) => result.status).sort(), [200, 409]);
      const stored = await AssistanceRequest.findById(item.id);
      assert.equal(stored.status, 'assigned'); assert.equal(stored.assignmentVersion, 2); assert.ok(stored.acceptedAt);
      assert.equal((await task(item, 'accept', 2)).status, 409);
      assert.equal((await assign(item, 0, actors.citizen.user.id)).status, 400);
    });

    test('competing admins cannot overwrite assignments using the same version', async () => {
      const item = await assistance();
      const second = await User.create({ name: 'Second volunteer', email: 'second-volunteer@example.com', phone: '+94771234567', role: 'volunteer', passwordHash: hash });
      const secondAdmin = await User.create({ name: 'Second admin', email: 'second-admin@example.com', phone: '+94771234567', role: 'admin', passwordHash: hash });
      const results = await Promise.all([assign(item), assign(item, 0, second.id, { token: issueToken(secondAdmin) })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      const winner = results.find((result) => result.status === 200).body.request;
      const stored = await AssistanceRequest.findById(item.id);
      assert.equal(stored.assignedVolunteer.toString(), winner.assignedVolunteer); assert.equal(stored.assignmentVersion, 1);
    });

    test('real concurrent transactions cannot overspend stock across different requests', async () => {
      const [first, second] = await Promise.all([assistance(), assistance()]); const resource = await stock();
      const results = await Promise.all([allocate(resource, first, 7), allocate(resource, second, 7)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal((await Resource.findById(resource.id)).quantityAvailable, 3);
      const records = await ResourceAllocation.find({ resource: resource.id });
      assert.equal(records.length, 1); assert.equal(records[0].allocatedQuantity, 7);
    });

    test('an allocation insert followed by failure rolls back the actual record, stock, and request write', async () => {
      const item = await assistance(); const resource = await stock(); const before = await AssistanceRequest.findById(item.id);
      const create = ResourceAllocation.create;
      mock.method(ResourceAllocation, 'create', async function (...args) {
        await create.apply(this, args); // The real insert succeeds inside the transaction.
        throw new Error('Injected failure after allocation insert');
      });
      assert.equal((await allocate(resource, item, 4)).status, 500);
      const stored = await Resource.findById(resource.id); const after = await AssistanceRequest.findById(item.id);
      assert.equal(stored.quantityAvailable, 10); assert.equal(stored.stockVersion, 0); assert.equal(after.__v, before.__v);
      assert.equal(await ResourceAllocation.countDocuments({}), 0);
    });

    test('invalid allocation quantities never modify persisted stock or create history', async () => {
      const item = await assistance(); const resource = await stock();
      for (const quantity of [0, -1, 0.5, null, '1', 'NaN', Number.MAX_SAFE_INTEGER + 1]) assert.equal((await allocate(resource, item, quantity)).status, 400);
      assert.equal((await allocate(resource, item, 11)).status, 409);
      assert.equal((await Resource.findById(resource.id)).quantityAvailable, 10); assert.equal(await ResourceAllocation.countDocuments({}), 0);
    });

    test('unauthenticated users, citizens, and volunteers cannot perform admin operations', async () => {
      const item = await assistance(); const resource = await stock();
      const report = await http('/disasters', { actor: actors.citizen, method: 'POST', body: reportInput });
      const operations = [
        [`/disasters/${report.body.report.id}/status`, 'PATCH', { status: 'verified' }],
        [`/requests/${item.id}/assignment`, 'PATCH', { volunteerId: actors.volunteer.user.id, expectedVersion: 0 }],
        [`/requests/${item.id}/assignment`, 'DELETE', { expectedVersion: 0 }],
        ['/resources', 'POST', resourceInput], ['/resources', 'GET'],
        [`/resources/${resource.id}`, 'PATCH', { quantityAvailable: 100, expectedVersion: 0 }],
        [`/resources/${resource.id}/deactivate`, 'PATCH', { expectedVersion: 0 }],
        [`/resources/${resource.id}/allocations`, 'POST', { assistanceRequest: item.id, allocatedQuantity: 1 }],
        ['/resources/allocations', 'GET'], ['/volunteers', 'GET'], ['/dashboard/summary', 'GET'],
      ];
      for (const actor of [null, actors.citizen, actors.volunteer]) {
        for (const [path, method, body] of operations) assert.equal((await http(path, { actor, method, body })).status, actor ? 403 : 401, `${method} ${path}`);
      }
      assert.equal((await DisasterReport.findById(report.body.report.id)).status, 'pending');
      assert.equal((await AssistanceRequest.findById(item.id)).status, 'pending');
      assert.equal((await Resource.findById(resource.id)).quantityAvailable, 10);
      assert.equal(await ResourceAllocation.countDocuments({}), 0);
    });

    test('citizens cannot read or cancel another citizen request at any lifecycle status', async () => {
      for (const status of ['pending', 'assigned', 'in_progress', 'completed', 'cancelled']) {
        const item = await AssistanceRequest.create({ ...requestInput, requester: actors.citizen.user._id, status });
        for (const [suffix, method] of [['', 'GET'], ['/cancel', 'PATCH']]) {
          const hidden = await http(`/requests/${item.id}${suffix}`, { actor: actors.other, method });
          const missing = await http(`/requests/000000000000000000000001${suffix}`, { actor: actors.other, method });
          assert.equal(hidden.status, 404); assert.deepEqual(hidden.body, missing.body);
        }
      }
      assert.equal((await http('/requests/mine', { actor: actors.other })).body.total, 0);
      assert.equal((await http('/requests/mine', { actor: actors.citizen })).body.total, 5);
      assert.equal((await http(`/requests/mine?requester=${actors.citizen.user.id}`, { actor: actors.other })).status, 400);
    });

    test('Socket.IO rejects missing authentication and takes roles from the real database', async () => {
      async function connect(auth, query) {
        const socket = connectClient(baseUrl, { autoConnect: false, reconnection: false, auth, query, timeout: 2000 });
        clients.push(socket);
        const outcome = new Promise((resolve) => { socket.once('connect', () => resolve(null)); socket.once('connect_error', resolve); });
        socket.connect(); return { socket, error: await outcome };
      }
      for (const [auth, query] of [[{}, {}], [{ token: 'invalid' }, {}], [{}, { token: actors.admin.token }]]) {
        const result = await connect(auth, query); assert.equal(result.error.data.code, 'UNAUTHENTICATED');
      }
      const { socket, error } = await connect({ token: actors.citizen.token, role: 'admin', rooms: ['role:admin'] });
      assert.equal(error, null);
      const rooms = io.sockets.sockets.get(socket.id).rooms;
      assert.ok(rooms.has('role:citizen')); assert.ok(rooms.has(`user:${actors.citizen.user.id}`)); assert.ok(!rooms.has('role:admin'));
    });
  });
}
