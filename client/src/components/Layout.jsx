import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { dashboardPath, useAuth } from '../context/AuthContext.js';
import { useRealtime } from '../realtime.js';

export default function Layout() {
  const { user, loading, logout, storageWarning } = useAuth();
  const { status: liveStatus } = useRealtime();
  const { pathname } = useLocation();

  useEffect(() => {
    const page = pathname === '/login' ? 'Sign in' : pathname === '/register' ? 'Create account' : pathname === '/resources' ? 'Resource inventory' : pathname === '/tasks' ? 'My tasks' : pathname.startsWith('/requests') ? 'Assistance requests' : pathname.startsWith('/disasters') ? 'Disaster reports' : pathname.startsWith('/dashboard') ? 'Dashboard' : 'Community resilience';
    document.title = `${page} | HavenHub`;
    window.scrollTo(0, 0);
  }, [pathname]);

  const navClass = ({ isActive }) => `border-b-2 py-2 text-sm font-semibold transition-colors ${isActive ? 'border-orange-600 text-slate-950' : 'border-transparent text-slate-600 hover:text-slate-950'}`;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 bg-white p-4 font-semibold focus:not-sr-only focus:absolute">Skip to main content</a>
      <div className="bg-slate-950 px-6 py-2.5 text-center text-[11px] font-medium tracking-wider text-slate-200 sm:px-10">
        DISASTER RESPONSE & RESOURCE COORDINATION <span className="mx-3 hidden text-orange-400 sm:inline">/</span><span className="hidden sm:inline">COMMUNITY FIRST. ALWAYS.</span>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-5 sm:px-10">
          <Link to="/" aria-label="HavenHub home" className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-slate-950">
            <span className="flex size-10 items-center justify-center bg-orange-600 text-white" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6"><path d="m3 11 9-8 9 8M5 9v11h14V9M12 11v6M9 14h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            HavenHub<span aria-hidden="true" className="text-orange-600">.</span>
          </Link>
          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-5 sm:gap-7">
            <NavLink to="/" end className={navClass}>Home</NavLink>
            {loading ? <span className="text-sm text-slate-500" role="status">Checking session…</span> : user ? (
              <>
                <NavLink to={dashboardPath(user.role)} className={navClass}>Dashboard</NavLink>
                <NavLink to="/disasters" className={navClass}>Reports</NavLink>
                <NavLink to={user.role === 'citizen' ? '/requests/mine' : '/requests'} className={navClass}>{user.role === 'citizen' ? 'My requests' : 'Requests'}</NavLink>
                {user.role === 'admin' && <NavLink to="/resources" className={navClass}>Resources</NavLink>}
                {user.role === 'volunteer' && <NavLink to="/tasks" className={navClass}>My tasks</NavLink>}
                <button onClick={logout} className="cursor-pointer border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Sign out</button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navClass}>Sign in</NavLink>
                <Link to="/register" className="bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800">Create account <span aria-hidden="true">↗</span></Link>
              </>
            )}
          </nav>
        </div>
      </header>
      {user && liveStatus && <p aria-live="polite" className={`border-b px-6 py-2 text-center text-xs ${liveStatus === 'online' ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>{liveStatus === 'online' ? 'Live updates connected' : liveStatus === 'connecting' ? 'Connecting live updates…' : 'Live updates disconnected. Reconnecting… You can continue using the app and refresh data manually.'}</p>}
      {storageWarning && <p role="alert" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center text-sm text-amber-950">{storageWarning}</p>}
      <main id="main-content" className="flex flex-1 flex-col" tabIndex={-1}><Outlet /></main>
      <footer className="border-t border-slate-200 bg-white px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 text-xs text-slate-500 sm:flex-row">
          <p className="font-semibold text-slate-800">HavenHub <span className="mx-2 text-orange-600">/</span> Built around people.</p>
          <p>Connecting communities. Coordinating support.</p>
        </div>
      </footer>
    </div>
  );
}
