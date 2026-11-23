import { useMemo, useRef } from 'react';
import type { CircuitConfig } from '../../shared/schema';
import { solveCircuit, type CircuitResult } from '../../shared/physics/circuit';
import { fmt } from '../../shared/experiment';
import { C } from '../components/ui';
import { useInView, useRaf, useReducedMotion, usePageVisible } from '../lib/hooks';

type Pt = [number, number];
interface ResPlace { a: Pt; b: Pt; label: string; tagSide: 'above' | 'left' | 'right' }
interface Layout { wires: Pt[][]; resistors: ResPlace[]; paths: { pts: Pt[]; resistorIndex: number | null }[]; junctions: Pt[] }

const TOP = 70, BOT = 310, BX = 80, BAT_TOP = 178, BAT_BOT = 202;

/** Geometry for each supported topology. Paths are used for the illustrative current dots. */
export function circuitLayout(c: CircuitConfig): Layout {
  const n = c.resistors.length;
  const loopStart: Pt[] = [[BX, BAT_TOP], [BX, TOP]];
  const loopEnd = (x: number): Pt[] => [[x, BOT], [BX, BOT], [BX, BAT_BOT]];
  if (c.topology === 'series') {
    const xs = n === 1 ? [320] : n === 2 ? [250, 420] : [220, 390];
    const res: ResPlace[] = xs.map((x, i) => ({ a: [x - 50, TOP], b: [x + 50, TOP], label: `R${i + 1}`, tagSide: 'above' }));
    if (n === 3) res.push({ a: [560, 140], b: [560, 240], label: 'R3', tagSide: 'left' });
    return {
      wires: [[[BX, BAT_TOP], [BX, TOP], [560, TOP], [560, BOT], [BX, BOT], [BX, BAT_BOT]]],
      resistors: res,
      paths: [{ pts: [...loopStart, [560, TOP], ...loopEnd(560)], resistorIndex: null }],
      junctions: [],
    };
  }
  if (c.topology === 'parallel') {
    const xs = n === 2 ? [330, 500] : [250, 400, 550];
    const last = xs[xs.length - 1]!;
    return {
      wires: [[[BX, BAT_TOP], [BX, TOP], [last, TOP]], [[last, BOT], [BX, BOT], [BX, BAT_BOT]], ...xs.map((x) => [[x, TOP], [x, BOT]] as Pt[])],
      resistors: xs.map((x, i) => ({ a: [x, 140], b: [x, 240], label: `R${i + 1}`, tagSide: i === xs.length - 1 ? 'left' : 'right' })),
      paths: xs.map((x, i) => ({ pts: [...loopStart, [x, TOP], ...loopEnd(x)], resistorIndex: i })),
      junctions: xs.slice(0, -1).flatMap((x) => [[x, TOP], [x, BOT]] as Pt[]),
    };
  }
  // mixed: R1 on the top rail, then R2 || R3
  const xs = [400, 550];
  return {
    wires: [[[BX, BAT_TOP], [BX, TOP], [550, TOP]], [[550, BOT], [BX, BOT], [BX, BAT_BOT]], ...xs.map((x) => [[x, TOP], [x, BOT]] as Pt[])],
    resistors: [
      { a: [180, TOP], b: [280, TOP], label: 'R1', tagSide: 'above' },
      { a: [400, 140], b: [400, 240], label: 'R2', tagSide: 'right' },
      { a: [550, 140], b: [550, 240], label: 'R3', tagSide: 'left' },
    ],
    paths: xs.map((x, i) => ({ pts: [...loopStart, [x, TOP], ...loopEnd(x)], resistorIndex: i + 1 })),
    junctions: [[400, TOP], [400, BOT]],
  };
}

function zigzag(a: Pt, b: Pt): string {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const lead = 14, teeth = 6, amp = 9, seg = (L - 2 * lead) / teeth;
  let d = `M${a[0]},${a[1]} L${a[0] + ux * lead},${a[1] + uy * lead}`;
  for (let i = 0; i < teeth; i++) {
    const t = lead + seg * (i + 0.5), s = i % 2 ? -1 : 1;
    d += ` L${a[0] + ux * t + nx * amp * s},${a[1] + uy * t + ny * amp * s}`;
  }
  d += ` L${b[0] - ux * lead},${b[1] - uy * lead} L${b[0]},${b[1]}`;
  return d;
}

