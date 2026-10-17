import { useState } from 'react';
import { get } from '../api.js';
import { Badge, ErrorBox, Icon, Skeleton, copyText, fmt, useAsync, useDebounced, useToast } from '../ui.jsx';

export function LinkRow({ l, extra }) {
  const toast = useToast();
  const used = l.click_limit ? Math.min(100, (l.click_count / l.click_limit) * 100) : 0;
  return (
    <div className="linkrow">
      <div style={{ minWidth: 0 }}>
        <a href={`#/links/${l.id}`} className="code mono">/{l.short_code}</a>{l.has_password && <span title="Password protected"> 🔒</span>}
        <div className="sm mute url">{l.title || '—'}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="url sm" title={l.destination_url}>{l.destination_url}</span>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>{l.tags.map((t) => <span className="badge" key={t}>#{t}</span>)}{l.campaign_name && <span className="badge ai">{l.campaign_name}</span>}{extra}</div>
      </div>
      <div><Badge status={l.effective_status} /></div>
      <div><b>{fmt(l.click_count)}</b>{l.click_limit ? <span className="mute sm"> / {l.click_limit}</span> : <span className="mute sm"> clicks</span>}{l.click_limit && <div className="usebar"><i style={{ width: `${used}%` }} /></div>}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button className="btn ghost s" onClick={() => copyText(l.short_url, toast)} aria-label={`Copy /${l.short_code}`}><Icon name="copy" size={14} />Copy</button>
        <a className="btn ghost s" href={`#/links/${l.id}`}>Open</a>
      </div>
    </div>
  );
}

export default function Links({ params }) {
  const [search, setSearch] = useState(params.search || '');
  const [status, setStatus] = useState('');
  const [campaign, setCampaign] = useState(params.campaign || '');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const dSearch = useDebounced(search, 300);
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  const q = new URLSearchParams({ page, ...(dSearch && { search: dSearch }), ...(status && { status }), ...(campaign && { campaign }), ...(tag && { tag }) });
  const meta = useAsync(async () => { const [c, t] = await Promise.all([get('/api/campaigns'), get('/api/tags')]); return { camps: c.campaigns, tags: t.tags }; }, []);
  const { loading, data, error, reload } = useAsync(() => get('/api/links?' + q), [q.toString()]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="page">
      <div className="head">
        <div><h1>My links</h1><p className="mute">{data ? `${fmt(data.total)} link${data.total === 1 ? '' : 's'}` : 'Loading…'}</p></div>
        <a className="btn" href="#/links/new"><Icon name="plus" size={16} />New link</a>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input type="text" style={{ flex: '1 1 220px', width: 'auto' }} placeholder="Search code, URL or title" value={search} onChange={reset(setSearch)} aria-label="Search links" />
        <select style={{ width: 'auto' }} value={status} onChange={reset(setStatus)} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="expired">Expired</option><option value="disabled">Disabled</option><option value="limit_reached">Limit reached</option></select>
        <select style={{ width: 'auto' }} value={campaign} onChange={reset(setCampaign)} aria-label="Campaign"><option value="">Any campaign</option>{meta.data?.camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select style={{ width: 'auto' }} value={tag} onChange={reset(setTag)} aria-label="Tag"><option value="">Any tag</option>{meta.data?.tags.map((t) => <option key={t.name} value={t.name}>#{t.name}</option>)}</select>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : (
        <div className="card" style={{ padding: 10, opacity: loading && data ? 0.55 : 1, transition: 'opacity .2s' }}>
          {!data ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={58} style={{ margin: 8 }} />)
            : data.links.length ? data.links.map((l) => <LinkRow key={l.id} l={l} />)
              : <div className="empty">No links match. <a href="#/links/new">Create one</a></div>}
        </div>)}
      {data && pages > 1 && (
        <div className="pager"><span className="mute sm">Page {data.page} of {pages}</span>
          <button className="btn ghost s" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn ghost s" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>)}
    </div>
  );
}
