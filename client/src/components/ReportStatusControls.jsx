import { useState } from 'react';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';

const actions = {
  pending: [{ status: 'verified', label: 'Verify' }, { status: 'rejected', label: 'Reject' }],
  verified: [{ status: 'resolved', label: 'Resolve' }],
};

export default function ReportStatusControls({ report, onUpdated, onRefresh }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  if (user.role !== 'admin' || !actions[report.status]) return null;

  async function updateStatus(status) {
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      const { data } = await api.patch(`/disasters/${report.id}/status`, { status });
      onUpdated(data.report);
    } catch (failure) {
      setError(apiErrorMessage(failure));
      setConflict(failure.response?.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-200 pt-5" aria-busy={busy}>
      <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">Admin review</p>
      <div className="flex flex-wrap items-center gap-3">
        {actions[report.status].map(({ status, label }) => (
          <button key={status} type="button" aria-label={`${label} report: ${report.title}`} disabled={busy || conflict} onClick={() => updateStatus(status)} className={`cursor-pointer px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${status === 'rejected' ? 'border border-red-300 text-red-800 hover:bg-red-50' : 'bg-slate-900 text-white hover:bg-slate-700'}`}>{label}</button>
        ))}
        {busy && <p role="status" className="text-sm text-slate-500">Updating report status…</p>}
      </div>
      {error && <div className="mt-4 border-l-4 border-red-600 bg-red-50 p-4"><p role="alert" className="text-sm text-red-900">{error}</p><button type="button" onClick={onRefresh} className="mt-3 cursor-pointer text-sm font-semibold underline underline-offset-4">Refresh report data</button></div>}
    </div>
  );
}
