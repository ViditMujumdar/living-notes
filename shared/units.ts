/**
 * Unit normalisation for values read from diagrams.
 * Returns null when the unit is not recognised, so the field can be flagged for review
 * instead of being silently converted.
 */

type Table = Record<string, number>;

const RESISTANCE: Table = {
  'ω': 1, 'Ω': 1, ohm: 1, ohms: 1, 'r': 1,
  'mω': 1e-3, 'milliohm': 1e-3,
  'kω': 1e3, 'kΩ': 1e3, kohm: 1e3, kohms: 1e3, k: 1e3, kiloohm: 1e3, kiloohms: 1e3,
  'mΩ_mega': 1e6, megohm: 1e6, megaohm: 1e6, megaohms: 1e6,
};
const VOLTAGE: Table = { v: 1, volt: 1, volts: 1, mv: 1e-3, millivolt: 1e-3, millivolts: 1e-3, kv: 1e3, kilovolt: 1e3 };
const LENGTH_CM: Table = { cm: 1, centimetre: 1, centimeter: 1, centimetres: 1, centimeters: 1, mm: 0.1, millimetre: 0.1, millimeter: 0.1, m: 100, metre: 100, meter: 100, metres: 100, meters: 100 };
const SPEED: Table = { 'm/s': 1, 'ms-1': 1, 'ms^-1': 1, 'm s-1': 1, 'm·s-1': 1, 'mps': 1, 'km/h': 1 / 3.6, 'kmh': 1 / 3.6, 'kph': 1 / 3.6, 'km/hr': 1 / 3.6, 'cm/s': 0.01 };
const ACCEL: Table = { 'm/s2': 1, 'm/s^2': 1, 'm/s²': 1, 'ms-2': 1, 'ms^-2': 1, 'm s-2': 1, 'n/kg': 1 };
const ANGLE: Table = { '°': 1, deg: 1, degree: 1, degrees: 1, rad: 180 / Math.PI, radian: 180 / Math.PI, radians: 180 / Math.PI };

export type Quantity = 'resistance' | 'voltage' | 'lengthCm' | 'speed' | 'acceleration' | 'angleDeg';

const TABLES: Record<Quantity, Table> = {
  resistance: RESISTANCE, voltage: VOLTAGE, lengthCm: LENGTH_CM, speed: SPEED, acceleration: ACCEL, angleDeg: ANGLE,
};
const CANONICAL: Record<Quantity, string> = { resistance: 'Ω', voltage: 'V', lengthCm: 'cm', speed: 'm/s', acceleration: 'm/s²', angleDeg: '°' };

function key(unit: string) {
  return unit.trim().replace(/\s+/g, ' ').replace(/ohm(s)?/i, (m) => m.toLowerCase());
}

/**
 * Convert value+unit to the canonical unit for a quantity.
 * - unit null/empty → returns { value, unitKnown: false } (caller decides whether to assume the canonical unit and flag it)
 */
export function normalise(q: Quantity, value: number | null, unit: string | null): { value: number | null; unitKnown: boolean; canonical: string } {
  const canonical = CANONICAL[q];
  if (value == null || !Number.isFinite(value)) return { value: null, unitKnown: unit != null, canonical };
  if (unit == null || unit.trim() === '') return { value, unitKnown: false, canonical };
  const t = TABLES[q];
  const raw = key(unit);
  // Megaohm "MΩ" vs milliohm "mΩ" are case-sensitive; check exact first.
  if (raw === 'MΩ' || raw === 'Mohm' || raw === 'M') return q === 'resistance' ? { value: value * 1e6, unitKnown: true, canonical } : { value: null, unitKnown: false, canonical };
  if (raw === 'mΩ') return q === 'resistance' ? { value: value * 1e-3, unitKnown: true, canonical } : { value: null, unitKnown: false, canonical };
  const f = t[raw] ?? t[raw.toLowerCase()] ?? t[raw.toLowerCase().replace(/\s/g, '')];
  if (f == null) return { value: null, unitKnown: false, canonical };
  return { value: value * f, unitKnown: true, canonical };
}

export const canonicalUnit = (q: Quantity) => CANONICAL[q];
