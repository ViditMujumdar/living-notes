/**
 * Ideal projectile motion: no air resistance, uniform gravity, launch and
 * landing at the same height (y = 0).
 *
 *  x(t) = v0·cos(θ)·t
 *  y(t) = v0·sin(θ)·t − ½·g·t²
 *  time of flight T = 2·v0·sin(θ)/g
 *  max height H = (v0·sin θ)² / (2g)
 *  range R = v0²·sin(2θ)/g
 *
 * Positions are always analytical functions of simulation time, so results
 * do not depend on the animation frame rate.
 */

export interface ProjectileInput {
  speed: number; // v0, m/s, >= 0
  angleDeg: number; // θ in degrees, 0..90
  gravity: number; // g, m/s², > 0
}

export interface ProjectileResult {
  ok: true;
  input: ProjectileInput;
  angleRad: number;
  vx: number;
  vy0: number;
  timeOfFlight: number;
  maxHeight: number;
  timeToApex: number;
  range: number;
  /** True when nothing moves through the air (v0 = 0 or θ = 0). */
  degenerate: boolean;
  note: string | null;
}

export interface ProjectileError {
  ok: false;
  errors: string[];
}

export interface ProjectileState {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

export const deg2rad = (d: number) => (d * Math.PI) / 180;
/** Values this small are treated as exactly zero (avoids 1e-15 "ranges" at 90°). */
const EPS = 1e-9;
const clean = (v: number) => (Math.abs(v) < EPS ? 0 : v);

export function validateProjectile(input: ProjectileInput): string[] {
  const e: string[] = [];
  if (!Number.isFinite(input.speed) || input.speed < 0) e.push('Initial speed must be 0 m/s or more.');
  if (!Number.isFinite(input.angleDeg) || input.angleDeg < 0 || input.angleDeg > 90) e.push('Launch angle must be between 0° and 90°.');
  if (!Number.isFinite(input.gravity) || input.gravity <= 0) e.push('Gravitational acceleration must be a positive number.');
  return e;
}

export function solveProjectile(input: ProjectileInput): ProjectileResult | ProjectileError {
  const errors = validateProjectile(input);
  if (errors.length) return { ok: false, errors };
  const { speed: v0, angleDeg, gravity: g } = input;
  const th = deg2rad(angleDeg);
  const vx = clean(v0 * Math.cos(th));
  const vy0 = clean(v0 * Math.sin(th));
  const T = (2 * vy0) / g;
  const H = (vy0 * vy0) / (2 * g);
  const R = clean(vx * T);
  const degenerate = T === 0;
  let note: string | null = null;
  if (v0 === 0) note = 'With zero launch speed the projectile never leaves the launch point.';
  else if (vy0 === 0) note = 'A 0° launch on level ground lands immediately: there is no vertical velocity to keep it in the air.';
  else if (vx === 0) note = 'A 90° launch goes straight up and comes straight back down, so the range is zero.';
  return { ok: true, input, angleRad: th, vx, vy0, timeOfFlight: T, maxHeight: H, timeToApex: T / 2, range: R, degenerate, note };
}

/** State at simulation time t, clamped to the flight interval [0, T]. */
export function projectileAt(r: ProjectileResult, t: number): ProjectileState {
  const tc = Math.min(Math.max(t, 0), r.timeOfFlight);
  const g = r.input.gravity;
  const x = r.vx * tc;
  // Clamp tiny negative heights at landing caused by floating point.
  const y = Math.max(0, r.vy0 * tc - 0.5 * g * tc * tc);
  const vy = r.vy0 - g * tc;
  return { t: tc, x, y, vx: r.vx, vy, speed: Math.hypot(r.vx, vy) };
}

/** Sample the trajectory at n+1 evenly spaced times (for drawing). */
export function sampleTrajectory(r: ProjectileResult, n = 120): ProjectileState[] {
  if (r.timeOfFlight === 0) return [projectileAt(r, 0)];
  return Array.from({ length: n + 1 }, (_, i) => projectileAt(r, (i / n) * r.timeOfFlight));
}
