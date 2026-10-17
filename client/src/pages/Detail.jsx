import { useState } from 'react';
import { api, get, patch, TZ } from '../api.js';
import { AreaChart, Donut } from '../charts.jsx';
import { Badge, Bars, Btn, ErrorBox, Icon, PageSkeleton, RangeTabs, Stat, ago, copyText, fmt, fromLocalInput, toLocalInput, useAsync, useToast, when } from '../ui.jsx';
import { InsightsCard } from './Dashboard.jsx';
import { QrImage } from './Wizard.jsx';

function EditForm({ l, done }) {
  const toast = useToast();
  const [f, setF] = useState({ destination_url: l.destination_url, title: l.title, expires_at: toLocalInput(l.expires_at), click_limit: l.click_limit || '', password: '', tags: l.tags.join(', ') });
  const [rm, setRm] = useState(false);
  const [errs, setErrs] = useState({});
  const [warns, setWarns] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    const p = { destination_url: f.destination_url.trim(), title: f.title.trim(), expires_at: f.expires_at ? fromLocalInput(f.expires_at) : null, click_limit: f.click_limit ? Number(f.click_limit) : null, tags: f.tags };
    if (rm) p.password = null; else if (f.password) p.password = f.password;
    try { const r = await patch(`/api/links/${l.id}`, p); setWarns(r.warnings || []); toast('Saved. Changes apply to the very next click.'); done(); }
    catch (er) { if (er.body.errors) setErrs(er.body.errors); toast(er.message, true); } finally { setBusy(false); }
  }
  const fld = (k, label, type = 'text', extra = {}) => <div className="field"><label htmlFor={'e' + k}>{label}</label><input id={'e' + k} type={type} value={f[k]} onChange={set(k)} className={errs[k] ? 'invalid' : ''} {...extra} />{errs[k] && <div className="err">{errs[k]}</div>}</div>;
  return (
    <details className="card mt"><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Edit link rules</summary>
      <form onSubmit={save} noValidate style={{ marginTop: 18 }}>
        {fld('destination_url', 'Destination', 'url')}
        <div className="grid g2">{fld('title', 'Title')}{fld('tags', 'Tags')}</div>
        <div className="grid g2">{fld('expires_at', 'Expires at (clear to remove)', 'datetime-local')}{fld('click_limit', 'Maximum clicks (clear to remove)', 'number', { min: 1 })}</div>
        {fld('password', 'Password', 'password', { placeholder: l.has_password ? 'leave blank to keep the current one' : 'no password', autoComplete: 'new-password' })}
        {l.has_password && <label className="chk"><input type="checkbox" checked={rm} onChange={(e) => setRm(e.target.checked)} /> Remove the password</label>}
        {warns.map((w) => <div className="warnbox" key={w}>⚠ {w}</div>)}
        <div style={{ height: 12 }} /><Btn className="btn" busy={busy} type="submit">Save changes</Btn>
      </form>
    </details>
  );
}

