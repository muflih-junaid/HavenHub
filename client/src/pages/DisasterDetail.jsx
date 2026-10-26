import { useLiveRefresh } from '../realtime.js';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import ReportBadges from '../components/ReportBadges.jsx';
import ReportStatusControls from '../components/ReportStatusControls.jsx';

function ReportDetail({ id }) {
  const { user } = useAuth();
  const location = useLocation();
  const [result, setResult] = useState({ status: 'loading', report: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useLiveRefresh('disasters:changed', () => setAttempt((value) => value + 1), id);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function loadReport() {
      try {
        const { data } = await api.get(`/disasters/${id}`, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ status: 'ready', report: data.report, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ status: 'error', report: null, error: apiErrorMessage(error) });
      }
    }
    loadReport();
    return () => controller.abort();
  }, [id, attempt]);

  function retry() {
    setResult({ status: 'loading', report: null, error: '' });
    setAttempt((previous) => previous + 1);
  }

  function handleStatusUpdated(updatedReport) {
    setResult({ status: 'ready', report: updatedReport, error: '' });
    setNotice(`Report status updated to ${updatedReport.status}.`);
  }

  const report = result.report;
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-10 sm:px-10 sm:py-14">
      <Link to="/disasters" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to reports</Link>
      {notice && <p role="status" className="mt-7 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
      {location.state?.submitted && (!report || report.status === 'pending') && <p role="status" className="mt-7 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">Your report was submitted successfully with a pending status.</p>}
      {result.status === 'loading' && <p role="status" className="mt-8 border border-slate-200 bg-white p-8 text-slate-600">Loading disaster report…</p>}
      {result.status === 'error' && <div className="mt-8 border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-semibold">Report unavailable</h1><p role="alert" className="mt-3 text-sm text-red-900">{result.error}</p><button onClick={retry} className="mt-4 cursor-pointer text-sm font-semibold underline underline-offset-4">Try again</button></div>}
      {report && (
        <article className="mt-8 border border-slate-200 bg-white p-6 sm:p-9">
          <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Disaster report / {report.disasterType}</p>
          <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{report.title}</h1>
          <div className="mt-5"><ReportBadges severity={report.severity} status={report.status} /></div>
          <ReportStatusControls report={report} onUpdated={handleStatusUpdated} onRefresh={retry} />
          <h2 className="mt-8 text-lg font-semibold">What happened</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{report.description}</p>
          <section className="mt-8 border-t border-slate-200 pt-6" aria-labelledby="location-heading">
            <h2 id="location-heading" className="text-lg font-semibold">Location</h2>
            <p className="mt-3 break-words text-sm leading-7 text-slate-600">{report.location.address}</p>
            {report.location.latitude !== undefined && report.location.longitude !== undefined && <p className="mt-3 text-sm text-slate-600">Latitude: {report.location.latitude} · Longitude: {report.location.longitude}</p>}
          </section>
          <dl className="mt-8 grid gap-5 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Submitted</dt><dd className="mt-2">{new Date(report.createdAt).toLocaleString()}</dd></div>
            <div><dt className="text-xs text-slate-500">Last updated</dt><dd className="mt-2">{new Date(report.updatedAt).toLocaleString()}</dd></div>
            {report.reportedBy && <div><dt className="text-xs text-slate-500">Reported by</dt><dd className="mt-2 break-all">{report.reportedBy === user.id ? 'You' : report.reportedBy}</dd></div>}
          </dl>
        </article>
      )}
    </section>
  );
}

export default function DisasterDetail() {
  const { id } = useParams();
  return <ReportDetail key={id} id={id} />;
}
