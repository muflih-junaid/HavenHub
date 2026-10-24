import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthPanel, { FormField } from '../components/AuthPanel.jsx';
import { SessionStatus } from '../components/ProtectedRoute.jsx';
import { dashboardPath, useAuth } from '../context/AuthContext.js';
import { apiErrorMessage } from '../api/client.js';

export default function Login() {
  const { user, loading, needsRetry, sessionError, login } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (loading || needsRetry) return <SessionStatus />;
  if (user) return <Navigate to={dashboardPath(user.role)} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setSubmitting(true);
    try {
      const account = await login({ email: form.get('email').trim(), password: form.get('password') });
      const home = dashboardPath(account.role);
      navigate(location.state?.from === home ? location.state.from : home, { replace: true });
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPanel title="Welcome back." description="Sign in to your community response workspace.">
      {sessionError && !error && <p role="status" className="mt-6 border-l-4 border-orange-600 bg-orange-50 p-4 text-sm text-orange-950">{sessionError}</p>}
      <form onSubmit={handleSubmit} className="mt-8 space-y-5" aria-busy={submitting}>
        {error && <p role="alert" className="border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <fieldset disabled={submitting} className="space-y-5">
          <FormField label="Email address" id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com" />
          <FormField label="Password" id="login-password" name="password" type="password" autoComplete="current-password" required />
          <button disabled={submitting} className="w-full cursor-pointer bg-orange-700 px-5 py-3.5 font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span></button>
        </fieldset>
      </form>
      <p className="mt-7 text-sm text-slate-600">New to HavenHub? <Link to="/register" className="font-semibold text-slate-950 underline decoration-orange-500 underline-offset-4">Create an account</Link></p>
    </AuthPanel>
  );
}
