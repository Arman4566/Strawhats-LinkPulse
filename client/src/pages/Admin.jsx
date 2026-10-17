import { useState } from 'react';
import { del, get, post } from '../api.js';
import { Badge, Btn, ErrorBox, Icon, Modal, PageSkeleton, Tabs, ago, fmt, useAsync, useDebounced, useToast, when } from '../ui.jsx';

const th = (t) => <th key={t} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--mute)', fontSize: 12 }}>{t}</th>;
const td = { padding: '11px 10px', borderTop: '1px solid var(--line)' };
const Wrap = ({ children }) => <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>{children}</table></div>;

function DisableModal({ link, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('Violates our policy'); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await post(`/api/admin/links/${link.id}/disable`, { reason }); toast('Disabled. The very next click sees it.'); onDone(); } catch (e) { toast(e.message, true); } finally { setBusy(false); } };
  return <Modal title={`Disable /${link.short_code}`} onClose={onClose}>
    <div className="field"><label htmlFor="rs">Reason (shown on the link page)</label><input id="rs" type="text" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    <div className="row"><Btn className="btn danger" busy={busy} onClick={go}>Disable link</Btn><button className="btn ghost" onClick={onClose}>Cancel</button></div></Modal>;
}

function AllLinks() {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [target, setTarget] = useState(null);
  const toast = useToast(); const d = useDebounced(search, 300);
  const q = new URLSearchParams({ page, ...(d && { search: d }) });
  const { data, error, reload } = useAsync(() => get('/api/admin/links?' + q), [q.toString()]);
  const enable = async (l) => { try { await post(`/api/admin/links/${l.id}/enable`); toast('Enabled'); reload(); } catch (e) { toast(e.message, true); } };
  if (error) return <ErrorBox error={error} retry={reload} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return <>
    <input type="text" placeholder="Search code, URL or owner…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ marginBottom: 14, maxWidth: 420 }} aria-label="Search all links" />
    <div className="card"><Wrap><thead><tr>{['Link', 'Destination', 'Owner', 'Status', 'Clicks', ''].map(th)}</tr></thead>
      <tbody>{(data?.links || []).map((l) => <tr key={l.id}><td style={td} className="mono"><b>/{l.short_code}</b></td><td style={{ ...td, maxWidth: 260 }}><span className="url sm" title={l.destination_url}>{l.destination_url}</span></td><td style={td} className="sm">{l.owner_email}</td><td style={td}><Badge status={l.effective_status} /></td><td style={td}>{fmt(l.click_count)}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.status === 'disabled' ? <button className="btn ghost s" onClick={() => enable(l)}>Enable</button> : <button className="btn danger s" onClick={() => setTarget(l)}>Disable</button>} <a className="btn ghost s" href={`#/links/${l.id}`}>Analytics</a></td></tr>)}</tbody></Wrap>
      {data && <div className="pager"><span className="mute sm">{fmt(data.total)} links · page {data.page} of {pages}</span><button className="btn ghost s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn ghost s" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}</div>
    {target && <DisableModal link={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); reload(); }} />}
  </>;
}

function Risk() {
  const toast = useToast(); const [target, setTarget] = useState(null);
  const { data, error, reload } = useAsync(() => get('/api/admin/risk'), []);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  return <>
    <div className="card aicard"><div className="aihead"><span className="sparkle"><Icon name="shield" size={16} /></span><h2 style={{ margin: 0 }}>Risk radar</h2><span className="badge ai">scans every active link</span></div>
      <p className="mute sm" style={{ marginTop: 0 }}>{data.scanned} active links checked for look-alike domains, raw IPs, pressure words and other phishing signs. Review before disabling: a high score is a warning, not proof.</p>
      {data.risky.length ? data.risky.map((r, i) => <div className={'insight ' + (r.level === 'high' ? 'warn' : 'tip')} style={{ '--i': i }} key={r.id}>
        <span className="ic"><Icon name="shield" size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}><b><span className="mono">/{r.short_code}</span> <span className={'badge ' + (r.level === 'high' ? 'disabled' : 'expired')}>risk {r.score}</span></b><span className="url sm mute">{r.destination_url}</span><span className="sm mute">{r.reasons.join(' · ')}</span></div>
        <button className="btn danger s" style={{ alignSelf: 'center' }} onClick={() => setTarget(r)}>Disable</button></div>) : <div className="empty">No risky links found. 🎉</div>}</div>
    {target && <DisableModal link={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); toast('Done'); reload(); }} />}
  </>;
}

