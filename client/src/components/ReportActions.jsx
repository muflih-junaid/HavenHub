import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';

export default function ReportActions({ report }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = user.role === 'admin';
  const isOwnerPending = user.role === 'citizen' && report.reportedBy === user.id && report.status === 'pending';
  if (!isAdmin && !isOwnerPending) return null;

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${report.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/disasters/${report.id}`);
      navigate('/disasters', { replace: true });
    } catch (failure) {
      setError(apiErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-200 pt-5" aria-busy={busy}>
      <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">Manage report</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/disasters/${report.id}/edit`} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50">Edit</Link>
        <button type="button" disabled={busy} onClick={handleDelete} className="cursor-pointer border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50">
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      {error && <p role="alert" className="mt-4 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    </div>
  );
}