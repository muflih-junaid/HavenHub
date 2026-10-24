import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from './app.js';
import User from './models/User.js';
import { authorizeRoles } from './middleware/auth.js';
import { getJwtConfig, issueToken } from './utils/auth.js';
import { bootstrapAdmin } from './scripts/bootstrapAdmin.js';

// Mock only MongoDB calls. HTTP, schema validation, bcrypt, and JWTs run normally.
const users = new Map();
const testSecret = 'test-only-secret-that-is-longer-than-thirty-two-bytes';
const profile = {
  name: 'Test Citizen', email: 'citizen@example.com', password: 'Test password 123!',
  phone: '+94 77 123 4567', location: 'Colombo',
};
let server;
let baseUrl;
const originalEnvironment = { ...process.env };

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

beforeEach(() => {
  users.clear();
  process.env.JWT_SECRET = testSecret;
  process.env.JWT_EXPIRES_IN_SECONDS = '3600';
  process.env.ADMIN_NAME = 'Local Test Admin';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'Test admin password 123!';
  process.env.ADMIN_PHONE = '+94 71 123 4567';
  delete process.env.ADMIN_LOCATION;

  mock.method(User.prototype, 'save', async function () {
    await this.validate();
    if ([...users.values()].some((user) => user.email === this.email && !user._id.equals(this._id))) {
      throw Object.assign(new Error('Duplicate email'), { code: 11000 });
    }
    this.initializeTimestamps();
    users.set(this._id.toString(), this);
    return this;
  });
  mock.method(User, 'findOne', (filter) => {
    const found = [...users.values()].find((user) => user.email === filter.email) || null;
    const query = Promise.resolve(found);
    query.select = () => query;
    return query;
  });
  mock.method(User, 'findById', async (id) => users.get(id) || null);
});

afterEach(() => mock.restoreAll());

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const key of ['JWT_SECRET', 'JWT_EXPIRES_IN_SECONDS', 'ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_PHONE', 'ADMIN_LOCATION']) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

