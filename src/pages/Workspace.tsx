import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ExperimentConfig } from '../../shared/schema';
import { EXAMPLES, TITLES, ASSUMPTIONS, summarize, fmt } from '../../shared/experiment';
import { TOPOLOGY_LABEL } from '../../shared/physics/circuit';
import { loadCurrent, saveCurrent, saveDoc, getSaved, newId, type LabDoc } from '../lib/docs';
import { useLocation, navigate, Link } from '../lib/router';
import { useKeyboardOpen } from '../lib/hooks';
import { Panel, Fold, Alert, Icon, toast } from '../components/ui';
import { PaperFor } from '../components/Paper';
import { ParamControls, Presets, Measurements, Equations } from '../experiments/panels';
import { Tutor } from '../components/Tutor';
import { Sources } from '../components/Sources';
import { ShareDialog, makePoster } from '../components/ShareAndPoster';

const CircuitView = lazy(() => import('../experiments/CircuitView'));
const LensView = lazy(() => import('../experiments/LensView'));
const ProjectileView = lazy(() => import('../experiments/ProjectileView'));

export function docFromExample(id: string): LabDoc | null {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return null;
  const now = new Date().toISOString();
  return { localId: newId(), title: ex.title, config: ex.config, source: 'example', exampleId: ex.id, createdAt: now, updatedAt: now };
}

export function Sim({ config, onChange, onPickResistor }: { config: ExperimentConfig; onChange?: (c: ExperimentConfig) => void; onPickResistor?: (i: number) => void }) {
  return (
    <Suspense fallback={<div className="empty" style={{ minHeight: 300 }}><span className="label">Loading experiment…</span></div>}>
      {config.type === 'circuit' && <CircuitView config={config} exportId="sim-export" onPickResistor={onPickResistor} />}
      {config.type === 'lens' && <LensView config={config} exportId="sim-export" onChange={onChange} />}
      {config.type === 'projectile' && <ProjectileView config={config} exportId="sim-export" />}
    </Suspense>
  );
}

type Tab = 'diagram' | 'controls' | 'explain' | 'sources';

