import { useEffect, useRef, useState } from 'react';
import { Interpretation } from '../../shared/schema';
import { decodeFile, rotated, exportForUpload, sharpness, LIMITS, type Crop } from '../lib/image';
import { analyzeImage, type ApiError } from '../lib/api';
import { setPending } from '../lib/flow';
import { navigate, Link } from '../lib/router';
import { useConnection, svcStatus } from '../lib/connection';
import { Alert, Panel } from '../components/ui';

type Stage = 'prepare' | 'upload' | 'read' | 'check';
const STAGES: [Stage, string][] = [['prepare', 'Preparing image on your device'], ['upload', 'Uploading securely'], ['read', 'AI is reading the diagram'], ['check', 'Checking the answer against the schema']];

export default function Upload() {
  const conn = useConnection();
  const ai = svcStatus(conn.health?.ai);
  const [src, setSrc] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 1, h: 1 });
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<{ stage: Stage; progress: number; started: number; error?: ApiError } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [quality, setQuality] = useState<{ w: number; h: number; sharp: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const lastImage = useRef<string>('');

  const take = async (file: File | undefined) => {
    if (!file) return;
    setErr(null); setRun(null);
    try { const img = await decodeFile(file); setSrc(img); setQuarter(0); setCrop({ x: 0, y: 0, w: 1, h: 1 }); }
    catch (e) { setErr((e as Error).message); }
  };

  // redraw preview when image/rotation changes
  useEffect(() => {
    if (!src) return;
    const rot = rotated(src as any, quarter); rotRef.current = rot;
    const cv = canvasRef.current; if (!cv) return;
    const s = Math.min(1, 1400 / Math.max(rot.width, rot.height));
    cv.width = Math.round(rot.width * s); cv.height = Math.round(rot.height * s);
    cv.getContext('2d')!.drawImage(rot, 0, 0, cv.width, cv.height);
  }, [src, quarter]);

  // quality check (debounced)
  useEffect(() => {
    const rot = rotRef.current; if (!rot) return;
    const id = setTimeout(() => setQuality({ w: Math.round(crop.w * rot.width), h: Math.round(crop.h * rot.height), sharp: sharpness(rot, crop) }), 200);
    return () => clearTimeout(id);
  }, [crop, src, quarter]);

  useEffect(() => {
    if (!run || run.error || run.stage !== 'read') return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - run.started) / 1000)), 500);
    return () => clearInterval(id);
  }, [run]);

  const tooSmall = quality ? Math.min(quality.w, quality.h) < LIMITS.minSide : false;
  const maybeBlurry = quality ? quality.sharp < 30 : false;

  const analyze = async () => {
    const rot = rotRef.current; if (!rot) return;
    setRun({ stage: 'prepare', progress: 0, started: Date.now() });
    let prepared;
    try { prepared = await exportForUpload(rot, crop); } catch { setRun({ stage: 'prepare', progress: 0, started: Date.now(), error: { code: 'prepare', message: 'Could not prepare the image in this browser.', status: 0 } }); return; }
    lastImage.current = prepared.dataUrl;
    setRun({ stage: 'upload', progress: 0, started: Date.now() });
    const job = analyzeImage(prepared.blob, (p) => setRun((r) => (r && r.stage === 'upload' ? { ...r, progress: p } : r)), () => setRun((r) => (r ? { ...r, stage: 'read', progress: 1, started: Date.now() } : r)));
    abortRef.current = job.abort;
    const res = await job.promise;
    abortRef.current = null;
    if (!res.ok) {
      if (!['offline', 'backend_unreachable', 'ai_not_configured', 'too_small', 'bad_type', 'rate_limited', 'aborted'].includes(res.error.code)) conn.report('ai', false, res.error.message);
      setRun((r) => ({ stage: r?.stage ?? 'read', progress: 1, started: Date.now(), error: res.error }));
      return;
    }
    setRun({ stage: 'check', progress: 1, started: Date.now() });
    const check = Interpretation.safeParse(res.data.interpretation);
    if (!check.success) { setRun({ stage: 'check', progress: 1, started: Date.now(), error: { code: 'ai_invalid_output', message: 'The answer did not pass validation, so it was discarded.', status: 0 } }); return; }
    conn.report('ai', true);
    setPending({ image: prepared.dataUrl, interpretation: check.data, model: `${res.data.provider} · ${res.data.model}`, analyzedAt: res.data.analyzedAt });
    navigate('/review');
  };

  const manual = (reason: string) => {
    const rot = rotRef.current;
    const go = (img: string) => { setPending({ image: img, interpretation: null, manualReason: reason }); navigate('/review'); };
    if (lastImage.current) go(lastImage.current);
    else if (rot) exportForUpload(rot, crop).then((p) => go(p.dataUrl)).catch(() => navigate('/review?manual=circuit'));
    else navigate('/review?manual=circuit');
  };

  /* ---------- crop interaction ---------- */
  const dragRef = useRef<{ mode: string; sx: number; sy: number; c: Crop } | null>(null);
  const onDown = (mode: string) => (e: React.PointerEvent) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); dragRef.current = { mode, sx: e.clientX, sy: e.clientY, c: crop }; };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current; const cv = canvasRef.current; if (!d || !cv) return;
    const rect = cv.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / rect.width, dy = (e.clientY - d.sy) / rect.height;
    let { x, y, w, h } = d.c; const min = 0.08;
    if (d.mode === 'move') { x = Math.min(Math.max(0, x + dx), 1 - w); y = Math.min(Math.max(0, y + dy), 1 - h); }
    if (d.mode.includes('l')) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
    if (d.mode.includes('r')) w = Math.min(Math.max(min, w + dx), 1 - x);
    if (d.mode.includes('t')) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
    if (d.mode.includes('b')) h = Math.min(Math.max(min, h + dy), 1 - y);
    setCrop({ x, y, w, h });
  };

  const busy = Boolean(run && !run.error);
  const stageIdx = run ? STAGES.findIndex(([s]) => s === run.stage) : -1;

  return (
    <div className="page">
      <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
        <span className="label">New experiment · step 1 of 3</span>
        <h1 className="h2">Upload a textbook diagram</h1>
        <p className="muted" style={{ margin: 0 }}>Supported: DC resistor circuits (1–3 resistors), thin convex lenses, projectile motion. JPEG, PNG or WebP up to 15 MB.</p>
      </div>

      {ai === 'not_configured' && <div style={{ marginBottom: 16 }}><Alert tone="amber"><p><b>AI diagram reading: setup required.</b> This server has no AI key, so uploads can't be analysed yet. You can still use your photo as a reference and enter the values yourself.</p></Alert></div>}

      {!src ? (
        <div className={`panel drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
          <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="12" width="48" height="40" rx="6" fill="none" stroke="var(--line-2)" /><path d="M16 42 l10-12 8 9 6-6 8 9" fill="none" stroke="var(--lime)" strokeWidth="2" /><circle cx="44" cy="22" r="4" fill="var(--cyan)" /></svg>
          <div><b>Drop a photo here</b><p className="muted" style={{ margin: '4px 0 0' }}>or choose one from your device</p></div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <label className="btn btn-primary">Choose image<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => take(e.target.files?.[0])} /></label>
            <label className="btn">Take a photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => take(e.target.files?.[0])} /></label>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: 0, maxWidth: 520 }}>Tip: shoot straight on, in good light, with the whole figure and its labels in frame. Your image is sent to the AI provider (Google Gemini) for reading and is <b>not stored</b> by Living Notes.</p>
          <Link href="/lab" className="linkbtn" onClick={() => {}}>or set up an experiment manually</Link>
        </div>
      ) : (
        <div className="editor">
          <Panel title="Crop & rotate" pad={false} right={<div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => { setQuarter((q) => q - 1); setCrop({ x: 0, y: 0, w: 1, h: 1 }); }} disabled={busy} aria-label="Rotate left">⟲</button>
            <button className="btn btn-sm" onClick={() => { setQuarter((q) => q + 1); setCrop({ x: 0, y: 0, w: 1, h: 1 }); }} disabled={busy} aria-label="Rotate right">⟳</button>
            <button className="btn btn-sm" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })} disabled={busy}>Reset crop</button>
          </div>}>
            <div className="cropwrap" onPointerMove={onMove} onPointerUp={() => (dragRef.current = null)}>
              <div style={{ position: 'relative' }}>
                <canvas ref={canvasRef} aria-label="Image preview" />
                <div className="crop" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, cursor: 'move' }} onPointerDown={onDown('move')} aria-label="Crop area: drag to move">
                  {(['tl', 'tr', 'bl', 'br'] as const).map((k) => <span key={k} className={`h ${k}`} onPointerDown={onDown(k)} aria-hidden="true" />)}
                </div>
              </div>
            </div>
          </Panel>
          <div className="stack">
            <Panel title="Image check">
              <div className="stack" style={{ gap: 10 }}>
                {quality && <p className="mono" style={{ margin: 0, fontSize: 13, color: 'var(--cyan)' }}>{quality.w} × {quality.h} px selected · sent at up to {LIMITS.uploadMaxSide} px</p>}
                {tooSmall && <Alert tone="coral"><p>The selected area is too small to read labels reliably. Use a larger crop or a higher-resolution photo.</p></Alert>}
                {maybeBlurry && !tooSmall && <Alert tone="amber"><p>This image may be blurry (a quick sharpness estimate, not a guarantee). If labels look soft, retake the photo closer and steadier.</p></Alert>}
                {!tooSmall && !maybeBlurry && quality && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Looks readable. Crop to just the diagram and its labels for the best result.</p>}
              </div>
            </Panel>
            <Panel title="Analysis">
              <div className="stack" style={{ gap: 12 }}>
                {run && (
                  <div className="stages" aria-live="polite">
                    {STAGES.map(([s, l], i) => {
                      const st = run.error && i === stageIdx ? 'error' : i < stageIdx ? 'done' : i === stageIdx && !run.error ? 'active' : 'todo';
                      return <div className="stage" data-s={st} key={s}><span className="ic">{st === 'done' ? '✓' : st === 'error' ? '×' : st === 'active' ? '●' : '○'}</span><span>{l}</span>
                        <span className="mono" style={{ fontSize: 12 }}>{st === 'active' && s === 'upload' ? `${Math.round(run.progress * 100)}%` : st === 'active' && s === 'read' ? `${elapsed}s` : ''}</span></div>;
                    })}
                    {run.stage === 'upload' && !run.error && <div className="progress" aria-hidden="true"><span style={{ width: `${run.progress * 100}%` }} /></div>}
                  </div>
                )}
                {run?.error && (
                  <Alert tone="coral">
                    <p>{run.error.message}</p>
                    <p className="row" style={{ gap: 14 }}>
                      {run.error.code !== 'ai_not_configured' && <button className="linkbtn" onClick={analyze}>Try again</button>}
                      <button className="linkbtn" onClick={() => manual(run.error!.code === 'ai_not_configured' ? 'AI analysis is not set up on this server.' : 'The AI could not analyse this image.')}>Enter values manually</button>
                    </p>
                  </Alert>
                )}
                <div className="row">
                  {!busy ? <button className="btn btn-primary" onClick={analyze} disabled={tooSmall || ai === 'not_configured' || !conn.browserOnline}>Analyse diagram</button>
                    : <button className="btn" onClick={() => abortRef.current?.()}>Cancel</button>}
                  {ai === 'not_configured' && <button className="btn" onClick={() => manual('AI analysis is not set up on this server.')}>Continue without AI</button>}
                  <button className="btn btn-ghost" onClick={() => { setSrc(null); setRun(null); setQuality(null); }} disabled={busy}>Choose another</button>
                </div>
                {!conn.browserOnline && <p className="coral" style={{ margin: 0, fontSize: 13 }}>You are offline. Analysis needs a connection.</p>}
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>The compressed image goes to our server, which forwards it to Google Gemini for reading and then discards it. Instructions written inside images are ignored.</p>
              </div>
            </Panel>
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 14 }}><Alert tone="coral"><p>{err}</p></Alert></div>}
    </div>
  );
}