async function request(path, { body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function assertSanitized(user) {
  assert.equal(user.password, undefined);
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.__v, undefined);
  assert.match(user.id, /^[a-f0-9]{24}$/);
}

test('registers citizens and volunteers, normalizes emails, hashes passwords, and issues expiring tokens', async () => {
  for (const role of ['citizen', 'volunteer']) {
    const result = await request('/register', {
      body: { ...profile, role, email: `  ${role.toUpperCase()}@Example.COM  `, passwordHash: 'injected-hash' },
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.user.email, `${role}@example.com`);
    assert.equal(result.body.user.role, role);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assertSanitized(result.body.user);
    const stored = users.get(result.body.user.id);
    assert.notEqual(stored.passwordHash, profile.password);
    assert.notEqual(stored.passwordHash, 'injected-hash');
    assert.equal(await bcrypt.compare(profile.password, stored.passwordHash), true);
    assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
    const claims = jwt.verify(result.body.token, testSecret, { algorithms: ['HS256'] });
    assert.equal(claims.sub, result.body.user.id);
    assert.equal(claims.exp - claims.iat, 3600);
    assert.equal(claims.role, undefined);
  }
});

test('defaults registration to citizen and rejects duplicate normalized emails with 409', async () => {
  const first = await request('/register', { body: profile });
  assert.equal(first.status, 201);
  assert.equal(first.body.user.role, 'citizen');
  const duplicate = await request('/register', { body: { ...profile, email: ' CITIZEN@EXAMPLE.COM ' } });
  assert.equal(duplicate.status, 409);
  assert.equal(users.size, 1);
  assert.deepEqual(Object.keys(duplicate.body), ['message']);
});

test('rejects public admin registration and invalid roles without creating users', async () => {
  assert.equal((await request('/register', { body: { ...profile, role: 'admin' } })).status, 403);
  for (const role of ['Admin', 'superadmin', null, { $ne: 'citizen' }]) {
    assert.equal((await request('/register', { body: { ...profile, role } })).status, 400);
  }
  assert.equal(users.size, 0);
});

test('rejects invalid registration fields, short passwords, and bcrypt-truncated UTF-8 passwords', async () => {
  const invalidBodies = [
    {}, [], { ...profile, name: 42 }, { ...profile, email: { $ne: null } },
    { ...profile, email: 'invalid-email' }, { ...profile, phone: 'not-a-phone' },
    { ...profile, location: {} }, { ...profile, password: 'short' },
    { ...profile, password: ' '.repeat(10) }, { ...profile, password: '🔐'.repeat(19) },
  ];
  for (const body of invalidBodies) {
    assert.equal((await request('/register', { body })).status, 400);
  }
  assert.equal(users.size, 0);
});

test('logs in with a normalized email and returns a sanitized user and valid token', async () => {
  await request('/register', { body: profile });
  const login = await request('/login', { body: { email: ' CITIZEN@EXAMPLE.COM ', password: profile.password } });
  assert.equal(login.status, 200);
  assertSanitized(login.body.user);
  assert.equal(jwt.verify(login.body.token, testSecret).sub, login.body.user.id);
  const me = await request('/me', { token: login.body.token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, login.body.user);
});

test('uses the same 401 response for wrong passwords and unknown accounts', async () => {
  await request('/register', { body: profile });
  const wrong = await request('/login', { body: { email: profile.email, password: 'wrong' } });
  const missing = await request('/login', { body: { email: 'missing@example.com', password: profile.password } });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(wrong.body, missing.body);
  assert.deepEqual(Object.keys(wrong.body), ['message']);
});

test('rejects missing or incorrectly typed login fields with 400', async () => {
  for (const body of [{}, { email: { $ne: null }, password: profile.password }, { email: profile.email, password: [] }]) {
    assert.equal((await request('/login', { body })).status, 400);
  }
});

test('rejects missing, malformed, expired, wrongly signed, and wrong-algorithm tokens', async () => {
  const registered = await request('/register', { body: profile });
  const sub = registered.body.user.id;
  const tokens = [
    undefined, 'invalid',
    jwt.sign({ sub }, testSecret, { expiresIn: -1 }),
    jwt.sign({ sub }, 'a-different-test-secret-longer-than-thirty-two-bytes', { expiresIn: 3600 }),
    jwt.sign({ sub }, testSecret, { algorithm: 'HS512', expiresIn: 3600 }),
    jwt.sign({ sub }, testSecret),
    jwt.sign({ sub: 'not-an-object-id' }, testSecret, { expiresIn: 3600 }),
  ];
  for (const token of tokens) assert.equal((await request('/me', { token })).status, 401);
});

test('me loads the current user role and rejects a user deleted after token issuance', async () => {
  const registered = await request('/register', { body: profile });
  users.get(registered.body.user.id).role = 'volunteer';
  const me = await request('/me', { token: registered.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'volunteer');
  assertSanitized(me.body.user);
  users.clear();
  assert.equal((await request('/me', { token: registered.body.token })).status, 401);
});

test('database errors remain 500 errors instead of being treated as invalid tokens', async () => {
  const registered = await request('/register', { body: profile });
  mock.method(User, 'findById', async () => { throw new Error('database unavailable'); });
  const result = await request('/me', { token: registered.body.token });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});

test('role middleware requires authentication, forbids other roles, and allows admins', () => {
  const authorize = authorizeRoles('admin');
  let result;
  authorize({}, {}, (error) => { result = error; });
  assert.equal(result.status, 401);
  authorize({ user: { role: 'citizen' } }, {}, (error) => { result = error; });
  assert.equal(result.status, 403);
  authorize({ user: { role: 'admin' } }, {}, (error) => { result = error; });
  assert.equal(result, undefined);
});

test('admin bootstrap hashes environment credentials and leaves an existing admin unchanged', async () => {
  assert.equal(await bootstrapAdmin(), true);
  const admin = [...users.values()][0];
  assert.equal(admin.role, 'admin');
  assert.equal(await bcrypt.compare(process.env.ADMIN_PASSWORD, admin.passwordHash), true);
  const originalHash = admin.passwordHash;
  process.env.ADMIN_EMAIL = ' ADMIN@EXAMPLE.COM ';
  process.env.ADMIN_PASSWORD = 'A different test password!';
  assert.equal(await bootstrapAdmin(), false);
  assert.equal(users.size, 1);
  assert.equal(admin.passwordHash, originalHash);
});

test('admin bootstrap refuses to promote an existing citizen and requires valid credentials', async () => {
  await request('/register', { body: profile });
  process.env.ADMIN_EMAIL = profile.email;
  await assert.rejects(bootstrapAdmin(), (error) => error.status === 409);
  assert.equal([...users.values()][0].role, 'citizen');
  delete process.env.ADMIN_PASSWORD;
  await assert.rejects(bootstrapAdmin(), (error) => error.status === 400);
});

test('concurrent admin bootstraps with the same email do not create duplicates', async () => {
  const results = await Promise.all([bootstrapAdmin(), bootstrapAdmin()]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(users.size, 1);
});

test('requires a strong JWT secret and a positive token lifetime', () => {
  process.env.JWT_SECRET = '';
  assert.throws(getJwtConfig, /JWT_SECRET/);
  process.env.JWT_SECRET = 'too-short';
  assert.throws(getJwtConfig, /JWT_SECRET/);
  process.env.JWT_SECRET = testSecret;
  process.env.JWT_EXPIRES_IN_SECONDS = '-1';
  assert.throws(getJwtConfig, /JWT_EXPIRES_IN_SECONDS/);
  process.env.JWT_EXPIRES_IN_SECONDS = '60';
  const user = new User(profile);
  const claims = jwt.verify(issueToken(user), testSecret);
  assert.equal(claims.exp - claims.iat, 60);
});
