import { Link, NavLink } from 'react-router-dom';
import { dashboardPath, useAuth } from '../context/AuthContext.js';
import DisasterList from './DisasterList.jsx';

const dashboards = {
  citizen: {
    title: 'Your community starts here.',
    description: 'Your space to stay connected and find support when it matters.',
    modules: [],
  },
  volunteer: {
    title: 'Ready to make a difference.',
    description: 'Your space to help others and support a coordinated response.',
    modules: [],
  },
  admin: {
    title: 'A clearer view of the response.',
    description: 'Your space to bring people, resources, and response efforts together.',
    modules: [['Response overview', 'Coordinate reports and assistance across your community.']],
  },
};

export default function Dashboard() {
  const { user } = useAuth();
  const dashboard = dashboards[user.role];

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 lg:grid-cols-[230px_1fr]">
      <aside className="border-b border-slate-200 bg-white p-6 sm:px-10 lg:border-r lg:border-b-0 lg:px-6 lg:py-10">
        <p className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">Your workspace</p>
        <nav aria-label="Workspace navigation" className="mt-4">
          <NavLink to={dashboardPath(user.role)} className="flex items-center gap-3 border-l-2 border-orange-600 bg-orange-50 px-4 py-3 text-sm font-semibold text-slate-950"><span aria-hidden="true">▦</span>Overview</NavLink>
        </nav>
        <div className="mt-7 border-t border-slate-200 pt-5 lg:mt-12">
          <p className="text-xs text-slate-500">Signed in as</p>
          <p className="mt-2 break-words text-sm font-semibold">{user.name}</p>
          <p className="mt-1 text-xs text-orange-700 capitalize">{user.role}</p>
        </div>
      </aside>
      <div className="min-w-0 px-6 py-10 sm:px-10 lg:py-12">
        <p className="text-xs font-bold tracking-[0.18em] text-orange-700 uppercase">{user.role} dashboard</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{dashboard.title}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-slate-600">Welcome, {user.name}. {dashboard.description}</p>
        <div className="mt-8 flex items-start gap-4 border border-slate-200 bg-white p-5">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center bg-emerald-50 font-bold text-emerald-700">✓</span>
          <div><h2 className="text-sm font-semibold">Your account is ready</h2><p className="mt-1 text-sm leading-6 text-slate-600">Disaster reporting and assistance requests are available. Other response tools remain planned.</p></div>
        </div>
        <section className="mt-7 border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold tracking-tight">Disaster reports</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">{user.role === 'citizen' ? 'Report an incident and view your submitted reports.' : user.role === 'volunteer' ? 'View verified and resolved reports from your community.' : 'View all community disaster reports.'}</p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link to="/disasters" className="border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">View reports</Link>
            {user.role === 'citizen' && <Link to="/disasters/new" className="bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800">Report a disaster</Link>}
          </div>
        </section>
        <section className="mt-7 border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold tracking-tight">Assistance requests</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">{user.role === 'citizen' ? 'Request support and track your own requests.' : user.role === 'admin' ? 'Review the assistance queue by urgency and status.' : 'View pending assistance summaries without private citizen details.'}</p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link to={user.role === 'citizen' ? '/requests/mine' : '/requests'} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">{user.role === 'citizen' ? 'My requests' : 'View request queue'}</Link>
            {user.role === 'volunteer' && <Link to="/tasks" className="bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800">My tasks</Link>}
            {user.role === 'citizen' && <Link to="/requests/new" className="bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800">Request assistance</Link>}
          </div>
        </section>
        {user.role === 'admin' && <section className="mt-7 border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">Resource inventory</h2><p className="mt-3 text-sm leading-7 text-slate-600">Manage stock and view allocations across assistance requests.</p><Link to="/resources" className="mt-5 inline-block border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Manage resources</Link></section>}
        {user.role === 'admin' && <DisasterList status="pending" embedded />}
        {dashboard.modules.length > 0 && <div className="mt-7 grid gap-5 md:grid-cols-2">
          {dashboard.modules.map(([title, description]) => (
            <section key={title} className="border border-slate-200 bg-white p-6">
              <span className="border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">Planned</span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
            </section>
          ))}
        </div>}
        <section className="mt-10 border-t border-slate-200 pt-7" aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-lg font-semibold">Your account</h2>
          <dl className="mt-5 grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
            {[['Email address', user.email], ['Phone number', user.phone], ['Role', user.role], ['Location', user.location || 'Not provided']].map(([label, value]) => (
              <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1.5 break-words font-medium">{value}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
