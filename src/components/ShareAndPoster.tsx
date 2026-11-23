import { useEffect, useState } from 'react';
import type { ExperimentConfig } from '../../shared/schema';
import { compute, fmt, summarize, TITLES } from '../../shared/experiment';
import type { CircuitResult } from '../../shared/physics/circuit';
import type { LensResult } from '../../shared/physics/lens';
import type { ProjectileResult } from '../../shared/physics/projectile';
import { api } from '../lib/api';
import type { LabDoc } from '../lib/docs';
import { Alert, toast } from './ui';

export function plainEquation(c: ExperimentConfig): string {
  const r = compute(c);
  if (!r.result.ok) return '';
  if (r.type === 'circuit') { const x = r.result as CircuitResult; return `I = V / R_eq = ${fmt(x.voltage)} V / ${fmt(x.totalResistance)} Ω = ${fmt(x.totalCurrent)} A`; }
  if (r.type === 'lens') { const x = r.result as LensResult; return x.image ? `1/f = 1/u + 1/v  →  v = uf/(u − f) = ${fmt(x.image.distance)} cm` : '1/v = 1/f − 1/u = 0  →  image at infinity'; }
  const x = r.result as ProjectileResult; return `R = v₀² sin 2θ / g = ${fmt(x.range)} m`;
}

export function keyValues(c: ExperimentConfig): [string, string][] {
  const r = compute(c);
  if (r.type === 'circuit') {
    const base: [string, string][] = [['Arrangement', c.type === 'circuit' ? (c.topology === 'mixed' ? 'R1 + (R2 || R3)' : c.topology) : ''], ['Voltage', `${fmt((c as any).voltage)} V`], ['Resistors', (c as any).resistors.map((x: number) => `${fmt(x)} Ω`).join(', ')]];
    if (r.result.ok) { const x = r.result as CircuitResult; base.push(['Total resistance', `${fmt(x.totalResistance)} Ω`], ['Total current', `${fmt(x.totalCurrent)} A`], ['Total power', `${fmt(x.totalPower)} W`]); }
    return base;
  }
  if (r.type === 'lens') {
    const x = r.result as LensResult; const l = c as Extract<ExperimentConfig, { type: 'lens' }>;
    return [['Focal length f', `${fmt(l.focalLength)} cm`], ['Object distance u', `${fmt(l.objectDistance)} cm`], ['Object height h', `${fmt(l.objectHeight)} cm`], ...(x.ok && x.image ? [['Image distance v', `${fmt(x.image.distance)} cm`], ['Magnification m', fmt(x.image.magnification)], ['Image', `${x.image.nature}, ${x.image.orientation}`]] as [string, string][] : [['Image', 'at infinity']] as [string, string][])];
  }
  const x = r.result as ProjectileResult; const p = c as Extract<ExperimentConfig, { type: 'projectile' }>;
  return [['Initial speed v₀', `${fmt(p.speed)} m/s`], ['Angle θ', `${fmt(p.angleDeg)}°`], ['Gravity g', `${fmt(p.gravity)} m/s²`], ...(x.ok ? [['Time of flight', `${fmt(x.timeOfFlight)} s`], ['Max height', `${fmt(x.maxHeight)} m`], ['Range', `${fmt(x.range)} m`]] as [string, string][] : [])];
}

