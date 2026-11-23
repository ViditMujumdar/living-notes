import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectileConfig } from '../../shared/schema';
import { solveProjectile, projectileAt, sampleTrajectory, type ProjectileResult } from '../../shared/physics/projectile';
import { fmt } from '../../shared/experiment';
import { C } from '../components/ui';
import { useInView, useRaf, usePageVisible, useReducedMotion } from '../lib/hooks';

function niceStep(span: number, target = 6) {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export default function ProjectileView({ config, exportId, autoPlay = true }: { config: ProjectileConfig; exportId?: string; autoPlay?: boolean }) {
  const res = solveProjectile(config);
  const r = res.ok ? (res as ProjectileResult) : null;
  const T = r?.timeOfFlight ?? 0;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrapRef, inView] = useInView<HTMLDivElement>();
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 720, h: 400 });

  // restart when parameters change
  useEffect(() => { setT(0); setPlaying(autoPlay && !reduced && T > 0); }, [config.speed, config.angleDeg, config.gravity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setSize({ w, h: Math.round(Math.max(240, Math.min(460, w * 0.56))) }); });
    ro.observe(el); return () => ro.disconnect();
  }, [wrapRef]);

  // Simulation time advances with real elapsed time; positions are analytical in t, so frame rate never changes results.
  useRaf(playing && inView && visible, (dt) => {
    setT((prev) => {
      const nt = prev + dt * (slow ? 0.25 : 1);
      if (nt >= T) { setPlaying(false); return T; }
      return nt;
    });
  });

  const traj = useMemo(() => (r ? sampleTrajectory(r, 160) : []), [config.speed, config.angleDeg, config.gravity]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = r ? projectileAt(r, t) : null;

  // world → screen mapping with equal scaling on both axes
  const map = useMemo(() => {
    const { w, h } = size;
    const R = r?.range ?? 0, Hm = r?.maxHeight ?? 0;
    const spanX = Math.max(R * 1.12, Hm * 0.6, 1), spanY = Math.max(Hm * 1.3, spanX * 0.08, 0.5);
    const s = Math.min((w - 70) / spanX, (h - 60) / spanY);
    const ox = 50 + ((w - 70) - R * s) / 2 * 0.0, oy = h - 34;
    return { s, ox, oy, X: (x: number) => ox + x * s, Y: (y: number) => oy - y * s, w, h };
  }, [size, r?.range, r?.maxHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(map.w * dpr); cv.height = Math.round(map.h * dpr);
    const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0A0F1B'; g.fillRect(0, 0, map.w, map.h);
    // grid + axes labels in metres
    const stepX = niceStep((map.w - 60) / map.s), stepY = stepX;
    g.font = '11px JetBrains Mono, monospace'; g.lineWidth = 1;
    for (let x = 0; map.X(x) < map.w; x += stepX) { g.strokeStyle = C.grid; g.beginPath(); g.moveTo(map.X(x), 0); g.lineTo(map.X(x), map.oy); g.stroke(); g.fillStyle = C.faint; g.fillText(`${fmt(x)}`, map.X(x) + 3, map.oy + 16); }
    for (let y = stepY; map.Y(y) > 0; y += stepY) { g.strokeStyle = C.grid; g.beginPath(); g.moveTo(map.ox, map.Y(y)); g.lineTo(map.w, map.Y(y)); g.stroke(); g.fillStyle = C.faint; g.fillText(`${fmt(y)}`, 6, map.Y(y) + 4); }
    g.fillStyle = C.faint; g.fillText('m', map.w - 16, map.oy + 16);
    g.strokeStyle = C.paper; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(0, map.oy); g.lineTo(map.w, map.oy); g.stroke(); g.globalAlpha = 1;
    if (!r || !now) return;
    // predicted path
    g.setLineDash([4, 6]); g.strokeStyle = C.cyan; g.globalAlpha = 0.45; g.lineWidth = 1.5;
    g.beginPath(); traj.forEach((p, i) => (i ? g.lineTo(map.X(p.x), map.Y(p.y)) : g.moveTo(map.X(p.x), map.Y(p.y)))); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    // travelled path
    g.strokeStyle = C.lime; g.lineWidth = 2.5; g.beginPath();
    const steps = 80; for (let i = 0; i <= steps; i++) { const p = projectileAt(r, (i / steps) * t); i ? g.lineTo(map.X(p.x), map.Y(p.y)) : g.moveTo(map.X(p.x), map.Y(p.y)); } g.stroke();
    // apex + range markers
    if (T > 0) {
      const apex = projectileAt(r, r.timeToApex);
      g.strokeStyle = C.faint; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(map.X(apex.x), map.Y(apex.y)); g.lineTo(map.X(apex.x), map.oy); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.muted; g.fillText(`H = ${fmt(r.maxHeight)} m`, map.X(apex.x) + 6, map.Y(apex.y) - 8);
      g.fillText(`R = ${fmt(r.range)} m`, map.X(r.range) - 40, map.oy - 8);
    }
    // ball
    const bx = map.X(now.x), by = map.Y(now.y);
    const grd = g.createRadialGradient(bx, by, 0, bx, by, 18); grd.addColorStop(0, 'rgba(212,255,58,0.55)'); grd.addColorStop(1, 'rgba(212,255,58,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(bx, by, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.paper; g.beginPath(); g.arc(bx, by, 6.5, 0, Math.PI * 2); g.fill();
    // velocity vectors (scaled so v0 ≈ 22% of the shorter side)
    if (config.speed > 0) {
      const k = (0.22 * Math.min(map.w, map.h)) / config.speed;
      const arrow = (x0: number, y0: number, dx: number, dy: number, color: string, dash = false) => {
        const x1 = x0 + dx, y1 = y0 + dy, L = Math.hypot(dx, dy); if (L < 2) return;
        g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2; g.setLineDash(dash ? [4, 4] : []);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
        const a = Math.atan2(dy, dx); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); g.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); g.closePath(); g.fill();
      };
      arrow(bx, by, now.vx * k, 0, C.cyan, true);
      arrow(bx, by, 0, -now.vy * k, C.cyan, true);
      arrow(bx, by, now.vx * k, -now.vy * k, C.lime);
    }
  }, [map, t, traj, r, now, config.speed, T]);

  if (!r) return <div className="empty"><p className="coral">{(res as { errors: string[] }).errors.join(' ')}</p></div>;
  const pct = T > 0 ? t / T : 0;
  return (
    <div ref={wrapRef}>
      <canvas ref={canvasRef} id={exportId} style={{ width: '100%', height: size.h }} role="img" aria-label={`Projectile trajectory. At t = ${fmt(t)} s the projectile is at x = ${fmt(now!.x)} m, y = ${fmt(now!.y)} m.`} />
      <div className="stack" style={{ padding: '10px 14px', gap: 10, borderTop: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-primary" disabled={T === 0} onClick={() => { if (t >= T) setT(0); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚ Pause' : t >= T && T > 0 ? '↻ Replay' : '▶ Play'}</button>
          <button className="btn btn-sm" onClick={() => { setPlaying(false); setT(0); }}>Reset</button>
          <label className="row" style={{ gap: 6, fontSize: 13, color: 'var(--muted)', minHeight: 36 }}><input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Slow motion ¼×</label>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--cyan)' }}>t = {fmt(t)} / {fmt(T)} s</span>
        </div>
        <input type="range" aria-label="Time scrubber" min={0} max={Math.max(T, 1e-6)} step={Math.max(T / 400, 1e-6)} value={t} disabled={T === 0} style={{ ['--p' as string]: `${pct * 100}%` }}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
        <div className="readouts" aria-live="off">
          <div className="readout"><span className="k">x</span><span className="v">{fmt(now!.x)}<small>m</small></span></div>
          <div className="readout"><span className="k">y</span><span className="v">{fmt(now!.y)}<small>m</small></span></div>
          <div className="readout"><span className="k">v_x</span><span className="v">{fmt(now!.vx)}<small>m/s</small></span></div>
          <div className="readout"><span className="k">v_y</span><span className="v">{fmt(now!.vy)}<small>m/s</small></span></div>
        </div>
        <Graph r={r} t={t} />
        <div className="legend"><span><i style={{ background: C.lime }} />velocity</span><span><i style={{ background: C.cyan }} />components</span><span><i style={{ background: C.cyan, opacity: 0.5 }} />predicted path</span></div>
      </div>
    </div>
  );
}

