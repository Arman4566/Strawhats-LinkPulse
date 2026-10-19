import { useEffect, useMemo, useState } from 'react';
import { api, get, getSession } from '../api.js';
import { Badge, Btn, ErrorBox, Icon, PageSkeleton, ShareMenu, copyText, fmt, useAsync, useToast } from '../ui.jsx';

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** A small phone-shaped preview that updates as you type (the real page is rendered by the server). */
function Preview({ form, items, theme }) {
  const t = theme || {};
  const shown = items.filter((i) => i.effective_status === 'active');   // like the real page, switched-off links are hidden
  return (
    <div className="phone" aria-label="Preview of your page">
      <div className="phone-in" style={{ background: t.bg, color: t.fg }}>
        <div className="pav" style={{ background: t.card, borderColor: t.line }}>{(form.display_name || form.handle || '?').slice(0, 1).toUpperCase()}</div>
        <b className="pname">{form.display_name || 'Your name'}</b>
        <span className="phandle">@{form.handle || 'your-name'}</span>
        {form.bio && <p className="pbio">{form.bio}</p>}
        <div className="plist">
          {shown.length ? shown.map((i) => (
            <div className="pbtn" key={i.link_id} style={{ background: t.card, borderColor: t.line }}>
              <b>{i.label || i.title || `/${i.short_code}`}</b><span>{host(i.destination_url)}</span>
            </div>
          )) : <div className="pempty">Add links below and they show up here.</div>}
        </div>
      </div>
    </div>
  );
}

