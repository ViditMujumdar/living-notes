/**
 * Custom "textbook page" illustrations used for the curated examples.
 * They are drawings made for this app (not AI output), shown on warm paper.
 * Each exports highlight boxes (viewBox units) for the landing animation.
 */
const INK = '#1F1B14', RED = '#B4432F', LIGHT = '#6B6457';
const serif = "'Instrument Serif', Georgia, serif";

export const PAPER_HIGHLIGHTS: Record<'circuit' | 'lens' | 'projectile', { box: [number, number, number, number]; label: string }[]> = {
  circuit: [
    { box: [18, 70, 62, 130], label: 'battery 12 V' },
    { box: [78, 26, 152, 54], label: 'R1 4 Ω' },
    { box: [178, 70, 222, 138], label: 'R2 6 Ω' },
    { box: [238, 70, 282, 138], label: 'R3 12 Ω' },
  ],
  lens: [
    { box: [40, 52, 74, 112], label: 'object' },
    { box: [140, 18, 172, 162], label: 'convex lens' },
    { box: [100, 104, 128, 126], label: 'F' },
    { box: [58, 128, 156, 150], label: 'u = 25 cm' },
  ],
  projectile: [
    { box: [26, 108, 64, 146], label: 'launch' },
    { box: [44, 90, 112, 124], label: 'θ = 45°' },
    { box: [70, 36, 170, 64], label: 'v₀ = 20 m/s' },
    { box: [24, 140, 280, 160], label: 'level ground' },
  ],
};

