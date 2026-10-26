import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import api, { setToken } from './api/client.js';

const user = { id: '000000000000000000000001', name: 'Test Citizen', email: 'test@example.com', phone: '+94 77 123 4567', role: 'citizen' };
const report = {
  id: '000000000000000000000002', title: 'Flooding near Main Street', description: 'Water is rising across the road.',
  disasterType: 'flood', severity: 'high', status: 'pending', reportedBy: user.id,
  location: { address: 'Main Street, Colombo', latitude: 0, longitude: 0 },
  createdAt: '2026-10-24T08:00:00.000Z', updatedAt: '2026-10-24T08:00:00.000Z',
};
const originalAdapter = api.defaults.adapter;
let role;
let handleReports;
let requests;

function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}

function listData(reports = [report], page = 1, total = reports.length) {
  return { reports, page, pageSize: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) };
}

beforeEach(() => {
  localStorage.clear();
  setToken('test-session-token');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  requests = [];
  role = 'citizen';
  handleReports = (config) => {
    if (config.url === '/disasters' && config.method === 'get') return reply(config, listData());
    return reply(config, { report }, config.method === 'post' ? 201 : 200);
  };
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/me') return reply(config, { user: { ...user, role } });
    requests.push(config);
    return handleReports(config);
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

async function fillReport() {
  await screen.findByRole('heading', { name: 'Report a disaster.' });
  fill('Report title', report.title);
  fill('Description', report.description);
  fill('Disaster type', 'flood');
  fill('Severity', 'high');
  fill('Location address', report.location.address);
}

test('report pages require a session', async () => {
  setToken(null);
  openPage('/disasters');
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

test.each(['volunteer', 'admin'])('%s cannot access the submission form', async (accountRole) => {
  role = accountRole;
  openPage('/disasters/new');
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Submit report' })).toBe(null);
  expect(requests).toHaveLength(0);
});

test('loads the list and opens an individual report with its full details', async () => {
  openPage('/disasters');
  const title = await screen.findByRole('link', { name: report.title });
  expect(screen.getByRole('link', { name: /Report a disaster/ })).toBeTruthy();
  expect(requests.at(-1).headers.Authorization).toBe('Bearer test-session-token');
  fireEvent.click(title);
  expect(await screen.findByRole('heading', { name: report.title })).toBeTruthy();
  expect(screen.getByText(report.description)).toBeTruthy();
  expect(screen.getByText(report.location.address)).toBeTruthy();
  expect(screen.getByText('Latitude: 0 · Longitude: 0')).toBeTruthy();
  expect(screen.getByText('You')).toBeTruthy();
});

test('submits numeric coordinates, displays a pending success message, and disables duplicate submissions', async () => {
  let finish;
  handleReports = (config) => config.method === 'post'
    ? new Promise((resolve) => { finish = () => resolve(reply(config, { report }, 201)); })
    : reply(config, { report });
  openPage('/disasters/new');
  await fillReport();
  fill('Latitude', '0');
  fill('Longitude', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
  expect((await screen.findByRole('button', { name: 'Submitting report…' })).disabled).toBe(true);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const body = JSON.parse(requests.find((request) => request.method === 'post').data);
  expect(body).toEqual({
    title: report.title, description: report.description, disasterType: 'flood', severity: 'high',
    location: { address: report.location.address, latitude: 0, longitude: 0 },
  });
  await act(async () => finish());
  expect(await screen.findByRole('heading', { name: report.title })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('submitted successfully with a pending status');
});

test('omits coordinates when both numeric inputs are blank', async () => {
  openPage('/disasters/new');
  await fillReport();
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
  await screen.findByRole('heading', { name: report.title });
  expect(JSON.parse(requests.find((request) => request.method === 'post').data).location).toEqual({ address: report.location.address });
});

test('requires coordinate pairs and rejects whitespace-only titles before sending a request', async () => {
  openPage('/disasters/new');
  await fillReport();
  fill('Latitude', '6.9');
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
  expect((await screen.findByRole('alert')).textContent).toContain('both latitude and longitude');
  fill('Latitude', '');
  fill('Report title', '   ');
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
  expect(screen.getByRole('alert').textContent).toContain('required');
  expect(requests).toHaveLength(0);
});

test('checks coordinate ranges even when browser validation is bypassed', async () => {
  openPage('/disasters/new');
  await fillReport();
  fill('Latitude', '91');
  fill('Longitude', '79');
  fireEvent.submit(screen.getByRole('button', { name: 'Submit report' }).closest('form'));
  expect((await screen.findByRole('alert')).textContent).toContain('between -90 and 90');
  expect(requests).toHaveLength(0);
});

test('shows submission errors and keeps the entered report for retry', async () => {
  handleReports = (config) => reply(config, { message: 'Could not save this report' }, 400);
  openPage('/disasters/new');
  await fillReport();
  fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not save this report');
  expect(screen.getByLabelText('Report title').value).toBe(report.title);
  expect(screen.getByRole('button', { name: 'Submit report' }).disabled).toBe(false);
});

test('shows list loading and a clear empty state, without a citizen-only action for volunteers', async () => {
  role = 'volunteer';
  let finish;
  handleReports = (config) => new Promise((resolve) => { finish = () => resolve(reply(config, listData([]))); });
  openPage('/disasters');
  expect(await screen.findByText('Loading disaster reports…')).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish());
  expect(await screen.findByRole('heading', { name: 'No reports to show.' })).toBeTruthy();
  expect(screen.getByText('There are no verified or resolved reports on this page.')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Report a disaster/ })).toBe(null);
});

test('loads another page through the API and removes the previous page contents', async () => {
  const secondReport = { ...report, id: '000000000000000000000003', title: 'Storm damage near the school' };
  handleReports = (config) => reply(config, listData(config.params.page === '2' ? [secondReport] : [report], Number(config.params.page), 11));
  openPage('/disasters');
  await screen.findByRole('link', { name: report.title });
  fireEvent.click(screen.getByRole('link', { name: 'Next' }));
  expect(await screen.findByRole('link', { name: secondReport.title })).toBeTruthy();
  expect(screen.queryByRole('link', { name: report.title })).toBe(null);
  expect(requests.at(-1).params.page).toBe('2');
});

test('list errors can be retried', async () => {
  let failed = true;
  handleReports = (config) => failed ? reply(config, {}, 503) : reply(config, listData());
  openPage('/disasters');
  expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: report.title })).toBeTruthy();
});

test('private or missing report details show an error and a link back to reports', async () => {
  handleReports = (config) => reply(config, { message: 'Disaster report not found' }, 404);
  openPage(`/disasters/${report.id}`);
  expect(await screen.findByRole('heading', { name: 'Report unavailable' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Disaster report not found');
  expect(screen.getByRole('link', { name: /Back to reports/ }).getAttribute('href')).toBe('/disasters');
});

test('report descriptions are rendered as text, without interpreting submitted HTML', async () => {
  const description = '<img src=x onerror="alert(1)">';
  handleReports = (config) => reply(config, { report: { ...report, description } });
  openPage(`/disasters/${report.id}`);
  expect(await screen.findByText(description)).toBeTruthy();
  expect(document.querySelector('img')).toBe(null);
});