/** Height and vertical velocity against time, with a cursor synced to the animation. */
function Graph({ r, t }: { r: ProjectileResult; t: number }) {
  const T = r.timeOfFlight; if (T === 0) return null;
  const W = 640, H = 160, pad = 30, gw = (W - pad * 3) / 2, gh = H - 52;
  const pts = Array.from({ length: 61 }, (_, i) => projectileAt(r, (i / 60) * T));
  const ymax = Math.max(r.maxHeight, 1e-9), vmax = Math.max(Math.abs(r.vy0), Math.abs(r.vx), 1e-9);
  const yPath = pts.map((p, i) => `${i ? 'L' : 'M'}${(pad + (p.t / T) * gw).toFixed(1)},${(30 + gh - (p.y / ymax) * gh).toFixed(1)}`).join(' ');
  const vy = (v: number) => 30 + gh / 2 - (v / vmax) * (gh / 2);
  const x2 = pad * 2 + gw;
  const vyPath = `M${x2},${vy(r.vy0)} L${x2 + gw},${vy(r.vy0 - r.input.gravity * T)}`;
  const vxPath = `M${x2},${vy(r.vx)} L${x2 + gw},${vy(r.vx)}`;
  const cur = t / T;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graphs of height and velocity components against time">
      <text x={pad} y="12" fill={C.muted} fontSize="11" fontFamily="JetBrains Mono, monospace">height y(t): a parabola, peak at T/2</text>
      <line x1={pad} y1={30 + gh} x2={pad + gw} y2={30 + gh} stroke={C.line} />
      <path d={yPath} fill="none" stroke={C.cyan} strokeWidth="2" />
      <text x={x2} y="12" fill={C.muted} fontSize="11" fontFamily="JetBrains Mono, monospace">v_x constant · v_y falls by g each second</text>
      <line x1={x2} y1={vy(0)} x2={x2 + gw} y2={vy(0)} stroke={C.line} />
      <path d={vxPath} fill="none" stroke={C.cyan} strokeWidth="2" strokeDasharray="5 4" />
      <path d={vyPath} fill="none" stroke={C.lime} strokeWidth="2" />
      <text x={x2 + gw - 4} y={vy(r.vx) + 14} textAnchor="end" fill={C.cyan} fontSize="10" fontFamily="JetBrains Mono, monospace">v_x</text>
      <text x={x2 + 6} y={vy(r.vy0) + 14} fill={C.lime} fontSize="10" fontFamily="JetBrains Mono, monospace">v_y</text>
      {[pad, x2].map((x0) => <line key={x0} x1={x0 + cur * gw} y1="24" x2={x0 + cur * gw} y2={30 + gh} stroke={C.paper} strokeOpacity="0.7" />)}
      <circle cx={pad + cur * gw} cy={30 + gh - (projectileAt(r, t).y / ymax) * gh} r="4" fill={C.paper} />
      <circle cx={x2 + cur * gw} cy={vy(projectileAt(r, t).vy)} r="4" fill={C.lime} />
      <text x={pad} y={H - 4} fill={C.faint} fontSize="10" fontFamily="JetBrains Mono, monospace">0 s</text>
      <text x={pad + gw} y={H - 4} textAnchor="end" fill={C.faint} fontSize="10" fontFamily="JetBrains Mono, monospace">{fmt(T)} s</text>
      <text x={x2 + gw} y={H - 4} textAnchor="end" fill={C.faint} fontSize="10" fontFamily="JetBrains Mono, monospace">{fmt(T)} s</text>
    </svg>
  );
}
