import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon, ShareMenu, useToast } from './ui.jsx';

const save = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/** Full-screen QR for projectors and phones: big, white, easy to scan from across a room. */
function QrFullscreen({ id, code, url, onClose, onDownload }) {
  const [src, setSrc] = useState('');
  const box = useRef(null);
  useEffect(() => {
    let u;
    api('GET', `/api/links/${id}/qr.svg`, undefined, { blob: true }).then((b) => { u = URL.createObjectURL(b); setSrc(u); }).catch(() => {});
    return () => u && URL.revokeObjectURL(u);
  }, [id]);
  useEffect(() => {
    const el = box.current;
    try { el?.requestFullscreen?.().catch(() => {}); } catch { /* the overlay below still fills the window */ }
    const onFs = () => { if (!document.fullscreenElement) onClose(); };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('fullscreenchange', onFs); addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs); removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [onClose]);
  return (
    <div className="qrfs" ref={box} role="dialog" aria-modal="true" aria-label={`QR code for ${url}`}>
      <div className="qrfs-bar">
        <button className="btn ghost" onClick={onDownload}><Icon name="download" size={16} />Download</button>
        <button className="btn ghost" onClick={onClose} aria-label="Close full screen"><Icon name="close" size={16} />Close</button>
      </div>
      <div className="qrfs-body">
        {src ? <img src={src} alt={`QR code for ${url}`} /> : <div className="skeleton" style={{ width: 320, height: 320 }} />}
        <div className="qrfs-url">{url.replace(/^https?:\/\//, '')}</div>
        <div className="qrfs-hint">Point a phone camera at the code · /{code}</div>
      </div>
    </div>
  );
}

/** The QR code with Download (PNG / SVG), Share and Full screen. */
export default function QrPanel({ link, alt }) {
  const toast = useToast();
  const [png, setPng] = useState(null);
  const [src, setSrc] = useState('');
  const [full, setFull] = useState(false);
  useEffect(() => {
    let u; let live = true;
    api('GET', `/api/links/${link.id}/qr.png`, undefined, { blob: true }).then((b) => { if (!live) return; u = URL.createObjectURL(b); setPng(b); setSrc(u); }).catch(() => {});
    return () => { live = false; u && URL.revokeObjectURL(u); };
  }, [link.id]);

  const name = `${link.short_code}-qr`;
  const download = async (kind) => {
    try {
      if (kind === 'png' && png) save(png, `${name}.png`);
      else save(await api('GET', `/api/links/${link.id}/qr.${kind}`, undefined, { blob: true }), `${name}.${kind}`);
    } catch (e) { toast(e.message, true); }
  };
  const file = png ? new File([png], `${name}.png`, { type: 'image/png' }) : null;
  const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const extra = [];
  if (canShareFile) extra.push({ label: 'Share QR image…', onClick: async () => { try { await navigator.share({ files: [file], title: link.title || link.short_code, text: link.short_url, url: link.short_url }); } catch (e) { if (e.name !== 'AbortError') toast('Could not share the image', true); } } });
  if (png && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) extra.push({ label: 'Copy QR image', onClick: async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); toast('QR image copied'); } catch { toast('Could not copy the image', true); } } });

  return (
    <div>
      <div className="qrbox qrframe">
        {src ? <img src={src} alt={alt || `QR code for ${link.short_url}`} /> : <div className="skeleton" style={{ width: 200, height: 200 }} />}
        <button className="qrexpand" onClick={() => setFull(true)} aria-label="View QR code full screen" title="Full screen"><Icon name="expand" size={16} /></button>
      </div>
      <div className="row qractions">
        <button className="btn ghost s" onClick={() => download('png')} disabled={!png}><Icon name="download" size={14} />PNG</button>
        <button className="btn ghost s" onClick={() => download('svg')}><Icon name="download" size={14} />SVG</button>
        <ShareMenu url={link.short_url} title={link.title || `/${link.short_code}`} text="Scan or tap this link" extra={extra} />
        <button className="btn ghost s" onClick={() => setFull(true)}><Icon name="expand" size={14} />Full screen</button>
      </div>
      {full && <QrFullscreen id={link.id} code={link.short_code} url={link.short_url} onClose={() => setFull(false)} onDownload={() => download('png')} />}
    </div>
  );
}