function Blocklist() {
  const toast = useToast(); const [dom, setDom] = useState(''); const [cb, setCb] = useState(true); const [err, setErr] = useState('');
  const { data, error, reload } = useAsync(() => get('/api/admin/blocklist'), []);
  async function add(e) { e.preventDefault(); setErr(''); try { const r = await post('/api/admin/blocklist', { domain: dom, disable_existing: cb }); toast(`Blocked ${r.domain}. ${r.disabled_links} existing link${r.disabled_links === 1 ? '' : 's'} switched off.`); setDom(''); reload(); } catch (er) { setErr(er.body.errors?.domain || er.message); } }
  if (error) return <ErrorBox error={error} retry={reload} />;
  return <div className="grid gmain">
    <div className="card">{data?.domains.length ? <Wrap><thead><tr>{['Domain', 'Added', ''].map(th)}</tr></thead><tbody>{data.domains.map((d) => <tr key={d.id}><td style={td} className="mono">{d.domain}</td><td style={td} className="sm mute">{when(d.created_at)}</td><td style={td}><button className="btn ghost s" onClick={async () => { await del(`/api/admin/blocklist/${d.id}`); reload(); }}>Remove</button></td></tr>)}</tbody></Wrap> : <div className="empty">No blocked domains.</div>}</div>
    <form className="card" onSubmit={add} noValidate style={{ alignSelf: 'start' }}><h2>Block a domain</h2>
      <div className="field"><input type="text" placeholder="bad-site.example" value={dom} onChange={(e) => setDom(e.target.value)} className={err ? 'invalid' : ''} aria-label="Domain" />{err && <div className="err">{err}</div>}<div className="hint">Subdomains are blocked too. New links to it are refused.</div></div>
      <label className="chk" style={{ marginBottom: 14 }}><input type="checkbox" checked={cb} onChange={(e) => setCb(e.target.checked)} /> Also switch off existing links to it</label><button className="btn danger" type="submit">Block domain</button></form></div>;
}

function Reports() {
  const toast = useToast(); const { data, error, reload } = useAsync(() => get('/api/admin/reports'), []);
  const resolve = async (r, disable) => { try { if (disable) await post(`/api/admin/links/${r.link_id}/disable`, { reason: 'Reported: ' + r.reason }); await post(`/api/admin/reports/${r.id}/resolve`); toast('Done'); reload(); } catch (e) { toast(e.message, true); } };
  if (error) return <ErrorBox error={error} retry={reload} />;
  return <div className="card">{data?.reports.length ? <Wrap><thead><tr>{['Link', 'Reason', 'Reported', ''].map(th)}</tr></thead><tbody>{data.reports.map((r) => <tr key={r.id} style={{ opacity: r.resolved ? 0.5 : 1 }}><td style={td}><b className="mono">/{r.short_code}</b><span className="url sm mute" style={{ maxWidth: 240 }}>{r.destination_url}</span></td><td style={td}>{r.reason}</td><td style={td} className="sm">{ago(r.created_at)}</td>
    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.resolved ? <span className="badge">resolved</span> : <><button className="btn danger s" onClick={() => resolve(r, true)}>Disable link</button> <button className="btn ghost s" onClick={() => resolve(r, false)}>Dismiss</button></>}</td></tr>)}</tbody></Wrap> : <div className="empty">No reports. Visitors can report a link at /api/report.</div>}</div>;
}

function Users() {
  const { data, error, reload } = useAsync(() => get('/api/admin/users'), []);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return <div className="card"><Wrap><thead><tr>{['Name', 'Email', 'Role', 'Links', 'Joined'].map(th)}</tr></thead><tbody>{(data?.users || []).map((u) => <tr key={u.id}><td style={td}>{u.name}</td><td style={td}>{u.email}</td><td style={td}><span className={'badge ' + (u.role === 'admin' ? 'admin' : '')}>{u.role}</span></td><td style={td}>{u.links}</td><td style={td} className="sm mute">{when(u.created_at)}</td></tr>)}</tbody></Wrap></div>;
}

function Perf() {
  const { data, error, reload } = useAsync(() => get('/api/admin/perf'), []);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const ms = (n) => `${n.toFixed(2)} ms`;
  const S = ({ v, l }) => <div className="card stat lift"><div className="v">{v}</div><div className="k">{l}</div></div>;
  return <><div className="grid g3"><S v={ms(data.redirect_decide_ms.avg)} l={`Redirect decision, average (p95 ${ms(data.redirect_decide_ms.p95)}, ${data.redirect_decide_ms.samples} samples)`} /><S v={ms(data.click_flush_ms.avg)} l={`Batched click write, average (${data.click_flush_ms.samples} batches)`} /><S v={data.queued_clicks} l="Clicks waiting to be written" /></div>
    <div className="card mt"><p style={{ margin: 0 }}>{data.note}</p><p className="hint">Every redirect also returns a Server-Timing header, so the decision time shows in the browser's network panel.</p><button className="btn ghost s" onClick={reload}>Refresh</button></div></>;
}

const TABS = [['risk', 'Risk radar'], ['links', 'All links'], ['blocklist', 'Blocklist'], ['reports', 'Reports'], ['users', 'Users'], ['perf', 'Performance']];
export default function Admin() {
  const [tab, setTab] = useState('risk');
  const View = { risk: Risk, links: AllLinks, blocklist: Blocklist, reports: Reports, users: Users, perf: Perf }[tab];
  return <div className="page"><div className="head"><div><h1>Admin</h1><p className="mute">Moderate links, block unsafe domains, watch the platform.</p></div></div><Tabs options={TABS} value={tab} onChange={setTab} /><div key={tab} className="slide"><View /></div></div>;
}
