import { useState } from 'react';
import { get, TZ } from '../api.js';
import { AreaChart, Donut } from '../charts.jsx';
import { Badge, Bars, ErrorBox, Icon, PageSkeleton, RangeTabs, Skeleton, Stat, fmt, useAsync } from '../ui.jsx';

export function InsightsCard({ link, campaign, days = 30 }) {
  const q = `/api/ai/insights?days=${days}&tz=${TZ}${link ? `&link=${link}` : ''}${campaign ? `&campaign=${campaign}` : ''}`;
  const { loading, data, error } = useAsync(() => get(q), [q]);
  return (
    <div className="card aicard reveal" style={{ '--i': 4 }}>
      <div className="aihead">
        <span className="sparkle"><Icon name="spark" size={16} /></span>
        <h2 style={{ margin: 0 }}>Smart insights</h2>
        {data && <span className="badge ai" title={data.summary_by === 'gemini' ? 'Written by Gemini' : 'Calculated from your click data'}>{data.summary_by === 'gemini' ? 'Gemini' : 'auto'}</span>}
      </div>
      {loading && <><Skeleton h={54} /><div style={{ height: 10 }} /><Skeleton h={44} /><div style={{ height: 10 }} /><Skeleton h={44} /></>}
      {error && <div className="mute sm">Insights are unavailable right now.</div>}
      {data && <>
        {data.summary && <p className="summary">{data.summary}</p>}
        {data.insights.map((it, i) => (
          <div className={'insight ' + it.kind} style={{ '--i': i }} key={it.title}>
            <span className="ic"><Icon name={it.icon} size={17} /></span>
            <div><b>{it.title}</b><span className="mute sm">{it.text}</span></div>
          </div>))}
      </>}
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [campaign, setCampaign] = useState('');
  const q = `?days=${days}&tz=${TZ}${campaign ? '&campaign=' + campaign : ''}`;
  const { loading, data, error, reload } = useAsync(async () => {
    const [d, c] = await Promise.all([get('/api/analytics/summary' + q), get('/api/campaigns')]);
    return { d, camps: c.campaigns };
  }, [q]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { d, camps } = data;
  const clicks = d.series.map((x) => x.clicks);
  const vis = d.series.map((x) => x.visitors);

  return (
    <div className="page" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <div className="head">
        <div><h1>Dashboard</h1><p className="mute">Real visits only. Bots and link previews are filtered out.</p></div>
        <div className="row">
          <select style={{ width: 'auto' }} value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign filter">
            <option value="">All campaigns</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <a className="btn" href="#/links/new"><Icon name="plus" size={16} />New link</a>
        </div>
      </div>
      <RangeTabs days={days} onChange={setDays} />
      <div className="grid g4">
        <Stat i={0} icon="bolt" label="Clicks" value={d.totals.clicks} series={clicks} />
        <Stat i={1} icon="users" label="Unique visitors" value={d.totals.visitors} series={vis} />
        <Stat i={2} icon="qr" label="QR scans" value={d.totals.qr_scans} />
        <Stat i={3} icon="shield" label="Bot hits filtered" value={d.totals.bots_filtered} />
      </div>

      <div className="grid gmain mt">
        <div className="card reveal" style={{ '--i': 2 }}><h2>Clicks over time</h2><AreaChart series={d.series} /></div>
        <InsightsCard campaign={campaign} days={days} />
      </div>

      <div className="grid g2 mt">
        <div className="card reveal" style={{ '--i': 3 }}>
          <h2>Top links</h2>
          {d.top_links.length ? d.top_links.map((l) => (
            <a key={l.id} href={`#/links/${l.id}`} className="linkrow" style={{ gridTemplateColumns: '1fr auto auto', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ minWidth: 0 }}><span className="code mono">/{l.short_code}</span><span className="url sm mute">{l.title || l.destination_url}</span></div>
              <Badge status={l.effective_status} /><b>{fmt(l.clicks)}</b>
            </a>)) : <div className="empty">No clicks in this period yet.</div>}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card reveal" style={{ '--i': 4 }}>
            <h2>Needs attention</h2>
            {d.alerts.length ? d.alerts.map((a, i) => (
              <a key={i} href={`#/links/${a.link_id}`} className={'insight ' + (a.severity === 'high' ? 'warn' : a.severity === 'medium' ? 'tip' : '')} style={{ '--i': i, color: 'inherit', textDecoration: 'none' }}>
                <span className="ic"><Icon name={a.type === 'spike' ? 'up' : a.type === 'expiring' ? 'hourglass' : 'bolt'} size={16} /></span>
                <div><b className="mono">/{a.short_code}</b><span className="mute sm">{a.message}</span></div>
              </a>)) : <div className="empty sm">Nothing needs your attention.</div>}
          </div>
          <div className="card reveal" style={{ '--i': 5 }}>
            <h2>Campaigns</h2>
            {d.campaigns.length ? <Bars rows={d.campaigns.map((c) => ({ label: c.name, clicks: c.clicks }))} /> : <div className="empty sm">No campaigns yet.</div>}
          </div>
        </div>
      </div>

      <div className="grid g3 mt">
        <div className="card reveal" style={{ '--i': 5 }}><h2>Where visitors come from</h2><Bars rows={d.traffic.referrers} /></div>
        <div className="card reveal" style={{ '--i': 6 }}><h2>Devices</h2><Donut rows={d.traffic.devices} /><hr className="sep" /><Bars rows={d.traffic.browsers} /></div>
        <div className="card reveal" style={{ '--i': 7 }}><h2>Countries</h2><Bars rows={d.traffic.countries} /><p className="hint">Country comes from the hosting provider's header. “Unknown” means none was sent.</p></div>
      </div>

      <div className="card mt reveal" style={{ '--i': 8 }}>
        <h2>Your links</h2>
        <div className="row" style={{ gap: 24 }}>
          {[['total', 'Total'], ['active', 'Active'], ['expired', 'Expired'], ['disabled', 'Disabled'], ['limit_reached', 'Limit reached']].map(([k, l]) => <span key={k}><b style={{ fontSize: 22 }}>{d.links[k]}</b> <span className="mute">{l}</span></span>)}
        </div>
      </div>
    </div>
  );
}
