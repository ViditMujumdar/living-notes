import { describe, it, expect } from 'vitest';
import { solveCircuit, type CircuitResult } from '../shared/physics/circuit';
import { solveLens, classifyLens, type LensResult } from '../shared/physics/lens';
import { solveProjectile, projectileAt, sampleTrajectory, type ProjectileResult } from '../shared/physics/projectile';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps * Math.max(1, Math.abs(b)));
const ok = <T extends { ok: boolean }>(r: T) => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

describe('circuit: series', () => {
  it('adds resistances and shares one current', () => {
    const r = ok(solveCircuit({ topology: 'series', voltage: 12, resistors: [2, 4, 6] })) as CircuitResult;
    close(r.totalResistance, 12);
    close(r.totalCurrent, 1);
    expect(r.resistors.map((x) => x.current)).toEqual([1, 1, 1]);
    r.resistors.forEach((x, i) => close(x.voltage, [2, 4, 6][i]!));
    // Kirchhoff's voltage law
    close(r.resistors.reduce((s, x) => s + x.voltage, 0), 12);
    // P = V·I, and sum of powers = source power
    r.resistors.forEach((x) => close(x.power, x.voltage * x.current));
    close(r.resistors.reduce((s, x) => s + x.power, 0), r.totalPower);
  });
  it('works with a single resistor', () => {
    const r = ok(solveCircuit({ topology: 'series', voltage: 9, resistors: [3] })) as CircuitResult;
    close(r.totalCurrent, 3);
    close(r.resistors[0]!.power, 27);
  });
});

describe('circuit: parallel', () => {
  it('uses reciprocal addition and full voltage on each branch', () => {
    const r = ok(solveCircuit({ topology: 'parallel', voltage: 6, resistors: [3, 6] })) as CircuitResult;
    close(r.totalResistance, 2);
    close(r.totalCurrent, 3);
    close(r.resistors[0]!.current, 2);
    close(r.resistors[1]!.current, 1);
    r.resistors.forEach((x) => close(x.voltage, 6));
    // Kirchhoff's current law
    close(r.resistors.reduce((s, x) => s + x.current, 0), r.totalCurrent);
  });
  it('three branches', () => {
    const r = ok(solveCircuit({ topology: 'parallel', voltage: 12, resistors: [12, 12, 12] })) as CircuitResult;
    close(r.totalResistance, 4);
    close(r.totalCurrent, 3);
  });
  it('rejects a single resistor in parallel', () => {
    const r = solveCircuit({ topology: 'parallel', voltage: 6, resistors: [3] });
    expect(r.ok).toBe(false);
  });
});

describe('circuit: R1 in series with (R2 ∥ R3)', () => {
  it('computes branch voltages and currents', () => {
    const r = ok(solveCircuit({ topology: 'mixed', voltage: 12, resistors: [4, 6, 12] })) as CircuitResult;
    close(r.parallelBlockResistance!, 4); // 6·12/18
    close(r.totalResistance, 8);
    close(r.totalCurrent, 1.5);
    const [a, b, c] = r.resistors;
    close(a!.voltage, 6); close(a!.current, 1.5);
    close(b!.voltage, 6); close(b!.current, 1);
    close(c!.voltage, 6); close(c!.current, 0.5);
    close(b!.current + c!.current, r.totalCurrent);
    close(a!.voltage + b!.voltage, 12);
    close(r.resistors.reduce((s, x) => s + x.power, 0), r.totalPower);
  });
  it('requires exactly three resistors', () => {
    expect(solveCircuit({ topology: 'mixed', voltage: 12, resistors: [4, 6] }).ok).toBe(false);
  });
  it('topology change changes the calculation, not just the drawing', () => {
    const rs = [4, 6, 12];
    const s = ok(solveCircuit({ topology: 'series', voltage: 12, resistors: rs })) as CircuitResult;
    const p = ok(solveCircuit({ topology: 'parallel', voltage: 12, resistors: rs })) as CircuitResult;
    const m = ok(solveCircuit({ topology: 'mixed', voltage: 12, resistors: rs })) as CircuitResult;
    expect(new Set([s.totalResistance, p.totalResistance, m.totalResistance]).size).toBe(3);
  });
});

describe('circuit: invalid input never throws', () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    it(`rejects R = ${bad}`, () => {
      const r = solveCircuit({ topology: 'series', voltage: 5, resistors: [bad] });
      expect(r.ok).toBe(false);
    });
  }
  it('rejects negative voltage', () => expect(solveCircuit({ topology: 'series', voltage: -1, resistors: [1] }).ok).toBe(false));
  it('allows 0 V (no current)', () => {
    const r = ok(solveCircuit({ topology: 'series', voltage: 0, resistors: [5] })) as CircuitResult;
    expect(r.totalCurrent).toBe(0);
  });
});

