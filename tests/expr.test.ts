import { describe, it, expect } from 'vitest';
import { evaluate, parse, variables, runPlan, ExprError } from '../shared/expr';

describe('safe expression evaluator', () => {
  it('follows normal precedence and associativity', () => {
    expect(evaluate('2+3*4', {})).toBe(14);
    expect(evaluate('(2+3)*4', {})).toBe(20);
    expect(evaluate('2^3^2', {})).toBe(512); // right associative
    expect(evaluate('-2^2', {})).toBe(-4);
    expect(evaluate('10/4/5', {})).toBe(0.5);
    expect(evaluate('2**3', {})).toBe(8);
    expect(evaluate('6×2÷3', {})).toBe(4);
  });
  it('supports variables, constants and whitelisted functions', () => {
    expect(evaluate('2*pi*sqrt(L/g)', { L: 1, g: 9.81 })).toBeCloseTo(2.006, 3);
    expect(evaluate('v0^2*sin(2*th*pi/180)/g', { v0: 20, th: 45, g: 9.81 })).toBeCloseTo(40.77, 2);
    expect(evaluate('ln(e)', {})).toBe(1);
    expect(evaluate('max(3, 7)', {})).toBe(7);
    expect(evaluate('1.5e3 + .5', {})).toBe(1500.5);
  });
  it('rejects anything that is not arithmetic', () => {
    for (const bad of ['process.exit()', 'alert(1)', 'constructor', 'a[0]', 'x = 3', '"str"', 'f`x`', '1;2', 'this.x', '__proto__(1)']) {
      expect(() => evaluate(bad, {}), bad).toThrow();
    }
    expect(() => evaluate('sqrt(1,2)', {})).toThrow(/argument/);
    expect(() => evaluate('unknown_fn(2)', {})).toThrow(/Unknown function/);
    expect(() => evaluate('x + 1', {})).toThrow(/Unknown value/);
  });
  it('never returns NaN or Infinity', () => {
    expect(() => evaluate('1/0', {})).toThrow(ExprError);
    expect(() => evaluate('sqrt(-1)', {})).toThrow(ExprError);
  });
  it('limits size and nesting', () => {
    expect(() => parse('1+'.repeat(300) + '1')).toThrow();
    expect(() => parse('('.repeat(80) + '1' + ')'.repeat(80))).toThrow();
  });
  it('lists variables', () => {
    expect(variables('2*pi*sqrt(L/g)').sort()).toEqual(['L', 'g', 'pi']);
  });
});

describe('running an AI solution plan', () => {
  const plan = {
    givens: [{ symbol: 'L', value: 2 }, { symbol: 'g', value: 9.8 }],
    steps: [
      { target: 'omega', expression: 'sqrt(g/L)' },
      { target: null, expression: null },
      { target: 'T', expression: '2*pi/omega' },
    ],
    answers: [{ symbol: 'T', expression: 'T' }, { symbol: 'f', expression: '1/T' }],
  };
  it('evaluates steps in order and feeds them forward', () => {
    const r = runPlan(plan);
    expect(r.answerValues[0]).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / 9.8), 10);
    expect(r.answerValues[1]).toBeCloseTo(1 / r.answerValues[0]!, 10);
    expect(r.stepValues[1]).toBeNull();
  });
  it('uses user overrides (sliders)', () => {
    const r = runPlan(plan, { L: 8 });
    expect(r.answerValues[0]).toBeCloseTo(2 * Math.PI * Math.sqrt(8 / 9.8), 10);
  });
  it('reports missing givens instead of inventing them', () => {
    const r = runPlan({ ...plan, givens: [{ symbol: 'L', value: null }, { symbol: 'g', value: 9.8 }] });
    expect(r.answerValues[0]).toBeNull();
    expect(r.stepErrors[0]).toMatch(/Unknown value "L"/);
  });
  it('a step cannot overwrite a given', () => {
    const r = runPlan({ givens: [{ symbol: 'x', value: 2 }], steps: [{ target: 'x', expression: '100' }], answers: [{ symbol: 'y', expression: 'x*3' }] });
    expect(r.answerValues[0]).toBe(6);
  });
});
