import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import ReportBadges from '../components/ReportBadges.jsx';
import ReportStatusControls from '../components/ReportStatusControls.jsx';

function ReportListPage({ page, status, embedded, notice, onNotice }) {
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [result, setResult] = useState({ status: 'loading', data: null, error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadReports() {
      try {
        const { data } = await api.get('/disasters', { params: { page, ...(status ? { status } : {}) }, signal: controller.signal });
        if (!controller.signal.aborted && status && data.page > data.totalPages) {
          // Reviewing the last report on a page can shrink the pending queue.
          setSearchParams({ page: String(data.totalPages) }, { replace: true });
          return;
        }
        if (!controller.signal.aborted) setResult({ status: 'ready', data, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ status: 'error', data: null, error: apiErrorMessage(error) });
      }
    }
    loadReports();
    return () => controller.abort();
  }, [page, status, attempt, setSearchParams]);

  function retry() {
    setResult({ status: 'loading', data: null, error: '' });
    setAttempt((previous) => previous + 1);
  }

  function handleStatusUpdated(updatedReport) {
    onNotice(`Report status updated to ${updatedReport.status}.`);
    if (status) {
      // Reload the filtered queue and its count after a report leaves it.
      retry();
    } else {
      setResult((previous) => {
        if (!previous.data) return previous;
        return { ...previous, data: {
          ...previous.data,
          reports: previous.data.reports.map((report) => report.id === updatedReport.id ? updatedReport : report),
        } };
      });
    }
  }

  const descriptions = {
    citizen: 'Your submitted reports, including pending and reviewed reports.',
    volunteer: 'Verified and resolved reports available to your volunteer account.',
    admin: 'All submitted disaster reports across the community.',
  };
  const data = result.data;
  return (
    <section className={embedded ? 'mt-10 border-t border-slate-200 pt-8' : 'mx-auto w-full max-w-7xl px-6 py-10 sm:px-10 sm:py-14'}>
      <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Community response</p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
        <div>
          {embedded ? <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Pending disaster reports</h2> : <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Disaster reports</h1>}
          <p className="mt-4 max-w-2xl leading-7 text-slate-600">{status === 'pending' ? 'Review new submissions. Open a report for its full description and location before making a decision.' : descriptions[user.role]}</p>
        </div>
        {user.role === 'citizen' && <Link to="/disasters/new" className="bg-orange-700 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-800">Report a disaster <span aria-hidden="true">↗</span></Link>}
      </div>
      {notice && <p role="status" className="mt-6 border-l-4 border-emerald-700 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}
      <div className="mt-8" aria-busy={result.status === 'loading'}>
        {result.status === 'loading' && <p role="status" className="border border-slate-200 bg-white p-8 text-slate-600">Loading disaster reports…</p>}
        {result.status === 'error' && <div className="border border-red-200 bg-red-50 p-6"><p role="alert" className="text-sm text-red-900">{result.error}</p><button onClick={retry} className="mt-4 cursor-pointer text-sm font-semibold underline underline-offset-4">Try again</button><Link to="/disasters" className="ml-5 text-sm font-semibold underline underline-offset-4">First page</Link></div>}
        {data && (
          <>
            {data.reports.length === 0 ? (
              <div className="border border-slate-200 bg-white p-8">
                <h2 className="text-xl font-semibold">No reports to show.</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{status === 'pending' ? 'There are no pending reports on this page.' : user.role === 'volunteer' ? 'There are no verified or resolved reports on this page.' : 'There are no disaster reports on this page.'}</p>
              </div>
            ) : (
              <ul className="grid gap-5">
                {data.reports.map((report) => (
                  <li key={report.id} className="border border-slate-200 bg-white p-6 sm:p-7">
                    <div className="flex flex-wrap items-center justify-between gap-3"><ReportBadges severity={report.severity} status={report.status} /><p className="text-xs text-slate-500">{new Date(report.createdAt).toLocaleString()}</p></div>
                    <h2 className="mt-4 break-words text-xl font-semibold tracking-tight"><Link to={`/disasters/${report.id}`} className="hover:text-orange-700 hover:underline">{report.title}</Link></h2>
                    <p className="mt-2 text-xs font-semibold text-orange-700 capitalize">{report.disasterType}</p>
                    <p className="mt-3 line-clamp-2 break-words text-sm leading-7 text-slate-600">{report.description}</p>
                    <p className="mt-4 break-words border-t border-slate-100 pt-4 text-sm text-slate-600"><span className="font-semibold text-slate-800">Location:</span> {report.location.address}</p>
                    <ReportStatusControls report={report} onUpdated={handleStatusUpdated} onRefresh={retry} />
                  </li>
                ))}
              </ul>
            )}
            <nav aria-label="Report pages" className="mt-7 flex flex-wrap items-center justify-between gap-4 text-sm">
              <p className="text-slate-600">{data.total} {data.total === 1 ? 'report' : 'reports'} · Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-3">
                {data.page > 1 ? <Link to={`?page=${data.page - 1}`} className="border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100">Previous</Link> : <button disabled className="border border-slate-200 px-4 py-2 text-slate-400">Previous</button>}
                {data.page < data.totalPages ? <Link to={`?page=${data.page + 1}`} className="border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-100">Next</Link> : <button disabled className="border border-slate-200 px-4 py-2 text-slate-400">Next</button>}
              </div>
            </nav>
          </>
        )}
      </div>
    </section>
  );
}

export default function DisasterList({ status, embedded = false }) {
  const [searchParams] = useSearchParams();
  const [notice, setNotice] = useState('');
  const page = searchParams.get('page') ?? '1';
  return <ReportListPage key={`${page}-${status || 'all'}`} page={page} status={status} embedded={embedded} notice={notice} onNotice={setNotice} />;
}
