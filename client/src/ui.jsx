import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

// ---------------------------------------------------------------- icons (24x24 stroke paths)
const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 20h16',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  up: 'M4 16l6-6 4 4 6-7M14 7h6v6',
  down: 'M4 8l6 6 4-4 6 7M14 17h6v-6',
  flat: 'M4 12h16M16 8l4 4-4 4',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h.01',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9',
  info: 'M12 8h.01M11 12h1v5h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  chat: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.3A8 8 0 1 1 21 12z',
  send: 'M5 12l15-8-6 17-3-7z',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  copy: 'M8 8h11v13H8zM5 16H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
  check: 'M5 13l4 4L19 7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
};
export function Icon({ name, size = 18, stroke = 2 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] || P.info} /></svg>;
}
export const Logo = () => <svg width="20" height="20" viewBox="0 0 32 32"><path d="M3 17h6l3-9 5 17 3-8h9" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// ---------------------------------------------------------------- formatting
const nf = new Intl.NumberFormat();
export const fmt = (n) => nf.format(Math.round(n || 0));
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now'; if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h ago`; return `${Math.floor(ms / 86400_000)} d ago`;
}
export const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

// ---------------------------------------------------------------- hooks
export function useAsync(fn, deps) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn(ac.signal).then((data) => live && set({ loading: false, data, error: null }), (error) => { if (live && error.name !== 'AbortError') set({ loading: false, data: null, error }); });
    return () => { live = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}
export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------- theme
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    let saved = null;
    try { saved = localStorage.getItem('lp_theme'); } catch { /* ignore */ }
    return saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('lp_theme', theme); } catch { /* ignore */ } }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, error) => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, error }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={'toast' + (t.error ? ' error' : '')}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export async function copyText(text, toast) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast('Copied to clipboard');
}

// ---------------------------------------------------------------- small components
export function Badge({ status, children, kind }) {
  const label = children ?? ({ limit_reached: 'limit reached' }[status] || status);
  return <span className={'badge ' + (kind || status)}>{label}</span>;
}
export function Skeleton({ h = 20, w = '100%', style }) { return <div className="skeleton" style={{ height: h, width: w, ...style }} />; }
export function PageSkeleton() {
  return (
    <div className="page">
      <Skeleton h={34} w="240px" /><div style={{ height: 22 }} />
      <div className="grid g4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={104} style={{ borderRadius: 18 }} />)}</div>
      <div className="grid gmain mt"><Skeleton h={300} style={{ borderRadius: 18 }} /><Skeleton h={300} style={{ borderRadius: 18 }} /></div>
    </div>
  );
}
export function ErrorBox({ error, retry }) {
  return <div className="card empty"><p>{error.message}</p>{retry && <button className="btn ghost s" onClick={retry}>Try again</button>}</div>;
}

/** Counts up to a number when it first appears. */
export function CountUp({ value, ms = 900 }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return undefined; }
    const start = performance.now(); const a = from.current; let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      setN(a + (value - a) * (1 - (1 - t) ** 4));
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{fmt(n)}</>;
}

export function Stat({ icon, label, value, series, i = 0 }) {
  return (
    <div className="card stat lift reveal" style={{ '--i': i }}>
      <div className="k"><span className="ico"><Icon name={icon} size={16} /></span>{label}</div>
      <div className="v"><CountUp value={value} /></div>
      {series && <Spark data={series} />}
    </div>
  );
}
export function Spark({ data, w = 84, h = 30 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return <svg className="spark" width={w} height={h} aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--acc)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Horizontal bars that grow in after mount. */
export function Bars({ rows, empty = 'No data yet', fmtLabel }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setGo(true)); return () => cancelAnimationFrame(t); }, []);
  if (!rows || !rows.length) return <div className="empty sm">{empty}</div>;
  const key = rows[0].clicks !== undefined ? 'clicks' : 'value';
  const max = Math.max(1, ...rows.map((r) => r[key]));
  return (
    <div>{rows.map((r, i) => (
      <div className="rowbar" key={r.label + i}>
        <span title={r.label}>{fmtLabel ? fmtLabel(r.label) : r.label}</span>
        <div className="bar"><i style={{ width: go ? `${Math.max(3, (r[key] / max) * 100)}%` : 0, transitionDelay: `${i * 70}ms` }} /></div>
        <b>{fmt(r[key])}</b>
      </div>))}
    </div>
  );
}

export function Tabs({ options, value, onChange }) {
  return <div className="tabs" role="tablist">{options.map(([v, label]) => <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}</div>;
}

export function Modal({ title, children, onClose }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{children}</div></div>;
}

export function Btn({ busy, children, ...rest }) {
  return <button {...rest} disabled={rest.disabled || busy}>{busy && <span className="spinner" />}{children}</button>;
}

export function Confetti() {
  const colors = ['#0e8fd0', '#8b5cf6', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e'];
  const bits = Array.from({ length: 46 }, (_, i) => ({ left: (i * 37) % 100, delay: ((i * 53) % 90) / 100, color: colors[i % colors.length], rot: (i * 47) % 360 }));
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), 3200); return () => clearTimeout(t); }, []);
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return <div className="confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ left: `${b.left}%`, background: b.color, animationDelay: `${b.delay}s`, transform: `rotate(${b.rot}deg)` }} />)}</div>;
}

export function RangeTabs({ days, onChange }) {
  return <Tabs value={days} onChange={onChange} options={[[7, '7 days'], [30, '30 days'], [90, '90 days']]} />;
}
