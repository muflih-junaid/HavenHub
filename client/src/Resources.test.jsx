import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import api, { setToken } from './api/client.js';

const admin = { id: '000000000000000000000001', name: 'Admin', role: 'admin' };
const resource = { id: '000000000000000000000002', name: 'Water bottles', category: 'water', quantityAvailable: 10, unit: 'bottles', storageLocation: 'Community centre', active: true, stockVersion: 0 };
const request = { id: '000000000000000000000003', assistanceType: 'water', urgency: 'high', status: 'pending', description: 'Clean water needed', location: 'Main Street', requester: '000000000000000000000004', createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z' };
const allocation = { id: '000000000000000000000005', resource: resource.id, assistanceRequest: request.id, resourceName: resource.name, unit: resource.unit, allocatedQuantity: 4, createdAt: request.createdAt, allocatedBy: admin.id };
const originalAdapter = api.defaults.adapter;
let role;
let calls;
let handleResources;
let handleRequest;

function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}
function inventory(items = [resource], page = 1, total = items.length) { return { resources: items, page, total, totalPages: Math.max(1, Math.ceil(total / 10)) }; }
function history(items = [], page = 1, total = items.length) { return { allocations: items, page, total, totalPages: Math.max(1, Math.ceil(total / 10)) }; }

beforeEach(() => {
  localStorage.clear(); setToken('test-token'); role = 'admin'; calls = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  handleRequest = (config) => reply(config, { request });
  handleResources = (config) => reply(config, config.url === '/resources/allocations' ? history() : inventory());
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/me') return reply(config, { user: { ...admin, role } });
    calls.push(config);
    if (config.url === '/volunteers') return reply(config, { volunteers: [], page: 1, totalPages: 1 });
    if (config.url.startsWith('/requests/')) return handleRequest(config);
    return handleResources(config);
  };
});
afterEach(() => { cleanup(); setToken(null); api.defaults.adapter = originalAdapter; });
function openPage(path = '/resources') { render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>); }
function fill(label, value) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  fill('Resource name', '  Rice bags  '); fill('Category', 'food'); fill('Available quantity', '0'); fill('Unit', 'bags'); fill('Storage location', 'Community centre');
}

