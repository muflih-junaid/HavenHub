import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { dashboardPath, useAuth } from '../context/AuthContext.js';

export function SessionStatus() {
  const { loading, sessionError, retrySession, logout } = useAuth();
  return (
    <section className="mx-auto max-w-lg px-6 py-24 text-center" aria-live="polite">
      <p className="text-xs font-bold tracking-[0.2em] text-orange-700 uppercase">Your HavenHub session</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{loading ? 'Getting your workspace ready…' : 'We couldn’t restore your session.'}</h1>
      <p className="mt-4 leading-7 text-slate-600">{loading ? 'Checking your account securely with HavenHub.' : sessionError}</p>
      {!loading && (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={retrySession} className="cursor-pointer bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-700">Try again</button>
          <button onClick={logout} className="cursor-pointer border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-100">Sign out</button>
        </div>
      )}
    </section>
  );
}

export default function ProtectedRoute({ roles }) {
  const { user, loading, needsRetry } = useAuth();
  const location = useLocation();
  if (loading || needsRetry) return <SessionStatus />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <section className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-xs font-bold tracking-[0.2em] text-orange-700 uppercase">Access restricted</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">This workspace is for another role.</h1>
        <p className="mt-4 leading-7 text-slate-600">You are signed in as a {user.role}. Your own workspace is ready below.</p>
        <Link to={dashboardPath(user.role)} className="mt-8 inline-block bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-700">Go to my dashboard</Link>
      </section>
    );
  }
  return <Outlet />;
}
