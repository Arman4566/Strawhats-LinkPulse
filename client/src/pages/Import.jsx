import { useState } from 'react';
import { post } from '../api.js';
import { Btn, useToast } from '../ui.jsx';

const SAMPLE = 'destination_url,alias,campaign,tags,expires_at,click_limit,title\nhttps://example.com/menu,,Cafe Menu,qr;menu,,,Table menu\nhttps://example.com/offer,weekend-deal,Cafe Menu,offer,,200,Weekend offer\nnot a url,,,,,,Broken row\n';

export default function Import() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(dry, body = text) {
    if (!body.trim()) { toast('Paste CSV text or choose a file first', true); return; }
    setBusy(true); setFatal('');
    try { setRes({ ...(await post(`/api/links/import${dry ? '?dryRun=1' : ''}`, body, { raw: true })), dry }); }
    catch (e) { setRes(null); setFatal(e.message); } finally { setBusy(false); }
  }
  const pick = async (e) => { const f = e.target.files[0]; if (f) { const t = await f.text(); setText(t); run(true, t); } };
  const sm = res?.summary;
  const cls = (s) => (s === 'valid' || s === 'imported' ? 'active' : s === 'duplicate' ? 'expired' : 'disabled');
  return (
    <div className="page">
      <div className="head"><div><h1>Bulk import</h1><p className="mute">Paste or upload a CSV. You see every problem before anything is saved.</p></div></div>
      <div className="card">
        <p className="sm mute" style={{ marginTop: 0 }}>Columns: <b>destination_url</b> (required), alias, campaign, tags (separate with ; or ,), expires_at, click_limit, password, title. Up to 1000 rows.</p>
        <div className="field"><input type="file" accept=".csv,text/csv" onChange={pick} aria-label="CSV file" /></div>
        <textarea rows={8} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} aria-label="CSV text" />
        <div className="row" style={{ margin: '14px 0' }}>
          <Btn className="btn" busy={busy} onClick={() => run(true)}>Preview &amp; validate</Btn>
          <button className="btn ghost" onClick={() => setText(SAMPLE)}>Fill sample data</button>
        </div>
        {fatal && <div className="badbox">{fatal}</div>}
        {res && <div className="slide">
          <div className="okbox">{res.dry ? `Preview: ${sm.valid} ready to import, ${sm.duplicates} duplicates, ${sm.errors} with errors (of ${sm.total} rows). Nothing has been saved yet.` : `Imported ${res.imported} links. ${sm.errors} rows had errors.`}</div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr>{['Row', 'Destination', 'Alias', 'Result'].map((t) => <th key={t} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mute)', fontSize: 12 }}>{t}</th>)}</tr></thead>
            <tbody>{res.rows.map((x, i) => (
              <tr key={x.row} style={{ borderTop: '1px solid var(--line)', animation: `rise .4s ${Math.min(i, 12) * 40}ms var(--ease) both` }}>
                <td style={{ padding: '9px 8px' }}>{x.row}</td><td style={{ padding: '9px 8px', maxWidth: 280 }}><span className="url sm">{x.input.destination_url || '—'}</span></td><td className="mono sm" style={{ padding: '9px 8px' }}>{x.input.alias || 'auto'}</td>
                <td style={{ padding: '9px 8px' }}><span className={'badge ' + cls(x.status)}>{x.status}</span> <span className="sm mute">{(x.messages || []).join('; ')}</span></td></tr>))}</tbody></table></div>
          <div style={{ marginTop: 14 }}>
            {res.dry && sm.valid > 0 && <Btn className="btn" busy={busy} onClick={() => run(false)}>Import {sm.valid} valid link{sm.valid === 1 ? '' : 's'}</Btn>}
            {!res.dry && <a className="btn" href="#/links">View my links</a>}
          </div>
        </div>}
      </div>
    </div>
  );
}
