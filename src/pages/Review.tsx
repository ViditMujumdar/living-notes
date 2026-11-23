import { useMemo, useState } from 'react';
import type { ExperimentConfig, Interpretation } from '../../shared/schema';
import { draftFromInterpretation, emptyDraft, configFromDraft, TITLES, type Draft, type DraftField, fmt } from '../../shared/experiment';
import { TOPOLOGY_LABEL, type Topology } from '../../shared/physics/circuit';
import { getPending } from '../lib/flow';
import { navigate, Link, useLocation } from '../lib/router';
import { saveCurrent, newId, type LabDoc } from '../lib/docs';
import { setSolveSeed } from './Solve';
import { Alert, Panel, C } from '../components/ui';

type Origin = DraftField['origin'] | 'edited';
const ORIGIN: Record<Origin, { text: string; cls: string }> = {
  diagram: { text: 'Read from diagram', cls: 'cyan' },
  inferred: { text: 'Inferred: please check', cls: 'amber' },
  missing: { text: 'Missing: enter a value', cls: 'coral' },
  default: { text: 'Default', cls: '' },
  edited: { text: 'Edited by you', cls: 'lime' },
};
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

function foundSentence(i: Interpretation): string {
  const count = (k: string[]) => i.components.filter((c) => k.includes(c.kind)).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => { if (n) parts.push(n === 1 ? `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}` : `${NUM[n] ?? n} ${many}`); };
  if (i.experimentType === 'circuit') { add(count(['battery', 'cell']), 'battery', 'batteries'); add(Math.max(count(['resistor']), i.circuit?.resistors.length ?? 0), 'resistor', 'resistors'); }
  if (i.experimentType === 'lens') { add(count(['lens']), 'convex lens', 'lenses'); add(count(['object']), 'object', 'objects'); add(count(['focal_point']), 'focal point', 'focal points'); }
  if (i.experimentType === 'projectile') { add(count(['projectile']), 'projectile', 'projectiles'); add(count(['trajectory']), 'trajectory', 'trajectories'); }
  if (!parts.length) return i.summary;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `We found ${list}. Check the ${i.experimentType === 'circuit' ? 'connections and values' : 'values'}.`;
}

function TopoIcon({ t }: { t: Topology }) {
  const s = { stroke: 'currentColor', fill: 'none', strokeWidth: 2 };
  const R = (x: number, y: number, v = false) => v ? <rect x={x - 4} y={y - 9} width="8" height="18" {...s} /> : <rect x={x - 9} y={y - 4} width="18" height="8" {...s} />;
  return (
    <svg viewBox="0 0 100 54" aria-hidden="true">
      <path d="M10 22 V6 H90 V48 H10 V32" {...s} /><line x1="4" y1="22" x2="16" y2="22" {...s} /><line x1="7" y1="32" x2="13" y2="32" {...s} strokeWidth="4" />
      {t === 'series' && <>{R(40, 6)}{R(68, 6)}</>}
      {t === 'parallel' && <><path d="M50 6 V48" {...s} />{R(50, 27, true)}{R(90, 27, true)}</>}
      {t === 'mixed' && <><path d="M62 6 V48" {...s} />{R(34, 6)}{R(62, 27, true)}{R(90, 27, true)}</>}
    </svg>
  );
}

