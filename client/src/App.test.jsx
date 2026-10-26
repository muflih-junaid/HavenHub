import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import api, { getToken, setToken, TOKEN_KEY } from './api/client.js';

const account = {
  id: '000000000000000000000001', name: 'Asha Silva', email: 'asha@example.com',
  phone: '+94 77 123 4567', role: 'citizen', location: 'Colombo',
};
const originalAdapter = api.defaults.adapter;
let handleRequest;
let requests;

function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}

beforeEach(() => {
  localStorage.clear();
  setToken(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  requests = [];
  handleRequest = (config) => {
    if (config.url === '/health') return reply(config, { status: 'ok' });
    if (config.url === '/disasters') return reply(config, { reports: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
    return reply(config, { user: account });
  };
  // Only the transport is replaced. Components, Context, routing, and interceptors are real.
  api.defaults.adapter = async (config) => {
    requests.push(config);
    return handleRequest(config);
  };
});

afterEach(() => {
  cleanup();
  setToken(null);
  api.defaults.adapter = originalAdapter;
});

function openPage(path) {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>);
}

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submitLogin() {
  fill('Email address', account.email);
  fill('Password', 'Test password 123!');
  fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
}

test('redirects an unauthenticated dashboard visit to the sign-in page', async () => {
  openPage('/dashboard/admin');
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test('signs in, stores only the token, and opens the user dashboard', async () => {
  handleRequest = (config) => reply(config, { token: 'login-token', user: account });
  openPage('/login');
  submitLogin();
  expect(await screen.findByRole('heading', { name: 'Your community starts here.' })).toBeTruthy();
  expect(localStorage.getItem(TOKEN_KEY)).toBe('login-token');
  expect(localStorage.length).toBe(1);
  expect(requests[0].url).toBe('/auth/login');
  expect(JSON.parse(requests[0].data)).toEqual({ email: account.email, password: 'Test password 123!' });
  expect(requests[0].headers.Authorization).toBeUndefined();
});

test('shows invalid credentials without creating a session', async () => {
  handleRequest = (config) => reply(config, { message: 'Invalid email or password' }, 401);
  openPage('/login');
  submitLogin();
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password');
  expect(getToken()).toBe(null);
  expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
});

test('registers a volunteer using the existing API contract and opens the volunteer dashboard', async () => {
  handleRequest = (config) => reply(config, { token: 'volunteer-token', user: { ...account, role: 'volunteer' } }, 201);
  openPage('/register');
  fill('Full name', account.name);
  fill('Email address', account.email);
  fill('Phone number', account.phone);
  fill('Location (optional)', account.location);
  fill('Password', 'Test password 123!');
  fill('Confirm password', 'Test password 123!');
  fireEvent.click(screen.getByRole('radio', { name: /volunteer/i }));
  expect(screen.queryByRole('radio', { name: /admin/i })).toBe(null);
  fireEvent.click(screen.getByRole('button', { name: /Create account/ }));
  expect(await screen.findByRole('heading', { name: 'Ready to make a difference.' })).toBeTruthy();
  expect(requests[0].url).toBe('/auth/register');
  expect(JSON.parse(requests[0].data)).toEqual({
    name: account.name, email: account.email, phone: account.phone,
    location: account.location, role: 'volunteer', password: 'Test password 123!',
  });
  expect(localStorage.getItem(TOKEN_KEY)).toBe('volunteer-token');
});

test('rejects mismatched passwords without sending a registration request', async () => {
  openPage('/register');
  fill('Full name', account.name);
  fill('Email address', account.email);
  fill('Phone number', account.phone);
  fill('Password', 'Test password 123!');
  fill('Confirm password', 'A different password!');
  fireEvent.click(screen.getByRole('button', { name: /Create account/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('do not match');
  expect(requests).toHaveLength(0);
});

test.each(['citizen', 'volunteer', 'admin'])('restores a %s session from the API and attaches its Bearer token', async (role) => {
  setToken('saved-token');
  handleRequest = (config) => config.url === '/dashboard/summary'
    ? reply(config, { metrics: { disasters: { total: 0, pending: 0, verified: 0 }, requests: { pending: 0, active: 0, completed: 0 }, volunteers: { total: 0 }, resources: { totalTypes: 0, lowStock: 0 } }, recentDisasters: [], urgentPendingRequests: [], lowStockThreshold: 10, generatedAt: '2026-10-26T08:00:00Z' })
    : config.url === '/disasters'
    ? reply(config, { reports: [], page: 1, pageSize: 10, total: 0, totalPages: 1 })
    : reply(config, { user: { ...account, role } });
  openPage(`/dashboard/${role}`);
  expect(screen.getByRole('heading', { name: /Getting your workspace ready/ })).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Your account' })).toBeTruthy();
  expect(requests.find((request) => request.url === '/auth/me').headers.Authorization).toBe('Bearer saved-token');
});

test('blocks a citizen from the admin route and links to their own dashboard', async () => {
  setToken('citizen-token');
  openPage('/dashboard/admin');
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'A clearer view of the response.' })).toBe(null);
  fireEvent.click(screen.getByRole('link', { name: 'Go to my dashboard' }));
  expect(await screen.findByRole('heading', { name: 'Your community starts here.' })).toBeTruthy();
});

test('clears an expired session and explains why sign-in is required', async () => {
  setToken('expired-token');
  handleRequest = (config) => reply(config, { message: 'Invalid or expired token' }, 401);
  openPage('/dashboard');
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Your session has ended');
  expect(localStorage.getItem(TOKEN_KEY)).toBe(null);
});

test('keeps a saved token on network failure and restores the session after retry', async () => {
  setToken('saved-token');
  let offline = true;
  handleRequest = (config) => {
    if (offline) throw new AxiosError('Network error', 'ERR_NETWORK', config);
    return reply(config, { user: account });
  };
  openPage('/dashboard');
  expect(await screen.findByRole('heading', { name: 'We couldn’t restore your session.' })).toBeTruthy();
  expect(localStorage.getItem(TOKEN_KEY)).toBe('saved-token');
  offline = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Your community starts here.' })).toBeTruthy();
});

test('signs out, removes persistence, and prevents returning to a protected dashboard', async () => {
  setToken('saved-token');
  openPage('/dashboard/citizen');
  await screen.findByRole('heading', { name: 'Your account' });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(getToken()).toBe(null);
  expect(localStorage.getItem(TOKEN_KEY)).toBe(null);
});

test('ends the session when a later authenticated request receives 401', async () => {
  setToken('saved-token');
  openPage('/dashboard/citizen');
  await screen.findByRole('heading', { name: 'Your account' });
  handleRequest = (config) => reply(config, { message: 'Token expired' }, 401);
  await act(async () => { await api.get('/protected-example').catch(() => {}); });
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(getToken()).toBe(null);
});

test('a late session-restore response cannot undo sign-out in another tab', async () => {
  setToken('saved-token');
  let resolveRequest;
  handleRequest = (config) => new Promise((resolve) => { resolveRequest = () => resolve(reply(config, { user: account })); });
  openPage('/dashboard/citizen');
  await waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY, newValue: null })));
  await act(async () => { resolveRequest(); });
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(getToken()).toBe(null);
});

test('can sign in with blocked persistence and explains the memory-only session', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage blocked'); });
  handleRequest = (config) => reply(config, { token: 'memory-only-token', user: account });
  openPage('/login');
  submitLogin();
  await screen.findByRole('heading', { name: 'Your account' });
  expect(screen.getByRole('alert').textContent).toContain('need to sign in again after reloading');
  expect(getToken()).toBe('memory-only-token');
});
