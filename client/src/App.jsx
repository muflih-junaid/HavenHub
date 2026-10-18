import { useEffect, useState } from 'react';

const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '');

const connectionStates = {
  checking: {
    label: 'Checking connection',
    description: 'Contacting the HavenHub API…',
    color: 'bg-amber-400',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
  connected: {
    label: 'API connected',
    description: 'The HavenHub API is online and responding.',
    color: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  },
  offline: {
    label: 'API unavailable',
    description: 'We could not reach the API. Please try again shortly.',
    color: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-800 ring-rose-200',
  },
  unconfigured: {
    label: 'API not configured',
    description: 'An API connection has not been configured for this site.',
    color: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-700 ring-slate-200',
  },
};

export default function App() {
  const [status, setStatus] = useState(apiUrl ? 'checking' : 'unconfigured');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!apiUrl) return;

    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);

    async function checkConnection() {
      try {
        const response = await fetch(`${apiUrl}/health`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Health check failed');

        const data = await response.json();
        if (data.status !== 'ok') throw new Error('Unexpected health response');

        if (active) setStatus('connected');
      } catch {
        if (active) setStatus('offline');
      } finally {
        clearTimeout(timeout);
      }
    }

    checkConnection();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  function retryConnection() {
    setStatus('checking');
    setAttempt((previous) => previous + 1);
  }

  const connection = connectionStates[status];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <a href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600">
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-teal-700 text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6">
                <path d="m3 11 9-8 9 8M5 9v11h14V9M12 11v6M9 14h6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight">HavenHub</span>
          </a>
          <span className="hidden text-sm text-slate-500 sm:block">Disaster response & resource coordination</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-14 sm:px-10 sm:py-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <section aria-labelledby="welcome-heading">
            <p className="mb-6 text-xs font-bold tracking-[0.2em] text-teal-700 uppercase">Stronger communities. Coordinated response.</p>
            <h1 id="welcome-heading" className="max-w-xl text-4xl leading-tight font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              When it matters most,<span className="text-teal-700"> come together.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
              HavenHub brings communities, responders, and essential resources together to support people through disasters.
            </p>
            <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
              <span aria-hidden="true" className="h-px w-8 bg-teal-600" />
              Built around people. Ready for connection.
            </div>
          </section>

          <section aria-labelledby="connection-heading" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
            <div className="bg-slate-900 px-7 py-8 sm:px-8">
              <p className="text-xs font-semibold tracking-[0.18em] text-teal-300 uppercase">Platform connection</p>
              <h2 id="connection-heading" className="mt-3 text-2xl font-semibold tracking-tight text-white">A connected foundation.</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">Every coordinated response starts with a reliable connection.</p>
            </div>
            <div className="px-7 py-8 sm:px-8">
              <div role="status" aria-live="polite" aria-atomic="true">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${connection.badge}`}>
                  <span aria-hidden="true" className={`size-2 rounded-full ${connection.color}`} />
                  {connection.label}
                </span>
                <p className="mt-5 min-h-12 text-sm leading-6 text-slate-600">{connection.description}</p>
              </div>
              <button
                type="button"
                onClick={retryConnection}
                disabled={status === 'checking' || status === 'unconfigured'}
                className="mt-6 w-full cursor-pointer rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'checking' ? 'Checking…' : 'Check connection'}
              </button>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-700">HavenHub</p>
          <p>Connecting people. Coordinating support.</p>
        </div>
      </footer>
    </div>
  );
}
