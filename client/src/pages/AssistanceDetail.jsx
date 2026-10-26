import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import RequestBadges from '../components/RequestBadges.jsx';
import AssignmentControls from '../components/AssignmentControls.jsx';

function RequestDetail({ id }) {
  const { user } = useAuth();
  const location = useLocation();
  const [result, setResult] = useState({ loading: true, item: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function loadRequest() {
      try {
        const { data } = await api.get(`/requests/${id}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ loading: false, item: data.request, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ loading: false, item: null, error: apiErrorMessage(failure) });
      }
    }
    loadRequest();
    return () => controller.abort();
  }, [id, attempt]);

  function refresh() {
    setCancelError('');
    setConflict(false);
    setResult({ loading: true, item: null, error: '' });
    setAttempt((previous) => previous + 1);
  }

  async function cancelRequest() {
    setCancelling(true);
    setCancelError('');
    try {
      const { data } = await api.patch(`/requests/${id}/cancel`);
      setResult({ loading: false, item: data.request, error: '' });
      setNotice('Your assistance request has been cancelled.');
    } catch (failure) {
      setCancelError(apiErrorMessage(failure));
      setConflict(failure.response?.status === 409);
    } finally {
      setCancelling(false);
    }
  }

  const item = result.item;
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 sm:py-14">
      <Link to={user.role === 'citizen' ? '/requests/mine' : user.role === 'volunteer' && item?.assignedVolunteer === user.id ? '/tasks' : '/requests'} className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to requests</Link>
      {notice && <p role="status" className="mt-7 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
      {location.state?.submitted && item?.status === 'pending' && <p role="status" className="mt-7 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">Your assistance request was submitted successfully.</p>}
      {result.loading && <p role="status" className="mt-8 border border-slate-200 bg-white p-8 text-slate-600">Loading assistance request…</p>}
      {result.error && <div className="mt-8 border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-semibold">Request unavailable</h1><p role="alert" className="mt-3 text-sm text-red-900">{result.error}</p><button onClick={refresh} className="mt-4 cursor-pointer text-sm font-semibold underline underline-offset-4">Try again</button></div>}
      {item && <article className="mt-8 border border-slate-200 bg-white p-6 sm:p-9">
        <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Community assistance</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 capitalize sm:text-4xl">{item.assistanceType} assistance request</h1>
        <div className="mt-5"><RequestBadges urgency={item.urgency} status={item.status} acceptedAt={item.acceptedAt} /></div>
        {user.role === 'volunteer' && item.assignedVolunteer !== user.id ? <p className="mt-7 text-sm leading-7 text-slate-600">This is a pending-request summary. Descriptions, locations, and requester details are not shared in the volunteer view.</p> : <>
          <h2 className="mt-8 text-lg font-semibold">Assistance needed</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{item.description}</p>
          <h2 className="mt-8 text-lg font-semibold">Location</h2>
          <p className="mt-3 break-words text-sm leading-7 text-slate-600">{item.location}</p>
          {item.disaster && <Link to={`/disasters/${item.disaster}`} className="mt-5 inline-block text-sm font-semibold underline decoration-orange-500 underline-offset-4">View linked disaster report</Link>}
        </>}
        <dl className="mt-8 grid gap-5 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Submitted</dt><dd className="mt-2">{new Date(item.createdAt).toLocaleString()}</dd></div>
          <div><dt className="text-xs text-slate-500">Last updated</dt><dd className="mt-2">{new Date(item.updatedAt).toLocaleString()}</dd></div>
          {item.requester && <div><dt className="text-xs text-slate-500">Requester</dt><dd className="mt-2 break-all">{item.requester === user.id ? 'You' : item.requester}</dd></div>}
        </dl>
        {user.role === 'citizen' && item.requester === user.id && item.status === 'pending' && <div className="mt-8 border-t border-slate-200 pt-6"><button type="button" disabled={cancelling || conflict} onClick={cancelRequest} className="cursor-pointer border border-red-300 px-5 py-3 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">{cancelling ? 'Cancelling…' : 'Cancel request'}</button><p className="mt-3 text-xs text-slate-500">Cancellation is available only while your request is pending.</p></div>}
        {(user.role === 'admin' || (user.role === 'volunteer' && item.assignedVolunteer === user.id)) && <AssignmentControls key={item.assignmentVersion ?? 0} item={item} role={user.role} onRefresh={refresh} onUpdated={(updated, message) => { setResult({ loading: false, item: updated, error: '' }); setNotice(message); }} />}
        {cancelError && <div className="mt-5 border-l-4 border-red-600 bg-red-50 p-4"><p role="alert" className="text-sm text-red-900">{cancelError}</p><button onClick={refresh} className="mt-3 cursor-pointer text-sm font-semibold underline underline-offset-4">Refresh request</button></div>}
      </article>}
    </section>
  );
}

export default function AssistanceDetail() {
  const { id } = useParams();
  return <RequestDetail key={id} id={id} />;
}
