import { describe, it, expect } from 'vitest';
import { Interpretation, ExperimentConfig, TutorModelOutput, ShareCreate } from '../shared/schema';
import { draftFromInterpretation, configFromDraft, setParam, emptyDraft, summarize, equations } from '../shared/experiment';
import { normalise } from '../shared/units';

const Qv = (value: number | null, unit: string | null = null, inferred = false) => ({ value, unit, sourceText: value == null ? null : `${value}${unit ?? ''}`, inferred });

const base = {
  summary: 'A battery with three resistors.', unsupportedReason: null, imageQuality: 'clear' as const, components: [],
  lens: null, projectile: null, missing: [], assumptions: [], warnings: [], needsReview: [],
};

describe('AI interpretation schema', () => {
  it('accepts a well-formed circuit interpretation', () => {
    const r = Interpretation.safeParse({ ...base, experimentType: 'circuit', circuit: { topology: 'mixed', voltage: Qv(12, 'V'), resistors: [{ label: 'R1', value: Qv(4, 'Ω') }, { label: 'R2', value: Qv(6, 'Ω') }, { label: 'R3', value: Qv(12, 'Ω') }] } });
    expect(r.success).toBe(true);
  });
  it('rejects unknown experiment types', () => {
    expect(Interpretation.safeParse({ ...base, experimentType: 'quantum', circuit: null }).success).toBe(false);
  });
  it('rejects missing required keys', () => {
    const { summary: _s, ...noSummary } = base;
    expect(Interpretation.safeParse({ ...noSummary, experimentType: 'circuit', circuit: null }).success).toBe(false);
  });
  it('rejects wrong value types (string numbers)', () => {
    const r = Interpretation.safeParse({ ...base, experimentType: 'lens', circuit: null, lens: { focalLength: { value: '10', unit: 'cm', sourceText: null, inferred: false }, objectDistance: Qv(20, 'cm'), objectHeight: Qv(2, 'cm') } });
    expect(r.success).toBe(false);
  });
  it('rejects malformed bounding boxes', () => {
    const r = Interpretation.safeParse({ ...base, experimentType: 'circuit', circuit: null, components: [{ kind: 'resistor', label: 'R1', valueText: null, box: [1, 2, 3] }] });
    expect(r.success).toBe(false);
  });
});

describe('draft from interpretation keeps unreadable values missing', () => {
  it('missing resistor value stays null and blocks launch', () => {
    const i = Interpretation.parse({ ...base, experimentType: 'circuit', circuit: { topology: 'series', voltage: Qv(9, 'V'), resistors: [{ label: 'R1', value: Qv(10, 'Ω') }, { label: 'R2', value: Qv(null) }] } });
    const d = draftFromInterpretation(i);
    expect(d.fields.find((f) => f.key === 'r2')?.value).toBeNull();
    expect(d.fields.find((f) => f.key === 'r2')?.origin).toBe('missing');
    const out = configFromDraft(d);
    expect('errors' in out && out.errors.join(' ')).toMatch(/missing/);
  });
  it('unknown topology must be chosen by the user', () => {
    const i = Interpretation.parse({ ...base, experimentType: 'circuit', circuit: { topology: 'unknown', voltage: Qv(9, 'V'), resistors: [{ label: 'R1', value: Qv(10, 'Ω') }, { label: 'R2', value: Qv(5, 'Ω') }] } });
    const d = draftFromInterpretation(i);
    expect(d.topology).toBeNull();
    expect('errors' in configFromDraft(d)).toBe(true);
    const fixed = configFromDraft({ ...d, topology: 'parallel' });
    expect('config' in fixed).toBe(true);
  });
  it('converts kΩ and flags absent units as inferred', () => {
    const i = Interpretation.parse({ ...base, experimentType: 'circuit', circuit: { topology: 'series', voltage: Qv(5, null), resistors: [{ label: 'R1', value: Qv(2.2, 'kΩ') }] } });
    const d = draftFromInterpretation(i);
    expect(d.fields.find((f) => f.key === 'r1')?.value).toBeCloseTo(2200);
    const v = d.fields.find((f) => f.key === 'voltage')!;
    expect(v.value).toBe(5);
    expect(v.origin).toBe('inferred');
    expect(v.note).toMatch(/assumed/i);
  });
  it('unrecognised units are not silently converted', () => {
    const i = Interpretation.parse({ ...base, experimentType: 'lens', circuit: null, lens: { focalLength: Qv(10, 'furlongs'), objectDistance: Qv(30, 'cm'), objectHeight: Qv(2, 'cm') } });
    const d = draftFromInterpretation(i);
    expect(d.fields[0]!.value).toBeNull();
    expect(d.fields[0]!.note).toMatch(/Unrecognised unit/);
  });
  it('projectile gravity is never assumed', () => {
    const i = Interpretation.parse({ ...base, experimentType: 'projectile', circuit: null, projectile: { initialSpeed: Qv(20, 'm/s'), launchAngle: Qv(30, '°'), gravity: Qv(null) } });
    const d = draftFromInterpretation(i);
    expect(d.fields.find((f) => f.key === 'gravity')?.value).toBeNull();
  });
  it('manual drafts start empty', () => {
    expect(emptyDraft('lens').fields.every((f) => f.value === null)).toBe(true);
  });
});