/** Split wires so they don't run through resistor bodies. */
function wireSegments(layout: Layout): string {
  const parts: string[] = [];
  for (const poly of layout.wires) {
    for (let i = 0; i < poly.length - 1; i++) {
      const p = poly[i]!, q = poly[i + 1]!;
      // collect resistors lying on this segment
      const cuts = layout.resistors.filter((r) => onSeg(r.a, p, q) && onSeg(r.b, p, q)).map((r) => {
        const ta = proj(r.a, p, q), tb = proj(r.b, p, q); return [Math.min(ta, tb), Math.max(ta, tb)] as [number, number];
      }).sort((x, y) => x[0] - y[0]);
      let t0 = 0;
      for (const [s, e] of [...cuts, [1, 1] as [number, number]]) {
        if (s > t0) parts.push(`M${lerp(p, q, t0).join(',')} L${lerp(p, q, s).join(',')}`);
        t0 = Math.max(t0, e);
      }
    }
  }
  return parts.join(' ');
}
const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const proj = (r: Pt, p: Pt, q: Pt) => { const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; return ((r[0] - p[0]) * (q[0] - p[0]) + (r[1] - p[1]) * (q[1] - p[1])) / L2; };
const onSeg = (r: Pt, p: Pt, q: Pt) => { const t = proj(r, p, q); const c = lerp(p, q, t); return t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(c[0] - r[0], c[1] - r[1]) < 0.5; };

function polyLen(pts: Pt[]) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); return L; }
function pointAt(pts: Pt[], s: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l) return lerp(a, b, s / l);
    s -= l;
  }
  return pts[pts.length - 1]!;
}

