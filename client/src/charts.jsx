import { useRef, useState } from 'react';

/** Area + line chart with a draw-in animation and a hover read-out. Series items: { day, clicks, visitors }. */
export function AreaChart({ series, height = 240 }) {
  const W = 760; const H = height; const pad = { l: 40, r: 14, t: 16, b: 28 };
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const max = Math.max(4, ...series.map((d) => d.clicks));
  const top = Math.ceil(max / 4) * 4;
  const x = (i) => pad.l + (series.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (series.length - 1));
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const line = series.map((d, i) => `${x(i).toFixed(1)},${y(d.clicks).toFixed(1)}`);
  const vis = series.map((d, i) => `${x(i).toFixed(1)},${y(d.visitors).toFixed(1)}`);
  const step = Math.ceil(series.length / 7);
  const len = Math.round((W - pad.l - pad.r) * 1.6);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1)))));
  };
  const d = hover === null ? null : series[hover];
  return (
    <div>
      <div className="legend"><span><i style={{ background: 'var(--acc)' }} />Clicks</span><span><i style={{ background: 'var(--mute)', opacity: 0.6 }} />Unique visitors</span></div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Clicks per day" onMouseMove={move} onMouseLeave={() => setHover(null)} onTouchMove={(e) => move(e.touches[0])} style={{ touchAction: 'pan-y', display: 'block' }}>
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0e8fd0" stopOpacity=".38" /><stop offset="1" stopColor="#8b5cf6" stopOpacity="0" /></linearGradient>
          <linearGradient id="lg" x1="0" x2="1"><stop offset="0" stopColor="#0e8fd0" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => { const v = (top / 4) * i; return <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{Math.round(v)}</text></g>; })}
        {series.map((s, i) => (i % step === 0 || i === series.length - 1) && <text key={s.day} x={x(i)} y={H - 7} textAnchor="middle" fontSize="11" fill="var(--mute)">{s.day.slice(5)}</text>)}
        <path className="areafade" d={`M${x(0)},${y(0)} L${line.join(' L')} L${x(series.length - 1)},${y(0)} Z`} fill="url(#ag)" />
        <polyline className="draw" style={{ '--len': len, animationDelay: '.15s' }} points={vis.join(' ')} fill="none" stroke="var(--mute)" strokeWidth="1.6" strokeDasharray="5 4" opacity=".55" />
        <polyline className="draw" style={{ '--len': len * 1.4 }} points={line.join(' ')} fill="none" stroke="url(#lg)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {d && <g><line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--acc)" strokeOpacity=".35" /><circle cx={x(hover)} cy={y(d.clicks)} r="5.5" fill="var(--acc)" stroke="var(--card-solid)" strokeWidth="2.5" /></g>}
      </svg>
      <div className="sm mute" style={{ minHeight: 20, marginTop: 4 }}>{d ? <><b style={{ color: 'var(--ink)' }}>{d.day}</b> · {d.clicks} clicks · {d.visitors} visitors</> : 'Hover or touch the chart for daily numbers'}</div>
    </div>
  );
}

/** Donut for a small set of parts, drawn in with a stroke animation. rows: [{label, clicks|value}] */
export function Donut({ rows, size = 150 }) {
  if (!rows || !rows.length) return <div className="empty sm">No data yet</div>;
  const key = rows[0].clicks !== undefined ? 'clicks' : 'value';
  const total = rows.reduce((a, r) => a + r[key], 0) || 1;
  const colors = ['#0e8fd0', '#8b5cf6', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e'];
  const R = 52; const C = 2 * Math.PI * R; let acc = 0;
  return (
    <div className="row" style={{ gap: 20, flexWrap: 'nowrap' }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Share breakdown" style={{ flex: 'none' }}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg2)" strokeWidth="18" />
        {rows.slice(0, 6).map((r, i) => {
          const frac = r[key] / total; const dash = Math.max(0, frac * C - 2); const off = -acc * C; acc += frac;
          return <circle key={r.label} cx="70" cy="70" r={R} fill="none" stroke={colors[i % colors.length]} strokeWidth="18" strokeDasharray={`${dash} ${C}`} strokeDashoffset={off} transform="rotate(-90 70 70)" style={{ animation: `draw 1.2s ${i * 0.12}s var(--ease) both`, '--len': C }} />;
        })}
        <text x="70" y="75" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">{rows.length > 0 ? `${Math.round((rows[0][key] / total) * 100)}%` : ''}</text>
      </svg>
      <div style={{ minWidth: 0, fontSize: 13 }}>
        {rows.slice(0, 6).map((r, i) => <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length], flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span><b style={{ marginLeft: 'auto' }}>{Math.round((r[key] / total) * 100)}%</b></div>)}
      </div>
    </div>
  );
}
