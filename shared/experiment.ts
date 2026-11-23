/**
 * Experiment model: parameter metadata, deterministic results, equations,
 * text summaries, and conversion from an AI interpretation into an editable draft.
 */
import { solveCircuit, TOPOLOGY_LABEL, type CircuitResult } from './physics/circuit';
import { solveLens, type LensResult } from './physics/lens';
import { solveProjectile, type ProjectileResult } from './physics/projectile';
import { ExperimentConfig, type CircuitConfig, type Interpretation, type AIQuantity } from './schema';
import { normalise, type Quantity } from './units';

/* ---------------- parameters ---------------- */

export interface ParamMeta {
  key: string;
  label: string;
  symbol: string;
  unit: string;
  min: number; // slider range
  max: number;
  step: number;
  /** Hard validity bounds (inputs outside are rejected, not clamped). */
  validMin: number;
  validMax: number;
  exclusiveMin?: boolean;
}

export const PARAMS: Record<ExperimentConfig['type'], ParamMeta[]> = {
  circuit: [
    { key: 'voltage', label: 'Source voltage', symbol: 'V', unit: 'V', min: 0, max: 24, step: 0.1, validMin: 0, validMax: 1000 },
    { key: 'r1', label: 'Resistance R1', symbol: 'R₁', unit: 'Ω', min: 1, max: 100, step: 0.5, validMin: 0, validMax: 1e6, exclusiveMin: true },
    { key: 'r2', label: 'Resistance R2', symbol: 'R₂', unit: 'Ω', min: 1, max: 100, step: 0.5, validMin: 0, validMax: 1e6, exclusiveMin: true },
    { key: 'r3', label: 'Resistance R3', symbol: 'R₃', unit: 'Ω', min: 1, max: 100, step: 0.5, validMin: 0, validMax: 1e6, exclusiveMin: true },
  ],
  lens: [
    { key: 'focalLength', label: 'Focal length', symbol: 'f', unit: 'cm', min: 2, max: 40, step: 0.5, validMin: 0, validMax: 500, exclusiveMin: true },
    { key: 'objectDistance', label: 'Object distance', symbol: 'u', unit: 'cm', min: 1, max: 100, step: 0.5, validMin: 0, validMax: 2000, exclusiveMin: true },
    { key: 'objectHeight', label: 'Object height', symbol: 'h', unit: 'cm', min: 1, max: 20, step: 0.5, validMin: -200, validMax: 200 },
  ],
  projectile: [
    { key: 'speed', label: 'Initial speed', symbol: 'v₀', unit: 'm/s', min: 0, max: 60, step: 0.5, validMin: 0, validMax: 1000 },
    { key: 'angleDeg', label: 'Launch angle', symbol: 'θ', unit: '°', min: 0, max: 90, step: 1, validMin: 0, validMax: 90 },
    { key: 'gravity', label: 'Gravitational acceleration', symbol: 'g', unit: 'm/s²', min: 1, max: 25, step: 0.01, validMin: 0, validMax: 300, exclusiveMin: true },
  ],
};

export function paramValue(c: ExperimentConfig, key: string): number | undefined {
  if (c.type === 'circuit') {
    if (key === 'voltage') return c.voltage;
    const m = /^r([123])$/.exec(key);
    return m ? c.resistors[Number(m[1]) - 1] : undefined;
  }
  return (c as Record<string, unknown>)[key] as number | undefined;
}

/** Returns a new config with one parameter changed, or an error message. Never mutates. */
export function setParam(c: ExperimentConfig, key: string, value: number): { config: ExperimentConfig } | { error: string } {
  const meta = PARAMS[c.type].find((p) => p.key === key);
  if (!meta) return { error: `Unknown parameter "${key}".` };
  if (!Number.isFinite(value)) return { error: `${meta.label} must be a number.` };
  if (meta.exclusiveMin ? value <= meta.validMin : value < meta.validMin) return { error: `${meta.label} must be ${meta.exclusiveMin ? 'greater than' : 'at least'} ${meta.validMin} ${meta.unit}.` };
  if (value > meta.validMax) return { error: `${meta.label} must be at most ${meta.validMax} ${meta.unit}.` };
  let next: unknown;
  if (c.type === 'circuit') {
    if (key === 'voltage') next = { ...c, voltage: value };
    else {
      const i = Number(key.slice(1)) - 1;
      if (i >= c.resistors.length) return { error: `This circuit has no R${i + 1}.` };
      const rs = c.resistors.slice(); rs[i] = value; next = { ...c, resistors: rs };
    }
  } else next = { ...c, [key]: value };
  const parsed = ExperimentConfig.safeParse(next);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid value.' };
  return { config: parsed.data };
}

