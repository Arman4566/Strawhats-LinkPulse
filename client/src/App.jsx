import { useEffect, useState } from 'react';
import { getSession, onSession, setSession } from './api.js';
import { Icon, Logo, ToastProvider, useTheme } from './ui.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Assistant from './pages/Assistant.jsx';
import Links from './pages/Links.jsx';
import Wizard from './pages/Wizard.jsx';
import Detail from './pages/Detail.jsx';
import Import from './pages/Import.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Admin from './pages/Admin.jsx';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => { setHash(location.hash || '#/'); scrollTo({ top: 0 }); };
    addEventListener('hashchange', f); return () => removeEventListener('hashchange', f);
  }, []);
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}
function useSessionState() {
  const [s, set] = useState(getSession());
  useEffect(() => onSession(set), []);
  return s;
}

const NAV = [
  ['/', 'Dashboard', 'home'], ['/ask', 'Ask AI', 'chat', 'AI'], ['/links', 'My links', 'link'],
  ['/links/new', 'Create', 'plus'], ['/import', 'Import', 'upload'], ['/campaigns', 'Campaigns', 'flag'],
];

function Shell({ session, path, children }) {
  const [theme, toggle] = useTheme();
  const nav = [...NAV, ...(session.user.role === 'admin' ? [['/admin', 'Admin', 'shield']] : [])];
  const active = (to) => (to === '/' ? path === '/' : to === '/links' ? path === '/links' || /^\/links\/\d+/.test(path) : path === to);
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="#/"><span className="logo"><Logo /></span>LinkPulse</a>
        <nav className="nav" aria-label="Main">
          {nav.map(([to, label, icon, tag]) => <a key={to} href={'#' + to} className={active(to) ? 'on' : ''} aria-current={active(to) ? 'page' : undefined}><Icon name={icon} size={19} />{label}{tag && <span className="tag">{tag}</span>}</a>)}
        </nav>
        <div className="sidefoot">
          <div className="who"><span className="avatar">{session.user.name.slice(0, 1).toUpperCase()}</span><div style={{ minWidth: 0 }}><b>{session.user.name}</b><span className="sm mute">{session.user.role}</span></div></div>
          <div className="row">
            <button className="btn ghost s grow" onClick={toggle} aria-label="Toggle dark mode"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />{theme === 'dark' ? 'Light' : 'Dark'}</button>
            <button className="btn ghost s" onClick={() => setSession(null)} aria-label="Sign out"><Icon name="logout" size={15} /></button>
          </div>
        </div>
      </aside>
      <div className="mainwrap">
        <header className="topbar">
          <a className="brand" href="#/"><span className="logo"><Logo /></span>LinkPulse</a><span className="grow" />
          <button className="btn ghost s" onClick={toggle} aria-label="Toggle dark mode"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /></button>
          <button className="btn ghost s" onClick={() => setSession(null)} aria-label="Sign out"><Icon name="logout" size={15} /></button>
        </header>
        <main key={path}>{children}</main>
      </div>
    </div>
  );
}

function Routes({ path, params, session }) {
  let m;
  if (path === '/') return <Dashboard />;
  if (path === '/ask') return <Assistant />;
  if (path === '/links') return <Links params={params} />;
  if (path === '/links/new') return <Wizard />;
  if ((m = path.match(/^\/links\/(\d+)$/))) return <Detail id={Number(m[1])} />;
  if (path === '/import') return <Import />;
  if (path === '/campaigns') return <Campaigns />;
  if (path === '/admin' && session.user.role === 'admin') return <Admin />;
  return <Dashboard />;
}

export default function App() {
  const { path, params } = useHash();
  const session = useSessionState();
  useTheme();
  const isAuth = path === '/login' || path === '/register';
  useEffect(() => {
    if (!session && !isAuth) location.hash = '#/login';
    if (session && isAuth) location.hash = '#/';
  }, [session, isAuth]);
  return (
    <ToastProvider>
      {!session ? <Auth mode={path === '/register' ? 'register' : 'login'} />
        : isAuth ? null
          : <Shell session={session} path={path}><Routes path={path} params={params} session={session} /></Shell>}
    </ToastProvider>
  );
}