export default function Detail({ id }) {
  const [days, setDays] = useState(30);
  const toast = useToast();
  const { loading, data: d, error, reload } = useAsync(() => get(`/api/links/${id}/analytics?days=${days}&tz=${TZ}`), [id, days]);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!d) return <PageSkeleton />;
  const l = d.link;
  const toggle = async () => { setBusy(true); try { await patch(`/api/links/${id}`, { status: l.status === 'active' ? 'disabled' : 'active' }); toast(l.status === 'active' ? 'Link switched off' : 'Link switched on'); reload(); } catch (e) { toast(e.message, true); } finally { setBusy(false); } };
  const download = async (fmtName) => {
    const b = await api('GET', `/api/links/${id}/qr.${fmtName}`, undefined, { blob: true });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `${l.short_code}-qr.${fmtName}` });
    document.body.append(a); a.click(); a.remove();
  };
  return (
    <div className="page" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <div className="head">
        <div><a href="#/links" className="sm">← My links</a><h1 className="mono" style={{ marginTop: 6 }}>/{l.short_code}</h1><p className="mute row" style={{ gap: 8 }}>{l.title}<Badge status={l.effective_status} />{l.has_password && '🔒'}</p></div>
        <div className="row">
          <button className="btn ghost" onClick={() => copyText(l.short_url, toast)}><Icon name="copy" size={16} />Copy link</button>
          <a className="btn ghost" href={l.short_url} target="_blank" rel="noopener noreferrer">Open</a>
          <Btn className={'btn ' + (l.status === 'active' ? 'danger' : '')} busy={busy} onClick={toggle}>{l.status === 'active' ? 'Switch off' : 'Switch on'}</Btn>
        </div>
      </div>
      {l.status === 'disabled' && l.disabled_reason && <div className="badbox">Disabled: {l.disabled_reason}</div>}
      <div className="card reveal" style={{ marginBottom: 18 }}>
        <div className="mute sm">Destination</div><div style={{ wordBreak: 'break-all', fontWeight: 600 }}>{l.destination_url}</div>
        <div className="row mute sm" style={{ marginTop: 10, gap: 16 }}><span>Created {when(l.created_at)}</span><span>Expires {l.expires_at ? when(l.expires_at) : 'never'}</span><span>Clicks {fmt(l.click_count)}{l.click_limit ? ` of ${l.click_limit}` : ''}</span>{l.campaign_name && <span>Campaign {l.campaign_name}</span>}{l.tags.map((t) => <span className="badge" key={t}>#{t}</span>)}</div>
      </div>
      <RangeTabs days={days} onChange={setDays} />
      <div className="grid g4">
        <Stat i={0} icon="bolt" label="Clicks" value={d.totals.clicks} series={d.series.map((x) => x.clicks)} />
        <Stat i={1} icon="users" label="Unique visitors" value={d.totals.visitors} />
        <Stat i={2} icon="qr" label="QR scans" value={d.totals.qr_scans} />
        <Stat i={3} icon="shield" label="Bot hits filtered" value={d.totals.bots_filtered} />
      </div>
      <div className="grid gmain mt">
        <div className="card reveal" style={{ '--i': 2 }}><h2>Clicks over time</h2><AreaChart series={d.series} /></div>
        <div className="card reveal" style={{ '--i': 3 }}><h2>QR code</h2><QrImage id={id} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn ghost s" onClick={() => download('png')}>PNG</button><button className="btn ghost s" onClick={() => download('svg')}>SVG</button></div>
          <p className="hint" style={{ textAlign: 'center' }}>Scans of this code are counted as QR.</p></div>
      </div>
      <div className="grid g2 mt"><InsightsCard link={id} days={days} />
        <div className="card reveal" style={{ '--i': 5 }}><h2>Devices</h2><Donut rows={d.devices} /><hr className="sep" /><h2>Browsers</h2><Bars rows={d.browsers} /></div></div>
      <div className="grid g3 mt">
        <div className="card reveal" style={{ '--i': 5 }}><h2>Referrers</h2><Bars rows={d.referrers} /></div>
        <div className="card reveal" style={{ '--i': 6 }}><h2>Countries</h2><Bars rows={d.countries} /></div>
        <div className="card reveal" style={{ '--i': 7 }}><h2>Sources</h2><Bars rows={d.sources} /></div>
      </div>
      <div className="card mt reveal" style={{ '--i': 8 }}><h2>Latest visits</h2>
        {d.recent.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}><thead><tr>{['When', 'Referrer', 'Device', 'Browser', 'Country', 'Source'].map((t) => <th key={t} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mute)', fontSize: 12 }}>{t}</th>)}</tr></thead>
          <tbody>{d.recent.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '9px 8px' }}>{ago(r.clicked_at)}{r.is_bot ? <span className="badge" style={{ marginLeft: 6 }}>bot</span> : null}</td><td style={{ padding: '9px 8px' }}>{r.referrer || 'Direct'}</td><td style={{ padding: '9px 8px' }}>{r.device}</td><td style={{ padding: '9px 8px' }}>{r.browser} · {r.os}</td><td style={{ padding: '9px 8px' }}>{r.country}</td><td style={{ padding: '9px 8px' }}>{r.source}</td></tr>)}</tbody></table></div>
          : <div className="empty">No visits yet. Open the short link and the first one appears here.</div>}
      </div>
      <EditForm key={l.updated_at} l={l} done={reload} />
    </div>
  );
}
