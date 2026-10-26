import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { FormField } from '../components/AuthPanel.jsx';

const inputClass = 'w-full border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-950 focus:border-slate-800 focus:outline-2 focus:outline-offset-2 focus:outline-orange-600 disabled:bg-slate-100';

export default function AssistanceForm() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportPage, setReportPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportError, setReportError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    async function loadReports() {
      try {
        const { data } = await api.get('/disasters', { params: { page: 1 }, signal: controller.signal });
        if (controller.signal.aborted) return;
        setReports(data.reports);
        setReportPage(data.page);
        setHasMore(data.page < data.totalPages);
      } catch (failure) {
        if (!controller.signal.aborted) setReportError(apiErrorMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoadingReports(false);
      }
    }
    loadReports();
    return () => controller.abort();
  }, []);

  async function loadMoreReports() {
    setLoadingReports(true);
    setReportError('');
    try {
      const { data } = await api.get('/disasters', { params: { page: reportPage + 1 } });
      setReports((previous) => [...previous, ...data.reports.filter((report) => !previous.some((item) => item.id === report.id))]);
      setReportPage(data.page);
      setHasMore(data.page < data.totalPages);
    } catch (failure) {
      setReportError(apiErrorMessage(failure));
    } finally {
      setLoadingReports(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = form.get('description').trim();
    const location = form.get('location').trim();
    const disaster = form.get('disaster');
    setError('');
    if (!description || !location) {
      setError('Describe the assistance you need and provide a location address.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/requests', {
        assistanceType: form.get('assistanceType'), urgency: form.get('urgency'), description, location,
        ...(disaster ? { disaster } : {}),
      });
      navigate(`/requests/${data.request.id}`, { replace: true, state: { submitted: true } });
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
      <Link to="/requests/mine" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← My requests</Link>
      <p className="mt-8 text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Community assistance</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Request assistance.</h1>
      <p className="mt-4 leading-7 text-slate-600">Tell us what you need and where. You can track your request and cancel it while it is pending.</p>
      <form onSubmit={handleSubmit} className="mt-8 border border-slate-200 bg-white p-5 sm:p-8" aria-busy={submitting}>
        {error && <p role="alert" className="mb-6 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <fieldset disabled={submitting} className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div><label htmlFor="assistance-type" className="mb-2 block text-sm font-semibold text-slate-800">Assistance type</label>
              <select id="assistance-type" name="assistanceType" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select assistance</option>
                {['food', 'water', 'shelter', 'medical', 'rescue', 'other'].map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
              </select>
            </div>
            <div><label htmlFor="assistance-urgency" className="mb-2 block text-sm font-semibold text-slate-800">Urgency</label>
              <select id="assistance-urgency" name="urgency" required defaultValue="medium" className={inputClass}>
                {['low', 'medium', 'high', 'critical'].map((urgency) => <option key={urgency} value={urgency}>{urgency[0].toUpperCase() + urgency.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div><label htmlFor="assistance-description" className="mb-2 block text-sm font-semibold text-slate-800">Description</label>
            <textarea id="assistance-description" name="description" required maxLength={5000} rows={5} className={inputClass} placeholder="Describe the assistance you need." />
          </div>
          <FormField id="assistance-location" name="location" label="Location address" autoComplete="street-address" required maxLength={300} placeholder="Street, nearby landmark, city or district" />
          <div>
            <label htmlFor="assistance-disaster" className="mb-2 block text-sm font-semibold text-slate-800">Related disaster report (optional)</label>
            <select id="assistance-disaster" name="disaster" defaultValue="" disabled={loadingReports && reports.length === 0} className={inputClass} aria-describedby="assistance-disaster-hint">
              <option value="">No related report</option>
              {reports.map((report) => <option key={report.id} value={report.id}>{report.title} ({report.status})</option>)}
            </select>
            <p id="assistance-disaster-hint" className="mt-2 text-xs leading-5 text-slate-500">You can link one of your own disaster reports, or submit without one.</p>
            {loadingReports && <p role="status" className="mt-2 text-xs text-slate-500">Loading your disaster reports…</p>}
            {reportError && <p role="alert" className="mt-2 text-sm text-red-800">{reportError} You can still submit without a related report.</p>}
            {(hasMore || reportError) && <button type="button" onClick={loadMoreReports} disabled={loadingReports} className="mt-3 cursor-pointer text-sm font-semibold underline underline-offset-4 disabled:opacity-50">{reportError ? 'Retry loading reports' : 'Load more reports'}</button>}
          </div>
          <button disabled={submitting} className="w-full cursor-pointer bg-orange-700 px-6 py-3.5 font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60 sm:w-auto">{submitting ? 'Submitting request…' : 'Submit request'}</button>
        </fieldset>
      </form>
    </section>
  );
}
