import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import ResourceForm from '../components/ResourceForm.jsx';
import ResourceAllocations from '../components/ResourceAllocations.jsx';

export default function Resources() {
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('all');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ loading: true, data: null, error: '' });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data } = await api.get('/resources', { params: { page, active }, signal: controller.signal });
        if (!controller.signal.aborted) setResult({ loading: false, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ loading: false, data: null, error: apiErrorMessage(failure) });
      }
    }
    load();
    return () => controller.abort();
  }, [page, active, attempt]);

  function refresh() {
    setError('');
    setEditing(null);
    setResult({ loading: true, data: null, error: '' });
    setAttempt((value) => value + 1);
  }

  async function deactivate(resource) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.patch(`/resources/${resource.id}/deactivate`, { expectedVersion: resource.stockVersion });
      setNotice('Resource deactivated. Existing allocation history is retained.');
      refresh();
    } catch (failure) { setError(apiErrorMessage(failure)); }
    finally { setBusy(false); }
  }

  const data = result.data;
  return <section className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10 sm:py-14">
    <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Response resources</p>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-5"><div><h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Resource inventory</h1><p className="mt-4 max-w-2xl leading-7 text-slate-600">Manage available stock. Open an assistance request to allocate resources.</p></div><button onClick={() => { setEditing({}); setNotice(''); }} disabled={busy} className="cursor-pointer bg-orange-700 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50">Add resource</button></div>
    <Link to="/requests" className="mt-5 inline-block text-sm font-semibold underline decoration-orange-500 underline-offset-4">Open assistance request queue ↗</Link>
    {notice && <p role="status" className="mt-6 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
    {editing && <ResourceForm key={editing.id || 'new'} resource={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={(message) => { setNotice(message); refresh(); }} />}
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4"><div><label htmlFor="inventory-active" className="mb-2 block text-sm font-semibold">Inventory status</label><select id="inventory-active" value={active} onChange={(event) => { setResult({ loading: true, data: null, error: '' }); setPage(1); setActive(event.target.value); }} className="border border-slate-300 bg-white px-4 py-2.5 text-sm"><option value="all">All resources</option><option value="true">Active resources</option><option value="false">Inactive resources</option></select></div><button disabled={busy} onClick={refresh} className="cursor-pointer text-sm font-semibold underline underline-offset-4 disabled:opacity-50">Refresh inventory</button></div>
    {error && <p role="alert" className="mt-5 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error} Refresh inventory before trying again.</p>}
    {result.loading && <p role="status" className="mt-6 border border-slate-200 bg-white p-7 text-slate-600">Loading inventory…</p>}
    {result.error && <p role="alert" className="mt-6 border border-red-200 bg-red-50 p-5 text-sm text-red-900">{result.error} Use Refresh inventory to try again.</p>}
    {data && <>
      {!data.resources.length ? <div className="mt-6 border border-slate-200 bg-white p-7"><h2 className="text-xl font-semibold">No resources to show.</h2><p className="mt-3 text-sm text-slate-600">Add a resource or change the inventory status filter.</p></div> : <div className="mt-6 overflow-x-auto border border-slate-200 bg-white"><table className="w-full text-left text-sm"><caption className="sr-only">Resource stock and storage locations</caption><thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600"><tr>{['Resource', 'Available', 'Storage location', 'Status', 'Actions'].map((title) => <th key={title} scope="col" className="px-5 py-4 font-semibold">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.resources.map((resource) => <tr key={resource.id}><th scope="row" className="min-w-40 px-5 py-5 font-semibold"><p>{resource.name}</p><p className="mt-1 text-xs font-normal text-slate-500 capitalize">{resource.category}</p></th><td className="whitespace-nowrap px-5 py-5 font-semibold">{resource.quantityAvailable} {resource.unit}</td><td className="min-w-44 px-5 py-5 text-slate-600">{resource.storageLocation}</td><td className="px-5 py-5"><span className={`px-2.5 py-1 text-xs font-semibold ${resource.active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{resource.active ? 'Active' : 'Inactive'}</span></td><td className="px-5 py-5">{resource.active ? <div className="flex gap-4"><button aria-label={`Edit ${resource.name}`} disabled={busy || Boolean(error)} onClick={() => { setEditing(resource); setNotice(''); }} className="cursor-pointer font-semibold underline underline-offset-4 disabled:opacity-50">Edit</button><button aria-label={`Deactivate ${resource.name}`} disabled={busy || Boolean(error)} onClick={() => deactivate(resource)} className="cursor-pointer font-semibold text-red-800 underline underline-offset-4 disabled:opacity-50">Deactivate</button></div> : <span className="text-xs text-slate-500">Unavailable for allocation</span>}</td></tr>)}</tbody></table></div>}
      <nav aria-label="Inventory pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-600">{data.total} resources · Page {data.page} of {data.totalPages}</p><div className="flex gap-3">{[['Previous', page - 1, data.page <= 1], ['Next', page + 1, data.page >= data.totalPages]].map(([label, next, disabled]) => <button key={label} disabled={disabled || busy} onClick={() => { setResult({ loading: true, data: null, error: '' }); setPage(next); }} className="cursor-pointer border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-40">{label}</button>)}</div></nav>
    </>}
    <ResourceAllocations />
  </section>;
}
