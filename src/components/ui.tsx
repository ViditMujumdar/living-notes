import { useEffect, useId, useState, type ReactNode } from 'react';

export const C = {
  ink: '#090D16', ink1: '#0D1220', paper: '#F4F1E8', lime: '#D4FF3A', cyan: '#4FE3F0', coral: '#FF7A66', amber: '#FFC857',
  muted: 'rgba(244,241,232,0.62)', faint: 'rgba(244,241,232,0.38)', grid: 'rgba(244,241,232,0.07)', line: 'rgba(244,241,232,0.18)',
};

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke={C.line} />
      <path d="M6 22 Q 12 6 16 15 T 26 11" fill="none" stroke={C.lime} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="26" cy="11" r="2.6" fill={C.cyan} />
    </svg>
  );
}

/** Slider + accessible numeric input for one physical parameter. */
export function ParamField(props: {
  id?: string; label: string; symbol: string; unit: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => string | null; // returns an error message or null
  disabled?: boolean; hint?: string;
}) {
  const uid = useId();
  const id = props.id ?? uid;
  const [text, setText] = useState(String(props.value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(trim(props.value)); setErr(null); }, [props.value]);
  const lo = Math.min(props.min, props.value), hi = Math.max(props.max, props.value);
  const pct = hi > lo ? ((props.value - lo) / (hi - lo)) * 100 : 0;
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(v)) { setErr('Enter a number.'); return; }
    setErr(props.onChange(v));
  };
  return (
    <div className="field">
      <div className="field-top">
        <label htmlFor={`${id}-n`}><span className="sym">{props.symbol}</span>{props.label}</label>
        <span className={`numin${err ? ' bad' : ''}`}>
          <input id={`${id}-n`} inputMode="decimal" value={text} disabled={props.disabled} aria-invalid={Boolean(err)} aria-describedby={err ? `${id}-e` : undefined}
            onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
          <span className="unit">{props.unit}</span>
        </span>
      </div>
      <input type="range" aria-label={`${props.label} slider`} min={lo} max={hi} step={props.step} value={props.value} disabled={props.disabled}
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => { const msg = props.onChange(Number(e.target.value)); setErr(msg); }} />
      {err && <p className="field-err" id={`${id}-e`} role="alert">{err}</p>}
      {props.hint && !err && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{props.hint}</p>}
    </div>
  );
}
const trim = (v: number) => String(Number(v.toPrecision(6)));

export function Panel({ title, right, children, className = '', pad = true, ticks = false, id }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; ticks?: boolean; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {ticks && <span className="ticks" aria-hidden="true" />}
      {title && <div className="panel-head"><span className="label">{title}</span>{right}</div>}
      <div className={pad ? 'panel-pad' : ''}>{children}</div>
    </section>
  );
}

export function Fold({ title, children, open, right }: { title: ReactNode; children: ReactNode; open?: boolean; right?: ReactNode }) {
  return (
    <details className="panel fold" open={open}>
      <summary><span className="label">{title}</span>{right}</summary>
      <div className="panel-pad">{children}</div>
    </details>
  );
}

export function Readout({ k, v, unit, hl }: { k: string; v: string; unit?: string; hl?: boolean }) {
  return <div className={`readout${hl ? ' hl' : ''}`}><span className="k">{k}</span><span className="v">{v}{unit && <small>{unit}</small>}</span></div>;
}

export function Alert({ tone = 'cyan', icon, children }: { tone?: 'cyan' | 'coral' | 'amber' | 'plain'; icon?: string; children: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === 'coral' ? 'alert' : undefined}><span className="alert-ico" aria-hidden="true">{icon ?? (tone === 'coral' ? '!' : tone === 'amber' ? '△' : 'i')}</span><div>{children}</div></div>;
}

let toastTimer = 0;
export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('ln-toast', { detail: msg }));
}
export function Toaster() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => { setM((e as CustomEvent).detail); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => setM(null), 3200); };
    window.addEventListener('ln-toast', on);
    return () => window.removeEventListener('ln-toast', on);
  }, []);
  return m ? <div className="toast" role="status" aria-live="polite">{m}</div> : <div className="sr-only" role="status" aria-live="polite" />;
}

export const Icon = {
  diagram: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 15l3-4 3 3 2-2 3 4" /></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5h16v11H9l-5 4z" /></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16" /></svg>,
};
