import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import { io } from 'socket.io-client';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import RealtimeProvider from './context/RealtimeProvider.jsx';
import api, { getToken, setToken } from './api/client.js';

vi.mock('socket.io-client', () => ({ io: vi.fn(() => {
  const listeners = new Map();
  const socket = {
    connected: false, active: true,
    on: vi.fn((event, listener) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); return socket; }),
    off: vi.fn((event, listener) => { listeners.get(event)?.delete(listener); return socket; }),
    connect: vi.fn(() => socket), disconnect: vi.fn(() => { socket.connected = false; return socket; }),
    receive(event, payload) { if (event === 'connect') socket.connected = true; if (event === 'disconnect') socket.connected = false; for (const listener of [...listeners.get(event) || []]) listener(payload); },
    listenerCount(event) { return listeners.get(event)?.size || 0; },
  };
  return socket;
}) }));

const user = { id: '000000000000000000000001', name: 'Test account', role: 'admin' };
const item = { id: '000000000000000000000002', assistanceType: 'rescue', status: 'assigned', urgency: 'critical', assignedVolunteer: user.id, assignmentVersion: 1, description: 'Private task description', location: 'Private address', createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z' };
const report = { id: '000000000000000000000003', title: 'Flooding report', disasterType: 'flood', severity: 'high', status: 'pending', description: 'Water rising', location: { address: 'Main Street' }, createdAt: item.createdAt, updatedAt: item.updatedAt };
const summary = { metrics: { disasters: { total: 1, pending: 1, verified: 0 }, requests: { pending: 0, active: 0, completed: 0 }, volunteers: { total: 0 }, resources: { totalTypes: 0, lowStock: 0 } }, recentDisasters: [report], urgentPendingRequests: [], lowStockThreshold: 10, generatedAt: item.createdAt };
const originalAdapter = api.defaults.adapter;
let role; let calls; let handle; let authFailure;
function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}
beforeEach(() => {
  vi.clearAllMocks(); setToken('test-session'); role = 'admin'; calls = []; authFailure = false;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  handle = (config) => reply(config, config.url === '/dashboard/summary' ? summary : config.url.startsWith('/disasters/') ? { report } : { request: item });
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/me') return reply(config, authFailure ? { message: 'Invalid or expired token' } : { user: { ...user, role } }, authFailure ? 401 : 200);
    calls.push(config); return handle(config);
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); setToken(null); api.defaults.adapter = originalAdapter; });
function openPage(path = '/dashboard/admin') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><RealtimeProvider><App /></RealtimeProvider></AuthProvider></MemoryRouter></StrictMode>);
}
async function currentSocket() {
  let socket;
  await waitFor(() => { socket = io.mock.results.map((result) => result.value).filter((value) => value.connect.mock.calls.length).at(-1); expect(socket).toBeTruthy(); });
  return socket;
}
const countCalls = (path) => calls.filter((config) => config.url === path).length;

test('connects to the API origin using the existing token without accepting client room claims', async () => {
  openPage(); const socket = await currentSocket();
  const [origin, options] = io.mock.calls.at(-1); expect(origin).toBe('http://havenhub.test'); expect(options.autoConnect).toBe(false);
  let auth; options.auth((value) => { auth = value; }); expect(auth).toEqual({ token: 'test-session' });
  act(() => socket.receive('connect')); expect(await screen.findByText('Live updates connected')).toBeTruthy();
});

test('authorized notifications refresh dashboard REST data and coalesce related events', async () => {
  openPage(); const socket = await currentSocket(); await screen.findByText('Total disaster reports');
  const baseline = countCalls('/dashboard/summary');
  handle = (config) => reply(config, { ...summary, metrics: { ...summary.metrics, disasters: { total: 2, pending: 2, verified: 0 } } });
  act(() => { socket.receive('disasters:changed', { id: report.id }); socket.receive('resources:changed', { id: item.id }); });
  await waitFor(() => expect(within(screen.getByText('Total disaster reports', { selector: 'dt' }).parentElement).getByText('2')).toBeTruthy());
  expect(countCalls('/dashboard/summary')).toBe(baseline + 1);
  expect(calls.every((config) => config.method === 'get')).toBe(true);
});

test('a reassigned volunteer refreshes through REST and loses old private task details', async () => {
  role = 'volunteer'; openPage(`/requests/${item.id}`); const socket = await currentSocket();
  expect(await screen.findByText('Private task description')).toBeTruthy();
  handle = (config) => reply(config, { message: 'Assistance request not found' }, 404);
  act(() => socket.receive('assignments:changed', { id: item.id }));
  expect(await screen.findByRole('heading', { name: 'Request unavailable' })).toBeTruthy();
  expect(screen.queryByText('Private task description')).toBe(null); expect(screen.queryByRole('button', { name: 'Accept task' })).toBe(null);
});

test('unrelated record notifications do not reload an open detail page', async () => {
  openPage(`/disasters/${report.id}`); const socket = await currentSocket(); await screen.findByRole('heading', { name: report.title });
  const baseline = calls.length;
  act(() => socket.receive('disasters:changed', { id: item.id }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
  expect(calls).toHaveLength(baseline);
});

test('disconnect preserves usable data; reconnect refreshes REST to recover missed events', async () => {
  openPage(); const socket = await currentSocket(); await screen.findByText('Total disaster reports');
  act(() => socket.receive('disconnect', 'transport close'));
  expect(await screen.findByText(/Live updates disconnected/)).toBeTruthy(); expect(screen.getByText('Total disaster reports')).toBeTruthy();
  handle = (config) => reply(config, { ...summary, metrics: { ...summary.metrics, volunteers: { total: 7 } } });
  act(() => socket.receive('connect'));
  expect(await screen.findByText('Live updates connected')).toBeTruthy();
  await waitFor(() => expect(within(screen.getByText('Total volunteers', { selector: 'dt' }).parentElement).getByText('7')).toBeTruthy());
});

test('unmount and sign-out remove socket listeners and disconnect the old session', async () => {
  openPage(); const socket = await currentSocket(); await screen.findByRole('button', { name: 'Sign out' });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByRole('heading', { name: 'Welcome back.' });
  expect(socket.disconnect).toHaveBeenCalled(); expect(socket.listenerCount('disasters:changed')).toBe(0); expect(socket.listenerCount('connect')).toBe(0);
  const baseline = calls.length; act(() => socket.receive('disasters:changed', { id: report.id }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120))); expect(calls).toHaveLength(baseline);
});

test('socket authentication rejection checks the REST session and ends an expired login', async () => {
  openPage(); const socket = await currentSocket(); authFailure = true;
  act(() => socket.receive('connect_error', { data: { code: 'UNAUTHENTICATED' } }));
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy(); expect(getToken()).toBe(null);
});

test('temporary socket authentication failures retry without deleting a valid login', async () => {
  openPage(); const socket = await currentSocket(); await screen.findByText('Total disaster reports');
  vi.useFakeTimers(); socket.active = false;
  const baseline = socket.connect.mock.calls.length;
  act(() => socket.receive('connect_error', { data: { code: 'UNAVAILABLE' } }));
  expect(getToken()).toBe('test-session'); expect(screen.getByText(/Live updates disconnected/)).toBeTruthy();
  act(() => vi.advanceTimersByTime(3000)); expect(socket.connect.mock.calls.length).toBe(baseline + 1);
});

test('unauthenticated pages never open a socket', async () => {
  setToken(null); openPage(); await screen.findByRole('heading', { name: 'Welcome back.' }); expect(io).not.toHaveBeenCalled();
});