function Zig({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
  let d = `M${x1},${y1}`; const n = 6, lead = 8, seg = (L - 2 * lead) / n;
  d += ` L${x1 + ux * lead},${y1 + uy * lead}`;
  for (let i = 0; i < n; i++) { const t = lead + seg * (i + 0.5), s = i % 2 ? -6 : 6; d += ` L${x1 + ux * t + nx * s},${y1 + uy * t + ny * s}`; }
  d += ` L${x2 - ux * lead},${y2 - uy * lead} L${x2},${y2}`;
  return <path d={d} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />;
}

export function CircuitPaper({ highlight = -1 }: { highlight?: number }) {
  return (
    <svg viewBox="0 0 300 180" role="img" aria-label="Textbook diagram: a 12 V battery with R1 = 4 Ω in series with R2 = 6 Ω and R3 = 12 Ω in parallel">
      <text x="10" y="16" fontSize="11" fill={LIGHT} fontFamily={serif} fontStyle="italic">Fig. 12.4: Combination of resistors</text>
      <path d="M40 92 V40 H110 M150 40 H260 V82 M200 40 V82 M200 126 V160 H40 V108 M260 126 V160" fill="none" stroke={INK} strokeWidth="1.6" />
      <line x1="26" y1="92" x2="54" y2="92" stroke={INK} strokeWidth="1.8" /><line x1="33" y1="108" x2="47" y2="108" stroke={INK} strokeWidth="4" />
      <text x="58" y="104" fontSize="13" fill={INK} fontFamily={serif}>12 V</text>
      <Zig x1={110} y1={40} x2={150} y2={40} /><Zig x1={200} y1={82} x2={200} y2={126} /><Zig x1={260} y1={82} x2={260} y2={126} />
      <circle cx="200" cy="40" r="2.6" fill={INK} /><circle cx="200" cy="160" r="2.6" fill={INK} />
      <text x="114" y="30" fontSize="13" fill={INK} fontFamily={serif}>R₁ = 4 Ω</text>
      <text x="168" y="108" fontSize="13" fill={INK} fontFamily={serif} textAnchor="end">6 Ω</text>
      <text x="268" y="108" fontSize="13" fill={INK} fontFamily={serif}>12 Ω</text>
      <text x="206" y="74" fontSize="11" fill={LIGHT} fontFamily={serif}>R₂</text><text x="266" y="74" fontSize="11" fill={LIGHT} fontFamily={serif}>R₃</text>
      <Hl i={highlight} kind="circuit" />
    </svg>
  );
}

export function LensPaper({ highlight = -1 }: { highlight?: number }) {
  return (
    <svg viewBox="0 0 300 180" role="img" aria-label="Textbook diagram: an object 25 cm from a convex lens of focal length 10 cm">
      <text x="10" y="16" fontSize="11" fill={LIGHT} fontFamily={serif} fontStyle="italic">Fig. 9.12: Image by a convex lens</text>
      <line x1="10" y1="112" x2="290" y2="112" stroke={INK} strokeWidth="1" strokeDasharray="4 3" />
      <path d="M156 26 Q 170 112 156 158 Q 142 112 156 26z" fill="rgba(80,140,170,0.12)" stroke={INK} strokeWidth="1.4" />
      <line x1="57" y1="112" x2="57" y2="62" stroke={RED} strokeWidth="2" /><path d="M51 70 L57 58 L63 70z" fill={RED} />
      {[[114, 'F'], [72, '2F'], [198, 'F'], [240, '2F']].map(([x, l]) => <g key={`${x}`}><line x1={Number(x)} y1="108" x2={Number(x)} y2="116" stroke={INK} /><text x={Number(x)} y="124" fontSize="11" textAnchor="middle" fill={INK} fontFamily={serif}>{l}</text></g>)}
      <path d="M57 140 H156" stroke={INK} strokeWidth="0.8" markerStart="url(#pa)" markerEnd="url(#pa)" />
      <defs><marker id="pa" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6z" fill={INK} /></marker></defs>
      <text x="106" y="138" fontSize="12" textAnchor="middle" fill={INK} fontFamily={serif}>u = 25 cm</text>
      <text x="200" y="40" fontSize="12" fill={INK} fontFamily={serif}>f = 10 cm</text>
      <text x="38" y="58" fontSize="11" fill={LIGHT} fontFamily={serif}>h = 4 cm</text>
      <Hl i={highlight} kind="lens" />
    </svg>
  );
}

export function ProjectilePaper({ highlight = -1 }: { highlight?: number }) {
  return (
    <svg viewBox="0 0 300 180" role="img" aria-label="Textbook diagram: a ball launched at 45 degrees with speed 20 m/s over level ground">
      <text x="10" y="16" fontSize="11" fill={LIGHT} fontFamily={serif} fontStyle="italic">Fig. 4.18: Projectile on level ground</text>
      <line x1="20" y1="150" x2="290" y2="150" stroke={INK} strokeWidth="1.4" />
      {Array.from({ length: 14 }, (_, i) => <line key={i} x1={24 + i * 19} y1="150" x2={16 + i * 19} y2="158" stroke={INK} strokeWidth="0.8" />)}
      <path d="M44 146 Q 150 -40 262 146" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="4 4" />
      <circle cx="44" cy="144" r="6" fill={RED} />
      <line x1="44" y1="144" x2="96" y2="92" stroke={INK} strokeWidth="1.6" /><path d="M96 92 L86 95 L93 102z" fill={INK} />
      <path d="M74 144 A 30 30 0 0 0 65 123" fill="none" stroke={INK} />
      <text x="80" y="134" fontSize="12" fill={INK} fontFamily={serif}>45°</text>
      <text x="96" y="58" fontSize="13" fill={INK} fontFamily={serif}>v₀ = 20 m s⁻¹</text>
      <text x="230" y="170" fontSize="11" fill={LIGHT} fontFamily={serif}>g = 9.81 m s⁻²</text>
      <Hl i={highlight} kind="projectile" />
    </svg>
  );
}

function Hl({ i, kind }: { i: number; kind: 'circuit' | 'lens' | 'projectile' }) {
  if (i < 0) return null;
  return <g>{PAPER_HIGHLIGHTS[kind].slice(0, i + 1).map((h, k) => {
    const [x0, y0, x1, y1] = h.box;
    return <rect key={k} className="hl-box on" x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="4" stroke="#7A9A00" />;
  })}</g>;
}

export function PaperFor({ type, highlight }: { type: 'circuit' | 'lens' | 'projectile'; highlight?: number }) {
  return type === 'circuit' ? <CircuitPaper highlight={highlight} /> : type === 'lens' ? <LensPaper highlight={highlight} /> : <ProjectilePaper highlight={highlight} />;
}
