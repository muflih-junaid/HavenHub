import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { io as connectClient } from 'socket.io-client';
import app from './app.js';
import User from './models/User.js';
import DisasterReport from './models/DisasterReport.js';
import AssistanceRequest from './models/AssistanceRequest.js';
import { issueToken } from './utils/auth.js';
import { attachRealtime, notifyRooms, notifyRequest, notifyDisaster } from './realtime.js';

// Socket.IO transports, HTTP, JWT checks, and rooms are real. Only MongoDB calls are mocked.
let server; let io; let url;
let admin; let citizen; let other; let volunteer; let secondVolunteer; let users; let clients; let reports;
const originalSecret = process.env.JWT_SECRET;
const req = { app };
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
const received = (socket, event) => once(socket, event, { signal: AbortSignal.timeout(3000) });

before(async () => {
  server = createServer(app); io = attachRealtime(server, app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); url = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  process.env.JWT_SECRET = 'socket-tests-only-secret-longer-than-thirty-two-bytes';
  admin = new User({ role: 'admin' }); citizen = new User({ role: 'citizen' }); other = new User({ role: 'citizen' });
  volunteer = new User({ role: 'volunteer' }); secondVolunteer = new User({ role: 'volunteer' });
  users = [admin, citizen, other, volunteer, secondVolunteer]; clients = []; reports = new Map();
  mock.method(User, 'findById', async (id) => users.find((user) => user.id === id) || null);
  mock.method(DisasterReport.prototype, 'save', async function () {
    await this.validate(); this.initializeTimestamps(); reports.set(this.id, this.toObject()); return this;
  });
});
afterEach(async () => { clients.forEach((socket) => socket.disconnect()); await pause(); mock.restoreAll(); });
after(async () => {
  await new Promise((resolve) => io.close(resolve));
  app.set('io', undefined);
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
async function client(user, auth = {}) {
  const socket = connectClient(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { ...(user ? { token: issueToken(user) } : {}), ...auth } });
  clients.push(socket); socket.events = [];
  socket.onAny((event, payload) => socket.events.push({ event, payload }));
  const outcome = new Promise((resolve) => { socket.once('connect', () => resolve(null)); socket.once('connect_error', resolve); });
  socket.connect(); const error = await outcome; return { socket, error };
}
const notifications = (socket, event) => socket.events.filter((entry) => entry.event === event);

 test('rejects absent, malformed, expired, forged, wrong-algorithm, and deleted-user tokens', async () => {
  const unknown = new User({ role: 'admin' });
  const options = { subject: citizen.id, expiresIn: 60 };
  const tokens = [undefined, 123, 'bad-token', issueToken(unknown),
    jwt.sign({}, process.env.JWT_SECRET, { ...options, expiresIn: -1 }),
    jwt.sign({}, 'wrong-secret', options), jwt.sign({}, process.env.JWT_SECRET, { ...options, algorithm: 'HS384' }),
    jwt.sign({ sub: citizen.id }, process.env.JWT_SECRET),
  ];
  for (const token of tokens) {
    const { error } = await client(null, { token }); assert.equal(error?.data.code, 'UNAUTHENTICATED');
  }
  assert.equal(io.sockets.sockets.size, 0);
});

test('rooms come from the database identity and role, ignoring client and JWT role claims', async () => {
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { subject: citizen.id, expiresIn: 60 });
  const { socket, error } = await client(null, { token, role: 'admin', rooms: ['role:admin', `user:${other.id}`] });
  assert.equal(error, null);
  const rooms = io.sockets.sockets.get(socket.id).rooms;
  assert.ok(rooms.has(`user:${citizen.id}`)); assert.ok(rooms.has('role:citizen'));
  assert.ok(!rooms.has('role:admin')); assert.ok(!rooms.has(`user:${other.id}`));
  socket.emit('join', 'role:admin'); socket.emit('subscribe', `user:${other.id}`); await pause();
  assert.ok(!rooms.has('role:admin')); assert.ok(!rooms.has(`user:${other.id}`));
});

test('private requests notify only admins, their owner, and their assigned volunteer', async () => {
  const connected = await Promise.all(users.map((user) => client(user)));
  const sockets = connected.map((result) => result.socket);
  const item = new AssistanceRequest({ requester: citizen._id, assignedVolunteer: volunteer._id, status: 'assigned' });
  const expected = [sockets[0], sockets[1], sockets[3]].map((socket) => received(socket, 'requests:changed'));
  await notifyRequest(req, item); await Promise.all(expected); await pause();
  for (const index of [0, 1, 3]) assert.deepEqual(notifications(sockets[index], 'requests:changed')[0].payload, { id: item.id });
  for (const index of [2, 4]) assert.equal(sockets[index].events.length, 0);
});

