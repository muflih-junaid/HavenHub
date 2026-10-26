import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../api/client.js';
import { FormField } from '../components/AuthPanel.jsx';

const inputClass = 'w-full border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-950 focus:border-slate-800 focus:outline-2 focus:outline-offset-2 focus:outline-orange-600 disabled:bg-slate-100';

export default function DisasterForm() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = form.get('title').trim();
    const description = form.get('description').trim();
    const address = form.get('address').trim();
    const latitude = form.get('latitude').trim();
    const longitude = form.get('longitude').trim();
    setError('');
    if (!title || !description || !address) {
      setError('Title, description, and location address are required.');
      return;
    }
    if (Boolean(latitude) !== Boolean(longitude)) {
      setError('Provide both latitude and longitude, or leave both blank.');
      return;
    }
    if (latitude && (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90
        || !Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180)) {
      setError('Latitude must be between -90 and 90; longitude must be between -180 and 180.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/disasters', {
        title, description, disasterType: form.get('disasterType'), severity: form.get('severity'),
        location: { address, ...(latitude ? { latitude: Number(latitude), longitude: Number(longitude) } : {}) },
      });
      navigate(`/disasters/${data.report.id}`, { replace: true, state: { submitted: true } });
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
      <Link to="/disasters" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to reports</Link>
      <p className="mt-8 text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">Citizen reporting</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Report a disaster.</h1>
      <p className="mt-4 leading-7 text-slate-600">Describe what you observed and where it happened. Your report will be submitted with a pending status.</p>
      <form onSubmit={handleSubmit} className="mt-8 border border-slate-200 bg-white p-5 sm:p-8" aria-busy={submitting}>
        {error && <p role="alert" className="mb-6 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <fieldset disabled={submitting} className="space-y-6">
          <FormField id="report-title" name="title" label="Report title" required maxLength={150} placeholder="For example, flooding near the main road" />
          <div>
            <label htmlFor="report-description" className="mb-2 block text-sm font-semibold text-slate-800">Description</label>
            <textarea id="report-description" name="description" required maxLength={5000} rows={5} className={inputClass} placeholder="Describe the incident, conditions, and visible impact." />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="report-type" className="mb-2 block text-sm font-semibold text-slate-800">Disaster type</label>
              <select id="report-type" name="disasterType" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select a type</option>
                {['flood', 'landslide', 'fire', 'storm', 'other'].map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="report-severity" className="mb-2 block text-sm font-semibold text-slate-800">Severity</label>
              <select id="report-severity" name="severity" required defaultValue="medium" className={inputClass}>
                {['low', 'medium', 'high', 'critical'].map((severity) => <option key={severity} value={severity}>{severity[0].toUpperCase() + severity.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <FormField id="report-address" name="address" label="Location address" autoComplete="street-address" required maxLength={300} placeholder="Street, nearby landmark, city or district" />
          <fieldset className="border-t border-slate-200 pt-6">
            <legend className="text-sm font-semibold text-slate-800">Coordinates (optional)</legend>
            <p className="mb-4 text-xs leading-6 text-slate-500">Enter both coordinates if known, or leave both blank.</p>
            <div className="grid gap-6 sm:grid-cols-2">
              <FormField id="report-latitude" name="latitude" label="Latitude" type="number" step="any" min={-90} max={90} hint="Between -90 and 90" placeholder="6.9271" />
              <FormField id="report-longitude" name="longitude" label="Longitude" type="number" step="any" min={-180} max={180} hint="Between -180 and 180" placeholder="79.8612" />
            </div>
          </fieldset>
          <button disabled={submitting} className="w-full cursor-pointer bg-orange-700 px-6 py-3.5 font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60 sm:w-auto">{submitting ? 'Submitting report…' : 'Submit report'}</button>
        </fieldset>
      </form>
    </section>
  );
}