export default function Workspace() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const [doc, setDoc] = useState<LabDoc | null>(() => {
    const ex = params.get('example'); const sv = params.get('saved');
    if (ex) return docFromExample(ex);
    if (sv) return getSaved(sv);
    return loadCurrent();
  });
  const initial = useRef<ExperimentConfig | null>(doc?.config ?? null);
  const [tab, setTab] = useState<Tab>('controls');
  const [sharing, setSharing] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const kbd = useKeyboardOpen();

  // React to URL changes (e.g. clicking another example)
  useEffect(() => {
    const ex = params.get('example'), sv = params.get('saved');
    if (!ex && !sv) return;
    const next = ex ? docFromExample(ex) : getSaved(sv!);
    if (next) { setDoc(next); initial.current = next.config; }
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preserve current work for this tab session. Once an example/saved doc is open, drop the query
  // from the URL so a reload restores the edited session copy instead of the original.
  useEffect(() => {
    if (!doc) return;
    saveCurrent(doc);
    if (location.search) history.replaceState(null, '', '/lab');
  }, [doc]);
  useEffect(() => { document.body.classList.toggle('kbd-open', kbd); return () => document.body.classList.remove('kbd-open'); }, [kbd]);

  const summaryText = useMemo(() => (doc ? summarize(doc.config) : ''), [doc?.config]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) {
    return (
      <div className="page"><div className="panel panel-pad stack" style={{ maxWidth: 640 }}>
        <span className="label">Lab</span>
        <h1 className="h2">No experiment open yet</h1>
        <p className="muted">Upload a diagram, open an example, or set one up by hand.</p>
        <div className="row">
          <Link href="/new" className="btn btn-primary">Upload a diagram</Link>
          {EXAMPLES.map((e) => <Link key={e.id} href={`/lab?example=${e.id}`} className="btn">{e.title}</Link>)}
        </div>
        <div className="row"><span className="muted" style={{ fontSize: 13 }}>Manual setup:</span>{(['circuit', 'lens', 'projectile'] as const).map((t) => <Link key={t} href={`/review?manual=${t}`} className="btn btn-sm">{TITLES[t]}</Link>)}</div>
      </div></div>
    );
  }

  const setConfig = (c: ExperimentConfig) => setDoc((d) => (d ? { ...d, config: c, updatedAt: new Date().toISOString() } : d));
  const pickResistor = (i: number) => { setTab('controls'); setTimeout(() => (document.getElementById(`param-r${i + 1}-n`) as HTMLInputElement | null)?.focus(), 50); };
  const save = () => {
    const r = saveDoc(doc);
    if (!r.ok) toast('Could not save: this browser’s storage is full or disabled.');
    else toast(r.droppedImage ? 'Saved (image too large for local storage, settings saved)' : 'Saved to this device');
  };
  const makeP = async () => {
    try {
      const blob = await makePoster(doc, document.getElementById('sim-export'), document.getElementById('diagram-export')?.querySelector('svg') ?? null);
      setPoster(URL.createObjectURL(blob));
    } catch { toast('Could not create the poster in this browser.'); }
  };
  const sourceBadge = { example: <span className="badge">Example</span>, upload: <span className="badge lime">From your upload</span>, manual: <span className="badge">Manual setup</span>, shared: <span className="badge cyan">Shared copy</span> }[doc.source];
  const assumptions = [...ASSUMPTIONS[doc.config.type], ...(doc.interpretation?.assumptions ?? [])];
  const show = (t: Tab) => (tab === t ? '' : ' mobile-hidden');

  const diagramPanel = (
    <Panel title="Original diagram" right={doc.source === 'upload' ? <Link href="/review" className="btn btn-sm btn-ghost">Edit review</Link> : null}>
      <div className="stack" style={{ gap: 12 }}>
        {doc.image ? <img src={doc.image} alt="Your uploaded diagram" style={{ borderRadius: 10, border: '1px solid var(--line)' }} />
          : doc.exampleId ? <div className="paper" id="diagram-export"><PaperFor type={doc.config.type} /></div>
            : <div className="empty" style={{ padding: 18 }}><span className="label">No image</span><span style={{ fontSize: 13 }}>{doc.source === 'upload' ? 'The image stays on the device it was uploaded from.' : 'Values were entered by hand.'}</span></div>}
        {doc.interpretation && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{doc.interpretation.summary}</p>
            <dl className="kv">{doc.interpretation.confirmed.map((c) => <Fragment key={c.label}><dt>{c.label}</dt><dd>{c.value} <span className="badge" style={{ marginLeft: 4 }}>{c.origin}</span></dd></Fragment>)}</dl>
            {doc.interpretation.model && <p className="muted mono" style={{ margin: 0, fontSize: 11 }}>Read by {doc.interpretation.model}{doc.interpretation.analyzedAt ? ` · ${new Date(doc.interpretation.analyzedAt).toLocaleString()}` : ''} · confirmed by you</p>}
          </>
        )}
      </div>
    </Panel>
  );

  return (
    <>
      <div className="ws-bar">
        <div className="ws-title">
          <label className="sr-only" htmlFor="ws-title">Experiment title</label>
          <input id="ws-title" value={doc.title} maxLength={120} onChange={(e) => setDoc({ ...doc, title: e.target.value, updatedAt: new Date().toISOString() })} />
        </div>
        {sourceBadge}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={save}>Save</button>
          <button className="btn btn-sm" onClick={() => setSharing(true)}>Share</button>
          <button className="btn btn-sm" onClick={makeP}>Poster</button>
        </div>
      </div>

      <div className="ws">
        <div className={`ws-col ws-left${show('diagram')}`}>
          {diagramPanel}
          <Fold title="Assumptions">
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 13.5 }}>{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            {doc.interpretation?.warnings.length ? <div style={{ marginTop: 10 }}><Alert tone="amber">{doc.interpretation.warnings.map((w) => <p key={w}>{w}</p>)}</Alert></div> : null}
          </Fold>
        </div>

        <div className="ws-col ws-center" style={{ padding: 0 }}>
          <section className="panel simcard" aria-label="Simulation">
            <div className="sim-top">
              <span className="label"><b>{TITLES[doc.config.type]}</b>{doc.config.type === 'circuit' ? ` · ${TOPOLOGY_LABEL[doc.config.topology]}` : ''}</span>
              <span className="legend">
                {doc.config.type === 'circuit' && <><span><i style={{ background: 'var(--lime)' }} />current (illustrative)</span><span><i style={{ background: 'var(--amber)' }} />heat ∝ power</span></>}
                {doc.config.type === 'lens' && <><span><i style={{ background: 'var(--cyan)' }} />light rays</span><span><i style={{ background: 'var(--cyan)', opacity: 0.5 }} />virtual extensions</span></>}
              </span>
            </div>
            <div className="sim-stage"><Sim config={doc.config} onChange={setConfig} onPickResistor={pickResistor} /></div>
            <div className="sim-foot" aria-live="polite"><span className="sr-only">Results: </span>{summaryText}</div>
          </section>
        </div>

        <div className={`ws-col ws-right${tab === 'controls' || tab === 'explain' || tab === 'sources' ? '' : ' mobile-hidden'}`}>
          <div className={show('controls').trim() ? 'mobile-hidden stack' : 'stack'} style={{ gap: 16 }}>
            <Panel title="Controls" right={<button className="btn btn-sm btn-ghost" onClick={() => initial.current && setConfig(initial.current)}>Reset</button>}>
              <div className="stack" style={{ gap: 16 }}>
                <ParamControls config={doc.config} onChange={setConfig} />
                <div className="stack" style={{ gap: 8 }}><span className="label">Presets</span><Presets type={doc.config.type} onPick={setConfig} /></div>
              </div>
            </Panel>
            <Panel title="Measurements"><Measurements config={doc.config} /></Panel>
            <Fold title="Equations with your values"><Equations config={doc.config} /></Fold>
          </div>
          <div className={show('explain').trim() ? 'mobile-hidden' : ''}>
            <Panel title="Explain · AI tutor">
              <Tutor config={doc.config} title={doc.title} assumptions={doc.interpretation?.assumptions} source={doc.source}
                onApply={(c, label) => { setConfig(c); toast(`Applied: ${label}`); }} />
            </Panel>
          </div>
          <div className={show('sources').trim() ? 'mobile-hidden' : ''}>
            <Fold title="Supporting sources" open={tab === 'sources'}><Sources config={doc.config} /></Fold>
          </div>
        </div>
      </div>

      <nav className="tabs" role="tablist" aria-label="Workspace sections">
        {([['diagram', 'Diagram', Icon.diagram], ['controls', 'Controls', Icon.sliders], ['explain', 'Explain', Icon.chat], ['sources', 'Sources', Icon.book]] as const).map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{ic}{l}</button>
        ))}
      </nav>

      {sharing && <ShareDialog doc={doc} onClose={() => setSharing(false)} onShared={(s) => { const d = { ...doc, share: s }; setDoc(d); saveDoc(d); }} />}
      {poster && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setPoster(null)}>
          <div className="panel modal fade-in" role="dialog" aria-modal="true" aria-label="Poster preview">
            <h2 className="h2" style={{ fontSize: 30 }}>Experiment poster</h2>
            <img src={poster} alt="Poster summary of this experiment" />
            <div className="row"><a className="btn btn-primary" href={poster} download={`${doc.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'experiment'}.png`}>Download PNG</a><button className="btn btn-ghost" onClick={() => setPoster(null)}>Close</button></div>
            {!doc.share && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tip: create a share link first to add a QR code.</p>}
          </div>
        </div>
      )}
    </>
  );
}
export { navigate, fmt };