test.each(['citizen', 'volunteer'])('%s cannot open resource management', async (accountRole) => {
  role = accountRole; openPage();
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy(); expect(calls).toHaveLength(0);
});
test('resource management requires a session', async () => {
  setToken(null); openPage(); expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy(); expect(calls).toHaveLength(0);
});
test('admin inventory shows current quantity, location, status, and allocation history', async () => {
  handleResources = (config) => reply(config, config.url === '/resources/allocations' ? history([allocation]) : inventory());
  openPage();
  expect(await screen.findByRole('table', { name: 'Resource stock and storage locations' })).toBeTruthy();
  expect(screen.getByText('10 bottles')).toBeTruthy(); expect(screen.getByText('Community centre')).toBeTruthy(); expect(screen.getByText('Active')).toBeTruthy();
  expect(await screen.findByText('Water bottles · 4 bottles')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View assistance request' }).getAttribute('href')).toBe(`/requests/${request.id}`);
});
test('admin creates a resource with normalized fields and zero available stock', async () => {
  let current = [];
  handleResources = (config) => {
    if (config.method === 'post') { current = [{ ...resource, ...JSON.parse(config.data) }]; return reply(config, { resource: current[0] }, 201); }
    return reply(config, config.url === '/resources/allocations' ? history() : inventory(current));
  };
  openPage(); await openForm(); fireEvent.click(screen.getByRole('button', { name: 'Save resource' }));
  expect(await screen.findByText('Resource added.')).toBeTruthy(); expect(await screen.findByText('0 bags')).toBeTruthy();
  const sent = calls.find((config) => config.method === 'post');
  expect(sent.headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(sent.data)).toEqual({ name: 'Rice bags', category: 'food', quantityAvailable: 0, unit: 'bags', storageLocation: 'Community centre' });
});
test('resource validation rejects whitespace, fractional, negative, and unsafe quantities without a POST', async () => {
  openPage(); await openForm(); fill('Resource name', ' ');
  fireEvent.submit(screen.getByRole('form', { name: 'Add resource' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Enter a name'); fill('Resource name', 'Rice');
  for (const value of ['-1', '0.5', '9007199254740992']) {
    fill('Available quantity', value); fireEvent.submit(screen.getByRole('form', { name: 'Add resource' }));
    expect((await screen.findByRole('alert')).textContent).toContain('safe whole number');
  }
  expect(calls.some((config) => config.method === 'post')).toBe(false);
});
test('edit submits the stock version and preserves form data after a validation failure', async () => {
  handleResources = (config) => config.method === 'patch' ? reply(config, { message: 'Check stock quantity' }, 400) : reply(config, config.url === '/resources/allocations' ? history() : inventory());
  openPage(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Water bottles' })); fill('Available quantity', '6');
  fireEvent.click(screen.getByRole('button', { name: 'Save resource' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Check stock quantity'); expect(screen.getByLabelText('Available quantity').value).toBe('6');
  const sent = calls.find((config) => config.method === 'patch');
  expect(sent.url).toBe(`/resources/${resource.id}`); expect(JSON.parse(sent.data)).toEqual({ ...Object.fromEntries(['name', 'category', 'unit', 'storageLocation'].map((key) => [key, resource[key]])), quantityAvailable: 6, expectedVersion: 0 });
});
test('stale inventory edits require closing and refreshing before another save', async () => {
  let quantity = 10;
  handleResources = (config) => {
    if (config.method === 'patch') { quantity = 6; return reply(config, { message: 'Resource changed. Refresh inventory' }, 409); }
    return reply(config, config.url === '/resources/allocations' ? history() : inventory([{ ...resource, quantityAvailable: quantity }]));
  };
  openPage(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Water bottles' })); fireEvent.click(screen.getByRole('button', { name: 'Save resource' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Refresh inventory'); expect(screen.getByRole('button', { name: 'Save resource' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' })); expect(await screen.findByText('6 bottles')).toBeTruthy();
  expect(screen.queryByRole('form', { name: 'Edit resource' })).toBe(null);
});
test('deactivation retains the resource and removes edit and allocation availability', async () => {
  let active = true;
  handleResources = (config) => {
    if (config.method === 'patch') { active = false; return reply(config, { resource: { ...resource, active } }); }
    return reply(config, config.url === '/resources/allocations' ? history() : inventory([{ ...resource, active }]));
  };
  openPage(); fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Water bottles' }));
  expect(await screen.findByText('Inactive')).toBeTruthy(); expect(screen.getByText('Unavailable for allocation')).toBeTruthy();
  expect(JSON.parse(calls.find((config) => config.method === 'patch').data)).toEqual({ expectedVersion: 0 });
});
test('inventory supports loading, error, retry, and empty states', async () => {
  let finish;
  handleResources = (config) => config.url === '/resources/allocations' ? reply(config, history()) : new Promise((resolve, reject) => { finish = () => { try { resolve(reply(config, {}, 503)); } catch (error) { reject(error); } }; });
  openPage(); expect(await screen.findByText('Loading inventory…')).toBeTruthy(); await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish()); expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  handleResources = (config) => reply(config, config.url === '/resources/allocations' ? history() : inventory([]));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' })); expect(await screen.findByRole('heading', { name: 'No resources to show.' })).toBeTruthy();
});
test('status filtering resets inventory pagination', async () => {
  handleResources = (config) => reply(config, config.url === '/resources/allocations' ? history() : inventory([resource], Number(config.params.page), 11));
  openPage(); await screen.findByRole('table'); fireEvent.click(within(screen.getByRole('navigation', { name: 'Inventory pages' })).getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(calls.filter((config) => config.url === '/resources').at(-1).params.page).toBe(2));
  fill('Inventory status', 'false'); await waitFor(() => expect(calls.filter((config) => config.url === '/resources').at(-1).params).toEqual({ active: 'false', page: 1 }));
});
test('allocating from a request updates displayed stock and scoped history', async () => {
  let quantity = 10; let records = [];
  handleResources = (config) => {
    if (config.method === 'post') { quantity = 6; records = [allocation]; return reply(config, { resource: { ...resource, quantityAvailable: quantity }, allocation }, 201); }
    return reply(config, config.url === '/resources/allocations' ? history(records) : inventory([{ ...resource, quantityAvailable: quantity }]));
  };
  openPage(`/requests/${request.id}`); await screen.findByRole('option', { name: /Water bottles/ }); fill('Available resource', resource.id); fill('Quantity to allocate', '4');
  fireEvent.click(screen.getByRole('button', { name: 'Allocate resource' }));
  expect(await screen.findByText('Resources allocated successfully. Available stock has been updated.')).toBeTruthy();
  expect(await screen.findByText('Available: 6 bottles')).toBeTruthy(); expect(await screen.findByText('Water bottles · 4 bottles')).toBeTruthy();
  expect(JSON.parse(calls.find((config) => config.method === 'post').data)).toEqual({ assistanceRequest: request.id, allocatedQuantity: 4 });
  expect(calls.filter((config) => config.url === '/resources/allocations').at(-1).params.assistanceRequest).toBe(request.id);
});
test('allocation rejects missing selection, excess stock, zero, and fractional quantities before sending', async () => {
  openPage(`/requests/${request.id}`); await screen.findByRole('option', { name: /Water bottles/ });
  fireEvent.click(screen.getByRole('button', { name: 'Allocate resource' })); expect((await screen.findByRole('alert')).textContent).toContain('Choose an active resource');
  fill('Available resource', resource.id); fill('Quantity to allocate', '11'); fireEvent.click(screen.getByRole('button', { name: 'Allocate resource' })); expect((await screen.findByRole('alert')).textContent).toContain('exceeds');
  for (const value of ['0', '-1', '1.5']) { fill('Quantity to allocate', value); fireEvent.submit(screen.getByRole('button', { name: 'Allocate resource' }).closest('form')); expect((await screen.findByRole('alert')).textContent).toContain('positive safe whole number'); }
  expect(calls.some((config) => config.method === 'post')).toBe(false);
});
test.each(['completed', 'cancelled'])('%s requests show allocation history without allocation controls', async (status) => {
  handleRequest = (config) => reply(config, { request: { ...request, status } });
  handleResources = (config) => reply(config, history([allocation]));
  openPage(`/requests/${request.id}`); expect(await screen.findByText('Resources cannot be allocated to completed or cancelled requests.')).toBeTruthy();
  expect(await screen.findByText('Water bottles · 4 bottles')).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Allocate resource' })).toBe(null);
  expect(calls.some((config) => config.url === '/resources')).toBe(false);
});
test('allocation conflicts require refreshing the request and cannot be blindly resubmitted', async () => {
  let changed = false;
  handleRequest = (config) => reply(config, { request: { ...request, status: changed ? 'completed' : 'pending' } });
  handleResources = (config) => {
    if (config.method === 'post') { changed = true; return reply(config, { message: 'Request completed or cancelled. Refresh the request' }, 409); }
    return reply(config, config.url === '/resources/allocations' ? history() : inventory());
  };
  openPage(`/requests/${request.id}`); await screen.findByRole('option', { name: /Water bottles/ }); fill('Available resource', resource.id);
  fireEvent.click(screen.getByRole('button', { name: 'Allocate resource' })); expect((await screen.findByRole('alert')).textContent).toContain('Request completed');
  expect(screen.getByRole('button', { name: 'Allocate resource' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh allocations' })); expect(await screen.findByText('Resources cannot be allocated to completed or cancelled requests.')).toBeTruthy();
  expect(calls.filter((config) => config.method === 'post')).toHaveLength(1);
});
test('a failed allocation blocks retries until stock and history have been refreshed', async () => {
  handleResources = (config) => config.method === 'post' ? reply(config, {}, 500) : reply(config, config.url === '/resources/allocations' ? history() : inventory());
  openPage(`/requests/${request.id}`); await screen.findByRole('option', { name: /Water bottles/ }); fill('Available resource', resource.id);
  fireEvent.click(screen.getByRole('button', { name: 'Allocate resource' })); expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  expect(screen.getByRole('button', { name: 'Allocate resource' }).disabled).toBe(true);
  expect(screen.getByText('Refresh stock and allocation history before trying again.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh allocations' })); await screen.findByRole('option', { name: /Water bottles/ });
  expect(calls.filter((config) => config.method === 'post')).toHaveLength(1);
});
test('allocation history errors can be retried', async () => {
  handleResources = (config) => config.url === '/resources/allocations' ? reply(config, {}, 503) : reply(config, inventory());
  openPage(); expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  handleResources = (config) => reply(config, config.url === '/resources/allocations' ? history() : inventory());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh allocations' })); expect(await screen.findByText('No resource allocations yet.')).toBeTruthy();
});
