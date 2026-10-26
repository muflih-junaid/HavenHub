import { useState } from 'react';
import api, { apiErrorMessage } from '../api/client.js';
import { FormField } from './AuthPanel.jsx';

export default function ResourceForm({ resource, onSaved, onClose }) {
  const [fields, setFields] = useState({
    name: resource?.name || '', category: resource?.category || 'food', quantityAvailable: String(resource?.quantityAvailable ?? 0),
    unit: resource?.unit || '', storageLocation: resource?.storageLocation || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  function change(event) { setFields((previous) => ({ ...previous, [event.target.name]: event.target.value })); }

  async function submit(event) {
    event.preventDefault();
    const quantity = Number(fields.quantityAvailable);
    if (!fields.name.trim() || !fields.unit.trim() || !fields.storageLocation.trim()) { setError('Enter a name, unit, and storage location.'); return; }
    if (!/^\d+$/.test(fields.quantityAvailable) || !Number.isSafeInteger(quantity)) { setError('Available quantity must be a non-negative safe whole number.'); return; }
    setBusy(true);
    setError('');
    try {
      const body = { ...fields, name: fields.name.trim(), unit: fields.unit.trim(), storageLocation: fields.storageLocation.trim(), quantityAvailable: quantity };
      if (resource) await api.patch(`/resources/${resource.id}`, { ...body, expectedVersion: resource.stockVersion });
      else await api.post('/resources', body);
      onSaved(resource ? 'Resource updated.' : 'Resource added.');
    } catch (failure) {
      setError(apiErrorMessage(failure));
      setConflict(failure.response?.status === 409);
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-7 border border-slate-200 bg-white p-6 sm:p-8" aria-labelledby="resource-form-heading">
    <h2 id="resource-form-heading" className="text-xl font-semibold">{resource ? 'Edit resource' : 'Add resource'}</h2>
    <p className="mt-3 text-sm leading-6 text-slate-600">Use whole units. Available quantity is the stock remaining after allocations.</p>
    <div className="mt-6 grid gap-5 sm:grid-cols-2">
      <FormField label="Resource name" id="resource-name" name="name" required maxLength={120} value={fields.name} onChange={change} disabled={busy || conflict} />
      <div><label htmlFor="resource-category" className="mb-2 block text-sm font-semibold">Category</label><select id="resource-category" name="category" value={fields.category} onChange={change} disabled={busy || conflict} className="w-full border border-slate-300 bg-white px-3.5 py-3">{['food', 'water', 'medical', 'shelter', 'other'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
      <FormField label="Available quantity" id="resource-quantity" name="quantityAvailable" type="number" min="0" step="1" required value={fields.quantityAvailable} onChange={change} disabled={busy || conflict} />
      <FormField label="Unit" id="resource-unit" name="unit" required maxLength={40} placeholder="e.g. bottles, kits, bags" value={fields.unit} onChange={change} disabled={busy || conflict} />
      <div className="sm:col-span-2"><FormField label="Storage location" id="resource-location" name="storageLocation" required maxLength={300} value={fields.storageLocation} onChange={change} disabled={busy || conflict} /></div>
    </div>
    {error && <p role="alert" className="mt-5 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}{conflict && ' Close this form and refresh inventory before editing again.'}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button disabled={busy || conflict} className="cursor-pointer bg-orange-700 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50">{busy ? 'Saving…' : 'Save resource'}</button><button type="button" disabled={busy} onClick={onClose} className="cursor-pointer border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Close form</button></div>
  </form>;
}
