import { useEffect, useState } from 'react';
import { Link, navigate } from '../lib/router';
import { EXAMPLES, fmt } from '../../shared/experiment';
import type { LensConfig, ExperimentConfig } from '../../shared/schema';
import { solveLens, type LensResult } from '../../shared/physics/lens';
import LensView from '../experiments/LensView';
import { PaperFor, LensPaper, PAPER_HIGHLIGHTS } from '../components/Paper';
import { ParamField } from '../components/ui';
import { useInView, useReducedMotion } from '../lib/hooks';

function Morph() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const steps = PAPER_HIGHLIGHTS.lens.length;
  const [stage, setStage] = useState(reduced ? steps : -1);
  const [cfg, setCfg] = useState<LensConfig>(EXAMPLES[1]!.config as LensConfig);
  useEffect(() => {
    if (reduced || !inView || stage >= steps) return;
    const id = setTimeout(() => setStage((s) => s + 1), stage < 0 ? 500 : 650);
    return () => clearTimeout(id);
  }, [stage, inView, reduced, steps]);
  const r = solveLens(cfg) as LensResult;
  const done = stage >= steps;
  return (
    <div ref={ref} className="panel morph" aria-label="Example: a textbook lens diagram becoming a live ray diagram">
      <span className="ticks" aria-hidden="true" />
      <div className="morph-src">
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="label">Textbook figure</span><span className="badge">Example</span></div>
        <div className="paper"><LensPaper highlight={Math.min(stage, steps - 1)} /></div>
        <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: 'none' }} aria-label="Components in the example">
          {PAPER_HIGHLIGHTS.lens.map((h, i) => (
            <li key={h.label} className="mono" style={{ fontSize: 12, color: i <= stage ? 'var(--lime)' : 'var(--faint)', transition: 'color .3s' }}>{i <= stage ? '✓' : '·'} {h.label}</li>
          ))}
        </ul>
      </div>
      <div className="morph-sim" style={{ opacity: done ? 1 : 0.25, transition: 'opacity .6s' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="label">Live experiment</span><span className="badge cyan">drag the object</span></div>
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
          <LensView config={cfg} onChange={(c) => setCfg(c as LensConfig)} compact />
        </div>
        <ParamField label="Object distance" symbol="u" unit="cm" min={3} max={45} step={0.5} value={cfg.objectDistance}
          onChange={(v) => { if (!(v > 0 && v <= 2000)) return 'Must be between 0 and 2000 cm.'; setCfg({ ...cfg, objectDistance: v }); return null; }} />
        <p className="mono" aria-live="polite" style={{ margin: 0, fontSize: 12.5, color: 'var(--cyan)' }}>
          {r.image ? `v = ${fmt(r.image.distance)} cm · m = ${fmt(r.image.magnification)} · ${r.image.nature}, ${r.image.orientation}` : 'image at infinity'}
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  const open = (c: ExperimentConfig, id: string) => { void c; navigate(`/lab?example=${id}`); };
  return (
    <div className="page" style={{ paddingTop: 12 }}>
      <section className="hero">
        <div className="hero-copy fade-in">
          <span className="label">Physics lab · photo to experiment</span>
          <h1 className="display">Your notes.<br /><em>Now in motion.</em></h1>
          <p className="lede">Photograph a circuit, lens or projectile diagram from your textbook. Living Notes reads it, lets you check every value, then turns it into an experiment you can push, pull and question.</p>
          <div className="hero-cta">
            <Link href="/new" className="btn btn-primary">Upload a diagram <span aria-hidden="true">→</span></Link>
            <Link href="/lab?example=circuit-mixed" className="btn">Try an example</Link>
            <Link href="/solve" className="btn btn-ghost">Solve any science question →</Link>
          </div>
          <div className="hero-meta"><span><i className="dot lime" /> DC circuits</span><span><i className="dot cyan" /> Convex lenses</span><span><i className="dot" style={{ color: 'var(--paper)' }} /> Projectiles</span></div>
        </div>
        <Morph />
      </section>

      <div className="section-head">
        <div><span className="label">Curated examples</span><h2 className="h2" style={{ marginTop: 6 }}>Start with a ready-made diagram</h2></div>
        <p className="muted" style={{ margin: 0, maxWidth: 420 }}>These figures were drawn for Living Notes. They open straight into the lab with known values, no AI involved.</p>
      </div>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex.id} className="panel ex-card" onClick={() => open(ex.config, ex.id)} aria-label={`Open example: ${ex.title}`}>
            <div className="paper"><PaperFor type={ex.config.type} /></div>
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{ex.title}</b><span className="badge">Example</span></div>
            <span className="muted" style={{ fontSize: 14 }}>{ex.blurb}</span>
          </button>
        ))}
      </div>

      <div className="section-head"><div><span className="label">How it works</span><h2 className="h2" style={{ marginTop: 6 }}>From page to lab in three checks</h2></div></div>
      <div className="steps">
        <div className="panel step"><span className="n">01 · Upload</span><b>Snap or drop a diagram</b><span className="muted">Rotate and crop on your phone. The image is compressed before upload and is not stored.</span></div>
        <div className="panel step"><span className="n">02 · Review</span><b>Check what the AI read</b><span className="muted">Every value shows whether it came from the diagram, was inferred, or is missing. Nothing runs until you confirm.</span></div>
        <div className="panel step"><span className="n">03 · Experiment</span><b>Change it, then ask why</b><span className="muted">The physics is computed by tested code in your browser. The AI tutor explains those exact numbers.</span></div>
      </div>

      <div className="section-head"><div><span className="label">Supported diagrams</span><h2 className="h2" style={{ marginTop: 6 }}>What Living Notes understands</h2></div>
        <p className="muted" style={{ margin: 0, maxWidth: 440 }}>It is honest about its limits: other diagrams are flagged as unsupported, and you can always set up one of these experiments by hand.</p></div>
      <div className="support-list">
        <div className="panel panel-pad"><b>DC resistor circuits</b><ul><li>One ideal battery</li><li>1–3 resistors in series or parallel</li><li>R1 in series with (R2 || R3)</li></ul></div>
        <div className="panel panel-pad"><b>Thin convex lenses</b><ul><li>Object on the principal axis</li><li>Real and virtual images</li><li>Object at F: image at infinity</li></ul></div>
        <div className="panel panel-pad"><b>Projectile motion</b><ul><li>No air resistance</li><li>Launch and landing at the same height</li><li>Any gravity, 0°–90°</li></ul></div>
      </div>
      <div className="panel panel-pad row" style={{ marginTop: 16, justifyContent: 'space-between' }}><div><b>Anything else?</b> <span className="muted">Pendulums, chemistry, biology, maths: the solver explains the method, Living Notes computes the numbers and lets you change every value.</span></div><Link href="/solve" className="btn btn-primary btn-sm">Open the solver</Link></div>
    </div>
  );
}