describe('lens', () => {
  const L = (u: number, f = 10, h = 2) => solveLens({ focalLength: f, objectDistance: u, objectHeight: h });
  it('object beyond 2F: real, inverted, diminished', () => {
    const r = ok(L(30)) as LensResult;
    expect(r.case).toBe('beyond-2f');
    close(r.image!.distance, 15);
    close(r.image!.magnification, -0.5);
    close(r.image!.height, -1);
    expect(r.image!.nature).toBe('real');
    expect(r.image!.orientation).toBe('inverted');
    expect(r.image!.size).toBe('diminished');
  });
  it('object at 2F: same size at 2F', () => {
    const r = ok(L(20)) as LensResult;
    expect(r.case).toBe('at-2f');
    close(r.image!.distance, 20);
    close(r.image!.magnification, -1);
    expect(r.image!.size).toBe('same size');
  });
  it('object between F and 2F: real, inverted, magnified beyond 2F', () => {
    const r = ok(L(15)) as LensResult;
    expect(r.case).toBe('between-f-2f');
    close(r.image!.distance, 30);
    close(r.image!.magnification, -2);
    expect(r.image!.size).toBe('magnified');
  });
  it('object inside F: virtual, upright, magnified, on the object side', () => {
    const r = ok(L(5)) as LensResult;
    expect(r.case).toBe('inside-f');
    close(r.image!.distance, -10);
    close(r.image!.magnification, 2);
    close(r.image!.height, 4);
    expect(r.image!.nature).toBe('virtual');
    expect(r.image!.orientation).toBe('upright');
  });
  it('object at F: image at infinity, never NaN or a giant number', () => {
    const r = ok(L(10)) as LensResult;
    expect(r.atInfinity).toBe(true);
    expect(r.image).toBeNull();
    const near = ok(L(10.02)) as LensResult; // within tolerance
    expect(near.atInfinity).toBe(true);
  });
  it('just outside the tolerance gives a finite, very distant image', () => {
    const r = ok(L(10.2)) as LensResult;
    expect(r.atInfinity).toBe(false);
    expect(Number.isFinite(r.image!.distance)).toBe(true);
    expect(r.image!.distance).toBeGreaterThan(400);
  });
  it('satisfies 1/f = 1/u + 1/v across many cases', () => {
    for (const u of [3, 7, 12, 18, 25, 40, 80]) {
      const r = ok(L(u)) as LensResult;
      close(1 / 10, 1 / u + 1 / r.image!.distance, 1e-12);
    }
  });
  it('classify boundaries', () => {
    expect(classifyLens(20, 10)).toBe('at-2f');
    expect(classifyLens(20.5, 10)).toBe('beyond-2f');
    expect(classifyLens(9.5, 10)).toBe('inside-f');
  });
  it('rejects invalid values', () => {
    expect(solveLens({ focalLength: -10, objectDistance: 5, objectHeight: 1 }).ok).toBe(false);
    expect(solveLens({ focalLength: 10, objectDistance: 0, objectHeight: 1 }).ok).toBe(false);
    expect(solveLens({ focalLength: 10, objectDistance: 5, objectHeight: 0 }).ok).toBe(false);
  });
});

describe('projectile', () => {
  const P = (speed: number, angleDeg: number, gravity = 9.81) => ok(solveProjectile({ speed, angleDeg, gravity })) as ProjectileResult;
  it('45° range, height, time of flight', () => {
    const r = P(20, 45);
    close(r.range, 400 / 9.81, 1e-12);
    close(r.maxHeight, (20 * Math.SQRT1_2) ** 2 / (2 * 9.81), 1e-12);
    close(r.timeOfFlight, (2 * 20 * Math.SQRT1_2) / 9.81, 1e-12);
  });
  it('converts degrees correctly (30° vs 60° give equal ranges)', () => {
    close(P(15, 30).range, P(15, 60).range, 1e-12);
    close(P(10, 30).vy0, 5, 1e-12);
  });
  it('lands at y = 0 exactly at T and stops there', () => {
    const r = P(20, 60);
    const end = projectileAt(r, r.timeOfFlight);
    close(end.x, r.range, 1e-9);
    expect(end.y).toBe(0);
    const after = projectileAt(r, r.timeOfFlight + 5);
    expect(after.t).toBe(r.timeOfFlight);
    close(after.x, r.range, 1e-9);
  });
  it('apex is at T/2 with vertical velocity 0', () => {
    const r = P(25, 70);
    const apex = projectileAt(r, r.timeToApex);
    close(apex.y, r.maxHeight, 1e-9);
    close(apex.vy, 0, 1e-9);
  });
  it('frame-rate independent: analytical positions agree regardless of sampling', () => {
    const r = P(18, 40);
    const coarse = sampleTrajectory(r, 7), fine = sampleTrajectory(r, 700);
    close(coarse[7]!.x, fine[700]!.x);
    close(projectileAt(r, 1.234).y, (18 * Math.sin((40 * Math.PI) / 180)) * 1.234 - 0.5 * 9.81 * 1.234 ** 2, 1e-12);
  });
  it('handles zero speed', () => {
    const r = P(0, 45);
    expect(r.timeOfFlight).toBe(0);
    expect(r.range).toBe(0);
    expect(r.degenerate).toBe(true);
    expect(r.note).toMatch(/zero/i);
  });
  it('handles 0° and 90° gracefully', () => {
    const flat = P(10, 0);
    expect(flat.timeOfFlight).toBe(0);
    expect(flat.range).toBe(0);
    const up = P(10, 90);
    expect(up.range).toBe(0);
    close(up.maxHeight, 100 / (2 * 9.81), 1e-12);
  });
  it('rejects invalid gravity and angles', () => {
    expect(solveProjectile({ speed: 10, angleDeg: 45, gravity: 0 }).ok).toBe(false);
    expect(solveProjectile({ speed: 10, angleDeg: 95, gravity: 9.8 }).ok).toBe(false);
    expect(solveProjectile({ speed: -1, angleDeg: 45, gravity: 9.8 }).ok).toBe(false);
  });
});
