import { useEffect, useRef, useState } from 'react';
import { post, TZ } from '../api.js';
import { AreaChart, Donut } from '../charts.jsx';
import { Bars, Btn, CountUp, Icon, useToast } from '../ui.jsx';

const IDEAS = [
  'Clicks from mobile last week', 'Top links this month', 'Which country visits us most?', 'QR scans by day last 14 days',
  'Unique visitors on Chrome yesterday', 'What time is our peak?', 'Clicks by campaign', 'Where do visitors come from?',
];

function Result({ r }) {
  if (!r.understood) return <div className="card answer"><div className="row"><span className="sparkle"><Icon name="chat" size={15} /></span><p style={{ margin: 0 }}>{r.answer}</p></div></div>;
  const rows = r.rows || [];
  const series = r.chart === 'line' ? rows.map((x) => ({ day: x.label, clicks: x.value, visitors: x.value })) : null;
  return (
    <div className="card answer">
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="sparkle"><Icon name="spark" size={15} /></span>
        {r.interpreted.filters.map((f) => <span key={f} className="badge ai">{f}</span>)}
        <span className="badge">{r.interpreted.period}</span>{r.by === 'gemini' && <span className="badge ai" title="Understood by Gemini">Gemini</span>}
      </div>
      {r.number !== undefined && <div className="bigno gradtext"><CountUp value={r.number} /> <span style={{ fontSize: 18, WebkitTextFillColor: 'var(--mute)' }}>{r.interpreted.metric}</span></div>}
      {r.number === undefined && <p style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>{r.answer}</p>}
      {series && series.length > 1 && <AreaChart series={series} height={200} />}
      {!series && rows.length > 0 && <div className="grid g2" style={{ alignItems: 'center' }}><Bars rows={rows} />{rows.length <= 6 && <Donut rows={rows} />}</div>}
    </div>
  );
}

export default function Assistant() {
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [log, busy]);

  async function ask(text) {
    const question = (text ?? q).trim();
    if (question.length < 3 || busy) return;
    setQ(''); setBusy(true);
    setLog((l) => [...l, { who: 'me', text: question }]);
    try {
      const [r] = await Promise.all([post('/api/ai/ask', { question, tz: TZ }), new Promise((ok) => setTimeout(ok, 450))]);
      setLog((l) => [...l, { who: 'ai', r }]);
    } catch (e) { toast(e.message, true); }
    finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="head"><div><h1>Ask <span className="gradtext">AI</span></h1><p className="mute">Ask about your links in plain English. Answers come straight from your click data.</p></div></div>
      {!log.length && (
        <div className="card reveal" style={{ marginBottom: 18 }}>
          <h2>Try one of these</h2>
          <div className="chips">{IDEAS.map((t) => <button key={t} className="chip" onClick={() => ask(t)}>{t}</button>)}</div>
          <p className="hint">You can mix filters: device, browser, country, referrer, campaign, a link such as /fest-reg, and a time like “yesterday” or “last 14 days”.</p>
        </div>)}
      <div className="grid" style={{ marginBottom: 18 }}>
        {log.map((m, i) => m.who === 'me'
          ? <div key={i} className="answer" style={{ justifySelf: 'end', maxWidth: '80%' }}><div className="badge" style={{ padding: '10px 16px', fontSize: 14, background: 'var(--grad)', color: '#fff' }}>{m.text}</div></div>
          : <Result key={i} r={m.r} />)}
        {busy && <div className="card typing" style={{ width: 90 }}><span /><span /><span /></div>}
        <div ref={end} />
      </div>
      <form className="ask" style={{ position: 'sticky', bottom: 84 }} onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. clicks from Instagram last week" aria-label="Your question" maxLength={300} />
        <Btn className="btn" busy={busy} type="submit" aria-label="Ask"><Icon name="send" size={16} />Ask</Btn>
      </form>
      {log.length > 0 && <div className="chips" style={{ marginTop: 12 }}>{IDEAS.slice(0, 5).map((t) => <button key={t} className="chip" onClick={() => ask(t)}>{t}</button>)}</div>}
    </div>
  );
}
