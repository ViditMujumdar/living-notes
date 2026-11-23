/**
 * Honest connection state. Browser "online" is not proof that AI/search work:
 * a service only counts as working after a real request to it succeeded.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Health, type ServiceHealth } from './api';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export interface ConnState {
  browserOnline: boolean;
  backend: 'unknown' | 'ok' | 'down';
  health: Health | null;
  checking: boolean;
  refresh: () => Promise<void>;
  probe: () => Promise<void>;
  /** Called by features after a real request, to keep status honest without polling the provider. */
  report: (svc: 'ai' | 'search', ok: boolean, message?: string) => void;
}

const Ctx = createContext<ConnState | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [browserOnline, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [backend, setBackend] = useState<ConnState['backend']>('unknown');
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api.health();
    if (r.ok) { setBackend('ok'); setHealth(r.data); } else setBackend(r.error.code === 'offline' ? 'unknown' : 'down');
  }, []);

  const probe = useCallback(async () => {
    setChecking(true);
    const r = await api.probe();
    if (r.ok) setHealth((h) => (h ? { ...h, ai: r.data.ai, search: r.data.search } : h));
    await refresh();
    setChecking(false);
  }, [refresh]);

  const report = useCallback((svc: 'ai' | 'search', ok: boolean, message?: string) => {
    setHealth((h) => {
      if (!h) return h;
      const now = new Date().toISOString();
      const s: ServiceHealth = ok ? { ...h[svc], lastOkAt: now, lastError: null } : { ...h[svc], lastError: { at: now, kind: 'error', message: message || 'Request failed' } };
      return { ...h, [svc]: s };
    });
  }, []);

  useEffect(() => {
    refresh();
    const on = () => { setOnline(true); refresh(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const iv = setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(iv); };
  }, [refresh]);

  const value = useMemo(() => ({ browserOnline, backend, health, checking, refresh, probe, report }), [browserOnline, backend, health, checking, refresh, probe, report]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ConnectionProvider missing');
  return c;
}

export type SvcStatus = 'not_configured' | 'unverified' | 'working' | 'failing';
export function svcStatus(s: ServiceHealth | undefined): SvcStatus {
  if (!s || !s.configured) return 'not_configured';
  if (s.lastError && (!s.lastOkAt || s.lastError.at > s.lastOkAt)) return 'failing';
  if (s.lastOkAt) return 'working';
  return 'unverified';
}

/** One summary line for the header chip. */
export function summary(c: ConnState): { tone: Tone; text: string } {
  if (!c.browserOnline) return { tone: 'bad', text: 'Offline' };
  if (c.backend === 'down') return { tone: 'bad', text: 'Server unreachable' };
  if (c.backend === 'unknown' || !c.health) return { tone: 'idle', text: 'Connecting…' };
  const ai = svcStatus(c.health.ai), se = svcStatus(c.health.search);
  if (ai === 'working' && se === 'working') return { tone: 'ok', text: 'Fully connected' };
  if (ai === 'failing') return { tone: 'bad', text: 'AI unavailable' };
  if (se === 'failing') return { tone: 'warn', text: 'Search unavailable' };
  if (ai === 'not_configured' && se === 'not_configured') return { tone: 'warn', text: 'AI & search: setup needed' };
  const word = { working: 'ok', unverified: 'not verified', not_configured: 'setup needed', failing: 'unavailable' } as const;
  const tone: Tone = ai === 'not_configured' || se === 'not_configured' ? 'warn' : 'idle';
  return { tone, text: `AI ${word[ai]} · Search ${word[se]}` };
}
