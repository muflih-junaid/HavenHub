import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import App from './App.jsx';
import AuthProvider from './context/AuthProvider.jsx';
import api, { setToken } from './api/client.js';

const account = { id: '000000000000000000000001', name: 'Admin', role: 'admin', email: 'admin@example.com', phone: '+94 77 123 4567' };
const report = { id: '000000000000000000000002', title: 'Flooding near Main Street', disasterType: 'flood', severity: 'critical', status: 'pending', createdAt: '2026-10-26T08:00:00Z' };
const request = { id: '000000000000000000000003', assistanceType: 'rescue', urgency: 'critical', status: 'pending', createdAt: '2026-10-26T08:00:00Z' };
const summary = {
  metrics: { disasters: { total: 37, pending: 6, verified: 8 }, requests: { pending: 19, active: 11, completed: 21 }, volunteers: { total: 14 }, resources: { totalTypes: 13, lowStock: 4 } },
  recentDisasters: [report], urgentPendingRequests: [request], lowStockThreshold: 10, generatedAt: '2026-10-26T09:00:00Z',
};
const originalAdapter = api.defaults.adapter;
let role;
let calls;
let handleSummary;
let handleReports;

function reply(config, data, status = 200) {
  const response = { config, data, status, statusText: '', headers: {} };
  if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  return response;
}
beforeEach(() => {
  localStorage.clear(); setToken('test-token'); role = 'admin'; calls = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  handleSummary = (config) => reply(config, summary);
  handleReports = (config) => reply(config, { reports: [], page: Number(config.params.page), total: 0, totalPages: 1 });
  api.defaults.adapter = async (config) => {
    if (config.url === '/auth/me') return reply(config, { user: { ...account, role } });
    calls.push(config);
    if (config.url === '/disasters') return handleReports(config);
    return handleSummary(config);
  };
});
afterEach(() => { cleanup(); setToken(null); api.defaults.adapter = originalAdapter; });
function openPage(path = '/dashboard/admin') { render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>); }
function metric(label) { return screen.getByText(label, { selector: 'dt' }).parentElement; }

test('renders each server-provided metric and both work lists from the protected summary endpoint', async () => {
  openPage(); await screen.findByText('Total disaster reports');
  for (const [label, count] of [['Total disaster reports', 37], ['Pending disasters', 6], ['Verified disasters', 8], ['Pending requests', 19], ['Active requests', 11], ['Completed requests', 21], ['Total volunteers', 14], ['Total resource types', 13], ['Low-stock resources', 4]]) {
    expect(within(metric(label)).getByText(String(count))).toBeTruthy();
  }
  expect(screen.getByRole('link', { name: report.title }).getAttribute('href')).toBe(`/disasters/${report.id}`);
  expect(screen.getByRole('link', { name: 'rescue assistance request' }).getAttribute('href')).toBe(`/requests/${request.id}`);
  expect(screen.getByText('Active entries with 10 or fewer units')).toBeTruthy();
  expect(calls.every((config) => config.url === '/dashboard/summary')).toBe(true);
  expect(calls[0].headers.Authorization).toBe('Bearer test-token');
});

test('loading does not display fabricated zero counts, and errors allow a retry', async () => {
  let finish;
  handleSummary = (config) => new Promise((resolve, reject) => { finish = () => { try { resolve(reply(config, {}, 503)); } catch (failure) { reject(failure); } }; });
  openPage(); expect(await screen.findByText('Loading dashboard summary…')).toBeTruthy();
  expect(screen.queryByText('Total disaster reports')).toBe(null);
  await waitFor(() => expect(finish).toBeTypeOf('function')); await act(async () => finish());
  expect((await screen.findByRole('alert')).textContent).toContain('server is unavailable');
  expect(screen.queryByText('Total disaster reports')).toBe(null);
  handleSummary = (config) => reply(config, summary);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Total disaster reports')).toBeTruthy();
});

test('empty data displays genuine zero counts and separate empty work-list states', async () => {
  handleSummary = (config) => reply(config, { ...summary, metrics: { disasters: { total: 0, pending: 0, verified: 0 }, requests: { pending: 0, active: 0, completed: 0 }, volunteers: { total: 0 }, resources: { totalTypes: 0, lowStock: 0 } }, recentDisasters: [], urgentPendingRequests: [] });
  openPage(); expect(await screen.findByText('No disaster reports have been submitted yet.')).toBeTruthy();
  expect(screen.getByText('No high or critical pending requests.')).toBeTruthy();
  expect(within(metric('Total disaster reports')).getByText('0')).toBeTruthy();
  expect(within(metric('Low-stock resources')).getByText('0')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Assign assistance/ }).getAttribute('href')).toBe('/requests?status=pending');
});

test('refresh replaces counts and lists with current server data', async () => {
  openPage(); await screen.findByText('Total disaster reports');
  handleSummary = (config) => reply(config, { ...summary, metrics: { ...summary.metrics, disasters: { total: 38, pending: 7, verified: 8 } }, recentDisasters: [{ ...report, title: 'New fire report' }], generatedAt: '2026-10-26T10:00:00Z' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(await screen.findByRole('link', { name: 'New fire report' })).toBeTruthy();
  expect(within(metric('Total disaster reports')).getByText('38')).toBeTruthy(); expect(screen.queryByRole('link', { name: report.title })).toBe(null);
});

test.each(['citizen', 'volunteer'])('%s dashboard never requests admin statistics', async (accountRole) => {
  role = accountRole; openPage(`/dashboard/${role}`);
  await screen.findByRole('heading', { name: 'Your account' });
  expect(screen.queryByRole('heading', { name: 'Response overview' })).toBe(null); expect(calls).toHaveLength(0);
});

test.each(['citizen', 'volunteer'])('%s cannot open the admin dashboard', async (accountRole) => {
  role = accountRole; openPage();
  expect(await screen.findByRole('heading', { name: 'This workspace is for another role.' })).toBeTruthy(); expect(calls).toHaveLength(0);
});

test('pending and verified metric links open filtered report lists and retain status during pagination', async () => {
  handleReports = (config) => reply(config, { reports: [{ ...report, description: 'Report description', location: { address: 'Main Street' }, status: config.params.status }], page: Number(config.params.page), total: 11, totalPages: 2 });
  openPage(); fireEvent.click(await screen.findByRole('link', { name: 'Verified disasters: 8' }));
  expect(await screen.findByRole('heading', { name: 'Verified disaster reports' })).toBeTruthy();
  await screen.findByRole('link', { name: report.title });
  expect(calls.at(-1).params).toEqual({ page: '1', status: 'verified' });
  fireEvent.click(screen.getByRole('link', { name: 'Next' }));
  await waitFor(() => expect(calls.at(-1).params).toEqual({ page: '2', status: 'verified' }));
});

test('operational links lead to existing request and resource pages', async () => {
  openPage(); await screen.findByText('Total disaster reports');
  expect(screen.getByRole('link', { name: /Review pending reports/ }).getAttribute('href')).toBe('/disasters?status=pending');
  expect(screen.getByRole('link', { name: 'Pending requests: 19' }).getAttribute('href')).toBe('/requests?status=pending');
  expect(screen.getByRole('link', { name: 'Completed requests: 21' }).getAttribute('href')).toBe('/requests?status=completed');
  expect(screen.getByRole('link', { name: /Manage resources/ }).getAttribute('href')).toBe('/resources');
});