export default function Review() {
  const { search } = useLocation();
  const manualType = new URLSearchParams(search).get('manual') as ExperimentConfig['type'] | null;
  const pending = manualType ? null : getPending();
  const interp = pending?.interpretation ?? null;
  const unsupported = interp?.experimentType === 'unsupported';

  const [draft, setDraft] = useState<Draft | null>(() => {
    if (manualType && ['circuit', 'lens', 'projectile'].includes(manualType)) return emptyDraft(manualType);
    if (interp && !unsupported) return draftFromInterpretation(interp);
    return null;
  });
  const [origins, setOrigins] = useState<Record<string, Origin>>({});
  const [showBoxes, setShowBoxes] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const chooseType = (t: ExperimentConfig['type']) => { setDraft(interp && interp.experimentType === t ? draftFromInterpretation(interp) : interp ? draftFromInterpretation(interp, t) : emptyDraft(t)); setOrigins({}); setErrors([]); };

  if (!pending && !manualType) {
    return (
      <div className="page"><div className="panel panel-pad stack" style={{ maxWidth: 620 }}>
        <span className="label">Review</span><h1 className="h2">Nothing to review yet</h1>
        <p className="muted">Upload a diagram first, or set up an experiment by hand.</p>
        <div className="row"><Link href="/new" className="btn btn-primary">Upload a diagram</Link>{(['circuit', 'lens', 'projectile'] as const).map((t) => <Link key={t} className="btn" href={`/review?manual=${t}`}>{TITLES[t]}</Link>)}</div>
      </div></div>
    );
  }

  const setField = (key: string, value: number | null) => {
    if (!draft) return;
    setDraft({ ...draft, fields: draft.fields.map((f) => (f.key === key ? { ...f, value } : f)) });
    setOrigins((o) => ({ ...o, [key]: 'edited' }));
  };
  const resize = (d: Draft, n: number): Draft => {
    const rs = d.fields.filter((f) => /^r\d$/.test(f.key));
    const others = d.fields.filter((f) => !/^r\d$/.test(f.key));
    const next = Array.from({ length: n }, (_, i) => rs[i] ?? { key: `r${i + 1}`, label: `Resistance R${i + 1}`, unit: 'Ω', value: null, origin: 'missing' as const, sourceText: null, note: 'Added by you.' });
    return { ...d, resistorCount: n, fields: [...others, ...next] };
  };
  const setCount = (n: number) => setDraft((d) => (d ? resize(d, n) : d));
  const setTopology = (t: Topology) => {
    setDraft((d) => {
      if (!d) return d;
      let n = d.resistorCount ?? 1;
      if (t === 'mixed') n = 3;
      if (t === 'parallel' && n < 2) n = 2;
      return resize({ ...d, topology: t, topologyOrigin: 'diagram' }, n);
    });
    setOrigins((o) => ({ ...o, topology: 'edited' }));
  };

  const launch = () => {
    if (!draft) return;
    const r = configFromDraft(draft);
    if ('errors' in r) { setErrors(r.errors); return; }
    const now = new Date().toISOString();
    const confirmed = draft.fields.map((f) => ({ label: f.label, value: `${fmt(f.value!)} ${f.unit}`, origin: ORIGIN[(origins[f.key] ?? f.origin) as Origin].text.split(':')[0]! }));
    if (draft.type === 'circuit' && draft.topology) confirmed.unshift({ label: 'Arrangement', value: TOPOLOGY_LABEL[draft.topology], origin: ORIGIN[(origins.topology ?? draft.topologyOrigin ?? 'missing') as Origin].text.split(':')[0]! });
    const doc: LabDoc = {
      localId: newId(),
      title: interp && !unsupported ? (interp.summary.length < 70 ? interp.summary.replace(/\.$/, '') : TITLES[draft.type]) : TITLES[draft.type],
      config: r.config,
      source: interp ? 'upload' : 'manual',
      interpretation: { summary: interp?.summary ?? 'Values entered by hand.', assumptions: interp?.assumptions ?? [], warnings: interp?.warnings ?? [], confirmed, model: pending?.model, analyzedAt: pending?.analyzedAt },
      image: pending?.image,
      createdAt: now, updatedAt: now,
    };
    saveCurrent(doc);
    navigate('/lab');
  };

  const boxes = interp?.components.filter((c) => c.box) ?? [];
  const missingKeys = draft?.fields.filter((f) => f.value == null).length ?? 0;

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
        <span className="label">{manualType ? 'Manual setup' : 'New experiment · step 2 of 3'}</span>
        <h1 className="h2">{interp && !unsupported ? foundSentence(interp) : manualType ? `Set up a ${TITLES[manualType].toLowerCase()}` : 'Choose the experiment and enter its values'}</h1>
        {interp && <p className="muted" style={{ margin: 0 }}>Nothing runs until you confirm. Values marked <b className="coral">missing</b> were not readable and were left empty on purpose.</p>}
      </div>

      <div className="review">
        <div className="stack">
          {pending?.image ? (
            <Panel title="Your diagram" pad={false} right={<div className="row" style={{ gap: 6 }}>{boxes.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setShowBoxes((v) => !v)} aria-pressed={showBoxes}>{showBoxes ? 'Hide' : 'Show'} detected parts</button>}<Link href="/new" className="btn btn-sm">Replace</Link></div>}>
              <div className="imgbox">
                <img src={pending.image} alt="Uploaded diagram" />
                {showBoxes && boxes.map((b, i) => {
                  const [y0 = 0, x0 = 0, y1 = 0, x1 = 0] = b.box!;
                  return <div key={i} className="bbox" style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%`, animationDelay: `${i * 120}ms` }}><span>{b.label || b.kind}{b.valueText ? ` · ${b.valueText}` : ''}</span></div>;
                })}
              </div>
              {boxes.length > 0 && showBoxes && <p className="muted" style={{ margin: 0, padding: '8px 14px', fontSize: 12 }}>Boxes are the AI’s approximate locations, shown so you can compare.</p>}
            </Panel>
          ) : <Panel title="Diagram"><p className="muted" style={{ margin: 0 }}>No image. You are entering values by hand.</p></Panel>}

          {interp && (
            <Panel title="What the AI reported">
              <div className="stack" style={{ gap: 10, fontSize: 14 }}>
                <p style={{ margin: 0 }}>{interp.summary}</p>
                <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--faint)' }}>Image quality: {interp.imageQuality} · {pending?.model}</p>
                {interp.imageQuality !== 'clear' && <Alert tone="amber"><p>The image was reported as <b>{interp.imageQuality}</b>. Double-check every value, or retake the photo.</p></Alert>}
                {interp.missing.length > 0 && <div><span className="label">Missing</span><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{interp.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
                {interp.warnings.length > 0 && <div><span className="label">Warnings</span><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{interp.warnings.map((m) => <li key={m}>{m}</li>)}</ul></div>}
                {interp.assumptions.length > 0 && <div><span className="label">Assumptions</span><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{interp.assumptions.map((m) => <li key={m}>{m}</li>)}</ul></div>}
                {interp.needsReview.length > 0 && <div className="chips" aria-label="Fields to review">{interp.needsReview.map((n) => <span key={n} className="badge amber">check: {n}</span>)}</div>}
              </div>
            </Panel>
          )}
          {pending?.manualReason && <Alert tone="amber"><p>{pending.manualReason} Use your photo as a reference and enter the values below.</p></Alert>}
        </div>

        <div className="stack">
          {unsupported && !draft && (
            <Alert tone="amber"><p><b>This isn’t one of the three interactive simulations.</b></p><p>{interp?.unsupportedReason ?? 'It could not be matched to a circuit, convex lens or projectile.'}</p><p className="row" style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={() => { if (pending?.image) setSolveSeed(pending.image); navigate('/solve'); }}>Solve it with AI instead →</button><span className="muted" style={{ fontSize: 13 }}>or, if it is one of them, pick it below.</span></p></Alert>
          )}
          <Panel title="Experiment type">
            <div className="seg" role="group" aria-label="Experiment type">
              {(['circuit', 'lens', 'projectile'] as const).map((t) => <button key={t} aria-pressed={draft?.type === t} onClick={() => chooseType(t)}>{TITLES[t]}</button>)}
            </div>
            {interp && !unsupported && draft && draft.type !== interp.experimentType && <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>You changed the type from what the AI suggested ({interp.experimentType}). Values for this type start empty.</p>}
          </Panel>

          {draft && (
            <Panel title="Check the values" className="fade-in">
              {draft.type === 'circuit' && (
                <div className="stack" style={{ gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="label">How are the resistors connected?</span>
                    <span className={`badge ${ORIGIN[(origins.topology ?? draft.topologyOrigin ?? 'missing') as Origin].cls}`}>{ORIGIN[(origins.topology ?? draft.topologyOrigin ?? 'missing') as Origin].text}</span></div>
                  <div className="topo" role="group" aria-label="Circuit arrangement">
                    {(['series', 'parallel', 'mixed'] as Topology[]).map((t) => (
                      <button key={t} aria-pressed={draft.topology === t} onClick={() => setTopology(t)}><TopoIcon t={t} />{t === 'mixed' ? 'R1 + (R2 || R3)' : TOPOLOGY_LABEL[t]}</button>
                    ))}
                  </div>
                  {draft.topology !== 'mixed' && (
                    <div className="row"><span className="muted" style={{ fontSize: 13 }}>Number of resistors</span>
                      {[1, 2, 3].map((n) => <button key={n} className="btn btn-sm" style={{ minWidth: 44 }} aria-pressed={draft.resistorCount === n} disabled={draft.topology === 'parallel' && n < 2} onClick={() => setCount(n)}>{draft.resistorCount === n ? <b className="lime">{n}</b> : n}</button>)}
                    </div>
                  )}
                  <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Only these three arrangements are simulated. Other networks are not supported.</p>
                </div>
              )}
              {draft.fields.map((f) => {
                const o = (origins[f.key] ?? f.origin) as Origin;
                return (
                  <div className="rfield" key={f.key}>
                    <label htmlFor={`rv-${f.key}`} style={{ fontWeight: 600 }}>{f.label}</label>
                    <span className={`numin${f.value == null ? ' bad' : ''}`}>
                      <input id={`rv-${f.key}`} inputMode="decimal" defaultValue={f.value ?? ''} placeholder="?" aria-invalid={f.value == null}
                        onChange={(e) => { const t = e.target.value.trim().replace(',', '.'); const v = Number(t); setField(f.key, t === '' || !Number.isFinite(v) ? null : v); }} />
                      <span className="unit">{f.unit}</span>
                    </span>
                    <div className="meta"><span className={`badge ${ORIGIN[o].cls}`}>{ORIGIN[o].text}</span>{f.sourceText && <span>read as “{f.sourceText}”</span>}{f.note && <span>{f.note}</span>}</div>
                  </div>
                );
              })}
            </Panel>
          )}

          {errors.length > 0 && <Alert tone="coral">{errors.map((e) => <p key={e}>{e}</p>)}</Alert>}
          {draft && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 13 }}>{missingKeys ? `${missingKeys} value${missingKeys > 1 ? 's' : ''} still missing` : 'All values filled in'}</span>
              <button className="btn btn-primary" onClick={launch}>Launch experiment →</button>
            </div>
          )}
        </div>
      </div>
      <span style={{ color: C.faint }} />
    </div>
  );
}
