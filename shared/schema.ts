/**
 * Runtime schemas shared by the server and the browser.
 * Everything that crosses a trust boundary (AI output, request bodies, shared
 * links, local storage) is parsed with these before use.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Experiment configuration: the ONLY thing the simulation runs from.  */
/* ------------------------------------------------------------------ */

const finitePos = z.number().finite().positive();

export const CircuitConfig = z.object({
  type: z.literal('circuit'),
  topology: z.enum(['series', 'parallel', 'mixed']),
  voltage: z.number().finite().min(0).max(1000),
  resistors: z.array(finitePos.max(1e6)).min(1).max(3),
}).superRefine((c, ctx) => {
  const n = c.resistors.length;
  if (c.topology === 'parallel' && n < 2) ctx.addIssue({ code: 'custom', message: 'Parallel needs 2 or 3 resistors', path: ['resistors'] });
  if (c.topology === 'mixed' && n !== 3) ctx.addIssue({ code: 'custom', message: 'Mixed arrangement needs exactly 3 resistors', path: ['resistors'] });
});

export const LensConfig = z.object({
  type: z.literal('lens'),
  focalLength: finitePos.max(500),
  objectDistance: finitePos.max(2000),
  objectHeight: z.number().finite().min(-200).max(200).refine((v) => v !== 0, 'Object height cannot be 0'),
});

export const ProjectileConfig = z.object({
  type: z.literal('projectile'),
  speed: z.number().finite().min(0).max(1000),
  angleDeg: z.number().finite().min(0).max(90),
  gravity: finitePos.max(300),
});

export const ExperimentConfig = z.discriminatedUnion('type', [CircuitConfig, LensConfig, ProjectileConfig]);
export type ExperimentConfig = z.infer<typeof ExperimentConfig>;
export type CircuitConfig = z.infer<typeof CircuitConfig>;
export type LensConfig = z.infer<typeof LensConfig>;
export type ProjectileConfig = z.infer<typeof ProjectileConfig>;
export type ExperimentType = ExperimentConfig['type'];

/* ------------------------------------------------------------------ */
/* AI interpretation of an uploaded diagram (model output).            */
/* Kept flat and small so it fits the provider's structured-output     */
/* grammar. Every value is nullable: unreadable means missing.         */
/* ------------------------------------------------------------------ */

const Q = z.object({
  value: z.number().nullable().describe('Numeric value exactly as written in the diagram, or null if not clearly readable. Never guess.'),
  unit: z.string().nullable().describe('Unit as written (e.g. "Ω", "kΩ", "V", "cm", "m/s"), or null if none is shown.'),
  sourceText: z.string().nullable().describe('The literal text in the image this came from, or null.'),
  inferred: z.boolean().describe('true if not written explicitly in the image (e.g. deduced from context).'),
});
export type AIQuantity = z.infer<typeof Q>;

export const COMPONENT_KINDS = ['battery', 'cell', 'resistor', 'wire', 'switch', 'lamp', 'ammeter', 'voltmeter', 'lens', 'object', 'image', 'focal_point', 'principal_axis', 'ray', 'projectile', 'launch_point', 'trajectory', 'ground', 'label', 'other'] as const;

export const Interpretation = z.object({
  experimentType: z.enum(['circuit', 'lens', 'projectile', 'unsupported']),
  summary: z.string().max(400).describe('One or two plain sentences describing what the diagram shows.'),
  unsupportedReason: z.string().max(400).nullable(),
  imageQuality: z.enum(['clear', 'partial', 'blurry', 'unreadable']),
  components: z.array(z.object({
    kind: z.enum(COMPONENT_KINDS),
    label: z.string().max(40).nullable(),
    valueText: z.string().max(40).nullable().describe('Value text as printed next to the component, or null.'),
    box: z.array(z.number().min(0).max(1000)).length(4).nullable().describe('Approximate bounding box [ymin, xmin, ymax, xmax] scaled 0-1000, or null.'),
  })).max(24),
  circuit: z.object({
    topology: z.enum(['series', 'parallel', 'mixed', 'unknown']).describe('mixed means exactly: R1 in series with the parallel pair R2 and R3. Use unknown for anything else.'),
    voltage: Q,
    resistors: z.array(z.object({ label: z.string().max(20).nullable(), value: Q })).max(3),
  }).nullable(),
  lens: z.object({ focalLength: Q, objectDistance: Q, objectHeight: Q }).nullable(),
  projectile: z.object({ initialSpeed: Q, launchAngle: Q, gravity: Q }).nullable(),
  missing: z.array(z.string().max(160)).max(12),
  assumptions: z.array(z.string().max(200)).max(12),
  warnings: z.array(z.string().max(200)).max(12),
  needsReview: z.array(z.string().max(80)).max(16).describe('Field names the user should check, e.g. "R2 value", "topology".'),
});
export type Interpretation = z.infer<typeof Interpretation>;

