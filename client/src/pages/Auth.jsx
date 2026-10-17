import { useEffect, useState } from 'react';
import { post, setSession } from '../api.js';
import { Btn, Icon, Logo } from '../ui.jsx';

const FEATURES = [
  ['link', 'Short links in seconds', 'Aliases, expiry, passwords, click limits'],
  ['spark', 'Smart insights', 'Plain-English summaries and safety checks'],
  ['chat', 'Ask your data', '“clicks from mobile last week”'],
  ['qr', 'QR codes that report back', 'Scans tracked apart from clicks'],
];
const TOP = [['/fest-reg', 541, 100], ['/cafe-menu', 388, 72], ['/club-join', 264, 49]];
const LINE = 'M0,72 C18,68 30,60 48,62 S78,42 98,46 S128,56 150,38 S188,22 214,32 S258,12 288,19 S334,6 360,10';

/** Counts up from 0 once, so the preview feels alive on first paint. */
function useCountUp(target, ms = 1400) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(target); return undefined; }
    let raf; const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / ms); setN(Math.round(target * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

/** A small sample dashboard, so first-time visitors see what they are signing in to. */
function Preview() {
  const clicks = useCountUp(12480);
  return (
    <div className="pv" aria-hidden="true">
      <div className="pv-card">
        <div className="pv-head"><span>Tech Fest 2026 · last 7 days</span><em>Sample data</em></div>
        <div className="pv-big"><b>{clicks.toLocaleString()}</b><span>clicks</span><i className="pv-up"><Icon name="up" size={13} stroke={2.4} />54%</i></div>
        <svg className="pv-chart" viewBox="0 0 360 90" preserveAspectRatio="none">
          <defs><linearGradient id="pvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7dd3fc" stopOpacity=".45" /><stop offset="1" stopColor="#7dd3fc" stopOpacity="0" /></linearGradient>
            <linearGradient id="pvl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#c4b5fd" /></linearGradient></defs>
          <path className="areafade" d={`${LINE} L360,90 L0,90 Z`} fill="url(#pvg)" />
          <path className="draw" style={{ '--len': 560 }} d={LINE} fill="none" stroke="url(#pvl)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="pv-stats">
          <div><b>41%</b><span>from QR codes</span></div>
          <div><b>68%</b><span>on phones</span></div>
          <div><b>134</b><span>bots filtered</span></div>
        </div>
        <div className="pv-links">
          {TOP.map(([code, n, w]) => (
            <div className="pv-row" key={code}><code>{code}</code><span className="pv-bar"><i style={{ width: `${w}%` }} /></span><b>{n}</b></div>
          ))}
        </div>
      </div>
      <div className="pv-chip pv-chip-a"><Icon name="hourglass" size={15} /><span><b>/fest-early</b> · 112 of 120 clicks used</span></div>
      <div className="pv-chip pv-chip-b"><Icon name="shield" size={15} /><span>Every link safety-checked</span></div>
    </div>
  );
}

export default function Auth({ mode }) {
  const reg = mode === 'register';
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [errs, setErrs] = useState({});
  const [top, setTop] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setErrs({}); setTop(''); setBusy(true);
    try { setSession(await post(reg ? '/api/auth/register' : '/api/auth/login', f)); location.hash = '#/'; }
    catch (er) { if (er.body.errors) setErrs(er.body.errors); else setTop(er.message); }
    finally { setBusy(false); }
  }
  const field = (k, label, type, auto) => (
    <div className="field"><label htmlFor={k}>{label}</label><input id={k} type={type} autoComplete={auto} value={f[k]} onChange={set(k)} className={errs[k] ? 'invalid' : ''} />{errs[k] && <div className="err">{errs[k]}</div>}</div>
  );
  return (
    <div className="authwrap">
      <section className="authart">
        <i className="blob a" /><i className="blob b" /><i className="blob c" />
        <div className="row" style={{ fontWeight: 800, fontSize: 20 }}><span className="logo"><Logo /></span>LinkPulse</div>
        <div className="authmid">
          <h2>Every link tells you<br /><span className="gradtext" style={{ backgroundImage: 'linear-gradient(135deg,#7dd3fc,#c4b5fd)' }}>what happened next.</span></h2>
          <p className="authlede">Shorten, share and track links and QR codes, with live analytics your whole team can read.</p>
          <Preview />
          <div className="featgrid">
            {FEATURES.map(([ic, t, d], i) => <div className="feat" style={{ '--i': i }} key={t}><span className="ic"><Icon name={ic} /></span><div><b>{t}</b><div>{d}</div></div></div>)}
          </div>
        </div>
        <div style={{ opacity: 0.6, fontSize: 12.5 }}>Team Strawhats · GEHU Tech Geeks hackathon</div>
      </section>
      <section className="authform">
        <form className="box page" onSubmit={submit} noValidate>
          <div className="authbrand row"><span className="logo"><Logo /></span>LinkPulse</div>
          <h1>{reg ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mute" style={{ margin: '8px 0 24px' }}>{reg ? 'It takes less than a minute.' : 'Sign in to see how your links are doing.'}</p>
          {top && <div className="badbox">{top}</div>}
          {reg && field('name', 'Your name', 'text', 'name')}
          {field('email', 'Email', 'email', 'email')}
          {field('password', 'Password', 'password', reg ? 'new-password' : 'current-password')}
          <Btn className="btn" style={{ width: '100%' }} busy={busy} type="submit">{reg ? 'Create account' : 'Sign in'}</Btn>
          <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>
            {reg ? 'Already have an account? ' : 'New here? '}<a href={reg ? '#/login' : '#/register'}>{reg ? 'Sign in' : 'Create an account'}</a>
          </p>
          {!reg && <p className="hint" style={{ textAlign: 'center' }}><a href="#/login" onClick={(e) => { e.preventDefault(); setF({ ...f, email: 'demo@linkpulse.test', password: 'demo1234' }); }}>Fill the demo login</a></p>}
        </form>
      </section>
    </div>
  );
}