describe('config + parameter edits', () => {
  it('rejects invalid configs', () => {
    expect(ExperimentConfig.safeParse({ type: 'circuit', topology: 'mixed', voltage: 5, resistors: [1, 2] }).success).toBe(false);
    expect(ExperimentConfig.safeParse({ type: 'lens', focalLength: 0, objectDistance: 5, objectHeight: 1 }).success).toBe(false);
    expect(ExperimentConfig.safeParse({ type: 'projectile', speed: 5, angleDeg: 120, gravity: 9.8 }).success).toBe(false);
  });
  it('setParam validates and never mutates', () => {
    const c = ExperimentConfig.parse({ type: 'circuit', topology: 'series', voltage: 5, resistors: [1, 2] });
    const r = setParam(c, 'r2', 20);
    expect('config' in r && r.config.type === 'circuit' && r.config.resistors[1]).toBe(20);
    expect(c.type === 'circuit' && c.resistors[1]).toBe(2);
    expect('error' in setParam(c, 'r2', 0)).toBe(true);
    expect('error' in setParam(c, 'r3', 5)).toBe(true);
    expect('error' in setParam(c, 'focalLength', 5)).toBe(true);
  });
  it('summaries and equations contain real numbers, never NaN', () => {
    for (const c of [
      { type: 'circuit', topology: 'mixed', voltage: 12, resistors: [4, 6, 12] },
      { type: 'lens', focalLength: 10, objectDistance: 10, objectHeight: 2 },
      { type: 'projectile', speed: 0, angleDeg: 45, gravity: 9.81 },
    ] as const) {
      const cfg = ExperimentConfig.parse(c);
      expect(summarize(cfg)).not.toMatch(/NaN|Infinity/);
      equations(cfg).forEach((e) => expect(e.tex).not.toMatch(/NaN|Infinity/));
    }
  });
});

describe('model output & share schemas', () => {
  it('tutor output must have markdown and at most 3 suggestions', () => {
    expect(TutorModelOutput.safeParse({ answerMarkdown: 'x', suggestions: [] }).success).toBe(true);
    expect(TutorModelOutput.safeParse({ answerMarkdown: '', suggestions: [] }).success).toBe(false);
    expect(TutorModelOutput.safeParse({ answerMarkdown: 'x', suggestions: Array(4).fill({ label: 'a', param: 'r1', value: 1 }) }).success).toBe(false);
  });
  it('share requires a valid config', () => {
    expect(ShareCreate.safeParse({ title: 'x', config: { type: 'lens', focalLength: -1, objectDistance: 1, objectHeight: 1 } }).success).toBe(false);
    expect(ShareCreate.parse({ title: 'x', config: { type: 'lens', focalLength: 1, objectDistance: 1, objectHeight: 1 } }).includeImage).toBe(false);
  });
});

describe('units', () => {
  it('normalises common units', () => {
    expect(normalise('resistance', 4.7, 'kΩ').value).toBeCloseTo(4700);
    expect(normalise('resistance', 1, 'MΩ').value).toBe(1e6);
    expect(normalise('lengthCm', 0.15, 'm').value).toBeCloseTo(15);
    expect(normalise('speed', 72, 'km/h').value).toBeCloseTo(20);
    expect(normalise('angleDeg', Math.PI / 4, 'rad').value).toBeCloseTo(45);
    expect(normalise('voltage', 5, 'bananas').value).toBeNull();
  });
});