/* ------------------------------------------------------------------ */
/* Tutor                                                               */
/* ------------------------------------------------------------------ */

export const LANGUAGES = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', zh: 'Chinese (Simplified)', ja: 'Japanese',
} as const;
export type LanguageCode = keyof typeof LANGUAGES;

export const TutorRequest = z.object({
  config: ExperimentConfig,
  question: z.string().trim().min(2).max(600),
  mode: z.enum(['short', 'steps']),
  language: z.enum(Object.keys(LANGUAGES) as [LanguageCode, ...LanguageCode[]]),
  context: z.object({
    title: z.string().max(120).optional(),
    assumptions: z.array(z.string().max(200)).max(12).optional(),
    source: z.enum(['example', 'upload', 'manual', 'shared']).optional(),
  }).optional(),
});
export type TutorRequest = z.infer<typeof TutorRequest>;

/** What the model must return for the tutor. Suggestions are validated again against PARAMS. */
export const TutorModelOutput = z.object({
  answerMarkdown: z.string().min(1).max(6000),
  suggestions: z.array(z.object({
    label: z.string().max(80),
    param: z.string().max(40),
    value: z.number(),
  })).max(3),
});
export type TutorModelOutput = z.infer<typeof TutorModelOutput>;

export const TutorSuggestion = z.object({ label: z.string(), param: z.string(), value: z.number() });
export type TutorSuggestion = z.infer<typeof TutorSuggestion>;

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export const SourcesRequest = z.object({
  type: z.enum(['circuit', 'lens', 'projectile']),
  concept: z.string().max(60).optional(),
});
export const SourceResult = z.object({
  title: z.string(),
  url: z.string().url(),
  domain: z.string(),
  excerpt: z.string(),
  trusted: z.boolean(),
  retrievedAt: z.string(),
});
export type SourceResult = z.infer<typeof SourceResult>;

/* ------------------------------------------------------------------ */
/* Shares                                                              */
/* ------------------------------------------------------------------ */

export const ShareCreate = z.object({
  title: z.string().trim().min(1).max(120),
  config: ExperimentConfig,
  summary: z.string().max(400).optional(),
  assumptions: z.array(z.string().max(200)).max(12).optional(),
  includeImage: z.boolean().default(false),
  image: z.string().max(2_800_000).optional(), // data URL, only when includeImage is true
});
export type ShareCreate = z.infer<typeof ShareCreate>;

export const SharePayload = z.object({
  id: z.string(),
  title: z.string(),
  config: ExperimentConfig,
  summary: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  image: z.string().nullable(),
  createdAt: z.string(),
});
export type SharePayload = z.infer<typeof SharePayload>;

/* ------------------------------------------------------------------ */
/* General science solver (any subject). The AI proposes formulas as   */
/* plain expressions; the app evaluates them with shared/expr.ts.      */
/* ------------------------------------------------------------------ */

export const SUBJECTS = ['physics', 'chemistry', 'biology', 'mathematics', 'earth_science', 'astronomy', 'computer_science', 'other'] as const;

