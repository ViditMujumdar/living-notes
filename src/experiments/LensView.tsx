import { useMemo, useRef, useState } from 'react';
import type { LensConfig, ExperimentConfig } from '../../shared/schema';
import { solveLens, type LensResult } from '../../shared/physics/lens';
import { fmt } from '../../shared/experiment';
import { C } from '../components/ui';

const W = 720, H = 420;

export default function LensView({ config, onChange, exportId, compact }: { config: LensConfig; onChange?: (c: ExperimentConfig) => void; exportId?: string; compact?: boolean }) {
  const { focalLength: f, objectDistance: u, objectHeight: h } = config;
  const r = solveLens(config);
  const x = r.ok ? (r as LensResult) : null;
  const [fitAll, setFitAll] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | 'base' | 'tip'>(null);

  const base = Math.max(u, 2 * f);
  const img = x?.image ?? null;
  const imgReasonable = img ? Math.abs(img.distance) <= 3.2 * base && Math.abs(img.height) <= 6 * Math.max(Math.abs(h), f * 0.4) : false;
  const imgFittable = img ? Math.abs(img.distance) <= 60 * base : false;
  const includeImg = img && (imgReasonable || (fitAll && imgFittable));

  const view = useMemo(() => {
    const xs = [-u, -2 * f, 2 * f, f, -f];
    if (includeImg && img) xs.push(img.distance);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const padX = (xmax - xmin) * 0.1 + 2;
    let ymax = Math.max(Math.abs(h), f * 0.5) * 1.5;
    if (includeImg && img) ymax = Math.max(ymax, Math.abs(img.height) * 1.25);
    const x0 = xmin - padX, x1 = xmax + padX;
    const s = Math.min(W / (x1 - x0), H / (2 * ymax));
    const cxw = (x0 + x1) / 2;
    return { s, cxw, x0: cxw - W / 2 / s, x1: cxw + W / 2 / s, ymax: H / 2 / s };
  }, [u, f, h, includeImg, img?.distance, img?.height]);
  const X = (wx: number) => W / 2 + (wx - view.cxw) * view.s;
  const Y = (wy: number) => H / 2 - wy * view.s;
  const P = (wx: number, wy: number) => `${X(wx).toFixed(1)},${Y(wy).toFixed(1)}`;

  // Rays (world coordinates). Right edge of the view = where refracted rays end.
  const xR = view.x1, xL = view.x0;
  const rays: { d: string; dashed?: boolean; key: string }[] = [];
  const ext: { d: string; key: string }[] = [];
  if (x) {
    const lineAt = (ax: number, ay: number, bx: number, by: number, atX: number) => ay + ((by - ay) / (bx - ax)) * (atX - ax);
    // 1: parallel → through F′
    rays.push({ key: 'r1', d: `M${P(-u, h)} L${P(0, h)} L${P(xR, lineAt(0, h, f, 0, xR))}` });
    // 2: through optical centre, undeviated
    rays.push({ key: 'r2', d: `M${P(-u, h)} L${P(xR, lineAt(-u, h, 0, 0, xR))}` });
    // 3: through (or from the direction of) F → parallel
    if (Math.abs(f - u) > 1e-9) {
      const y3 = (h * f) / (f - u);
      if (Math.abs(y3) < view.ymax * 3) {
        rays.push({ key: 'r3', d: `M${P(-u, h)} L${P(0, y3)} L${P(xR, y3)}` });
        if (u < f) ext.push({ key: 'c3', d: `M${P(-f, 0)} L${P(-u, h)}` }); // construction line from F
        if (img && img.nature === 'virtual') ext.push({ key: 'e3', d: `M${P(0, y3)} L${P(img.distance, y3)}` });
      }
    }
    if (img && img.nature === 'virtual') {
      ext.push({ key: 'e1', d: `M${P(0, h)} L${P(img.distance, img.height)}` });
      ext.push({ key: 'e2', d: `M${P(0, 0)} L${P(img.distance, img.height)}` });
    }
  }

  const toWorld = (e: React.PointerEvent) => {
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { wx: view.cxw + (p.x - W / 2) / view.s, wy: (H / 2 - p.y) / view.s };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !onChange) return;
    const { wx, wy } = toWorld(e);
    if (drag.current === 'base') {
      const nu = Math.round(Math.min(Math.max(-wx, 0.5), 2000) * 2) / 2;
      if (nu !== u) onChange({ ...config, objectDistance: nu });
    } else {
      let nh = Math.round(wy * 2) / 2;
      if (Math.abs(nh) < 0.5) nh = Math.sign(h) * 0.5;
      nh = Math.max(-200, Math.min(200, nh));
      if (nh !== h) onChange({ ...config, objectHeight: nh });
    }
  };
  const lensH = Math.min(view.ymax * 0.92, Math.max(Math.abs(h), f * 0.5) * 1.35);
  const marks = [[-2 * f, '2F'], [-f, 'F'], [f, 'F′'], [2 * f, '2F′']] as const;
  const fontM = 'JetBrains Mono, monospace';
  const offscreen = img && !includeImg;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} id={exportId} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="lens-t lens-d" style={{ background: '#0A0F1B', touchAction: 'none' }}
        onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
        <title id="lens-t">Convex lens ray diagram</title>
        <desc id="lens-d">{x ? (img ? `Object at ${fmt(u)} cm forms a ${img.nature}, ${img.orientation} image at v = ${fmt(img.distance)} cm.` : 'Object at the focal point: image at infinity.') : 'Invalid lens values.'}</desc>
        <defs>
          <pattern id="lgrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke={C.grid} /></pattern>
          <linearGradient id="lensg" x1="0" x2="1"><stop offset="0" stopColor={C.cyan} stopOpacity="0.05" /><stop offset="0.5" stopColor={C.cyan} stopOpacity="0.22" /><stop offset="1" stopColor={C.cyan} stopOpacity="0.05" /></linearGradient>
          <marker id="arrL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill={C.lime} /></marker>
          <marker id="arrC" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill={C.cyan} /></marker>
        </defs>
        <rect width={W} height={H} fill="url(#lgrid)" />
        {/* principal axis */}
        <line x1="0" y1={Y(0)} x2={W} y2={Y(0)} stroke={C.paper} strokeOpacity="0.35" strokeDasharray="2 6" />
        {/* lens */}
        <path d={`M${X(0)},${Y(lensH)} Q ${X(0) + 16},${Y(0)} ${X(0)},${Y(-lensH)} Q ${X(0) - 16},${Y(0)} ${X(0)},${Y(lensH)}z`} fill="url(#lensg)" stroke={C.cyan} strokeOpacity="0.8" strokeWidth="1.5" />
        <line x1={X(0)} y1={Y(lensH) - 6} x2={X(0)} y2={Y(-lensH) + 6} stroke={C.cyan} strokeOpacity="0.25" />
        {marks.map(([wx, l]) => (
          <g key={l}><line x1={X(wx)} y1={Y(0) - 5} x2={X(wx)} y2={Y(0) + 5} stroke={C.paper} strokeOpacity="0.7" /><text x={X(wx)} y={Y(0) + 20} textAnchor="middle" fill={C.muted} fontSize="12" fontFamily={fontM}>{l}</text></g>
        ))}
        <text x={X(0) + 6} y={Y(0) + 20} fill={C.muted} fontSize="12" fontFamily={fontM}>O</text>
        {/* rays */}
        {rays.map((ry) => (
          <g key={ry.key}>
            <path d={ry.d} fill="none" stroke={C.cyan} strokeWidth="1.6" strokeOpacity="0.85" />
            <path d={ry.d} fill="none" stroke="#E9FDFF" strokeWidth="1.6" className="flow" strokeOpacity="0.55" />
          </g>
        ))}
        {ext.map((e) => <path key={e.key} d={e.d} fill="none" stroke={C.cyan} strokeWidth="1.3" strokeDasharray="5 6" strokeOpacity="0.55" />)}
        {/* image */}
        {img && includeImg && (
          <g>
            <line x1={X(img.distance)} y1={Y(0)} x2={X(img.distance)} y2={Y(img.height)} stroke={C.cyan} strokeWidth="3" strokeDasharray={img.nature === 'virtual' ? '6 5' : undefined} markerEnd="url(#arrC)" />
            <text x={X(img.distance) + 8} y={Y(img.height) + (img.height > 0 ? -6 : 16)} fill={C.cyan} fontSize="12" fontFamily={fontM}>image ({img.nature})</text>
          </g>
        )}
        {/* object (draggable) */}
        <line x1={X(-u)} y1={Y(0)} x2={X(-u)} y2={Y(h)} stroke={C.lime} strokeWidth="3.5" markerEnd="url(#arrL)" />
        <text x={X(-u) - 8} y={Y(h) + (h > 0 ? -10 : 18)} textAnchor="end" fill={C.lime} fontSize="12" fontFamily={fontM}>object</text>
        {onChange && <>
          <circle cx={X(-u)} cy={Y(0)} r="14" fill="transparent" stroke={C.lime} strokeOpacity="0.5" strokeDasharray="3 3" style={{ cursor: 'ew-resize' }}
            onPointerDown={(e) => { drag.current = 'base'; (e.target as Element).setPointerCapture(e.pointerId); }} aria-label="Drag to change object distance" />
          <circle cx={X(-u)} cy={Y(h)} r="13" fill="transparent" style={{ cursor: 'ns-resize' }}
            onPointerDown={(e) => { drag.current = 'tip'; (e.target as Element).setPointerCapture(e.pointerId); }} aria-label="Drag to change object height" />
        </>}
        {x?.atInfinity && <text x={W - 14} y={30} textAnchor="end" fill={C.amber} fontSize="13" fontFamily={fontM}>refracted rays are parallel: image at infinity</text>}
        {!compact && <text x="14" y={H - 12} fill={C.faint} fontSize="11" fontFamily={fontM}>lens at x = 0 · object at x = −u · scale {fmt(10 * view.s / 10)} px/cm</text>}
      </svg>
      {offscreen && img && (
        <div className="alert amber" style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: '8px 12px' }}>
          <span className="alert-ico">△</span>
          <div style={{ flex: 1 }}><p>The image is outside this view at v = {fmt(img.distance)} cm{Math.abs(img.distance) > 60 * base ? '. It is too far away to draw at a readable scale.' : '.'}</p></div>
          {imgFittable && <button className="btn btn-sm" onClick={() => setFitAll(true)}>Fit view</button>}
        </div>
      )}
      {fitAll && !imgReasonable && img && <button className="btn btn-sm" style={{ position: 'absolute', right: 10, top: 10 }} onClick={() => setFitAll(false)}>Zoom back</button>}
    </div>
  );
}