/** Keys that exist for this specific config (e.g. r3 only when there are 3 resistors). */
export function activeParams(c: ExperimentConfig): ParamMeta[] {
  if (c.type !== 'circuit') return PARAMS[c.type];
  return PARAMS.circuit.filter((p) => p.key === 'voltage' || Number(p.key.slice(1)) <= c.resistors.length);
}

/* ---------------- results ---------------- */

export type Results =
  | { type: 'circuit'; result: ReturnType<typeof solveCircuit> }
  | { type: 'lens'; result: ReturnType<typeof solveLens> }
  | { type: 'projectile'; result: ReturnType<typeof solveProjectile> };

export function compute(c: ExperimentConfig): Results {
  if (c.type === 'circuit') return { type: 'circuit', result: solveCircuit({ topology: c.topology, voltage: c.voltage, resistors: c.resistors }) };
  if (c.type === 'lens') return { type: 'lens', result: solveLens(c) };
  return { type: 'projectile', result: solveProjectile(c) };
}

/* ---------------- formatting ---------------- */

export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  const s = v.toPrecision(digits);
  return String(Number(s));
}

export const ASSUMPTIONS: Record<ExperimentConfig['type'], string[]> = {
  circuit: [
    'Ideal voltage source (no internal resistance).',
    'Connecting wires have zero resistance.',
    'Resistors are ohmic: resistance does not change with current or temperature.',
    'Current values are steady DC; conventional current flows from + to −.',
  ],
  lens: [
    'Ideal thin convex lens in air; paraxial rays only.',
    'Lens at x = 0, real object at x = −u with u > 0, focal length f > 0.',
    '1/f = 1/u + 1/v and m = −v/u; v < 0 means a virtual image on the object side.',
  ],
  projectile: [
    'No air resistance.',
    'Uniform gravitational field, flat ground.',
    'Launch and landing at the same height (y = 0).',
  ],
};

export const TITLES: Record<ExperimentConfig['type'], string> = {
  circuit: 'DC resistor circuit',
  lens: 'Convex lens ray diagram',
  projectile: 'Projectile motion',
};

/** Plain-language summary of current results (used for screen readers and as tutor context). */
export function summarize(c: ExperimentConfig): string {
  const r = compute(c);
  if (r.type === 'circuit') {
    if (!r.result.ok) return `Circuit is invalid: ${r.result.errors.join(' ')}`;
    const x = r.result as CircuitResult;
    const parts = x.resistors.map((ri) => `R${ri.index + 1} = ${fmt(ri.resistance)} Ω carries ${fmt(ri.current)} A with ${fmt(ri.voltage)} V across it and dissipates ${fmt(ri.power)} W`);
    return `${TOPOLOGY_LABEL[x.topology]} circuit with a ${fmt(x.voltage)} V source. Total resistance ${fmt(x.totalResistance)} Ω, total current ${fmt(x.totalCurrent)} A, total power ${fmt(x.totalPower)} W. ${parts.join('; ')}.`;
  }
  if (r.type === 'lens') {
    if (!r.result.ok) return `Lens setup is invalid: ${r.result.errors.join(' ')}`;
    const x = r.result as LensResult;
    const base = `Convex lens with f = ${fmt(x.input.focalLength)} cm, object at u = ${fmt(x.input.objectDistance)} cm, height ${fmt(x.input.objectHeight)} cm. `;
    if (!x.image) return base + 'The object is at the focal point, so the image forms at infinity.';
    return base + `Image distance v = ${fmt(x.image.distance)} cm, magnification m = ${fmt(x.image.magnification)}, image height ${fmt(x.image.height)} cm. The image is ${x.image.nature}, ${x.image.orientation} and ${x.image.size}.`;
  }
  if (!r.result.ok) return `Projectile setup is invalid: ${r.result.errors.join(' ')}`;
  const x = r.result as ProjectileResult;
  return `Launch speed ${fmt(x.input.speed)} m/s at ${fmt(x.input.angleDeg)}° with g = ${fmt(x.input.gravity)} m/s². Time of flight ${fmt(x.timeOfFlight)} s, maximum height ${fmt(x.maxHeight)} m, horizontal range ${fmt(x.range)} m.${x.note ? ' ' + x.note : ''}`;
}

