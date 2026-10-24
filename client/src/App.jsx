import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { dashboardPath, useAuth } from './context/AuthContext.js';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';

function DashboardRedirect() {
  const { user } = useAuth();
  return <Navigate to={dashboardPath(user.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardRedirect />} />
          {['citizen', 'volunteer', 'admin'].map((role) => (
            <Route key={role} element={<ProtectedRoute roles={[role]} />}>
              <Route path={`/dashboard/${role}`} element={<Dashboard />} />
            </Route>
          ))}
        </Route>
        <Route path="*" element={
          <section className="mx-auto max-w-xl px-6 py-24 text-center">
            <p className="text-xs font-bold tracking-widest text-orange-700 uppercase">404 / Page not found</p>
            <h1 className="mt-4 text-3xl font-semibold">Let’s get you back on track.</h1>
            <p className="mt-4 text-slate-600">The page you’re looking for isn’t here.</p>
            <Link to="/" className="mt-7 inline-block bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-700">Back to HavenHub</Link>
          </section>
        } />
      </Route>
    </Routes>
  );
}
