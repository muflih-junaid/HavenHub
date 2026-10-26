import { useLiveRefresh } from '../realtime.js';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import RequestBadges from '../components/RequestBadges.jsx';

function RequestListPage({ mine, tasks, page, urgency, status }) {
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [result, setResult] = useState({ loading: true, data: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useLiveRefresh('requests:changed assignments:changed requests:queue-changed', () => setAttempt((value) => value + 1));

  useEffect(() => {
    const controller = new AbortController();
    async function loadRequests() {
      try {
        const { data } = await api.get(mine ? '/requests/mine' : tasks ? '/requests/tasks' : '/requests', {
          params: { page, ...(urgency ? { urgency } : {}), ...(status ? { status } : {}) }, signal: controller.signal,
        });
        if (!controller.signal.aborted) setResult({ loading: false, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ loading: false, data: null, error: apiErrorMessage(failure) });
      }
    }
    loadRequests();
    return () => controller.abort();
  }, [mine, tasks, page, urgency, status, attempt]);

  function changeFilter(key, value) {
    const params = new URLSearchParams();
    const nextUrgency = key === 'urgency' ? value : urgency;
    const nextStatus = key === 'status' ? value : status;
    if (nextUrgency) params.set('urgency', nextUrgency);
    if (nextStatus) params.set('status', nextStatus);
    setSearchParams(params);
  }

  function pageLink(next) {
    const params = new URLSearchParams({ page: String(next) });
    if (urgency) params.set('urgency', urgency);
    if (status) params.set('status', status);
    return `?${params}`;
  }

  function retry() {
    setResult({ loading: true, data: null, error: '' });
    setAttempt((previous) => previous + 1);
  }

  const data = result.data;
  return (
    <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10 sm:py-14">
      <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Community assistance</p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
        <div><h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{tasks ? 'My tasks' : mine ? 'My requests' : user.role === 'admin' ? 'Assistance request queue' : 'Pending assistance requests'}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-600">{tasks ? 'Accept your assignments, record progress, and complete tasks. Completed tasks stay here for reference.' : mine ? 'Track your assistance requests and open a request to see its details.' : user.role === 'admin' ? 'Review community requests by urgency and status.' : 'Pending summaries are available here. Descriptions, locations, and requester details are private.'}</p>
        </div>
        {mine && <Link to="/requests/new" className="bg-orange-700 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-800">Request assistance ↗</Link>}
      </div>
      {user.role === 'admin' && <div className="mt-7 flex flex-wrap items-end gap-4 border border-slate-200 bg-white p-5">
        <div><label htmlFor="queue-urgency" className="mb-2 block text-sm font-semibold">Urgency</label><select id="queue-urgency" value={urgency} onChange={(event) => changeFilter('urgency', event.target.value)} className="min-w-40 border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">All urgencies</option>{['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></div>
        <div><label htmlFor="queue-status" className="mb-2 block text-sm font-semibold">Status</label><select id="queue-status" value={status} onChange={(event) => changeFilter('status', event.target.value)} className="min-w-40 border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">All statuses</option>{['pending', 'assigned', 'in_progress', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></div>
        <button onClick={() => setSearchParams({})} className="cursor-pointer px-3 py-2.5 text-sm font-semibold underline underline-offset-4">Clear filters</button>
      </div>}
      <div className="mt-8" aria-busy={result.loading}>
        {result.loading && <p role="status" className="border border-slate-200 bg-white p-8 text-slate-600">Loading assistance requests…</p>}
        {result.error && <div className="border border-red-200 bg-red-50 p-6"><p role="alert" className="text-sm text-red-900">{result.error}</p><button onClick={retry} className="mt-4 cursor-pointer text-sm font-semibold underline underline-offset-4">Try again</button><button onClick={() => setSearchParams({})} className="ml-5 cursor-pointer text-sm font-semibold underline underline-offset-4">Reset view</button></div>}
        {data && <>
          {data.requests.length === 0 ? <div className="border border-slate-200 bg-white p-8"><h2 className="text-xl font-semibold">No assistance requests to show.</h2><p className="mt-3 text-sm text-slate-600">{tasks ? 'No tasks assigned yet. Your admin-assigned requests will appear here.' : mine ? 'Your assistance requests will appear here after submission.' : 'No requests match this view.'}</p></div> : <ul className="grid gap-5">{data.requests.map((item) => (
            <li key={item.id} className="border border-slate-200 bg-white p-6 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3"><RequestBadges urgency={item.urgency} status={item.status} acceptedAt={item.acceptedAt} /><p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p></div>
              <h2 className="mt-4 text-xl font-semibold capitalize"><Link to={`/requests/${item.id}`} className="hover:text-orange-700 hover:underline">{item.assistanceType} assistance request</Link></h2>
              {item.description && <p className="mt-3 line-clamp-2 break-words text-sm leading-7 text-slate-600">{item.description}</p>}
              {item.location && <p className="mt-4 break-words border-t border-slate-100 pt-4 text-sm text-slate-600"><span className="font-semibold text-slate-800">Location:</span> {item.location}</p>}
            </li>
          ))}</ul>}
          <nav aria-label="Assistance request pages" className="mt-7 flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-slate-600">{data.total} {data.total === 1 ? 'request' : 'requests'} · Page {data.page} of {data.totalPages}</p>
            <div className="flex gap-3">
              {data.page > 1 ? <Link to={pageLink(data.page - 1)} className="border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100">Previous</Link> : <button disabled className="border border-slate-200 px-4 py-2 text-slate-400">Previous</button>}
              {data.page < data.totalPages ? <Link to={pageLink(data.page + 1)} className="border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100">Next</Link> : <button disabled className="border border-slate-200 px-4 py-2 text-slate-400">Next</button>}
            </div>
          </nav>
        </>}
      </div>
    </section>
  );
}

export default function AssistanceList({ mine = false, tasks = false }) {
  const [params] = useSearchParams();
  const page = params.get('page') ?? '1';
  const urgency = mine || tasks ? '' : params.get('urgency') || '';
  const status = mine || tasks ? '' : params.get('status') || '';
  return <RequestListPage key={`${mine}-${tasks}-${page}-${urgency}-${status}`} mine={mine} tasks={tasks} page={page} urgency={urgency} status={status} />;
}