test('reassignment notifies both affected volunteers for REST refresh, excluding other citizens', async () => {
  const [a, c, o, v, v2] = (await Promise.all(users.map((user) => client(user)))).map((result) => result.socket);
  const previous = new AssistanceRequest({ requester: citizen._id, assignedVolunteer: volunteer._id, status: 'assigned' });
  const item = { ...previous.toObject(), assignedVolunteer: secondVolunteer._id };
  const expected = [a, c, v, v2].map((socket) => received(socket, 'assignments:changed'));
  await notifyRequest(req, item, previous, true); await Promise.all(expected); await pause();
  assert.equal(o.events.length, 0);
  for (const socket of [a, c, v, v2]) assert.deepEqual(notifications(socket, 'assignments:changed')[0].payload, { id: previous.id });
});

test('volunteer pending-feed notifications contain neither private IDs nor request details', async () => {
  const v = (await client(volunteer)).socket; const o = (await client(other)).socket;
  const expected = received(v, 'requests:queue-changed');
  await notifyRequest(req, new AssistanceRequest({ requester: citizen._id, status: 'pending', description: 'Private narrative', location: 'Private address' }));
  assert.deepEqual((await expected)[0], {}); await pause(); assert.equal(o.events.length, 0);
  assert.equal(notifications(v, 'requests:changed').length, 0);
});

test('disaster updates go to the owner/admin and only visible statuses go to volunteers', async () => {
  const [a, c, o, v] = (await Promise.all([admin, citizen, other, volunteer].map((user) => client(user)))).map((result) => result.socket);
  const report = new DisasterReport({ reportedBy: citizen._id, status: 'pending' });
  const initial = [a, c].map((socket) => received(socket, 'disasters:changed'));
  await notifyDisaster(req, report); await Promise.all(initial); await pause();
  assert.equal(o.events.length, 0); assert.equal(v.events.length, 0);
  report.status = 'verified'; const verified = received(v, 'disasters:changed');
  await notifyDisaster(req, report); assert.deepEqual((await verified)[0], { id: report.id });
  assert.equal(o.events.length, 0);
});

test('resource allocations are admin-only and clients cannot forge outgoing notifications', async () => {
  const a = (await client(admin)).socket; const c = (await client(citizen)).socket; const v = (await client(volunteer)).socket;
  const expected = received(a, 'allocations:changed'); const payload = { resourceId: citizen.id, requestId: volunteer.id };
  await notifyRooms(req, ['role:admin'], 'allocations:changed', payload); assert.deepEqual((await expected)[0], payload);
  c.emit('allocations:changed', payload); c.emit('assignments:changed', { id: volunteer.id }); await pause();
  assert.equal(a.events.length, 1); assert.equal(c.events.length, 0); assert.equal(v.events.length, 0);
});

test('deleted users and changed roles lose live access before the next notification', async () => {
  for (const change of ['role', 'delete']) {
    const { socket } = await client(admin);
    const invalid = received(socket, 'session:invalid'); const disconnected = received(socket, 'disconnect');
    if (change === 'role') admin.role = 'citizen'; else users = users.filter((user) => user.id !== admin.id);
    await notifyRooms(req, ['role:admin'], 'resources:changed', { id: citizen.id });
    await invalid; await disconnected;
    assert.equal(notifications(socket, 'resources:changed').length, 0);
    admin.role = 'admin';
  }
});

test('a socket is disconnected when its JWT expires', async () => {
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: citizen.id, expiresIn: 2 });
  const { socket, error } = await client(null, { token }); assert.equal(error, null);
  const invalid = received(socket, 'session:invalid'); const disconnected = received(socket, 'disconnect');
  await invalid; await disconnected; assert.equal(socket.connected, false);
});

test('database authentication errors are generic and never expose connection details', async () => {
  mock.method(User, 'findById', async () => { throw new Error('private MongoDB connection string'); });
  const { error } = await client(citizen); assert.equal(error.data.code, 'UNAVAILABLE');
  assert.ok(!error.message.includes('private'));
});

test('two authenticated sessions observe a legitimate REST creation without reconnecting', async () => {
  const a = (await client(admin)).socket; const c = (await client(citizen)).socket; const unrelated = (await client(other)).socket;
  const adminEvent = received(a, 'disasters:changed'); const citizenEvent = received(c, 'disasters:changed');
  const originalConnections = [a.id, c.id];
  const response = await fetch(`${url}/api/disasters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issueToken(citizen)}` },
    body: JSON.stringify({ title: 'Flood report from session B', description: 'Water is rising', disasterType: 'flood', severity: 'high', location: { address: 'Main Street' } }),
  });
  assert.equal(response.status, 201); const { report } = await response.json();
  assert.deepEqual((await adminEvent)[0], { id: report.id }); assert.deepEqual((await citizenEvent)[0], { id: report.id });
  assert.deepEqual([a.id, c.id], originalConnections); assert.equal(reports.size, 1); assert.equal(unrelated.events.length, 0);
  console.log('Two-session demonstration: citizen REST submission notified the citizen and admin; unrelated citizen received nothing.');
});