/** Equations as TeX with substituted values. The first one is the "main" equation. */
export function equations(c: ExperimentConfig): { label: string; tex: string }[] {
  const r = compute(c);
  if (r.type === 'circuit' && r.result.ok) {
    const x = r.result as CircuitResult;
    const R = x.resistors.map((ri) => fmt(ri.resistance));
    const eq: { label: string; tex: string }[] = [];
    if (x.topology === 'series') eq.push({ label: 'Series resistance', tex: `R_{eq} = ${x.resistors.map((_, i) => `R_${i + 1}`).join(' + ')} = ${R.join(' + ')} = ${fmt(x.totalResistance)}\\,\\Omega` });
    if (x.topology === 'parallel') eq.push({ label: 'Parallel resistance', tex: `\\frac{1}{R_{eq}} = ${x.resistors.map((_, i) => `\\frac{1}{R_${i + 1}}`).join(' + ')} \\Rightarrow R_{eq} = ${fmt(x.totalResistance)}\\,\\Omega` });
    if (x.topology === 'mixed') eq.push({ label: 'R1 + (R2 || R3)', tex: `R_{eq} = R_1 + \\frac{R_2 R_3}{R_2 + R_3} = ${R[0]} + \\frac{${R[1]} \\times ${R[2]}}{${R[1]} + ${R[2]}} = ${fmt(x.totalResistance)}\\,\\Omega` });
    eq.push({ label: "Ohm's law", tex: `I = \\frac{V}{R_{eq}} = \\frac{${fmt(x.voltage)}}{${fmt(x.totalResistance)}} = ${fmt(x.totalCurrent)}\\,\\text{A}` });
    x.resistors.forEach((ri) => eq.push({ label: `R${ri.index + 1}`, tex: `V_${ri.index + 1} = I_${ri.index + 1} R_${ri.index + 1} = ${fmt(ri.current)} \\times ${fmt(ri.resistance)} = ${fmt(ri.voltage)}\\,\\text{V},\\quad P_${ri.index + 1} = V_${ri.index + 1} I_${ri.index + 1} = ${fmt(ri.power)}\\,\\text{W}` }));
    return eq;
  }
  if (r.type === 'lens' && r.result.ok) {
    const x = r.result as LensResult;
    const f = fmt(x.input.focalLength), u = fmt(x.input.objectDistance);
    if (!x.image) return [{ label: 'Lens equation', tex: `\\frac{1}{v} = \\frac{1}{f} - \\frac{1}{u} = \\frac{1}{${f}} - \\frac{1}{${u}} = 0 \\Rightarrow v \\to \\infty` }];
    return [
      { label: 'Lens equation', tex: `\\frac{1}{f} = \\frac{1}{u} + \\frac{1}{v} \\Rightarrow v = \\frac{uf}{u-f} = \\frac{${u} \\times ${f}}{${u} - ${f}} = ${fmt(x.image.distance)}\\,\\text{cm}` },
      { label: 'Magnification', tex: `m = -\\frac{v}{u} = -\\frac{${fmt(x.image.distance)}}{${u}} = ${fmt(x.image.magnification)}` },
      { label: 'Image height', tex: `h' = m\\,h = ${fmt(x.image.magnification)} \\times ${fmt(x.input.objectHeight)} = ${fmt(x.image.height)}\\,\\text{cm}` },
    ];
  }
  if (r.type === 'projectile' && r.result.ok) {
    const x = r.result as ProjectileResult;
    const v = fmt(x.input.speed), th = fmt(x.input.angleDeg), g = fmt(x.input.gravity);
    return [
      { label: 'Range', tex: `R = \\frac{v_0^2 \\sin 2\\theta}{g} = \\frac{${v}^2 \\sin(2 \\times ${th}^\\circ)}{${g}} = ${fmt(x.range)}\\,\\text{m}` },
      { label: 'Time of flight', tex: `T = \\frac{2 v_0 \\sin\\theta}{g} = \\frac{2 \\times ${v} \\times \\sin ${th}^\\circ}{${g}} = ${fmt(x.timeOfFlight)}\\,\\text{s}` },
      { label: 'Maximum height', tex: `H = \\frac{(v_0 \\sin\\theta)^2}{2g} = ${fmt(x.maxHeight)}\\,\\text{m}` },
      { label: 'Position', tex: `x(t) = v_0 \\cos\\theta\\, t,\\quad y(t) = v_0 \\sin\\theta\\, t - \\tfrac{1}{2} g t^2` },
    ];
  }
  return [];
}

