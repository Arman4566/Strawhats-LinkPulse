import { useState } from 'react';
import { get, post } from '../api.js';
import { Btn, ErrorBox, PageSkeleton, fmt, useAsync, useToast } from '../ui.jsx';

export default function Campaigns() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => get('/api/campaigns'), []);
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function add(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await post('/api/campaigns', { name, description: desc }); toast('Campaign created'); setName(''); setDesc(''); reload(); }
    catch (er) { setErr(er.body.errors?.name || er.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const max = Math.max(1, ...data.campaigns.map((c) => c.clicks_30d));
  return (
    <div className="page">
      <div className="head"><div><h1>Campaigns</h1><p className="mute">Group links so you can compare how each push performed.</p></div></div>
      <div className="grid gmain">
        <div className="grid">{data.campaigns.length ? data.campaigns.map((c, i) => (
          <div className="card lift reveal" style={{ '--i': i }} key={c.id}>
            <div className="row"><b style={{ fontSize: 16 }}>{c.name}</b><span className="grow" /><a className="btn ghost s" href={`#/links?campaign=${c.id}`}>View links</a></div>
            <div className="mute sm">{c.description || 'No description'}</div>
            <div className="row" style={{ marginTop: 12, gap: 20 }}><span><b style={{ fontSize: 22 }}>{c.links}</b> <span className="mute sm">links</span></span><span><b style={{ fontSize: 22 }}>{fmt(c.clicks_30d)}</b> <span className="mute sm">clicks, 30 days</span></span></div>
            <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${Math.max(3, (c.clicks_30d / max) * 100)}%`, animation: 'none' }} /></div>
          </div>)) : <div className="card empty">No campaigns yet.</div>}</div>
        <form className="card" onSubmit={add} noValidate style={{ alignSelf: 'start' }}>
          <h2>New campaign</h2>
          <div className="field"><label htmlFor="cn">Name</label><input id="cn" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tech Fest 2026" className={err ? 'invalid' : ''} />{err && <div className="err">{err}</div>}</div>
          <div className="field"><label htmlFor="cd">Description</label><input id="cd" type="text" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <Btn className="btn" busy={busy} type="submit">Create</Btn>
        </form>
      </div>
    </div>
  );
}
