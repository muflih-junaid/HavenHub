export function FormField({ label, id, hint, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-800">{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} className="w-full border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-950 placeholder:text-slate-400 focus:border-slate-800 focus:outline-2 focus:outline-offset-2 focus:outline-orange-600 disabled:bg-slate-100" />
      {hint && <p id={`${id}-hint`} className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}

export default function AuthPanel({ title, description, children }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative overflow-hidden bg-slate-950 px-6 py-12 text-white sm:px-10 lg:px-14 lg:py-20">
        <p className="text-xs font-bold tracking-[0.2em] text-orange-400 uppercase">Connected for what comes next</p>
        <h2 className="mt-7 max-w-md text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">Stronger together.<br /><span className="text-orange-400">Ready to respond.</span></h2>
        <p className="mt-6 max-w-md text-base leading-7 text-slate-300">A shared space for citizens, volunteers, and response teams to build more resilient communities.</p>
        <div className="mt-10 grid gap-5 border-t border-slate-700 pt-7 lg:mt-16">
          {['People at the center', 'A coordinated community', 'One place to come together'].map((text, index) => (
            <p key={text} className="flex items-center gap-4 text-sm font-medium text-slate-200"><span className="font-mono text-xs text-orange-400">0{index + 1}</span>{text}</p>
          ))}
        </div>
        <div aria-hidden="true" className="absolute -right-16 -bottom-24 size-64 rounded-full border border-slate-800" />
      </aside>
      <section className="bg-white px-6 py-12 sm:px-10 lg:px-16 lg:py-16">
        <div className="mx-auto max-w-md">
          <p className="text-xs font-bold tracking-[0.2em] text-orange-700 uppercase">Welcome to HavenHub</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
