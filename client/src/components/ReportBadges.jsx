const severityColors = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-50 text-amber-900',
  high: 'bg-orange-50 text-orange-900',
  critical: 'bg-red-50 text-red-900',
};
const statusColors = {
  pending: 'bg-amber-50 text-amber-900',
  verified: 'bg-blue-50 text-blue-900',
  rejected: 'bg-red-50 text-red-900',
  resolved: 'bg-emerald-50 text-emerald-900',
};

export default function ReportBadges({ severity, status }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs font-semibold">
      <span className={`px-2.5 py-1 capitalize ${severityColors[severity]}`}>{severity} severity</span>
      <span className={`px-2.5 py-1 capitalize ${statusColors[status]}`}>{status}</span>
    </div>
  );
}
