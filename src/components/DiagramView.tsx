/**
 * Renders an AI-described diagram. The model only supplies validated shape data;
 * all SVG is produced here by trusted code, so nothing from the model is executed or injected.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Diagram, DiagramEl } from '../../shared/schema';
import { C } from './ui';
import { useReducedMotion } from '../lib/hooks';

const COLOR: Record<DiagramEl['color'], string> = { ink: C.paper, accent: C.lime, measure: C.cyan, warn: C.coral, muted: 'rgba(244,241,232,0.38)' };
const FONT = 'Inter, system-ui, sans-serif';
const GREEK: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', omega: 'ω', Omega: 'Ω', phi: 'φ', rho: 'ρ', sigma: 'σ', tau: 'τ', pi: 'π' };
/** "theta" → "θ", "theta_1" → "θ_1": nicer labels without trusting any markup from the model. */
const pretty = (t: string | null) => t == null ? t : t.replace(/\b(alpha|beta|gamma|delta|Delta|theta|lambda|mu|omega|Omega|phi|rho|sigma|tau|pi)\b/g, (m) => GREEK[m] ?? m);

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  let sweep = a1 - a0; if (Math.abs(sweep) > 359.9) sweep = Math.sign(sweep) * 359.9;
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a0 + sweep)), y1 = cy + r * Math.sin(rad(a0 + sweep));
  return `M${x0},${y0} A${r},${r} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${x1},${y1}`;
}

function El({ e, visible, fresh }: { e: DiagramEl; visible: boolean; fresh: boolean }) {
  const c = COLOR[e.color];
  const sw = e.kind === 'dashed' ? 0.5 : e.color === 'muted' ? 0.35 : 0.6;
  const style = { opacity: visible ? 1 : 0, transition: 'opacity .45s ease', filter: fresh ? 'drop-shadow(0 0 1.2px rgba(212,255,58,.9))' : undefined } as const;
  const label = (x: number, y: number) => e.text && e.kind !== 'text'
    ? <text x={x} y={y} fill={c} fontSize="3" fontFamily={FONT} paintOrder="stroke" stroke="#0A0F1B" strokeWidth="0.8">{pretty(e.text)}</text> : null;
  switch (e.kind) {
    case 'line': case 'arrow': case 'dashed':
      return <g style={style}>
        <line x1={e.x!} y1={e.y!} x2={e.x2!} y2={e.y2!} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeDasharray={e.kind === 'dashed' ? '1.6 1.4' : undefined} markerEnd={e.kind === 'arrow' ? `url(#dg-arrow-${e.color})` : undefined} />
        {label((e.x! + e.x2!) / 2 + 1.2, (e.y! + e.y2!) / 2 - 1.2)}
      </g>;
    case 'circle':
      return <g style={style}><circle cx={e.x!} cy={e.y!} r={e.r!} fill={e.fill ? c : 'none'} fillOpacity={e.fill ? 0.22 : 0} stroke={c} strokeWidth={sw} />{label(e.x! + e.r! + 1.2, e.y! - e.r! * 0.4)}</g>;
    case 'point':
      return <g style={style}><circle cx={e.x!} cy={e.y!} r={0.9} fill={c} />{label(e.x! + 1.6, e.y! - 1.2)}</g>;
    case 'rect':
      return <g style={style}><rect x={e.x!} y={e.y!} width={Math.abs(e.x2!)} height={Math.abs(e.y2!)} rx="0.8" fill={e.fill ? c : 'none'} fillOpacity={e.fill ? 0.18 : 0} stroke={c} strokeWidth={sw} />
        {e.text && <text x={e.x! + Math.abs(e.x2!) / 2} y={e.y! + Math.abs(e.y2!) / 2 + 1} textAnchor="middle" fill={c} fontSize="3" fontFamily={FONT}>{pretty(e.text)}</text>}</g>;
    case 'arc':
      return <g style={style}><path d={arcPath(e.x!, e.y!, e.r!, e.a0!, e.a1!)} fill="none" stroke={c} strokeWidth={sw} />{label(e.x! + (e.r! + 1.2) * Math.cos(((e.a0! + e.a1!) / 2) * Math.PI / 180), e.y! + (e.r! + 2) * Math.sin(((e.a0! + e.a1!) / 2) * Math.PI / 180))}</g>;
    case 'polyline': {
      const p = e.points!; const pts: string[] = [];
      for (let i = 0; i + 1 < p.length; i += 2) pts.push(`${p[i]},${p[i + 1]}`);
      return <g style={style}><polyline points={pts.join(' ')} fill="none" stroke={c} strokeWidth={sw} strokeLinejoin="round" />{label(p[p.length - 2]! + 1.2, p[p.length - 1]! - 1)}</g>;
    }
    case 'text':
      return <text style={style} x={e.x!} y={e.y!} fill={c} fontSize="3.2" fontFamily={FONT} fontWeight={e.color === 'accent' ? 600 : 400}>{pretty(e.text)}</text>;
  }
}

export function DiagramView({ diagram, step, onStep, maxStep }: { diagram: Diagram; step: number; onStep: (s: number) => void; maxStep: number }) {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const steps = useMemo(() => Math.max(maxStep, ...diagram.elements.map((e) => e.step ?? 0)), [diagram, maxStep]);
  useEffect(() => {
    if (!playing) return;
    if (step >= steps) { setPlaying(false); return; }
    const id = setTimeout(() => onStep(step + 1), reduced ? 0 : 1300);
    return () => clearTimeout(id);
  }, [playing, step, steps, onStep, reduced]);
  const H = diagram.height;
  const labels = diagram.elements.filter((e) => e.text).map((e) => e.text).join(', ');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', background: '#0A0F1B' }}>
        <svg viewBox={`0 0 100 ${H}`} role="img" aria-label={`${diagram.title}. ${diagram.caption ?? ''} Labels: ${labels}`}>
          <defs>
            <pattern id="dg-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="rgba(244,241,232,0.05)" strokeWidth="0.15" /></pattern>
            {(Object.keys(COLOR) as DiagramEl['color'][]).map((k) => (
              <marker key={k} id={`dg-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill={COLOR[k]} /></marker>
            ))}
          </defs>
          <rect width="100" height={H} fill="url(#dg-grid)" />
          {diagram.elements.map((e, i) => <El key={i} e={e} visible={e.step == null || e.step <= step} fresh={e.step != null && e.step === step && step > 0} />)}
        </svg>
      </div>
      {steps > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={() => { if (step >= steps) onStep(0); setPlaying((p) => !p); }}>{playing ? '❚❚ Pause' : step >= steps ? '↻ Build again' : '▶ Build it step by step'}</button>
          <div className="row" role="group" aria-label="Diagram step" style={{ gap: 4 }}>
            {Array.from({ length: steps + 1 }, (_, k) => (
              <button key={k} className="btn btn-sm" style={{ minWidth: 36, padding: 0, borderColor: k === step ? 'var(--lime)' : undefined, color: k === step ? 'var(--lime)' : undefined }} aria-pressed={k === step} onClick={() => { setPlaying(false); onStep(k); }}>{k === 0 ? 'Start' : k}</button>
            ))}
          </div>
        </div>
      )}
      {diagram.caption && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{diagram.caption}</p>}
      <p className="mono" style={{ margin: 0, fontSize: 11, color: 'var(--faint)' }}>Diagram described by AI, drawn by Living Notes. It is a sketch, not to scale.</p>
    </div>
  );
}