export default function CircuitView({ config, onPickResistor, exportId }: { config: CircuitConfig; onPickResistor?: (i: number) => void; exportId?: string }) {
  const layout = useMemo(() => circuitLayout(config), [config.topology, config.resistors.length]);
  const res = solveCircuit({ topology: config.topology, voltage: config.voltage, resistors: config.resistors });
  const ok = res.ok ? (res as CircuitResult) : null;
  const [ref, inView] = useInView<SVGSVGElement>();
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const dotsRef = useRef<SVGGElement>(null);
  const offsets = useRef<number[]>([]);

  // Current through each animated path.
  const pathCurrents = layout.paths.map((p) => (ok ? (p.resistorIndex == null ? ok.totalCurrent : ok.resistors[p.resistorIndex]!.current) : 0));
  const maxI = Math.max(1e-9, ...pathCurrents);
  const SPACING = 30;
  const dotsPerPath = layout.paths.map((p) => Math.floor(polyLen(p.pts) / SPACING));

  useRaf(inView && visible && !reduced && Boolean(ok) && ok!.totalCurrent > 0, (dt) => {
    const g = dotsRef.current; if (!g) return;
    let k = 0;
    layout.paths.forEach((p, pi) => {
      const L = polyLen(p.pts);
      // Illustrative speed: proportional to current, normalised so the largest current moves at 70 px/s.
      const v = 70 * (pathCurrents[pi]! / maxI);
      offsets.current[pi] = ((offsets.current[pi] ?? 0) + v * dt) % SPACING;
      for (let d = 0; d < dotsPerPath[pi]!; d++) {
        const el = g.children[k++] as SVGCircleElement | undefined;
        if (!el) continue;
        const [x, y] = pointAt(p.pts, (d * SPACING + offsets.current[pi]!) % L);
        el.setAttribute('cx', x.toFixed(1)); el.setAttribute('cy', y.toFixed(1));
      }
    });
  });

  const maxP = ok ? Math.max(1e-9, ...ok.resistors.map((r) => r.power)) : 1;
  return (
    <svg ref={ref} id={exportId} viewBox="0 0 640 380" role="img" aria-labelledby="circ-title circ-desc" style={{ background: '#0A0F1B' }}>
      <title id="circ-title">Circuit schematic</title>
      <desc id="circ-desc">{ok ? `${config.topology} circuit with a ${fmt(config.voltage)} volt source and ${config.resistors.length} resistors.` : 'Circuit has invalid values.'}</desc>
      <defs>
        <filter id="heat" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        <pattern id="cgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke={C.grid} strokeWidth="1" /></pattern>
      </defs>
      <rect width="640" height="380" fill="url(#cgrid)" />
      {/* wires */}
      <path d={wireSegments(layout)} fill="none" stroke={C.paper} strokeOpacity="0.78" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {layout.junctions.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill={C.paper} />)}
      {/* battery (long plate = +) */}
      <g>
        <line x1={BX - 22} y1={BAT_TOP} x2={BX + 22} y2={BAT_TOP} stroke={C.paper} strokeWidth="3" />
        <line x1={BX - 12} y1={BAT_BOT} x2={BX + 12} y2={BAT_BOT} stroke={C.paper} strokeWidth="6" />
        <text x={BX + 30} y={BAT_TOP - 4} fill={C.lime} fontSize="15" fontFamily="JetBrains Mono, monospace">+</text>
        <text x={BX + 30} y={BAT_BOT + 14} fill={C.muted} fontSize="15" fontFamily="JetBrains Mono, monospace">−</text>
        <text x={BX - 30} y={(BAT_TOP + BAT_BOT) / 2 + 5} fill={C.paper} fontSize="15" textAnchor="end" fontFamily="JetBrains Mono, monospace">{fmt(config.voltage)} V</text>
      </g>
      {/* current dots (illustrative) */}
      <g ref={dotsRef} aria-hidden="true">
        {ok && ok.totalCurrent > 0 && layout.paths.flatMap((p, pi) => Array.from({ length: dotsPerPath[pi]! }, (_, d) => {
          const [x, y] = pointAt(p.pts, d * SPACING);
          return <circle key={`${pi}-${d}`} cx={x} cy={y} r="3" fill={C.lime} opacity="0.9" />;
        }))}
      </g>
      {/* resistors */}
      {layout.resistors.map((r, i) => {
        const rr = ok?.resistors[i];
        const heat = rr ? Math.min(1, rr.power / maxP) : 0;
        const mid: Pt = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
        const vertical = r.a[0] === r.b[0];
        const tx = r.tagSide === 'right' ? mid[0] + 22 : r.tagSide === 'left' ? mid[0] - 22 : mid[0];
        // 'left' tags sit lower so they never collide with a neighbouring branch's 'right' tag
        const ty = r.tagSide === 'above' ? mid[1] - 40 : r.tagSide === 'left' ? mid[1] + 30 : mid[1] - 8;
        const anchor = r.tagSide === 'right' ? 'start' : r.tagSide === 'left' ? 'end' : 'middle';
        return (
          <g key={i} onClick={() => onPickResistor?.(i)} style={{ cursor: onPickResistor ? 'pointer' : undefined }}>
            <path d={zigzag(r.a, r.b)} fill="none" stroke={C.amber} strokeOpacity={0.15 + 0.6 * heat} strokeWidth="10" filter="url(#heat)" />
            <path d={zigzag(r.a, r.b)} fill="none" stroke={C.paper} strokeWidth="2.4" strokeLinejoin="round" />
            <rect x={Math.min(r.a[0], r.b[0]) - (vertical ? 16 : 0)} y={Math.min(r.a[1], r.b[1]) - (vertical ? 0 : 16)} width={vertical ? 32 : 100} height={vertical ? 100 : 32} fill="transparent" />
            <text x={tx} y={ty} textAnchor={anchor} fill={C.paper} fontSize="14" fontFamily="Inter, sans-serif" fontWeight="600">{r.label} <tspan fill={C.muted} fontWeight="400">{fmt(config.resistors[i]!)} Ω</tspan></text>
            {rr && <text x={tx} y={ty + 17} textAnchor={anchor} fill={C.cyan} fontSize="12" fontFamily="JetBrains Mono, monospace">{fmt(rr.current)} A · {fmt(rr.voltage)} V</text>}
          </g>
        );
      })}
      {ok && <text x="620" y="364" textAnchor="end" fill={C.faint} fontSize="11" fontFamily="JetBrains Mono, monospace">I = {fmt(ok.totalCurrent)} A · conventional current, illustrative dot speed</text>}
      {!ok && <text x="320" y="364" textAnchor="middle" fill={C.coral} fontSize="13" fontFamily="Inter, sans-serif">Fix the highlighted values to run the circuit.</text>}
    </svg>
  );
}
