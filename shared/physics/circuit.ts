/**
 * Ideal DC resistor circuits.
 *
 * Supported arrangements (and nothing else):
 *  - "series":   1–3 resistors in a single loop with the source.
 *  - "parallel": 2–3 resistors, each directly across the source.
 *  - "mixed":    exactly 3 resistors: R1 in series with (R2 || R3).
 *
 * Ideal assumptions: zero-resistance wires, ideal voltage source (no internal
 * resistance), ohmic resistors with constant resistance.
 */

export type Topology = 'series' | 'parallel' | 'mixed';

export interface CircuitInput {
  topology: Topology;
  /** Source EMF in volts. Must be finite and >= 0. */
  voltage: number;
  /** Resistances in ohms. Each must be finite and > 0. */
  resistors: number[];
}

export interface ResistorResult {
  index: number;
  resistance: number;
  current: number; // A
  voltage: number; // V
  power: number; // W
}

export interface CircuitResult {
  ok: true;
  topology: Topology;
  voltage: number;
  totalResistance: number;
  totalCurrent: number;
  totalPower: number;
  resistors: ResistorResult[];
  /** Equivalent resistance of the R2 || R3 block (mixed only). */
  parallelBlockResistance?: number;
}

export interface CircuitError {
  ok: false;
  errors: string[];
}

export const TOPOLOGY_LIMITS: Record<Topology, { min: number; max: number }> = {
  series: { min: 1, max: 3 },
  parallel: { min: 2, max: 3 },
  mixed: { min: 3, max: 3 },
};

export const TOPOLOGY_LABEL: Record<Topology, string> = {
  series: 'Series',
  parallel: 'Parallel',
  mixed: 'R1 in series with (R2 || R3)',
};

export function validateCircuit(input: CircuitInput): string[] {
  const errors: string[] = [];
  if (!(input.topology in TOPOLOGY_LIMITS)) {
    errors.push('Unsupported arrangement.');
    return errors;
  }
  if (!Number.isFinite(input.voltage) || input.voltage < 0) errors.push('Voltage must be a finite number of 0 V or more.');
  const { min, max } = TOPOLOGY_LIMITS[input.topology];
  const n = input.resistors.length;
  if (n < min || n > max) {
    errors.push(
      min === max
        ? `${TOPOLOGY_LABEL[input.topology]} needs exactly ${min} resistors.`
        : `${TOPOLOGY_LABEL[input.topology]} needs ${min}–${max} resistors.`,
    );
  }
  input.resistors.forEach((r, i) => {
    if (!Number.isFinite(r) || r <= 0) errors.push(`R${i + 1} must be a finite resistance greater than 0 Ω.`);
  });
  return errors;
}

const parallel = (...rs: number[]) => 1 / rs.reduce((s, r) => s + 1 / r, 0);

export function solveCircuit(input: CircuitInput): CircuitResult | CircuitError {
  const errors = validateCircuit(input);
  if (errors.length) return { ok: false, errors };
  const V = input.voltage;
  const R = input.resistors;

  if (input.topology === 'series') {
    const Req = R.reduce((s, r) => s + r, 0);
    const I = V / Req;
    const resistors = R.map((r, index) => ({ index, resistance: r, current: I, voltage: I * r, power: I * I * r }));
    return { ok: true, topology: 'series', voltage: V, totalResistance: Req, totalCurrent: I, totalPower: V * I, resistors };
  }

  if (input.topology === 'parallel') {
    const Req = parallel(...R);
    const resistors = R.map((r, index) => {
      const i = V / r;
      return { index, resistance: r, current: i, voltage: V, power: V * i };
    });
    const I = resistors.reduce((s, x) => s + x.current, 0);
    return { ok: true, topology: 'parallel', voltage: V, totalResistance: Req, totalCurrent: I, totalPower: V * I, resistors };
  }

  // mixed: R1 + (R2 || R3)
  const [r1, r2, r3] = R as [number, number, number];
  const Rp = parallel(r2, r3);
  const Req = r1 + Rp;
  const I = V / Req;
  const V1 = I * r1;
  const Vp = I * Rp;
  const I2 = Vp / r2;
  const I3 = Vp / r3;
  return {
    ok: true,
    topology: 'mixed',
    voltage: V,
    totalResistance: Req,
    totalCurrent: I,
    totalPower: V * I,
    parallelBlockResistance: Rp,
    resistors: [
      { index: 0, resistance: r1, current: I, voltage: V1, power: V1 * I },
      { index: 1, resistance: r2, current: I2, voltage: Vp, power: Vp * I2 },
      { index: 2, resistance: r3, current: I3, voltage: Vp, power: Vp * I3 },
    ],
  };
}
