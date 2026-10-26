import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { FormField } from './AuthPanel.jsx';

export default function ResourceAllocations({ request, onRefresh }) {
  const canAllocate = request && ['pending', 'assigned', 'in_progress'].includes(request.status);
  const [resources, setResources] = useState([]);
  const [stockPage, setStockPage] = useState(1);
  const [stock, setStock] = useState({ loading: Boolean(canAllocate), error: '', more: false });
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState({ loading: true, data: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!canAllocate) return;
    const controller = new AbortController();
    async function loadStock() {
      try {
        const { data } = await api.get('/resources', { params: { active: 'true', page: stockPage }, signal: controller.signal });
        if (controller.signal.aborted) return;
        setResources((previous) => stockPage === 1 ? data.resources : [...previous, ...data.resources.filter((item) => !previous.some((old) => old.id === item.id))]);
        setStock({ loading: false, error: '', more: data.page < data.totalPages });
      } catch (failure) {
        if (!controller.signal.aborted) setStock({ loading: false, error: apiErrorMessage(failure), more: false });
      }
    }
    loadStock();
    return () => controller.abort();
  }, [canAllocate, stockPage, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      try {
        const { data } = await api.get('/resources/allocations', { params: { page, ...(request ? { assistanceRequest: request.id } : {}) }, signal: controller.signal });
        if (!controller.signal.aborted) setHistory({ loading: false, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setHistory({ loading: false, data: null, error: apiErrorMessage(failure) });
      }
    }
    loadHistory();
    return () => controller.abort();
  }, [request, page, attempt]);

  function refresh() {
    setHistory({ loading: true, data: null, error: '' });
    setPage(1);
    setAttempt((value) => value + 1);
    setStockPage(1);
    if (canAllocate) setStock({ loading: true, error: '', more: false });
    if (stockPage !== 1) setSelected('');
    if (blocked && onRefresh) onRefresh();
  }

  async function allocate(event) {
    event.preventDefault();
    const amount = Number(quantity);
    const resource = resources.find((item) => item.id === selected);
    if (!resource) { setError('Choose an active resource.'); return; }
    if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(amount) || amount <= 0) { setError('Allocation quantity must be a positive safe whole number.'); return; }
    if (amount > resource.quantityAvailable) { setError('Allocation exceeds the displayed available quantity.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/resources/${selected}/allocations`, { assistanceRequest: request.id, allocatedQuantity: amount });
      setResources((previous) => previous.map((item) => item.id === data.resource.id ? data.resource : item));
      setNotice('Resources allocated successfully. Available stock has been updated.');
      setQuantity('1');
      refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
      setBlocked(!failure.response || failure.response.status === 409 || failure.response.status >= 500);
    } finally { setBusy(false); }
  }

  const chosen = resources.find((item) => item.id === selected);
  const data = history.data;
  return <section className="mt-8 border-t border-slate-200 pt-7" aria-labelledby="allocation-heading">
    <h2 id="allocation-heading" className="text-xl font-semibold">Resource allocations</h2>
    {notice && <p role="status" className="mt-4 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
    {canAllocate && <form onSubmit={allocate} className="mt-5 border border-slate-200 bg-slate-50 p-5">
      <h3 className="font-semibold">Allocate resources</h3>
      <div className="mt-4 grid items-start gap-5 sm:grid-cols-2">
        <div><label htmlFor="allocation-resource" className="mb-2 block text-sm font-semibold">Available resource</label><select id="allocation-resource" value={selected} disabled={busy || blocked || !resources.length} onChange={(event) => setSelected(event.target.value)} className="w-full border border-slate-300 bg-white px-3 py-3 text-sm disabled:opacity-50"><option value="">Choose a resource</option>{resources.map((item) => <option key={item.id} value={item.id} disabled={item.quantityAvailable === 0}>{item.name} · {item.quantityAvailable} {item.unit} available · {item.storageLocation}</option>)}</select>{chosen && <p className="mt-2 text-sm font-semibold text-slate-700">Available: {chosen.quantityAvailable} {chosen.unit}</p>}</div>
        <FormField label="Quantity to allocate" id="allocation-quantity" type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy || blocked} />
      </div>
      {stock.loading && <p role="status" className="mt-3 text-sm text-slate-600">Loading available resources…</p>}
      {!stock.loading && !stock.error && !resources.length && <p className="mt-3 text-sm text-slate-600">No active resources. Add stock in the resource inventory first.</p>}
      {stock.error && <p role="alert" className="mt-3 text-sm text-red-800">{stock.error}</p>}
      {stock.more && <button type="button" onClick={() => { setStock((previous) => ({ ...previous, loading: true, more: false })); setStockPage((value) => value + 1); }} className="mt-3 cursor-pointer text-sm font-semibold underline">Load more resources</button>}
      <button disabled={busy || blocked || !resources.length || stock.loading} className="mt-5 cursor-pointer bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? 'Allocating…' : 'Allocate resource'}</button>
    </form>}
    {request && !canAllocate && <p className="mt-4 text-sm text-slate-600">Resources cannot be allocated to completed or cancelled requests.</p>}
    {error && <div className="mt-4 border-l-4 border-red-600 bg-red-50 p-4"><p role="alert" className="text-sm text-red-900">{error}</p>{blocked && <p className="mt-2 text-sm text-red-900">Refresh stock and allocation history before trying again.</p>}</div>}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Allocation history</h3><button type="button" disabled={busy} onClick={refresh} className="cursor-pointer text-sm font-semibold underline underline-offset-4 disabled:opacity-50">Refresh allocations</button></div>
    {history.loading && <p role="status" className="mt-4 text-sm text-slate-600">Loading allocation history…</p>}
    {history.error && <p role="alert" className="mt-4 text-sm text-red-800">{history.error}</p>}
    {data && <>
      {!data.allocations.length ? <p className="mt-4 border border-slate-200 bg-white p-5 text-sm text-slate-600">No resource allocations yet.</p> : <ul className="mt-4 grid gap-3">{data.allocations.map((allocation) => <li key={allocation.id} className="border border-slate-200 bg-white p-5"><p className="font-semibold">{allocation.resourceName} · {allocation.allocatedQuantity} {allocation.unit}</p><p className="mt-2 text-xs text-slate-500">{new Date(allocation.createdAt).toLocaleString()}</p>{!request && <Link to={`/requests/${allocation.assistanceRequest}`} className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">View assistance request</Link>}</li>)}</ul>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-slate-600">{data.total} allocations · Page {data.page} of {data.totalPages}</p><div className="flex gap-3">{[['Previous', page - 1, data.page <= 1], ['Next', page + 1, data.page >= data.totalPages]].map(([label, next, disabled]) => <button key={label} type="button" disabled={disabled || history.loading} onClick={() => { setHistory({ loading: true, data: null, error: '' }); setPage(next); }} className="cursor-pointer border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-40">{label}</button>)}</div></div>
    </>}
  </section>;
}