export default function Bio() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => get('/api/bio'), []);
  const [form, setForm] = useState(null);
  const [items, setItems] = useState([]);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');

  useEffect(() => {
    if (!data) return;
    const p = data.page;
    setForm({ handle: p?.handle || data.suggested_handle || '', display_name: p?.display_name || getSession()?.user.name || '', bio: p?.bio || '', theme: p?.theme || 'ocean', published: p ? p.published : true });
    setItems(data.items);
  }, [data]);

  const theme = useMemo(() => data?.themes.find((t) => t.id === form?.theme), [data, form?.theme]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !form) return <PageSkeleton />;

  const page = data.page;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const used = new Set(items.map((i) => i.link_id));
  const available = data.links.filter((l) => !used.has(l.id));
  const add = (id) => { const l = data.links.find((x) => x.id === Number(id)); if (l) setItems([...items, { link_id: l.id, label: '', ...l }]); setPick(''); };
  const move = (i, d) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setItems(a); };
  const setLabel = (i, v) => setItems(items.map((x, k) => (k === i ? { ...x, label: v } : x)));

  async function save(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    try {
      await api('PUT', '/api/bio', { ...form, items: items.map((i) => ({ link_id: i.link_id, label: i.label })) });
      toast(page ? 'Page saved' : 'Your page is live'); reload();
    } catch (er) { if (er.body.errors) setErrs(er.body.errors); toast(er.message, true); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete your bio page? The link /@' + page.handle + ' will stop working. Your short links are not affected.')) return;
    try { await api('DELETE', '/api/bio'); toast('Page deleted'); reload(); } catch (er) { toast(er.message, true); }
  }
  const hidden = items.filter((i) => i.effective_status !== 'active').length;

  return (
    <div className="page">
      <div className="head">
        <div><h1>Link-in-bio page</h1><p className="mute">One address for all your links. Every button is a short link, so every tap shows up in your analytics.</p></div>
        {page && (
          <div className="row">
            <ShareMenu ghost url={page.url} title={page.display_name} text="My links" />
            <button className="btn ghost" onClick={() => copyText(page.url, toast)}><Icon name="copy" size={16} />Copy</button>
            <a className="btn" href={`/@${page.handle}`} target="_blank" rel="noopener noreferrer">View page</a>
          </div>
        )}
      </div>
      {page && <div className="card reveal" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}><div className="mute sm">Your page</div><b className="mono" style={{ wordBreak: 'break-all' }}>{page.url}</b></div>
          <div className="row" style={{ gap: 14 }}><span className="sm mute">{fmt(page.views)} view{page.views === 1 ? '' : 's'}</span>{page.published ? <Badge kind="active">published</Badge> : <Badge kind="disabled">hidden</Badge>}</div>
        </div>
      </div>}

      <div className="biogrid">
        <form onSubmit={save} noValidate>
          <div className="card reveal">
            <h2>Profile</h2>
            <div className="field"><label htmlFor="bh">Page address</label>
              <div className="prefix"><span>{location.host}/@</span><input id="bh" type="text" value={form.handle} onChange={set('handle')} className={errs.handle ? 'invalid' : ''} maxLength={30} autoComplete="off" spellCheck="false" /></div>
              {errs.handle && <div className="err">{errs.handle}</div>}</div>
            <div className="field"><label htmlFor="bn">Name shown on the page</label><input id="bn" type="text" value={form.display_name} onChange={set('display_name')} className={errs.display_name ? 'invalid' : ''} maxLength={60} />{errs.display_name && <div className="err">{errs.display_name}</div>}</div>
            <div className="field"><label htmlFor="bb">Short bio <span className="mute">({form.bio.length}/240)</span></label><textarea id="bb" rows={3} value={form.bio} onChange={set('bio')} maxLength={240} placeholder="Who you are, in a line or two" /></div>
            <div className="field"><label>Theme</label>
              <div className="themes" role="radiogroup" aria-label="Theme">{data.themes.map((t) => (
                <button type="button" key={t.id} role="radio" aria-checked={form.theme === t.id} className={'swatch' + (form.theme === t.id ? ' on' : '')} style={{ background: t.bg }} onClick={() => setForm({ ...form, theme: t.id })} title={t.label}><span style={{ color: t.fg }}>{t.label}</span></button>))}</div></div>
            <label className="chk"><input type="checkbox" checked={form.published} onChange={set('published')} /> Published (anyone with the address can open it)</label>
          </div>

          <div className="card reveal mt" style={{ '--i': 1 }}>
            <h2>Links on your page</h2>
            {errs.items && <div className="err" style={{ marginBottom: 8 }}>{errs.items}</div>}
            {hidden > 0 && <div className="warnbox">⚠ {hidden} link{hidden === 1 ? ' is' : 's are'} switched off, expired or used up, so visitors will not see {hidden === 1 ? 'it' : 'them'} until {hidden === 1 ? 'it works' : 'they work'} again.</div>}
            {items.length ? <div className="bioitems">{items.map((i, n) => (
              <div className="bioitem" key={i.link_id}>
                <div className="order"><button type="button" className="btn ghost s" onClick={() => move(n, -1)} disabled={n === 0} aria-label="Move up"><Icon name="up2" size={14} /></button><button type="button" className="btn ghost s" onClick={() => move(n, 1)} disabled={n === items.length - 1} aria-label="Move down"><Icon name="down2" size={14} /></button></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <input type="text" value={i.label} onChange={(e) => setLabel(n, e.target.value)} maxLength={60} placeholder={i.title || `/${i.short_code}`} aria-label={`Button text for /${i.short_code}`} />
                  <div className="sm mute url" style={{ marginTop: 4 }}><span className="mono">/{i.short_code}</span> · {host(i.destination_url)} {i.effective_status !== 'active' && <Badge status={i.effective_status} />}</div>
                </div>
                <button type="button" className="btn ghost s" onClick={() => setItems(items.filter((x) => x.link_id !== i.link_id))} aria-label={`Remove /${i.short_code}`}><Icon name="trash" size={14} /></button>
              </div>))}</div> : <div className="empty sm">No links yet. Pick one below.</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <select value={pick} onChange={(e) => add(e.target.value)} style={{ flex: 1, width: 'auto' }} aria-label="Add a link" disabled={!available.length}>
                <option value="">{available.length ? '+ Add one of your links…' : data.links.length ? 'All your links are on the page' : 'You have no links yet'}</option>
                {available.map((l) => <option key={l.id} value={l.id}>/{l.short_code}{l.title ? ` · ${l.title}` : ''}{l.effective_status !== 'active' ? ` (${l.effective_status.replace('_', ' ')})` : ''}</option>)}
              </select>
              {!data.links.length && <a className="btn ghost" href="#/links/new">Create a link</a>}
            </div>
          </div>

          <div className="row mt">
            <Btn className="btn" busy={busy} type="submit">{page ? 'Save page' : 'Publish my page'}</Btn>
            {page && <button type="button" className="btn ghost danger-ghost" onClick={remove}><Icon name="trash" size={15} />Delete page</button>}
          </div>
        </form>

        <aside className="biopreview"><div className="mute sm" style={{ textAlign: 'center', marginBottom: 10 }}>Live preview</div><Preview form={form} items={items} theme={theme} /></aside>
      </div>
    </div>
  );
}