/** Explanatory diagram as plain shape data (never SVG/HTML/code). Coordinates: x 0–100, y 0–height, y grows downward. */
export const DIAGRAM_KINDS = ['line', 'arrow', 'dashed', 'circle', 'rect', 'text', 'arc', 'polyline', 'point'] as const;
export const DIAGRAM_COLORS = ['ink', 'accent', 'measure', 'warn', 'muted'] as const;
export const DiagramEl = z.object({
  kind: z.enum(DIAGRAM_KINDS),
  x: z.number().nullable().describe('line/arrow/dashed: start x; circle/arc/point: centre x; rect: left; text: anchor x'),
  y: z.number().nullable(),
  x2: z.number().nullable().describe('line/arrow/dashed: end x; rect: width'),
  y2: z.number().nullable().describe('line/arrow/dashed: end y; rect: height'),
  r: z.number().nullable().describe('circle/arc radius'),
  a0: z.number().nullable().describe('arc start angle in degrees (0 = right, 90 = down)'),
  a1: z.number().nullable().describe('arc end angle in degrees'),
  points: z.array(z.number()).nullable().describe('polyline: flat list x1,y1,x2,y2,...'),
  text: z.string().max(60).nullable().describe('label text (text kind), or a short label drawn next to the element'),
  color: z.enum(DIAGRAM_COLORS).describe('ink = main drawing, accent = the key thing (lime), measure = quantities/forces (cyan), warn = caution (coral), muted = background/guides'),
  fill: z.boolean().nullable(),
  step: z.number().nullable().describe('Solution step number (1-based) at which this element should appear; null = always shown'),
});
export type DiagramEl = z.infer<typeof DiagramEl>;
export const Diagram = z.object({
  title: z.string().max(80),
  height: z.number().describe('Canvas height in the same units as width 100, between 40 and 100'),
  elements: z.array(DiagramEl).max(40),
  caption: z.string().max(300).nullable(),
});
export type Diagram = z.infer<typeof Diagram>;

export const SolvePlan = z.object({
  understood: z.boolean().describe('false if the question/image cannot be read or is not a science or maths question'),
  notUnderstoodReason: z.string().max(400).nullable(),
  subject: z.enum(SUBJECTS),
  topic: z.string().max(80).describe('Short topic, e.g. "Simple pendulum", "Stoichiometry", "Photosynthesis".'),
  questionText: z.string().max(2000).describe('The question as transcribed from the image and/or the typed text.'),
  givens: z.array(z.object({
    symbol: z.string().max(32).describe('Plain identifier used in expressions: letters, digits, underscore; e.g. L, g, theta_deg, m_NaCl.'),
    name: z.string().max(80),
    value: z.number().nullable().describe('Numeric value as given in the question, or null if not stated / unreadable. Never guess.'),
    unit: z.string().max(24).nullable(),
    sourceText: z.string().max(80).nullable(),
  })).max(16),
  steps: z.array(z.object({
    title: z.string().max(120),
    explanationMarkdown: z.string().max(1500),
    target: z.string().max(32).nullable().describe('Symbol this step computes (new identifier), or null for a purely explanatory step.'),
    expression: z.string().max(300).nullable().describe('Plain arithmetic expression using given/previous symbols, numbers, + - * / ^ ( ) and sqrt, sin, cos, tan, asin, acos, atan, ln, log10, exp, abs, min, max, pow; constants pi, e. Trig uses radians. No units, no "=" sign.'),
    unit: z.string().max(24).nullable(),
  })).max(12),
  answers: z.array(z.object({
    label: z.string().max(120),
    symbol: z.string().max(32),
    expression: z.string().max(300).nullable().describe('Expression (usually just the symbol of the step that computed it), or null for a non-numeric answer.'),
    unit: z.string().max(24).nullable(),
    textAnswer: z.string().max(600).nullable().describe('For non-numeric answers (e.g. biology, explanations). Null when numeric.'),
  })).max(6),
  conceptMarkdown: z.string().max(3000).describe('Short explanation of the key idea behind the solution.'),
  diagram: Diagram.nullable().optional().describe('An explanatory diagram of the situation/concept. Always provide one when a picture helps.'),
  assumptions: z.array(z.string().max(200)).max(10),
  warnings: z.array(z.string().max(200)).max(10),
});
export type SolvePlan = z.infer<typeof SolvePlan>;
