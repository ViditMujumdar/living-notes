import { useEffect, useMemo, useRef, useState } from 'react';
import type { SolvePlan } from '../../shared/schema';
import { runPlan } from '../../shared/expr';
import { fmt } from '../../shared/experiment';
import { decodeFile, rotated, exportForUpload } from '../lib/image';
import { useConnection, svcStatus } from '../lib/connection';
import { Alert, Panel, C } from '../components/ui';
import { Markdown } from '../components/Math';
import { DiagramView } from '../components/DiagramView';

const SEED = 'ln-solve-seed';
export function setSolveSeed(image: string) { try { sessionStorage.setItem(SEED, image); } catch { /* ignore */ } }

const EXAMPLES = [
  'A simple pendulum is 1.2 m long. Find its period and frequency (g = 9.8 m/s²).',
  'How many moles of water are in 36 g of H₂O? (H = 1, O = 16)',
  'A car accelerates uniformly from rest to 20 m/s in 5 s. Find its acceleration and the distance covered.',
  'Why do leaves look green, and what role does chlorophyll play in photosynthesis?',
];
const SUBJECT_LABEL: Record<string, string> = { physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', mathematics: 'Mathematics', earth_science: 'Earth science', astronomy: 'Astronomy', computer_science: 'Computer science', other: 'Science' };

interface Result { plan: SolvePlan; model: string; provider: string; solvedAt: string }

/** Decode a data: URL locally (fetch() on data: URLs is blocked by our Content-Security-Policy). */
function dataUrlToBlob(u: string): Blob {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error('The attached photo could not be read. Please attach it again.');
  const bin = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** 1.204 × 10²⁴ style for very large/small numbers (students read this better than 1.2e+24). */
function Num({ v }: { v: number }) {
  const a = Math.abs(v);
  if (v !== 0 && (a >= 1e5 || a < 1e-3)) {
    const exp = Math.floor(Math.log10(a)); const man = v / Math.pow(10, exp);
    return <>{Number(man.toPrecision(4))} × 10<sup>{exp}</sup></>;
  }
  return <>{fmt(v, 4)}</>;
}

export default function Solve() {
  const conn = useConnection();
  const ai = svcStatus(conn.health?.ai);
  const [question, setQuestion] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const t0 = useRef(0);

  useEffect(() => { try { const s = sessionStorage.getItem(SEED); if (s) { setImage(s); sessionStorage.removeItem(SEED); } } catch { /* ignore */ } }, []);
  useEffect(() => { if (!busy) return; const id = setInterval(() => setElapsed(Math.round((Date.now() - t0.current) / 1000)), 500); return () => clearInterval(id); }, [busy]);

  const attach = async (f: File | undefined) => {
    if (!f) return; setErr(null);
    try { const img = await decodeFile(f); const p = await exportForUpload(rotated(img as any, 0), { x: 0, y: 0, w: 1, h: 1 }); setImage(p.dataUrl); }
    catch (e) { setErr((e as Error).message); }
  };

  const solve = async () => {
    if (busy) return;
    if (!image && question.trim().length < 3) { setErr('Type a question or attach a photo of one.'); return; }
    if (navigator.onLine === false) { setErr('You are offline. The solver needs a connection.'); return; }
    setBusy(true); setErr(null); setRes(null); setOverrides({}); t0.current = Date.now(); setElapsed(0);
    try {
      const fd = new FormData();
      if (question.trim()) fd.append('question', question.trim());
      if (image) fd.append('image', dataUrlToBlob(image), 'question.jpg');
      const r = await fetch('/api/solve', { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { setErr(j?.message ?? 'Could not reach the Living Notes server.'); if (j && !['ai_not_configured', 'rate_limited', 'empty', 'too_small', 'bad_type'].includes(j.code)) conn.report('ai', false, j.message); }
      else { setRes(j); conn.report('ai', true); }
    } catch (e) {
      const n = (e as Error).name;
      setErr(n === 'TimeoutError' ? 'The solver took too long. Please try again.' : n === 'TypeError' ? 'Could not reach the Living Notes server.' : (e as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false); // never leave the spinner running
    }
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
        <span className="label">Solve any science question</span>
        <h1 className="h2">Ask it, or snap it.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>Physics, chemistry, biology, maths, earth science. The AI explains the method and writes each formula; <b>Living Notes does the arithmetic itself</b> and turns every given value into a slider you can change.</p>
      </div>
      {ai === 'not_configured' && <div style={{ marginBottom: 14 }}><Alert tone="amber"><p><b>AI solver: setup required.</b> Add a Gemini key on the server to enable this.</p></Alert></div>}

      <Panel title="Your question">
        <div className="stack" style={{ gap: 12 }}>
          <label htmlFor="solve-q" className="sr-only">Science question</label>
          <textarea id="solve-q" className="text-in" style={{ minHeight: 96 }} maxLength={2000} placeholder="e.g. A ball is thrown up at 15 m/s. How high does it go?" value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) solve(); }} />
          <div className="chips" aria-label="Example questions">{EXAMPLES.map((x) => <button key={x} onClick={() => setQuestion(x)}>{x.length > 64 ? x.slice(0, 62) + '…' : x}</button>)}</div>
          {image && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <img src={image} alt="Attached question" style={{ maxHeight: 160, borderRadius: 10, border: '1px solid var(--line)' }} />
              <button className="btn btn-sm btn-ghost" onClick={() => setImage(null)}>Remove photo</button>
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={solve} disabled={busy || ai === 'not_configured'}>{busy ? `Solving… ${elapsed}s` : 'Solve'}</button>
            <label className="btn">{image ? 'Replace photo' : 'Attach a photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => attach(e.target.files?.[0])} /></label>
            <span className="muted" style={{ fontSize: 12.5 }}>Photos and text are sent to Google Gemini to be solved and are not stored.</span>
          </div>
        </div>
      </Panel>

      {err && <div style={{ marginTop: 14 }}><Alert tone="coral"><p>{err}</p>{!busy && <p><button className="linkbtn" onClick={solve}>Try again</button></p>}</Alert></div>}
      {res && <Solution res={res} overrides={overrides} setOverrides={setOverrides} />}
    </div>
  );
}

function Solution({ res, overrides, setOverrides }: { res: Result; overrides: Record<string, number | null>; setOverrides: (o: Record<string, number | null>) => void }) {
  const { plan } = res;
  const run = useMemo(() => runPlan(plan, overrides), [plan, overrides]);
  const numericAnswers = plan.answers.map((a, i) => ({ a, i })).filter(({ i }) => run.answerValues[i] != null);
  const numericGivens = plan.givens.filter((g) => (overrides[g.symbol] ?? g.value) != null);
  const [xSym, setX] = useState<string>(numericGivens[0]?.symbol ?? '');
  const [yIdx, setY] = useState<number>(numericAnswers[0]?.i ?? -1);
  const maxStep = plan.diagram ? Math.max(0, ...plan.diagram.elements.map((e) => e.step ?? 0)) : 0;
  const [diagStep, setDiagStep] = useState(maxStep); // show the complete diagram first

  if (!plan.understood) return <div style={{ marginTop: 14 }}><Alert tone="amber"><p><b>The AI could not work with this question.</b></p><p>{plan.notUnderstoodReason ?? 'Try typing the question, or a clearer photo.'}</p></Alert></div>;
  const value = (sym: string) => (sym in overrides ? overrides[sym] : plan.givens.find((g) => g.symbol === sym)?.value) ?? null;

  return (
    <div className="stack fade-in" style={{ marginTop: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row"><span className="badge lime">{SUBJECT_LABEL[plan.subject]}</span><span className="badge">{plan.topic}</span><span className="badge amber">AI-generated solution: check it</span></div>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>Method by {res.provider} · {res.model} · arithmetic by Living Notes</span>
      </div>
      <Panel title="Question"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{plan.questionText}</p></Panel>

      <div className={plan.diagram ? 'grid-2' : ''} style={{ alignItems: 'start' }}>
      {plan.diagram && <Panel title={`Diagram · ${plan.diagram.title}`}><DiagramView diagram={plan.diagram} step={diagStep} onStep={setDiagStep} maxStep={Math.min(maxStep, plan.steps.length || maxStep)} /></Panel>}
      {plan.answers.length > 0 && (
        <Panel title="Answer">
          <div className="stack" style={{ gap: 12 }}>
            {plan.answers.map((a, i) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <span className="label">{a.label}</span>
                {run.answerValues[i] != null
                  ? <span className="mono" style={{ fontSize: 30, color: 'var(--lime)' }}>{a.symbol} = <Num v={run.answerValues[i]!} /> <small style={{ fontSize: 16, color: 'var(--muted)' }}>{a.unit ?? ''}</small></span>
                  : a.textAnswer ? <div className="msg a" style={{ padding: '10px 12px' }}><Markdown md={a.textAnswer} /></div>
                    : <span className="coral" style={{ fontSize: 14 }}>{run.answerErrors[i] ? `Can’t compute yet: ${run.answerErrors[i]}` : 'No numeric answer.'}</span>}
              </div>
            ))}
            {numericAnswers.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Numbers are computed by Living Notes from the AI’s formulas below. Units are as written; the app does not check unit consistency.</p>}
          </div>
        </Panel>
      )}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {plan.givens.length > 0 && (
          <Panel title="Given values · change them">
            <div className="stack" style={{ gap: 16 }}>
              {plan.givens.map((g) => {
                const v = value(g.symbol);
                const base = g.value ?? 1;
                const lo = base > 0 ? 0 : base < 0 ? base * 3 : -10, hi = base > 0 ? base * 3 : base < 0 ? 0 : 10;
                return (
                  <div className="field" key={g.symbol}>
                    <div className="field-top">
                      <label htmlFor={`g-${g.symbol}`}><span className="sym">{g.symbol}</span>{g.name}</label>
                      <span className={`numin${v == null ? ' bad' : ''}`}>
                        <input id={`g-${g.symbol}`} inputMode="decimal" style={{ width: 150 }} value={v ?? ''} placeholder="?" aria-invalid={v == null}
                          onChange={(e) => { const t = e.target.value.trim(); const n = Number(t); setOverrides({ ...overrides, [g.symbol]: t === '' || !Number.isFinite(n) ? null : n }); }} />
                        <span className="unit">{g.unit ?? ''}</span>
                      </span>
                    </div>
                    {v != null && <input type="range" aria-label={`${g.name} slider`} min={Math.min(lo, v)} max={Math.max(hi, v)} step={Math.abs(hi - lo) / 300 || 0.01} value={v}
                      style={{ ['--p' as string]: `${((v - Math.min(lo, v)) / ((Math.max(hi, v) - Math.min(lo, v)) || 1)) * 100}%` }}
                      onChange={(e) => setOverrides({ ...overrides, [g.symbol]: Number(e.target.value) })} />}
                    <span className="muted" style={{ fontSize: 12 }}>{g.value == null ? 'Not stated in the question: enter a value.' : g.sourceText ? `from “${g.sourceText}”` : ''}</span>
                  </div>
                );
              })}
              {Object.keys(overrides).length > 0 && <button className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setOverrides({})}>Reset to the question’s values</button>}
            </div>
          </Panel>
        )}
        {numericAnswers.length > 0 && numericGivens.length > 0 && (
          <Panel title="Explore" right={<div className="row" style={{ gap: 6 }}>
            <select className="text-in" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Answer to plot" value={yIdx} onChange={(e) => setY(Number(e.target.value))}>{numericAnswers.map(({ a, i }) => <option key={i} value={i}>{a.symbol}</option>)}</select>
            <span className="muted" style={{ fontSize: 12 }}>vs</span>
            <select className="text-in" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} aria-label="Value to vary" value={xSym} onChange={(e) => setX(e.target.value)}>{numericGivens.map((g) => <option key={g.symbol} value={g.symbol}>{g.symbol}</option>)}</select>
          </div>}>
            <PlanChart plan={plan} overrides={overrides} xSym={xSym} yIdx={yIdx} />
          </Panel>
        )}
      </div>

      {plan.steps.length > 0 && (
        <Panel title="Step by step">
          <ol className="stack" style={{ gap: 14, margin: 0, paddingLeft: 20 }}>
            {plan.steps.map((s, i) => (
              <li key={i} style={plan.diagram && diagStep === i + 1 ? { background: 'var(--lime-dim)', borderRadius: 10, padding: '6px 8px', marginLeft: -8 } : undefined}>
                <b>{s.title}</b>{plan.diagram?.elements.some((e) => e.step === i + 1) && <button className="linkbtn" style={{ marginLeft: 10, fontSize: 13 }} onClick={() => setDiagStep(i + 1)}>show on diagram</button>}
                <div className="muted" style={{ fontSize: 14.5 }}><Markdown md={s.explanationMarkdown} /></div>
                {s.expression && (
                  <p className="mono" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
                    <span style={{ color: 'var(--faint)' }}>{s.target ? `${s.target} = ` : ''}{s.expression}</span>
                    {run.stepValues[i] != null ? <span className="cyan"> → <Num v={run.stepValues[i]!} /> {s.unit ?? ''}</span> : <span className="coral"> · {run.stepErrors[i]}</span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="The idea behind it"><div style={{ fontSize: 15 }}><Markdown md={plan.conceptMarkdown} /></div></Panel>
      {(plan.assumptions.length > 0 || plan.warnings.length > 0) && (
        <div className="grid-2">
          {plan.assumptions.length > 0 && <Panel title="Assumptions"><ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}>{plan.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Panel>}
          {plan.warnings.length > 0 && <Alert tone="amber">{plan.warnings.map((w) => <p key={w}>{w}</p>)}</Alert>}
        </div>
      )}
    </div>
  );
}

/** Answer vs one given value, recomputed by the app at 60 points (the AI is not called again). */
function PlanChart({ plan, overrides, xSym, yIdx }: { plan: SolvePlan; overrides: Record<string, number | null>; xSym: string; yIdx: number }) {
  const g = plan.givens.find((x) => x.symbol === xSym);
  const x0 = (xSym in overrides ? overrides[xSym] : g?.value) ?? null;
  if (!g || x0 == null || yIdx < 0) return <p className="muted">Choose values to plot.</p>;
  const lo = x0 > 0 ? x0 * 0.1 : x0 < 0 ? x0 * 3 : -10, hi = x0 > 0 ? x0 * 3 : x0 < 0 ? x0 * 0.1 : 10;
  const pts: [number, number][] = [];
  for (let k = 0; k <= 60; k++) {
    const x = lo + ((hi - lo) * k) / 60;
    const y = runPlan(plan, { ...overrides, [xSym]: x }).answerValues[yIdx];
    if (y != null) pts.push([x, y]);
  }
  const cur = runPlan(plan, overrides).answerValues[yIdx];
  if (pts.length < 2 || cur == null) return <p className="muted">This answer can’t be plotted against {xSym} over this range.</p>;
  const W = 520, H = 240, P = 40;
  const ys = pts.map((p) => p[1]); const ymin = Math.min(...ys, cur), ymax = Math.max(...ys, cur), yr = ymax - ymin || 1;
  const X = (x: number) => P + ((x - lo) / (hi - lo)) * (W - P - 12), Y = (y: number) => H - 28 - ((y - ymin) / yr) * (H - 50);
  const ans = plan.answers[yIdx]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Graph of ${ans.symbol} against ${xSym}`}>
      <line x1={P} y1={H - 28} x2={W - 12} y2={H - 28} stroke={C.line} /><line x1={P} y1={14} x2={P} y2={H - 28} stroke={C.line} />
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')} fill="none" stroke={C.cyan} strokeWidth="2" />
      <line x1={X(x0)} y1={14} x2={X(x0)} y2={H - 28} stroke={C.paper} strokeOpacity="0.35" strokeDasharray="3 4" />
      <circle cx={X(x0)} cy={Y(cur)} r="5" fill={C.lime} />
      <text x={X(x0) + 8} y={Y(cur) - 8} fill={C.lime} fontSize="12" fontFamily="JetBrains Mono, monospace">{fmt(cur, 3)} {ans.unit ?? ''}</text>
      <text x={W - 12} y={H - 8} textAnchor="end" fill={C.muted} fontSize="11" fontFamily="JetBrains Mono, monospace">{xSym} ({g.unit ?? ''}) {fmt(lo, 2)} → {fmt(hi, 2)}</text>
      <text x={6} y={12} fill={C.muted} fontSize="11" fontFamily="JetBrains Mono, monospace">{ans.symbol} ({ans.unit ?? ''})</text>
    </svg>
  );
}
