import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import api, { setToken } from './api/client.js';

const user = { id: '000000000000000000000001', name: 'Test Citizen', role: 'citizen', email: 'citizen@example.com', phone: '+94 77 123 4567' };
const item = {
  id: '000000000000000000000002', requester: user.id, assistanceType: 'food', urgency: 'high', status: 'pending',
  description: 'Food is needed for our household.', location: '12 Main Street, Colombo',
  createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z',
};
const disaster = { id: '000000000000000000000003', title: 'My flood report', status: 'pending' };
const originalAdapter = api.defaults.adapter;
let role;
let requests;
let handleRequests;
let handleReports;
let handleVolunteers;

function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}

function listData(items = [item], page = 1, total = items.length) {
  return { requests: items, page, pageSize: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) };
}

beforeEach(() => {
  localStorage.clear();
  setToken('test-token');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  role = 'citizen';
  requests = [];
  handleVolunteers = (config) => reply(config, { volunteers: [{ id: '000000000000000000000005', name: 'Asha Volunteer', location: 'Colombo' }], page: 1, totalPages: 1 });
  handleReports = (config) => reply(config, { reports: [disaster], page: 1, totalPages: 1 });
  handleRequests = (config) => {
    if (config.url === '/requests/mine' || (config.url === '/requests' && config.method === 'get')) return reply(config, listData());
    return reply(config, { request: item }, config.method === 'post' ? 201 : 200);
  };
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/me') return reply(config, { user: { ...user, role } });
    requests.push(config);
    if (config.url === '/resources') return reply(config, { resources: [], page: 1, total: 0, totalPages: 1 });
    if (config.url === '/resources/allocations') return reply(config, { allocations: [], page: 1, total: 0, totalPages: 1 });
    if (config.url === '/volunteers') return handleVolunteers(config);
    return config.url === '/disasters' ? handleReports(config) : handleRequests(config);
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
function fill(label, value) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function fillRequest() {
  await screen.findByRole('heading', { name: 'Request assistance.' });
  fill('Assistance type', 'food');
  fill('Urgency', 'high');
  fill('Description', item.description);
  fill('Location address', item.location);
}

test('assistance pages require a session', async () => {
  setToken(null);
  openPage('/requests/mine');
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test.each(['admin', 'volunteer'])('%s cannot access the citizen submission form', async (accountRole) => {
  role = accountRole;
  openPage('/requests/new');
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Submit request' })).toBe(null);
  expect(requests).toHaveLength(0);
});

test('citizens use My Requests instead of the admin/volunteer queue', async () => {
  openPage('/requests');
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test('submits an optionally linked disaster request and opens its detail with success feedback', async () => {
  handleRequests = (config) => reply(config, { request: { ...item, disaster: disaster.id } }, config.method === 'post' ? 201 : 200);
  openPage('/requests/new');
  await fillRequest();
  await screen.findByRole('option', { name: 'My flood report (pending)' });
  fill('Related disaster report (optional)', disaster.id);
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  expect(await screen.findByRole('heading', { name: 'food assistance request' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('submitted successfully');
  expect(screen.getByRole('link', { name: 'View linked disaster report' }).getAttribute('href')).toBe(`/disasters/${disaster.id}`);
  const sent = requests.find((request) => request.method === 'post');
  expect(sent.url).toBe('/requests');
  expect(sent.headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(sent.data)).toEqual({ assistanceType: 'food', urgency: 'high', description: item.description, location: item.location, disaster: disaster.id });
});

test('loading older disaster options preserves the selected report', async () => {
  const older = { ...disaster, id: '000000000000000000000004', title: 'Older report' };
  handleReports = (config) => reply(config, { reports: config.params.page === 1 ? [disaster] : [older], page: config.params.page, totalPages: 2 });
  openPage('/requests/new');
  await fillRequest();
  await screen.findByRole('option', { name: 'My flood report (pending)' });
  fill('Related disaster report (optional)', disaster.id);
  fireEvent.click(screen.getByRole('button', { name: 'Load more reports' }));
  await screen.findByRole('option', { name: 'Older report (pending)' });
  expect(screen.getByLabelText('Related disaster report (optional)').value).toBe(disaster.id);
});

test('an optional disaster-loading failure does not prevent an unlinked submission', async () => {
  handleReports = (config) => reply(config, {}, 503);
  openPage('/requests/new');
  await fillRequest();
  expect((await screen.findByRole('alert')).textContent).toContain('still submit without');
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await screen.findByRole('heading', { name: 'food assistance request' });
  expect(JSON.parse(requests.find((request) => request.method === 'post').data).disaster).toBeUndefined();
});

test('form validation rejects whitespace and submission errors retain entered data', async () => {
  openPage('/requests/new');
  await fillRequest();
  fill('Description', '   ');
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Describe the assistance');
  expect(requests.some((request) => request.method === 'post')).toBe(false);
  fill('Description', item.description);
  handleRequests = (config) => reply(config, { message: 'Request could not be saved' }, 400);
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
  expect(screen.getByLabelText('Description').value).toBe(item.description);
});

test('My Requests loads the ownership-scoped endpoint and opens the request detail', async () => {
  openPage('/requests/mine');
  fireEvent.click(await screen.findByRole('link', { name: 'food assistance request' }));
  expect(await screen.findByRole('heading', { name: 'food assistance request' })).toBeTruthy();
  expect(screen.getByText(item.location)).toBeTruthy();
  expect(screen.getByText(item.description)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
  expect(requests[0].url).toBe('/requests/mine');
});

test('a citizen can cancel their pending request, with no status field supplied by the browser', async () => {
  handleRequests = (config) => reply(config, { request: { ...item, status: config.method === 'patch' ? 'cancelled' : 'pending' } });
  openPage(`/requests/${item.id}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
  expect(await screen.findByText('cancelled')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('has been cancelled');
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBe(null);
  expect(requests.find((request) => request.method === 'patch').url).toBe(`/requests/${item.id}/cancel`);
  expect(requests.find((request) => request.method === 'patch').data).toBeUndefined();
});

test.each(['assigned', 'in_progress', 'completed', 'cancelled'])('a citizen can read a %s request but cannot cancel it', async (status) => {
  handleRequests = (config) => reply(config, { request: { ...item, status } });
  openPage(`/requests/${item.id}`);
  expect(await screen.findByText(status.replace('_', ' '))).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBe(null);
});

test('cancellation conflicts disable stale actions and allow refreshing the current status', async () => {
  let changed = false;
  handleRequests = (config) => {
    if (config.method === 'patch') { changed = true; return reply(config, { message: 'Only pending requests can be cancelled' }, 409); }
    return reply(config, { request: { ...item, status: changed ? 'assigned' : 'pending' } });
  };
  openPage(`/requests/${item.id}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Only pending');
  expect(screen.getByRole('button', { name: 'Cancel request' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh request' }));
  expect(await screen.findByText('assigned')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBe(null);
});

test('admin urgency and status filters combine, reset pagination, and persist on the next page', async () => {
  role = 'admin';
  handleRequests = (config) => reply(config, listData([item], Number(config.params.page), 11));
  openPage('/requests?page=2');
  await screen.findByRole('link', { name: 'food assistance request' });
  fill('Urgency', 'critical');
  await waitFor(() => expect(requests.at(-1).params).toEqual({ page: '1', urgency: 'critical' }));
  fill('Status', 'pending');
  await waitFor(() => expect(requests.at(-1).params).toEqual({ page: '1', urgency: 'critical', status: 'pending' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Next' }));
  await waitFor(() => expect(requests.at(-1).params).toEqual({ page: '2', urgency: 'critical', status: 'pending' }));
});

test('admin request details offer assignment controls but cannot cancel the citizen request', async () => {
  role = 'admin';
  openPage(`/requests/${item.id}`);
  await screen.findByRole('heading', { name: 'food assistance request' });
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBe(null);
  expect(screen.getByRole('button', { name: 'Assign volunteer' })).toBeTruthy();
  expect(await screen.findByRole('option', { name: 'Asha Volunteer · Colombo' })).toBeTruthy();
});

test('volunteer lists and details show only summaries without private citizen information', async () => {
  role = 'volunteer';
  const summary = { id: item.id, assistanceType: item.assistanceType, urgency: item.urgency, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt };
  handleRequests = (config) => reply(config, config.url === '/requests' ? listData([summary]) : { request: summary });
  openPage('/requests');
  fireEvent.click(await screen.findByRole('link', { name: 'food assistance request' }));
  await screen.findByRole('heading', { name: 'food assistance request' });
  expect(screen.queryByText(item.description)).toBe(null);
  expect(screen.queryByText(item.location)).toBe(null);
  expect(screen.queryByText(user.phone)).toBe(null);
  expect(screen.queryByText(user.email)).toBe(null);
  expect(screen.queryByRole('button', { name: 'Cancel request' })).toBe(null);
});

test('list loading, errors, retry, and empty states are clear', async () => {
  let finish;
  handleRequests = (config) => new Promise((resolve, reject) => { finish = () => {
    try { resolve(reply(config, {}, 503)); } catch (error) { reject(error); }
  }; });
  openPage('/requests/mine');
  expect(await screen.findByText('Loading assistance requests…')).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish());
  expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  handleRequests = (config) => reply(config, listData([]));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'No assistance requests to show.' })).toBeTruthy();
});

test('private or missing requests show an error without private details', async () => {
  handleRequests = (config) => reply(config, { message: 'Assistance request not found' }, 404);
  openPage(`/requests/${item.id}`);
  expect(await screen.findByRole('heading', { name: 'Request unavailable' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Assistance request not found');
  expect(screen.queryByText(item.location)).toBe(null);
});

test('admin assigns a selected volunteer with the displayed version and sees success', async () => {
  role = 'admin';
  let current = { ...item, assignmentVersion: 0 };
  handleRequests = (config) => {
    if (config.method === 'patch') current = { ...current, status: 'assigned', assignedVolunteer: '000000000000000000000005', assignmentVersion: 1, assignedAt: item.updatedAt };
    return reply(config, { request: current });
  };
  openPage(`/requests/${item.id}`);
  await screen.findByRole('option', { name: 'Asha Volunteer · Colombo' });
  fireEvent.click(screen.getByRole('button', { name: 'Assign volunteer' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Choose a registered volunteer');
  expect(requests.some((config) => config.method === 'patch')).toBe(false);
  fill('Registered volunteer', '000000000000000000000005');
  fireEvent.click(screen.getByRole('button', { name: 'Assign volunteer' }));
  expect(await screen.findByText('assigned')).toBeTruthy();
  expect(await screen.findByText('Assignment updated successfully.')).toBeTruthy();
  const sent = requests.find((config) => config.method === 'patch');
  expect(sent.url).toBe(`/requests/${item.id}/assignment`);
  expect(JSON.parse(sent.data)).toEqual({ volunteerId: '000000000000000000000005', expectedVersion: 0 });
  expect(screen.getByRole('button', { name: 'Cancel assignment' })).toBeTruthy();
});

test('admin reassigns an active request and can cancel its assignment back to pending', async () => {
  role = 'admin';
  let current = { ...item, status: 'in_progress', assignedVolunteer: 'another-volunteer', assignmentVersion: 3, acceptedAt: item.updatedAt };
  handleRequests = (config) => {
    if (config.method === 'patch') current = { ...current, status: 'assigned', assignedVolunteer: '000000000000000000000005', acceptedAt: null, assignmentVersion: 4 };
    if (config.method === 'delete') current = { ...current, status: 'pending', assignedVolunteer: null, assignmentVersion: 5 };
    return reply(config, { request: current });
  };
  openPage(`/requests/${item.id}`);
  await screen.findByRole('option', { name: 'Asha Volunteer · Colombo' });
  fill('Registered volunteer', '000000000000000000000005');
  fireEvent.click(screen.getByRole('button', { name: 'Reassign volunteer' }));
  expect(await screen.findByText('assigned')).toBeTruthy();
  expect(JSON.parse(requests.find((config) => config.method === 'patch').data).expectedVersion).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel assignment' }));
  expect(await screen.findByText('pending')).toBeTruthy();
  expect(await screen.findByText('Assignment cancelled. The request is pending again.')).toBeTruthy();
  expect(JSON.parse(requests.find((config) => config.method === 'delete').data)).toEqual({ expectedVersion: 4 });
});

test('assignment conflicts block stale controls until the request is refreshed', async () => {
  role = 'admin';
  let version = 0;
  handleRequests = (config) => {
    if (config.method === 'patch') { version = 1; return reply(config, { message: 'This request changed. Refresh it before trying again' }, 409); }
    return reply(config, { request: { ...item, assignmentVersion: version, ...(version ? { status: 'assigned', assignedVolunteer: 'another-volunteer' } : {}) } });
  };
  openPage(`/requests/${item.id}`);
  await screen.findByRole('option', { name: 'Asha Volunteer · Colombo' });
  fill('Registered volunteer', '000000000000000000000005');
  fireEvent.click(screen.getByRole('button', { name: 'Assign volunteer' }));
  expect((await screen.findByRole('alert')).textContent).toContain('This request changed');
  expect(screen.getByRole('button', { name: 'Assign volunteer' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh request' }));
  expect(await screen.findByText('assigned')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reassign volunteer' }).disabled).toBe(false);
});

test('volunteer options support loading, failure, retry, and empty states', async () => {
  role = 'admin';
  let finish;
  handleVolunteers = (config) => new Promise((resolve, reject) => { finish = () => { try { resolve(reply(config, {}, 503)); } catch (failure) { reject(failure); } }; });
  openPage(`/requests/${item.id}`);
  expect(await screen.findByText('Loading registered volunteers…')).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish());
  expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  handleVolunteers = (config) => reply(config, { volunteers: [], page: 1, totalPages: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Retry volunteers' }));
  expect(await screen.findByText('No registered volunteers yet.')).toBeTruthy();
});

test('loading more registered volunteers retains the selected person', async () => {
  role = 'admin';
  handleVolunteers = (config) => reply(config, { volunteers: [{ id: config.params.page === 1 ? 'first' : 'second', name: config.params.page === 1 ? 'First volunteer' : 'Second volunteer' }], page: config.params.page, totalPages: 2 });
  openPage(`/requests/${item.id}`);
  await screen.findByRole('option', { name: 'First volunteer' });
  fill('Registered volunteer', 'first');
  fireEvent.click(screen.getByRole('button', { name: 'Load more volunteers' }));
  await screen.findByRole('option', { name: 'Second volunteer' });
  expect(screen.getByLabelText('Registered volunteer').value).toBe('first');
});

test('My Tasks uses the volunteer-scoped endpoint and opens full task details', async () => {
  role = 'volunteer';
  const assigned = { ...item, status: 'assigned', requester: undefined, assignedVolunteer: user.id, assignmentVersion: 1 };
  handleRequests = (config) => reply(config, config.url === '/requests/tasks' ? listData([assigned]) : { request: assigned });
  openPage('/tasks');
  expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('link', { name: 'food assistance request' }));
  expect(await screen.findByText(item.location)).toBeTruthy();
  expect(screen.getByText(item.description)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept task' })).toBeTruthy();
  expect(requests[0].url).toBe('/requests/tasks');
  expect(screen.queryByText(user.phone)).toBe(null);
  expect(screen.queryByText(user.email)).toBe(null);
  expect(screen.queryByRole('button', { name: 'Assign volunteer' })).toBe(null);
});

test('volunteer accepts, starts, and completes with the latest version on every action', async () => {
  role = 'volunteer';
  let current = { ...item, requester: undefined, status: 'assigned', assignedVolunteer: user.id, assignmentVersion: 1 };
  handleRequests = (config) => {
    if (config.method === 'patch') {
      const { action } = JSON.parse(config.data);
      current = { ...current, assignmentVersion: current.assignmentVersion + 1, acceptedAt: item.updatedAt,
        ...(action === 'start' ? { status: 'in_progress', startedAt: item.updatedAt } : {}),
        ...(action === 'complete' ? { status: 'completed', completedAt: item.updatedAt } : {}),
      };
    }
    return reply(config, { request: current });
  };
  openPage(`/requests/${item.id}`);
  fireEvent.click(await screen.findByRole('button', { name: 'Accept task' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark in progress' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark completed' }));
  expect(await screen.findByText('This task is completed. Thank you for your support.')).toBeTruthy();
  expect(requests.filter((config) => config.method === 'patch').map((config) => JSON.parse(config.data))).toEqual([
    { action: 'accept', expectedVersion: 1 }, { action: 'start', expectedVersion: 2 }, { action: 'complete', expectedVersion: 3 },
  ]);
  expect(requests.filter((config) => config.method === 'patch').every((config) => config.url === `/requests/${item.id}/task`)).toBe(true);
});

test.each(['admin', 'citizen'])('%s cannot open the volunteer My Tasks route', async (accountRole) => {
  role = accountRole;
  openPage('/tasks');
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test('My Tasks gives a clear empty state', async () => {
  role = 'volunteer';
  handleRequests = (config) => reply(config, listData([]));
  openPage('/tasks');
  expect(await screen.findByText('No tasks assigned yet. Your admin-assigned requests will appear here.')).toBeTruthy();
});
