/**
 * HTTP API. Routes are built from injected services so they can be tested in isolation.
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Interpretation, TutorRequest, TutorModelOutput, SourcesRequest, ShareCreate, SolvePlan, type ExperimentConfig } from '../shared/schema';
import { parse as parseExpr, isIdent } from '../shared/expr';
import { compute, summarize, ASSUMPTIONS, activeParams, setParam } from '../shared/experiment';
import { type AIProvider, ProviderError } from './ai/provider';
import { ANALYZE_SYSTEM, SOLVE_SYSTEM, tutorSystem } from './ai/prompts';
import { type BraveSearch, SearchError } from './search/brave';
import type { Store } from './store';
import { validateImage, parseDataUrlImage } from './lib/image';
import { RateLimiter } from './lib/ratelimit';
import type { AppConfig } from './config';

export interface Services { ai: AIProvider; search: BraveSearch; store: Store; config: AppConfig }

type ServiceState = { configured: boolean; lastOkAt: string | null; lastError: { at: string; kind: string; message: string } | null };

const INTERP_JSON_SCHEMA = z.toJSONSchema(Interpretation);
const TUTOR_JSON_SCHEMA = z.toJSONSchema(TutorModelOutput);
const SOLVE_JSON_SCHEMA = z.toJSONSchema(SolvePlan);

const PROVIDER_STATUS: Record<string, number> = { not_configured: 503, auth: 502, quota: 429, unavailable: 503, timeout: 504, blocked: 422, bad_output: 502, bad_request: 502 };

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
function sanitizeDeep<T>(v: T): T {
  if (typeof v === 'string') return clean(v) as T;
  if (Array.isArray(v)) return v.map(sanitizeDeep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitizeDeep(x)])) as T;
  return v;
}

export function createApp(s: Services) {
  const app = new Hono();
  const state: Record<'ai' | 'search', ServiceState> = {
    ai: { configured: s.ai.configured, lastOkAt: null, lastError: null },
    search: { configured: s.search.configured, lastOkAt: null, lastError: null },
  };
  const ok = (k: 'ai' | 'search') => { state[k].lastOkAt = new Date().toISOString(); state[k].lastError = null; };
  const fail = (k: 'ai' | 'search', kind: string, message: string) => { state[k].lastError = { at: new Date().toISOString(), kind, message }; };

  const limits = {
    analyze: new RateLimiter(10, 10 * 60_000),
    solve: new RateLimiter(15, 10 * 60_000),
    tutor: new RateLimiter(30, 10 * 60_000),
    sources: new RateLimiter(20, 10 * 60_000),
    shares: new RateLimiter(30, 60 * 60_000),
    probe: new RateLimiter(6, 60_000),
  };
  const ip = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || (c.env as any)?.incoming?.socket?.remoteAddress || 'local');
  const limited = (c: Context, l: RateLimiter) => {
    const wait = l.take(ip(c));
    if (!wait) return null;
    c.header('Retry-After', String(wait));
    return c.json({ code: 'rate_limited', message: `Too many requests. Please wait ${wait} seconds and try again.` }, 429);
  };
  const err = (c: Context, status: number, code: string, message: string) => c.json({ code, message }, status as any);

  // Security headers + minimal access log (no bodies, no secrets).
  app.use('*', async (c, next) => {
    const t0 = Date.now();
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (c.req.path.startsWith('/api/')) console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - t0}ms`);
  });

  /* ---------------- health ---------------- */
  app.get('/api/health', (c) => c.json({
    ok: true,
    ai: { ...state.ai, provider: s.ai.name, model: s.ai.model },
    search: { ...state.search, provider: 'Brave Search' },
    storage: s.store.kind,
    now: new Date().toISOString(),
  }));

  app.post('/api/health/probe', async (c) => {
    const r = limited(c, limits.probe); if (r) return r;
    const run = async (k: 'ai' | 'search', fn: () => Promise<void>) => {
      if (!state[k].configured) return;
      try { await fn(); ok(k); } catch (e) {
        const kind = (e as ProviderError | SearchError).kind ?? 'unavailable';
        fail(k, kind, (e as Error).message);
      }
    };
    await Promise.all([run('ai', () => s.ai.probe()), run('search', () => s.search.probe())]);
    return c.json({ ai: { ...state.ai, provider: s.ai.name, model: s.ai.model }, search: { ...state.search, provider: 'Brave Search' } });
  });

  /* ---------------- analyze ---------------- */
  app.post('/api/analyze', bodyLimit({ maxSize: s.config.limits.uploadBytes + 64 * 1024, onError: (c) => err(c, 413, 'too_large', 'The image is too large.') }), async (c) => {
    if (!s.ai.configured) return err(c, 503, 'ai_not_configured', 'AI diagram analysis is not set up on this server yet. You can still choose an experiment and enter values manually.');
    const r = limited(c, limits.analyze); if (r) return r;
    let file: unknown;
    try { file = (await c.req.parseBody())['image']; } catch { return err(c, 400, 'bad_form', 'Upload the image as multipart form data in the "image" field.'); }
    if (!(file instanceof File)) return err(c, 400, 'no_image', 'No image was attached.');
    const buf = new Uint8Array(await file.arrayBuffer());
    const v = validateImage(buf, s.config.limits);
    if (!v.ok) return err(c, 422, v.code, v.message);
    let raw: unknown;
    try {
      raw = await s.ai.generateJSON({
        system: ANALYZE_SYSTEM,
        parts: [
          { text: 'Read this physics diagram and return the structured interpretation. Remember: unreadable values must be null.' },
          { image: { mime: v.info.mime, base64: Buffer.from(buf).toString('base64') } },
        ],
        schema: INTERP_JSON_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: 4096,
      });
      ok('ai');
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('unavailable', 'AI request failed.');
      fail('ai', pe.kind, pe.message);
      return err(c, PROVIDER_STATUS[pe.kind] ?? 502, `ai_${pe.kind}`, pe.message);
    }
    const parsed = Interpretation.safeParse(raw);
    if (!parsed.success) {
      console.warn('analyze: model output failed schema validation', parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')));
      return err(c, 502, 'ai_invalid_output', 'The AI returned an answer we could not verify, so nothing was used. Please try again or enter the values manually.');
    }
    const interp = sanitizeDeep(parsed.data);
    // Enforce supported topologies regardless of what the model says.
    if (interp.circuit) {
      const n = interp.circuit.resistors.length;
      const bad = (interp.circuit.topology === 'mixed' && n !== 3) || (interp.circuit.topology === 'parallel' && n < 2) || n === 0;
      if (bad && interp.circuit.topology !== 'unknown') {
        interp.circuit.topology = 'unknown';
        interp.warnings.push('The detected arrangement does not match the number of resistors found. Please choose the arrangement.');
        interp.needsReview.push('topology');
      }
    }
    return c.json({ interpretation: interp, model: (s.ai as any).lastModel ?? s.ai.model, provider: s.ai.name, analyzedAt: new Date().toISOString(), image: { width: v.info.width, height: v.info.height, mime: v.info.mime, stored: false } });
  });

  /* ---------------- general solver ---------------- */
  app.post('/api/solve', bodyLimit({ maxSize: s.config.limits.uploadBytes + 64 * 1024, onError: (c) => err(c, 413, 'too_large', 'The request is too large.') }), async (c) => {
    if (!s.ai.configured) return err(c, 503, 'ai_not_configured', 'The AI solver is not set up on this server yet.');
    const r = limited(c, limits.solve); if (r) return r;
    let form: Record<string, unknown>;
    try { form = await c.req.parseBody(); } catch { return err(c, 400, 'bad_form', 'Send the question as multipart form data.'); }
    const question = typeof form['question'] === 'string' ? clean(form['question']).slice(0, 2000) : '';
    const file = form['image'];
    const parts: ({ text: string } | { image: { mime: string; base64: string } })[] = [];
    if (file instanceof File && file.size > 0) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const v = validateImage(buf, s.config.limits);
      if (!v.ok) return err(c, 422, v.code, v.message);
      parts.push({ image: { mime: v.info.mime, base64: Buffer.from(buf).toString('base64') } });
    }
    if (!parts.length && question.length < 3) return err(c, 400, 'empty', 'Type a question or attach a photo of one.');
    parts.unshift({ text: question ? `STUDENT QUESTION (untrusted text):\n"""${question}"""${parts.length ? '\nA photo of the question/diagram is attached.' : ''}` : 'Solve the science question shown in the attached photo.' });
    let raw: unknown;
    try {
      raw = await s.ai.generateJSON({ system: SOLVE_SYSTEM, parts, schema: SOLVE_JSON_SCHEMA, temperature: 0.2, maxOutputTokens: 6144 });
      ok('ai');
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('unavailable', 'AI request failed.');
      fail('ai', pe.kind, pe.message);
      return err(c, PROVIDER_STATUS[pe.kind] ?? 502, `ai_${pe.kind}`, pe.message);
    }
    const parsed = SolvePlan.safeParse(raw);
    if (!parsed.success) return err(c, 502, 'ai_invalid_output', 'The AI returned a solution we could not verify, so nothing was shown. Please try again.');
    const plan = sanitizeDeep(parsed.data);
    // Drop any expression the safe parser cannot read; flag it instead of showing an unverifiable number.
    const bad: string[] = [];
    const check = (e: string | null, where: string) => { if (!e) return null; try { parseExpr(e); return e; } catch { bad.push(where); return null; } };
    plan.givens = plan.givens.filter((g) => isIdent(g.symbol));
    plan.steps = plan.steps.map((st, i) => ({ ...st, target: st.target && isIdent(st.target) ? st.target : null, expression: check(st.expression, `step ${i + 1}`) }));
    plan.answers = plan.answers.map((a, i) => ({ ...a, expression: check(a.expression, `answer ${i + 1}`) }));
    if (bad.length) plan.warnings.push(`Some formulas could not be checked by the app (${bad.join(', ')}), so no number is shown for them.`);
    // Clamp the diagram to its canvas and drop elements that are missing the fields they need.
    if (plan.diagram) {
      const d = plan.diagram;
      d.height = Math.min(100, Math.max(40, Number.isFinite(d.height) ? d.height : 70));
      const fin = (v: number | null) => v != null && Number.isFinite(v) && Math.abs(v) <= 400;
      d.elements = d.elements.filter((e) => {
        if (e.kind === 'text') return fin(e.x) && fin(e.y) && Boolean(e.text);
        if (e.kind === 'polyline') return Array.isArray(e.points) && e.points.length >= 4 && e.points.length <= 80 && e.points.every((v) => fin(v));
        if (e.kind === 'circle' || e.kind === 'point') return fin(e.x) && fin(e.y) && (e.kind === 'point' || (fin(e.r) && e.r! > 0));
        if (e.kind === 'arc') return fin(e.x) && fin(e.y) && fin(e.r) && fin(e.a0) && fin(e.a1);
        return fin(e.x) && fin(e.y) && fin(e.x2) && fin(e.y2);
      });
      if (!d.elements.length) plan.diagram = null;
    }
    return c.json({ plan, model: (s.ai as any).lastModel ?? s.ai.model, provider: s.ai.name, solvedAt: new Date().toISOString(), imageStored: false });
  });

  /* ---------------- tutor ---------------- */
  app.post('/api/tutor', bodyLimit({ maxSize: 32 * 1024, onError: (c) => err(c, 413, 'too_large', 'Request too large.') }), async (c) => {
    if (!s.ai.configured) return err(c, 503, 'ai_not_configured', 'The AI tutor is not set up on this server yet.');
    const r = limited(c, limits.tutor); if (r) return r;
    let body: unknown; try { body = await c.req.json(); } catch { return err(c, 400, 'bad_json', 'Invalid JSON.'); }
    const p = TutorRequest.safeParse(body);
    if (!p.success) return err(c, 400, 'bad_request', p.error.issues[0]?.message ?? 'Invalid request.');
    const { config, question, mode, language, context } = p.data;
    const results = compute(config);
    const data = {
      experimentType: config.type,
      title: context?.title,
      source: context?.source,
      parameters: config,
      results: results.result,
      resultsSummary: summarize(config),
      assumptions: [...ASSUMPTIONS[config.type], ...(context?.assumptions ?? [])],
    };
    let raw: unknown;
    try {
      raw = await s.ai.generateJSON({
        system: tutorSystem(config, language, mode),
        parts: [{ text: `EXPERIMENT DATA (computed by the app):\n${JSON.stringify(data, null, 1)}\n\nSTUDENT QUESTION (untrusted text):\n"""${question}"""` }],
        schema: TUTOR_JSON_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 2048,
      });
      ok('ai');
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('unavailable', 'AI request failed.');
      fail('ai', pe.kind, pe.message);
      return err(c, PROVIDER_STATUS[pe.kind] ?? 502, `ai_${pe.kind}`, pe.message);
    }
    const out = TutorModelOutput.safeParse(raw);
    if (!out.success) return err(c, 502, 'ai_invalid_output', 'The tutor returned an answer we could not verify. Please ask again.');
    const allowed = new Set(activeParams(config).map((m) => m.key));
    const suggestions = out.data.suggestions.filter((sg) => allowed.has(sg.param) && 'config' in setParam(config, sg.param, sg.value)).map((sg) => ({ label: clean(sg.label), param: sg.param, value: sg.value }));
    return c.json({ answerMarkdown: clean(out.data.answerMarkdown), suggestions, model: (s.ai as any).lastModel ?? s.ai.model, provider: s.ai.name, answeredAt: new Date().toISOString() });
  });

  /* ---------------- sources ---------------- */
  app.post('/api/sources', bodyLimit({ maxSize: 4 * 1024, onError: (c) => err(c, 413, 'too_large', 'Request too large.') }), async (c) => {
    if (!s.search.configured) return err(c, 503, 'search_not_configured', 'Source search is not set up on this server yet.');
    const r = limited(c, limits.sources); if (r) return r;
    let body: unknown; try { body = await c.req.json(); } catch { return err(c, 400, 'bad_json', 'Invalid JSON.'); }
    const p = SourcesRequest.safeParse(body);
    if (!p.success) return err(c, 400, 'bad_request', 'Invalid request.');
    try {
      const res = await s.search.search(p.data.type, p.data.concept);
      ok('search');
      return c.json({ ...res, provider: 'Brave Search', note: 'Results and excerpts come directly from the search service. Pages were not opened or read in full.' });
    } catch (e) {
      const se = e instanceof SearchError ? e : new SearchError('unavailable', 'Search failed.');
      fail('search', se.kind, se.message);
      return err(c, PROVIDER_STATUS[se.kind] ?? 502, `search_${se.kind}`, se.message);
    }
  });

  /* ---------------- shares ---------------- */
  app.post('/api/shares', bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (c) => err(c, 413, 'too_large', 'Share is too large.') }), async (c) => {
    const r = limited(c, limits.shares); if (r) return r;
    let body: unknown; try { body = await c.req.json(); } catch { return err(c, 400, 'bad_json', 'Invalid JSON.'); }
    const p = ShareCreate.safeParse(body);
    if (!p.success) return err(c, 400, 'bad_request', p.error.issues[0]?.message ?? 'Invalid share.');
    let image: string | null = null;
    if (p.data.includeImage) {
      if (!p.data.image) return err(c, 400, 'no_image', 'Include-image was chosen but no image was sent.');
      const img = parseDataUrlImage(p.data.image, s.config.limits.shareImageBytes);
      if (!img.ok) return err(c, 422, 'bad_image', img.message);
      image = p.data.image;
    }
    const id = randomBytes(18).toString('base64url');
    const rec = { id, title: clean(p.data.title), config: p.data.config as ExperimentConfig, summary: p.data.summary ? clean(p.data.summary) : undefined, assumptions: p.data.assumptions?.map(clean), image, createdAt: new Date().toISOString() };
    await s.store.putShare(rec);
    const base = s.config.publicUrl || new URL(c.req.url).origin;
    return c.json({ id, url: `${base}/s/${id}`, includesImage: Boolean(image) }, 201);
  });

  app.get('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return err(c, 404, 'not_found', 'This shared experiment does not exist.');
    const rec = await s.store.getShare(id);
    if (!rec) return err(c, 404, 'not_found', 'This shared experiment does not exist.');
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(rec);
  });

  app.all('/api/*', (c) => err(c, 404, 'not_found', 'Unknown API route.'));
  app.onError((e, c) => {
    console.error('unhandled error:', (e as Error).name);
    return err(c, 500, 'server_error', 'Something went wrong on the server. Your work in the browser is unaffected.');
  });
  return app;
}
