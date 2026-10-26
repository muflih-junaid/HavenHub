import { useLiveRefresh } from '../realtime.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import ReportBadges from './ReportBadges.jsx';
import RequestBadges from './RequestBadges.jsx';

export default function AdminOverview() {
  const [result, setResult] = useState({ loading: true, data: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useLiveRefresh('disasters:changed requests:changed assignments:changed resources:changed allocations:changed volunteers:changed', () => setAttempt((value) => value + 1));

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data } = await api.get('/dashboard/summary', { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ loading: false, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ loading: false, data: null, error: apiErrorMessage(failure) });
      }
    }
    load();
    return () => controller.abort();
  }, [attempt]);

  function refresh() {
    setResult({ loading: true, data: null, error: '' });
    setAttempt((value) => value + 1);
  }

  const data = result.data;
  const metrics = data?.metrics;
  const cards = metrics ? [
    ['Total disaster reports', metrics.disasters.total, 'All submitted reports', '/disasters'],
    ['Pending disasters', metrics.disasters.pending, 'Awaiting admin review', '/disasters?status=pending'],
    ['Verified disasters', metrics.disasters.verified, 'Verified and not yet resolved', '/disasters?status=verified'],
    ['Pending requests', metrics.requests.pending, 'Awaiting assistance assignment', '/requests?status=pending'],
    ['Active requests', metrics.requests.active, 'Assigned or in progress', '/requests'],
    ['Completed requests', metrics.requests.completed, 'Completed assistance work', '/requests?status=completed'],
    ['Total volunteers', metrics.volunteers.total, 'Registered volunteer accounts', null],
    ['Total resource types', metrics.resources.totalTypes, 'Inventory entries, including inactive', '/resources'],
    ['Low-stock resources', metrics.resources.lowStock, `Active entries with ${data.lowStockThreshold} or fewer units`, '/resources'],
  ] : [];

  return <section className="mt-8" aria-labelledby="response-overview-heading" aria-busy={result.loading}>
    <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="response-overview-heading" className="text-xl font-semibold">Response overview</h2><button type="button" onClick={refresh} disabled={result.loading} className="cursor-pointer border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Refresh overview</button></div>
    <nav aria-label="Response operations" className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold"><Link to="/disasters?status=pending" className="underline decoration-orange-500 underline-offset-4">Review pending reports ↗</Link><Link to="/requests?status=pending" className="underline decoration-orange-500 underline-offset-4">Assign assistance ↗</Link><Link to="/resources" className="underline decoration-orange-500 underline-offset-4">Manage resources ↗</Link></nav>
    {result.loading && <p role="status" className="mt-6 border border-slate-200 bg-white p-7 text-slate-600">Loading dashboard summary…</p>}
    {result.error && <div className="mt-6 border border-red-200 bg-red-50 p-5"><p role="alert" className="text-sm text-red-900">{result.error}</p><button onClick={refresh} className="mt-4 cursor-pointer text-sm font-semibold underline underline-offset-4">Try again</button></div>}
    {data && <>
      <p className="mt-5 text-xs text-slate-500">Updated {new Date(data.generatedAt).toLocaleString()}. Refresh for the latest counts.</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, description, to]) => <div key={label} className="min-w-0 border border-slate-200 bg-white p-5"><dt className="text-sm font-semibold text-slate-600">{label}</dt><dd className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{to ? <Link to={to} aria-label={`${label}: ${value.toLocaleString()}`} className="hover:text-orange-700 hover:underline">{value.toLocaleString()}</Link> : value.toLocaleString()}</dd><p className="mt-3 text-xs leading-5 text-slate-500">{description}</p></div>)}</dl>
      <div className="mt-7 grid items-start gap-6 xl:grid-cols-2">
        <section className="min-w-0 border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="recent-disasters-heading">
          <h3 id="recent-disasters-heading" className="text-lg font-semibold">Recent disaster reports</h3><p className="mt-2 text-xs leading-5 text-slate-500">The five newest reports across all statuses.</p>
          {!data.recentDisasters.length ? <p className="mt-5 border-t border-slate-100 pt-5 text-sm text-slate-600">No disaster reports have been submitted yet.</p> : <ul className="mt-5 divide-y divide-slate-100">{data.recentDisasters.map((report) => <li key={report.id} className="py-5 first:pt-0"><ReportBadges severity={report.severity} status={report.status} /><Link to={`/disasters/${report.id}`} className="mt-3 block break-words font-semibold hover:text-orange-700 hover:underline">{report.title}</Link><p className="mt-2 text-xs text-slate-500"><span className="capitalize">{report.disasterType}</span> · {new Date(report.createdAt).toLocaleString()}</p></li>)}</ul>}
          <Link to="/disasters" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">View all disaster reports</Link>
        </section>
        <section className="min-w-0 border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="urgent-requests-heading">
          <h3 id="urgent-requests-heading" className="text-lg font-semibold">Urgent pending requests</h3><p className="mt-2 text-xs leading-5 text-slate-500">Up to five high/critical requests. Critical first, then oldest within each urgency.</p>
          {!data.urgentPendingRequests.length ? <p className="mt-5 border-t border-slate-100 pt-5 text-sm text-slate-600">No high or critical pending requests.</p> : <ul className="mt-5 divide-y divide-slate-100">{data.urgentPendingRequests.map((request) => <li key={request.id} className="py-5 first:pt-0"><RequestBadges urgency={request.urgency} status={request.status} /><Link to={`/requests/${request.id}`} className="mt-3 block font-semibold capitalize hover:text-orange-700 hover:underline">{request.assistanceType} assistance request</Link><p className="mt-2 text-xs text-slate-500">Submitted {new Date(request.createdAt).toLocaleString()}</p></li>)}</ul>}
          <Link to="/requests?status=pending" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">View pending assistance requests</Link>
        </section>
      </div>
    </>}
  </section>;
}
