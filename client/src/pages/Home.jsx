import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { dashboardPath, useAuth } from '../context/AuthContext.js';

const connectionStates = {
  checking: { label: 'Checking API connection…', color: 'bg-amber-400' },
  connected: { label: 'API connected', color: 'bg-emerald-400' },
  offline: { label: 'API unavailable. Try again shortly.', color: 'bg-rose-400' },
  unconfigured: { label: 'API connection is not configured.', color: 'bg-slate-400' },
};

export default function Home() {
  const { user } = useAuth();
  const [status, setStatus] = useState(import.meta.env.VITE_API_URL?.trim() ? 'checking' : 'unconfigured');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!import.meta.env.VITE_API_URL?.trim()) return;
    const controller = new AbortController();
    async function checkConnection() {
      try {
        const { data } = await api.get('/health', { signal: controller.signal, skipAuth: true });
        if (!controller.signal.aborted) setStatus(data.status === 'ok' ? 'connected' : 'offline');
      } catch {
        if (!controller.signal.aborted) setStatus('offline');
      }
    }
    checkConnection();
    return () => controller.abort();
  }, [attempt]);

  const connection = connectionStates[status];

  return (
    <>
      <section className="bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <p className="text-xs font-bold tracking-[0.22em] text-orange-400 uppercase">HavenHub / Community resilience</p>
            <h1 className="mt-6 max-w-2xl text-5xl leading-[1.08] font-semibold tracking-tight sm:text-6xl lg:text-7xl">When it matters.<br /><span className="text-orange-400">Come together.</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-300">Connecting communities, responders, and essential resources to support people through disasters.</p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Link to={user ? dashboardPath(user.role) : '/register'} className="bg-orange-700 px-6 py-3.5 font-semibold text-white hover:bg-orange-800">{user ? 'Open my dashboard' : 'Join your community'} <span aria-hidden="true" className="ml-3">↗</span></Link>
              {!user && <Link to="/login" className="border-b border-white pb-1 text-sm font-semibold hover:text-orange-300">Already a member? Sign in <span aria-hidden="true">→</span></Link>}
            </div>
          </div>
          <div className="border border-slate-700 bg-slate-900 p-7 sm:p-9">
            <div className="flex items-center justify-between gap-4 border-b border-slate-700 pb-5">
              <p className="text-xs font-semibold tracking-widest text-slate-300 uppercase">A connected community</p>
              <span aria-hidden="true" className="text-orange-400">✳</span>
            </div>
            <svg viewBox="0 0 360 220" role="img" aria-label="Citizens, volunteers, and response teams connected around a shared community" className="my-6 w-full text-slate-500">
              <path d="M0 190h360M35 190V95h60v95M105 190V60h60v130M225 190V88h45v102M285 190V110h45v80" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M50 110h10m10 0h10m-30 20h10m10 0h10m40-50h10m10 0h10m-30 20h10m10 0h10m-30 20h10m10 0h10m95-14h12m-12 20h12m45 0h15" stroke="currentColor" strokeWidth="2" />
              <path d="m65 58 115 62 120-67M180 120v70" fill="none" stroke="#fb923c" strokeWidth="1.5" />
              <circle cx="65" cy="58" r="13" fill="#0f172a" stroke="#fb923c" strokeWidth="2" />
              <circle cx="300" cy="53" r="13" fill="#0f172a" stroke="#fb923c" strokeWidth="2" />
              <circle cx="180" cy="120" r="28" fill="#ea580c" />
              <path d="m165 119 15-13 15 13m-25-4v18h20v-18m-10 4v8m-4-4h8" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-5">
              <p role="status" className="flex items-center gap-2 text-xs text-slate-200"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${connection.color}`} />{connection.label}</p>
              <button disabled={status === 'checking' || status === 'unconfigured'} onClick={() => { setStatus('checking'); setAttempt((previous) => previous + 1); }} className="cursor-pointer text-xs font-semibold text-orange-300 underline underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">Check connection</button>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto w-full max-w-7xl px-6 py-14 sm:px-10 sm:py-16">
        <p className="text-xs font-bold tracking-[0.2em] text-orange-700 uppercase">One community. A shared purpose.</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Resilience starts with people.</h2>
        <div className="mt-9 grid gap-8 md:grid-cols-3">
          {[
            ['01', 'Citizens', 'Stay connected to your community and the people who can help.'],
            ['02', 'Volunteers', 'Bring your willingness to help into a shared response community.'],
            ['03', 'Response teams', 'Build a common foundation for coordinated support.'],
          ].map(([number, title, description]) => (
            <article key={title} className="border-t border-slate-300 pt-5">
              <p className="font-mono text-xs text-orange-700">{number}</p>
              <h3 className="mt-4 text-xl font-semibold">{title}</h3>
              <p className="mt-3 max-w-sm text-sm leading-7 text-slate-600">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
