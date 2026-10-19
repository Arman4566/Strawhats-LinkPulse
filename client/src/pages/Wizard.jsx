import { useEffect, useRef, useState } from 'react';
import { api, get, post } from '../api.js';
import QrPanel from '../qrpanel.jsx';
import { Btn, Confetti, Icon, ShareMenu, copyText, fromLocalInput, useAsync, useDebounced, useToast, when } from '../ui.jsx';

const EMPTY = { destination_url: '', alias: '', title: '', expires_at: '', click_limit: '', password: '', campaign_id: '', campaign: '', tags: '' };
const STEP1 = ['destination_url', 'alias'];
const STEP2 = ['expires_at', 'click_limit', 'password', 'campaign_id'];

const payload = (f) => {
  const p = { destination_url: f.destination_url.trim(), alias: f.alias.trim(), title: f.title.trim(), tags: f.tags };
  if (f.expires_at) p.expires_at = fromLocalInput(f.expires_at);
  if (f.click_limit) p.click_limit = Number(f.click_limit);
  if (f.password) p.password = f.password;
  if (f.campaign_id === '__new') p.campaign = f.campaign.trim(); else if (f.campaign_id) p.campaign_id = f.campaign_id;
  return p;
};

function Safety({ url }) {
  const d = useDebounced(url.trim(), 450);
  const { data } = useAsync(() => (/^https?:\/\/.+\..+/i.test(d) ? post('/api/ai/scan', { destination_url: d }) : Promise.resolve(null)), [d]);
  if (!data || data.level === 'unknown') return null;
  const color = { low: 'var(--good)', medium: 'var(--warn)', high: 'var(--bad)' }[data.level];
  const label = { low: 'Looks safe', medium: 'Be careful', high: 'Looks risky' }[data.level];
  return (
    <div className={'scan ' + data.level}>
      <div className="row"><span className="sparkle" style={{ background: color }}><Icon name="shield" size={15} /></span><b>{label}</b><span className="badge ai">Link safety check</span><span className="grow" /><span className="mute sm">risk {data.score}/100</span></div>
      <div className="meter"><i style={{ width: `${Math.max(4, data.score)}%`, background: color }} /></div>
      <ul>{data.reasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
      {data.level === 'high' && <div className="hint" style={{ color: 'var(--bad)' }}>You can still create it, but visitors may be harmed. Admins can switch off reported links.</div>}
    </div>
  );
}

export default function Wizard() {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState({});
  const [warns, setWarns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const camps = useAsync(() => get('/api/campaigns'), []);
  const seq = useRef(0);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const dest = useDebounced(f.destination_url.trim(), 400);
  const titleD = useDebounced(f.title, 500);
  const sugg = useAsync(() => (/^https?:\/\/.+\..+/i.test(dest) ? post('/api/ai/suggest-alias', { destination_url: dest, title: titleD }) : Promise.resolve(null)), [dest, titleD]);

  // live validation as the person types
  const live = useDebounced(JSON.stringify([f.destination_url, f.alias, f.expires_at, f.click_limit, f.password]), 350);
  useEffect(() => {
    if (!f.destination_url && !f.alias) return;
    const my = ++seq.current;
    post('/api/links/validate', payload(f)).then((r) => { if (my === seq.current) { setErrs(r.errors || {}); setWarns(r.warnings || []); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const visibleErr = (keys) => Object.fromEntries(Object.entries(errs).filter(([k]) => keys.includes(k)));
  async function next() {
    if (!f.destination_url.trim()) { setErrs({ destination_url: 'Enter the address you want to shorten' }); return; }
    const keys = step === 1 ? STEP1 : STEP2;
    try {
      const r = await post('/api/links/validate', payload(f));
      setErrs(r.errors); setWarns(r.warnings);
      if (keys.some((k) => r.errors[k])) { toast('Fix the highlighted fields to continue', true); return; }
      setStep(step + 1);
    } catch (e) { toast(e.message, true); }
  }
  async function create() {
    setBusy(true);
    try { const r = await post('/api/links', payload(f)); setDone(r); }
    catch (e) {
      if (e.status === 422 && e.body.errors) { setErrs(e.body.errors); setStep(Object.keys(e.body.errors).some((k) => STEP1.includes(k)) ? 1 : 2); toast('Some fields need fixing', true); }
      else if (e.status === 429) toast(`Too many links created too fast. Try again in ${e.body.retryAfter || 60} seconds.`, true);
      else toast(e.message, true);
    } finally { setBusy(false); }
  }

  if (done) return <Done link={done.link} warnings={done.warnings} again={() => { setDone(null); setF(EMPTY); setStep(1); setErrs({}); setWarns([]); }} />;

  const E = (k, show) => show[k] && <div className="err">{show[k]}</div>;
  const show = visibleErr(step === 1 ? STEP1 : STEP2);
  const steps = ['Destination', 'Rules & organise', 'Review'];
  return (
    <div className="page">
      <div className="head"><div><h1>Create a short link</h1><p className="mute">Three quick steps, checked as you type.</p></div></div>
      <div className="steps">{steps.map((s, i) => <div key={s} className={'step ' + (step === i + 1 ? 'on' : step > i + 1 ? 'done' : '')}><i>{step > i + 1 ? '✓' : i + 1}</i><span>{s}</span></div>)}</div>
      <div className="card slide" key={step}>
        {step === 1 && <>
          <div className="field"><label htmlFor="d">Where should the link go?</label>
            <input id="d" type="url" autoFocus placeholder="https://example.com/a/very/long/page" value={f.destination_url} onChange={set('destination_url')} className={show.destination_url ? 'invalid' : ''} autoComplete="off" />
            {E('destination_url', show)}</div>
          <Safety url={f.destination_url} />
          <div style={{ height: 18 }} />
          <div className="field"><label htmlFor="a">Custom alias <span className="mute">(optional)</span></label>
            <input id="a" type="text" placeholder="leave blank for an automatic code" value={f.alias} onChange={set('alias')} className={show.alias ? 'invalid' : ''} autoComplete="off" />
            {E('alias', show)}
            {sugg.data?.suggestions?.length > 0 && <div style={{ marginTop: 10 }}><div className="hint row" style={{ marginBottom: 6 }}><span className="sparkle" style={{ width: 20, height: 20, borderRadius: 7 }}><Icon name="spark" size={11} /></span>Suggested aliases</div><div className="chips">{sugg.data.suggestions.map((s) => <button type="button" key={s} className="chip alias" onClick={() => setF((x) => ({ ...x, alias: s }))}>{s}</button>)}</div></div>}
          </div>
          <div className="field"><label htmlFor="t">Title <span className="mute">(optional)</span></label><input id="t" type="text" maxLength={120} placeholder="e.g. Fest registration form" value={f.title} onChange={set('title')} /><div className="hint">A private label to help you find it later. It also improves the alias ideas.</div></div>
          {warns.map((w) => <div className="warnbox" key={w}>⚠ {w}</div>)}
          <button className="btn" onClick={next}>Next: rules</button>
        </>}
        {step === 2 && <>
          <div className="grid g2">
            <div className="field"><label htmlFor="e">Expires at</label><input id="e" type="datetime-local" value={f.expires_at} onChange={set('expires_at')} className={show.expires_at ? 'invalid' : ''} />{E('expires_at', show)}<div className="hint">After this time the link shows an expired page.</div></div>
            <div className="field"><label htmlFor="c">Maximum clicks</label><input id="c" type="number" min="1" placeholder="no limit" value={f.click_limit} onChange={set('click_limit')} className={show.click_limit ? 'invalid' : ''} />{E('click_limit', show)}<div className="hint">Bots never use up a click.</div></div>
          </div>
          <div className="field"><label htmlFor="p">Password protection</label><input id="p" type="password" placeholder="optional" autoComplete="new-password" value={f.password} onChange={set('password')} className={show.password ? 'invalid' : ''} />{E('password', show)}</div>
          <div className="grid g2">
            <div className="field"><label htmlFor="cp">Campaign</label>
              <select id="cp" value={f.campaign_id} onChange={set('campaign_id')}><option value="">No campaign</option>{camps.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ New campaign…</option></select>
              {f.campaign_id === '__new' && <input type="text" style={{ marginTop: 8 }} placeholder="New campaign name" value={f.campaign} onChange={set('campaign')} autoFocus />}</div>
            <div className="field"><label htmlFor="tg">Tags</label><input id="tg" type="text" placeholder="comma separated, e.g. poster, qr" value={f.tags} onChange={set('tags')} /></div>
          </div>
          {warns.map((w) => <div className="warnbox" key={w}>⚠ {w}</div>)}
          <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button><button className="btn" onClick={next}>Next: review</button></div>
        </>}
        {step === 3 && <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {[['Destination', f.destination_url], ['Short code', f.alias || 'Automatic'], ['Title', f.title || '—'], ['Expires', f.expires_at ? when(fromLocalInput(f.expires_at)) : 'Never'], ['Click limit', f.click_limit || 'None'], ['Password', f.password ? 'Yes' : 'No'],
              ['Campaign', f.campaign_id === '__new' ? `${f.campaign} (new)` : camps.data?.campaigns.find((c) => String(c.id) === f.campaign_id)?.name || '—'], ['Tags', f.tags || '—']].map(([k, v]) => (
              <tr key={k}><td className="mute" style={{ padding: '9px 0', width: 150, borderBottom: '1px solid var(--line)' }}>{k}</td><td style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', wordBreak: 'break-all' }}>{v}</td></tr>))}
          </tbody></table>
          <div style={{ height: 16 }} /><Safety url={f.destination_url} />
          <div style={{ height: 14 }} />{warns.map((w) => <div className="warnbox" key={w}>⚠ {w}</div>)}
          <div className="row"><button className="btn ghost" onClick={() => setStep(2)}>Back</button><Btn className="btn" busy={busy} onClick={create}>Create short link</Btn></div>
        </>}
      </div>
    </div>
  );
}

function Done({ link, warnings, again }) {
  const toast = useToast();
  return (
    <div className="page"><Confetti />
      <div className="card"><div className="okbox">✓ Your short link is live</div>
        <div className="grid g2" style={{ alignItems: 'center' }}>
          <div>
            <label>Short link</label>
            <div className="copy"><input type="text" readOnly value={link.short_url} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => copyText(link.short_url, toast)}><Icon name="copy" size={16} />Copy</button></div>
            <p className="mute sm" style={{ wordBreak: 'break-all' }}>Goes to {link.destination_url}</p>
            {(warnings || []).map((w) => <div className="warnbox" key={w}>⚠ {w}</div>)}
            <div className="row"><ShareMenu ghost={false} url={link.short_url} title={link.title || `/${link.short_code}`} /><a className="btn ghost" href={`#/links/${link.id}`}>Open analytics</a><a className="btn ghost" href={link.short_url} target="_blank" rel="noopener noreferrer">Test the link</a><button className="btn ghost" onClick={again}>Create another</button></div>
          </div>
          <div><QrPanel link={link} alt={`QR code for ${link.short_url}`} /><p className="hint" style={{ textAlign: 'center' }}>Scans are tracked separately.</p></div>
        </div>
      </div>
    </div>
  );
}
