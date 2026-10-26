import { useEffect, useState } from 'react';
import api, { apiErrorMessage } from '../api/client.js';

function VolunteerPicker({ selected, onSelect, disabled, assignedVolunteer }) {
  const [people, setPeople] = useState([]);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ loading: true, error: '', more: false });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data } = await api.get('/volunteers', { params: { page }, signal: controller.signal });
        if (controller.signal.aborted) return;
        setPeople((previous) => page === 1 ? data.volunteers : [...previous, ...data.volunteers.filter((person) => !previous.some((old) => old.id === person.id))]);
        setResult({ loading: false, error: '', more: data.page < data.totalPages });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ loading: false, error: apiErrorMessage(failure), more: false });
      }
    }
    load();
    return () => controller.abort();
  }, [page, attempt]);

  function reload(nextPage) {
    setResult({ loading: true, error: '', more: false });
    setPage(nextPage);
    setAttempt((value) => value + 1);
  }

  const currentVolunteer = people.find((person) => person.id === assignedVolunteer);
  return <div className="mt-5">
    {currentVolunteer && <p className="mb-4 text-sm text-slate-600">Currently assigned: <span className="font-semibold text-slate-900">{currentVolunteer.name}</span></p>}
    <label htmlFor="assigned-volunteer" className="block text-sm font-semibold">Registered volunteer</label>
    <select id="assigned-volunteer" value={selected} onChange={(event) => onSelect(event.target.value)} disabled={disabled || !people.length} className="mt-2 w-full border border-slate-300 bg-white px-3 py-3 text-sm disabled:opacity-60">
      <option value="">Choose a volunteer</option>
      {people.map((person) => <option key={person.id} value={person.id} disabled={person.id === assignedVolunteer}>{person.name}{person.location ? ` · ${person.location}` : ''}{person.id === assignedVolunteer ? ' (currently assigned)' : ''}</option>)}
    </select>
    {result.loading && <p role="status" className="mt-3 text-sm text-slate-600">Loading registered volunteers…</p>}
    {!result.loading && !result.error && !people.length && <p className="mt-3 text-sm text-slate-600">No registered volunteers yet.</p>}
    {result.error && <div className="mt-3"><p role="alert" className="text-sm text-red-800">{result.error}</p><button type="button" onClick={() => reload(page)} className="mt-2 cursor-pointer text-sm font-semibold underline">Retry volunteers</button></div>}
    {result.more && <button type="button" onClick={() => reload(page + 1)} className="mt-3 cursor-pointer text-sm font-semibold underline">Load more volunteers</button>}
  </div>;
}

export default function AssignmentControls({ item, role, onUpdated, onRefresh }) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const active = ['assigned', 'in_progress'].includes(item.status);
  const canAssign = role === 'admin' && (item.status === 'pending' || active);
  const action = item.status === 'assigned' ? (item.acceptedAt ? 'start' : 'accept') : item.status === 'in_progress' ? 'complete' : null;
  const buttonClass = 'cursor-pointer bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';

  async function update(kind) {
    if (kind === 'assign' && !selected) { setError('Choose a registered volunteer.'); return; }
    setBusy(true);
    setError('');
    const body = { expectedVersion: item.assignmentVersion ?? 0 };
    try {
      let response;
      if (kind === 'assign') response = await api.patch(`/requests/${item.id}/assignment`, { ...body, volunteerId: selected });
      else if (kind === 'cancel') response = await api.delete(`/requests/${item.id}/assignment`, { data: body });
      else response = await api.patch(`/requests/${item.id}/task`, { ...body, action: kind });
      onUpdated(response.data.request, kind === 'cancel' ? 'Assignment cancelled. The request is pending again.' : 'Assignment updated successfully.');
    } catch (failure) {
      setError(apiErrorMessage(failure));
      setConflict([404, 409].includes(failure.response?.status));
    } finally { setBusy(false); }
  }

  return <section className="mt-8 border-t border-slate-200 pt-6" aria-labelledby="assignment-heading">
    <h2 id="assignment-heading" className="text-lg font-semibold">Volunteer assignment</h2>
    <p className="mt-3 text-sm leading-6 text-slate-600">{item.assignedVolunteer ? role === 'volunteer' ? 'You are assigned to this request.' : 'A volunteer is assigned to this request.' : 'No volunteer is assigned.'}</p>
    {item.acceptedAt && <p className="mt-2 text-sm text-emerald-800">Accepted · {new Date(item.acceptedAt).toLocaleString()}</p>}
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[['Assigned', item.assignedAt], ['Started', item.startedAt], ['Completed', item.completedAt], ['Assignment cancelled', item.assignmentCancelledAt]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1">{new Date(value).toLocaleString()}</dd></div>)}</dl>
    {canAssign && <>
      <VolunteerPicker selected={selected} onSelect={setSelected} disabled={busy || conflict} assignedVolunteer={item.assignedVolunteer} />
      <p className="mt-3 text-xs leading-6 text-slate-500">Reassigning resets acceptance and progress. Cancelling the assignment returns the request to pending.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => update('assign')} disabled={busy || conflict} className={buttonClass}>{busy ? 'Saving…' : active ? 'Reassign volunteer' : 'Assign volunteer'}</button>
        {active && <button type="button" onClick={() => update('cancel')} disabled={busy || conflict} className="cursor-pointer border border-red-300 px-5 py-3 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">Cancel assignment</button>}
      </div>
    </>}
    {role === 'volunteer' && action && <button type="button" onClick={() => update(action)} disabled={busy || conflict} className={`mt-5 ${buttonClass}`}>{busy ? 'Saving…' : action === 'accept' ? 'Accept task' : action === 'start' ? 'Mark in progress' : 'Mark completed'}</button>}
    {role === 'volunteer' && item.status === 'completed' && <p className="mt-4 text-sm text-emerald-800">This task is completed. Thank you for your support.</p>}
    {error && <div className="mt-4 border-l-4 border-red-600 bg-red-50 p-4"><p role="alert" className="text-sm text-red-900">{error}</p><button type="button" onClick={onRefresh} className="mt-3 cursor-pointer text-sm font-semibold underline">Refresh request</button></div>}
  </section>;
}
