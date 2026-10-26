const urgencyColors = {
  low: 'bg-slate-100 text-slate-700', medium: 'bg-amber-50 text-amber-900',
  high: 'bg-orange-50 text-orange-900', critical: 'bg-red-50 text-red-900',
};
const statusColors = {
  pending: 'bg-amber-50 text-amber-900', assigned: 'bg-blue-50 text-blue-900',
  in_progress: 'bg-violet-50 text-violet-900', completed: 'bg-emerald-50 text-emerald-900',
  cancelled: 'bg-slate-100 text-slate-700',
};

export default function RequestBadges({ urgency, status, acceptedAt }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs font-semibold">
      <span className={`px-2.5 py-1 capitalize ${urgencyColors[urgency]}`}>{urgency} urgency</span>
      <span className={`px-2.5 py-1 capitalize ${statusColors[status]}`}>{status.replace('_', ' ')}</span>
      {status === 'assigned' && <span className="bg-slate-100 px-2.5 py-1 text-slate-700">{acceptedAt ? 'Accepted' : 'Awaiting acceptance'}</span>}
    </div>
  );
}