/* ---------------- interpretation → editable draft ---------------- */

export type FieldOrigin = 'diagram' | 'inferred' | 'missing' | 'default';

export interface DraftField {
  key: string;
  label: string;
  unit: string;
  value: number | null;
  origin: FieldOrigin;
  /** Raw text read from the image, for "see where this came from". */
  sourceText: string | null;
  note: string | null;
}

export interface Draft {
  type: ExperimentConfig['type'];
  topology?: CircuitConfig['topology'] | null;
  topologyOrigin?: FieldOrigin;
  resistorCount?: number;
  fields: DraftField[];
}

function field(key: string, label: string, q: Quantity, unit: string, aq: AIQuantity | null | undefined): DraftField {
  if (!aq || aq.value == null) return { key, label, unit, value: null, origin: 'missing', sourceText: aq?.sourceText ?? null, note: null };
  const n = normalise(q, aq.value, aq.unit);
  if (n.value == null) {
    // Unit present but not recognised: keep it missing rather than guess a conversion.
    return { key, label, unit, value: null, origin: 'missing', sourceText: aq.sourceText ?? `${aq.value} ${aq.unit ?? ''}`.trim(), note: `Unrecognised unit "${aq.unit}". Please enter the value in ${unit}.` };
  }
  const note = n.unitKnown ? null : `No unit was shown; assumed ${unit}. Please check.`;
  return { key, label, unit, value: n.value, origin: aq.inferred || !n.unitKnown ? 'inferred' : 'diagram', sourceText: aq.sourceText, note };
}

/** Build an editable draft from a validated interpretation. Never fills unreadable values. */
export function draftFromInterpretation(i: Interpretation, forceType?: ExperimentConfig['type']): Draft {
  const type = forceType ?? (i.experimentType === 'unsupported' ? 'circuit' : i.experimentType);
  if (type === 'circuit') {
    const c = i.circuit;
    const rs = c?.resistors ?? [];
    const count = Math.min(3, Math.max(1, rs.length || 1));
    const fields: DraftField[] = [field('voltage', 'Source voltage', 'voltage', 'V', c?.voltage)];
    for (let k = 0; k < count; k++) fields.push(field(`r${k + 1}`, `Resistance ${rs[k]?.label || `R${k + 1}`}`, 'resistance', 'Ω', rs[k]?.value));
    const topo = c?.topology && c.topology !== 'unknown' ? c.topology : null;
    return { type, topology: topo, topologyOrigin: topo ? 'diagram' : 'missing', resistorCount: count, fields };
  }
  if (type === 'lens') {
    const l = i.lens;
    return { type, fields: [
      field('focalLength', 'Focal length', 'lengthCm', 'cm', l?.focalLength),
      field('objectDistance', 'Object distance', 'lengthCm', 'cm', l?.objectDistance),
      field('objectHeight', 'Object height', 'lengthCm', 'cm', l?.objectHeight),
    ] };
  }
  const p = i.projectile;
  const g = field('gravity', 'Gravitational acceleration', 'acceleration', 'm/s²', p?.gravity);
  return { type, fields: [
    field('speed', 'Initial speed', 'speed', 'm/s', p?.initialSpeed),
    field('angleDeg', 'Launch angle', 'angleDeg', '°', p?.launchAngle),
    g.value == null ? { ...g, value: null, origin: 'missing', note: 'Not shown in the diagram. Earth’s surface value is 9.81 m/s² if that is what your problem uses.' } : g,
  ] };
}

