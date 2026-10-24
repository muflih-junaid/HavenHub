import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import AuthPanel, { FormField } from '../components/AuthPanel.jsx';
import { SessionStatus } from '../components/ProtectedRoute.jsx';
import { dashboardPath, useAuth } from '../context/AuthContext.js';
import { apiErrorMessage } from '../api/client.js';

export default function Register() {
  const { user, loading, needsRetry, register } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  if (loading || needsRetry) return <SessionStatus />;
  if (user) return <Navigate to={dashboardPath(user.role)} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get('password');
    setError('');
    if (password !== form.get('confirmPassword')) {
      setError('Your passwords do not match. Please check them and try again.');
      return;
    }
    if (password.length < 8 || !password.trim() || new TextEncoder().encode(password).length > 72) {
      setError('Use a password with at least 8 characters and at most 72 UTF-8 bytes.');
      return;
    }
    setSubmitting(true);
    try {
      const account = await register({
        name: form.get('name').trim(), email: form.get('email').trim(), password,
        phone: form.get('phone').trim(), role: form.get('role'), location: form.get('location').trim(),
      });
      navigate(dashboardPath(account.role), { replace: true });
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPanel title="Be part of the response." description="Create a citizen or volunteer account to join HavenHub.">
      <form onSubmit={handleSubmit} className="mt-7 space-y-5" aria-busy={submitting}>
        {error && <p role="alert" className="border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        <fieldset disabled={submitting} className="space-y-5">
          <FormField label="Full name" id="register-name" name="name" autoComplete="name" required maxLength={100} placeholder="Your full name" />
          <FormField label="Email address" id="register-email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com" />
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Phone number" id="register-phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} placeholder="+94 77 123 4567" />
            <FormField label="Location (optional)" id="register-location" name="location" autoComplete="address-level2" maxLength={200} placeholder="City or district" />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-800">I’m joining as a</legend>
            <div className="grid grid-cols-2 gap-3">
              {['citizen', 'volunteer'].map((role) => (
                <label key={role} className="flex cursor-pointer items-start gap-3 border border-slate-300 p-3.5 has-checked:border-orange-600 has-checked:bg-orange-50">
                  <input type="radio" name="role" value={role} defaultChecked={role === 'citizen'} className="mt-1 accent-orange-600" />
                  <span><span className="block text-sm font-semibold capitalize">{role}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{role === 'citizen' ? 'Stay connected to support.' : 'Help your community.'}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormField label="Password" id="register-password" name="password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters; at most 72 UTF-8 bytes. Spaces in your password are preserved." />
          <FormField label="Confirm password" id="register-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} />
          <button disabled={submitting} className="w-full cursor-pointer bg-orange-700 px-5 py-3.5 font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Creating your account…' : 'Create account'} <span aria-hidden="true">→</span></button>
        </fieldset>
      </form>
      <p className="mt-7 text-sm text-slate-600">Already part of HavenHub? <Link to="/login" className="font-semibold text-slate-950 underline decoration-orange-500 underline-offset-4">Sign in</Link></p>
    </AuthPanel>
  );
}