async function elementToImage(el: Element | null): Promise<CanvasImageSource | null> {
  if (!el) return null;
  if (el instanceof HTMLCanvasElement) return el;
  if (el instanceof SVGSVGElement) {
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const vb = el.viewBox.baseVal;
    clone.setAttribute('width', String(vb.width * 2)); clone.setAttribute('height', String(vb.height * 2));
    clone.querySelectorAll('.flow').forEach((n) => n.remove());
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  return null;
}
async function urlToImage(src: string): Promise<HTMLImageElement | null> {
  try { const img = new Image(); img.src = src; await img.decode(); return img; } catch { return null; }
}

/** Poster-style summary: name, diagram, key values, main equation, QR when shared. */
export async function makePoster(doc: LabDoc, simEl: Element | null, diagramEl: Element | null): Promise<Blob> {
  const W = 1080, H = 1440, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  await document.fonts.ready;
  g.fillStyle = '#090D16'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(244,241,232,0.06)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 36) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 36) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = '#D4FF3A'; g.font = '500 22px "JetBrains Mono Variable", monospace'; g.fillText(`LIVING NOTES · ${TITLES[doc.config.type].toUpperCase()}`, 64, 92);
  g.fillStyle = '#F4F1E8'; g.font = '84px "Instrument Serif", serif';
  const title = doc.title.length > 34 ? doc.title.slice(0, 33) + '…' : doc.title; g.fillText(title, 64, 180);
  g.fillStyle = 'rgba(244,241,232,0.6)'; g.font = '24px "Inter Variable", sans-serif';
  g.fillText(doc.source === 'example' ? 'Curated example' : doc.source === 'upload' ? 'From an uploaded diagram (values confirmed by the student)' : doc.source === 'shared' ? 'Shared experiment' : 'Manual setup', 64, 222);
  const sim = await elementToImage(simEl);
  const box = (x: number, y: number, w: number, h: number) => { g.strokeStyle = 'rgba(244,241,232,0.18)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, h, 18); g.stroke(); };
  if (sim) {
    const sw = (sim as any).width, sh = (sim as any).height, w = W - 128, h = Math.min(560, (w * sh) / sw);
    g.save(); g.beginPath(); g.roundRect(64, 260, w, h, 18); g.clip(); g.drawImage(sim, 64, 260, w, h); g.restore(); box(64, 260, w, h);
  }
  const yb = 860;
  const diag = doc.image ? await urlToImage(doc.image) : await elementToImage(diagramEl);
  if (diag) {
    const dw = 380, dh = 300; const iw = (diag as any).width, ih = (diag as any).height; const s = Math.min(dw / iw, dh / ih);
    g.fillStyle = doc.image ? '#05070C' : '#F3EFE3'; g.beginPath(); g.roundRect(64, yb, dw, dh, 16); g.fill();
    g.drawImage(diag, 64 + (dw - iw * s) / 2, yb + (dh - ih * s) / 2, iw * s, ih * s); box(64, yb, dw, dh);
    g.fillStyle = 'rgba(244,241,232,0.5)'; g.font = '500 16px "JetBrains Mono Variable", monospace'; g.fillText('ORIGINAL DIAGRAM', 64, yb + dh + 28);
  }
  g.font = '500 16px "JetBrains Mono Variable", monospace';
  let ky = yb + 20;
  for (const [k, v] of keyValues(doc.config)) {
    g.fillStyle = 'rgba(244,241,232,0.5)'; g.fillText(k.toUpperCase(), 484, ky);
    g.fillStyle = '#4FE3F0'; g.font = '500 26px "JetBrains Mono Variable", monospace'; g.fillText(v, 484, ky + 32); g.font = '500 16px "JetBrains Mono Variable", monospace';
    ky += 62; if (ky > yb + 360) break;
  }
  g.fillStyle = '#D4FF3A'; g.font = '30px "JetBrains Mono Variable", monospace'; g.fillText(plainEquation(doc.config), 64, 1260);
  g.fillStyle = 'rgba(244,241,232,0.45)'; g.font = '20px "Inter Variable", sans-serif'; g.fillText('Ideal model. Values computed by Living Notes from the confirmed inputs.', 64, 1300);
  if (doc.share) {
    const QR = await import('qrcode');
    const qr = await urlToImage(await QR.toDataURL(doc.share.url, { margin: 1, width: 180, color: { dark: '#090D16', light: '#F4F1E8' } }));
    if (qr) { g.drawImage(qr, W - 64 - 150, 1200, 150, 150); }
    g.fillStyle = 'rgba(244,241,232,0.7)'; g.font = '18px "JetBrains Mono Variable", monospace'; g.fillText(doc.share.url.replace(/^https?:\/\//, '').slice(0, 52), 64, 1360);
  } else {
    g.fillStyle = 'rgba(244,241,232,0.45)'; g.font = '18px "Inter Variable", sans-serif'; g.fillText('Create a share link to add a QR code to this poster.', 64, 1360);
  }
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Poster failed'))), 'image/png'));
}

export function ShareDialog({ doc, onClose, onShared }: { doc: LabDoc; onClose: () => void; onShared: (s: NonNullable<LabDoc['share']>) => void }) {
  const [withImage, setWithImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);
  const create = async () => {
    setBusy(true); setErr(null);
    const r = await api.createShare({ title: doc.title, config: doc.config, summary: summarize(doc.config).slice(0, 400), assumptions: doc.interpretation?.assumptions.slice(0, 12), includeImage: withImage && Boolean(doc.image), image: withImage ? doc.image : undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    onShared({ id: r.data.id, url: r.data.url, includesImage: r.data.includesImage });
  };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Copy the link from the box'); } };
  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal fade-in" role="dialog" aria-modal="true" aria-labelledby="share-h">
        <h2 id="share-h" className="h2" style={{ fontSize: 32 }}>Share a read-only link</h2>
        {doc.share ? (<>
          <p className="muted" style={{ margin: 0 }}>Anyone with this link can open the experiment in its saved starting state{doc.share.includesImage ? ', including your diagram image' : '. Your uploaded image is not included'}.</p>
          <input className="text-in mono" readOnly value={doc.share.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
          <div className="row"><button className="btn btn-primary" onClick={() => copy(doc.share!.url)}>Copy link</button><a className="btn" href={doc.share.url} target="_blank" rel="noreferrer">Open</a><button className="btn btn-ghost" onClick={onClose}>Done</button></div>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Changes you make after sharing are not sent. Create a new link to share a new state.</p>
        </>) : (<>
          <p className="muted" style={{ margin: 0 }}>We store only the experiment settings and title on the server, under a long random link that can't be guessed.</p>
          {doc.image ? (
            <label className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
              <input type="checkbox" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} style={{ marginTop: 5 }} />
              <span><b>Also include my uploaded diagram image</b><br /><span className="muted" style={{ fontSize: 13 }}>Off by default. If on, the image is stored on the server and visible to anyone with the link.</span></span>
            </label>
          ) : null}
          {err && <Alert tone="coral"><p>{err}</p></Alert>}
          <div className="row"><button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create share link'}</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
        </>)}
      </div>
    </div>
  );
}