/** Empty manual draft for a chosen experiment type (all values missing). */
export function emptyDraft(type: ExperimentConfig['type']): Draft {
  const blank: Interpretation = { experimentType: type, summary: '', unsupportedReason: null, imageQuality: 'clear', components: [], circuit: null, lens: null, projectile: null, missing: [], assumptions: [], warnings: [], needsReview: [] };
  return draftFromInterpretation(blank, type);
}

/** Convert a completed draft into a validated config. */
export function configFromDraft(d: Draft): { config: ExperimentConfig } | { errors: string[] } {
  const v = (k: string) => d.fields.find((f) => f.key === k)?.value;
  const missing = d.fields.filter((f) => f.value == null).map((f) => `${f.label} is missing.`);
  if (d.type === 'circuit' && !d.topology) missing.push('Choose how the resistors are connected.');
  if (missing.length) return { errors: missing };
  let raw: unknown;
  if (d.type === 'circuit') {
    const rs = d.fields.filter((f) => /^r\d$/.test(f.key)).map((f) => f.value as number);
    raw = { type: 'circuit', topology: d.topology, voltage: v('voltage'), resistors: rs };
  } else if (d.type === 'lens') raw = { type: 'lens', focalLength: v('focalLength'), objectDistance: v('objectDistance'), objectHeight: v('objectHeight') };
  else raw = { type: 'projectile', speed: v('speed'), angleDeg: v('angleDeg'), gravity: v('gravity') };
  const parsed = ExperimentConfig.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.issues.map((e) => e.message) };
  return { config: parsed.data };
}

/* ---------------- examples ---------------- */

export interface Example {
  id: string;
  title: string;
  blurb: string;
  config: ExperimentConfig;
}

export const EXAMPLES: Example[] = [
  { id: 'circuit-mixed', title: 'Battery and three resistors', blurb: 'A 12 V battery drives R1 in series with R2 || R3.', config: { type: 'circuit', topology: 'mixed', voltage: 12, resistors: [4, 6, 12] } },
  { id: 'lens-2f', title: 'Candle in front of a convex lens', blurb: 'f = 10 cm, object at 25 cm: a real, inverted image.', config: { type: 'lens', focalLength: 10, objectDistance: 25, objectHeight: 4 } },
  { id: 'projectile-45', title: 'Ball launched at 45°', blurb: 'v₀ = 20 m/s on Earth: the maximum-range angle.', config: { type: 'projectile', speed: 20, angleDeg: 45, gravity: 9.81 } },
];

export const PRESETS: Record<ExperimentConfig['type'], { label: string; config: ExperimentConfig }[]> = {
  circuit: [
    { label: 'Two in series', config: { type: 'circuit', topology: 'series', voltage: 9, resistors: [10, 20] } },
    { label: 'Three in parallel', config: { type: 'circuit', topology: 'parallel', voltage: 6, resistors: [10, 20, 30] } },
    { label: 'R1 + (R2 || R3)', config: { type: 'circuit', topology: 'mixed', voltage: 12, resistors: [4, 6, 12] } },
  ],
  lens: [
    { label: 'Beyond 2F', config: { type: 'lens', focalLength: 10, objectDistance: 30, objectHeight: 4 } },
    { label: 'At 2F', config: { type: 'lens', focalLength: 10, objectDistance: 20, objectHeight: 4 } },
    { label: 'Between F and 2F', config: { type: 'lens', focalLength: 10, objectDistance: 15, objectHeight: 3 } },
    { label: 'Inside F (magnifier)', config: { type: 'lens', focalLength: 10, objectDistance: 6, objectHeight: 3 } },
  ],
  projectile: [
    { label: 'Earth, 45°', config: { type: 'projectile', speed: 20, angleDeg: 45, gravity: 9.81 } },
    { label: 'Moon, 45°', config: { type: 'projectile', speed: 20, angleDeg: 45, gravity: 1.62 } },
    { label: 'Steep 75°', config: { type: 'projectile', speed: 20, angleDeg: 75, gravity: 9.81 } },
  ],
};
