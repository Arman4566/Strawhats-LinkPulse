import { useState } from 'react';
import { post, setSession } from '../api.js';
import { Btn, Icon, Logo } from '../ui.jsx';

const FEATURES = [
  ['link', 'Short links in seconds', 'Custom aliases, expiry, passwords and click limits.'],
  ['spark', 'Smart insights', 'Plain-English summaries, link safety checks and alias ideas.'],
  ['chat', 'Ask your data', 'Type “clicks from mobile last week” and get the answer.'],
  ['qr', 'QR codes that report back', 'Every scan is tracked separately from clicks.'],
];

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
        <div>
          <h2>Every link tells you<br /><span className="gradtext" style={{ backgroundImage: 'linear-gradient(135deg,#7dd3fc,#c4b5fd)' }}>what happened next.</span></h2>
          {FEATURES.map(([ic, t, d], i) => <div className="feat" style={{ '--i': i }} key={t}><span className="ic"><Icon name={ic} /></span><div><b>{t}</b><div style={{ opacity: 0.75, fontSize: 13.5 }}>{d}</div></div></div>)}
        </div>
        <div style={{ opacity: 0.6, fontSize: 12.5 }}>Team Strawhats · GEHU Tech Geeks hackathon</div>
      </section>
      <section className="authform">
        <form className="box page" onSubmit={submit} noValidate>
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
