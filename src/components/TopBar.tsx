import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router';
import { Logo } from './ui';
import { summary, svcStatus, useConnection, type SvcStatus } from '../lib/connection';

const SVC_TEXT: Record<SvcStatus, { tone: string; label: string }> = {
  not_configured: { tone: 'var(--amber)', label: 'Setup required' },
  unverified: { tone: 'var(--faint)', label: 'Configured, not yet verified' },
  working: { tone: 'var(--lime)', label: 'Working' },
  failing: { tone: 'var(--coral)', label: 'Unavailable' },
};

function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

export function TopBar() {
  const conn = useConnection();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = summary(conn);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', on); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc); };
  }, [open]);
  const ai = svcStatus(conn.health?.ai), se = svcStatus(conn.health?.search);
  return (
    <header className="topbar" ref={ref}>
      <Link href="/" className="brand" aria-label="Living Notes home"><Logo /> Living Notes</Link>
      <nav className="nav" aria-label="Main">
        <Link href="/new">Upload</Link>
        <Link href="/solve">Solve</Link>
        <Link href="/lab?example=circuit-mixed">Lab</Link>
        <Link href="/saved">Saved</Link>
      </nav>
      <span className="spacer" />
      <button className="conn" data-tone={s.tone} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <span className="dot" aria-hidden="true" /> <span className="txt">{s.text}</span>
      </button>
      {open && (
        <div className="panel popover fade-in" role="dialog" aria-label="Connection status">
          <span className="label">Connection status</span>
          <div className="svc"><span className="dot" style={{ color: conn.browserOnline ? 'var(--lime)' : 'var(--coral)' }} /><div><b>Browser</b>: {conn.browserOnline ? 'online' : 'offline'}<p>Being online does not prove the services below work.</p></div></div>
          <div className="svc"><span className="dot" style={{ color: conn.backend === 'ok' ? 'var(--lime)' : conn.backend === 'down' ? 'var(--coral)' : 'var(--faint)' }} /><div><b>Living Notes server</b>: {conn.backend === 'ok' ? 'reachable' : conn.backend === 'down' ? 'unreachable' : 'checking…'}{conn.health && <p>Shared links stored in {conn.health.storage === 'sqlite' ? 'SQLite' : 'a JSON file'}.</p>}</div></div>
          {conn.health && (<>
            <div className="svc"><span className="dot" style={{ color: SVC_TEXT[ai].tone }} /><div><b>AI ({conn.health.ai.provider}{conn.health.ai.model ? ` · ${conn.health.ai.model}` : ''})</b>: {SVC_TEXT[ai].label}
              <p>{ai === 'not_configured' ? 'Add GEMINI_API_KEY on the server to enable diagram reading and the tutor.' : ai === 'failing' ? conn.health.ai.lastError?.message : conn.health.ai.lastOkAt ? `Last successful request ${ago(conn.health.ai.lastOkAt)}.` : 'No request has succeeded yet in this server session.'}</p></div></div>
            <div className="svc"><span className="dot" style={{ color: SVC_TEXT[se].tone }} /><div><b>Web search ({conn.health.search.provider})</b>: {SVC_TEXT[se].label}
              <p>{se === 'not_configured' ? 'Add BRAVE_SEARCH_API_KEY on the server to enable source search.' : se === 'failing' ? conn.health.search.lastError?.message : conn.health.search.lastOkAt ? `Last successful request ${ago(conn.health.search.lastOkAt)}.` : 'No request has succeeded yet in this server session.'}</p></div></div>
          </>)}
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Simulations run entirely in your browser and keep working without any connection.</p>
          <div className="row">
            <button className="btn btn-sm" onClick={() => conn.probe()} disabled={conn.checking || !conn.browserOnline}>{conn.checking ? 'Checking…' : 'Test connections now'}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => conn.refresh()}>Refresh</button>
          </div>
        </div>
      )}
    </header>
  );
}
