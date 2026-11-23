import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app';
import { GeminiProvider } from '../server/ai/gemini';
import { BraveSearch } from '../server/search/brave';
import { createStore } from '../server/store';
import { config as baseConfig } from '../server/config';
import { sniffImage } from '../server/lib/image';
import { type AIProvider, ProviderError, type GenerateJSONRequest } from '../server/ai/provider';
import { makePng, circuitInterpretation } from './helpers';

class FakeAI implements AIProvider {
  name = 'Fake'; model = 'fake-1'; configured = true;
  next: unknown = circuitInterpretation; error: ProviderError | null = null; last: GenerateJSONRequest | null = null;
  async generateJSON(req: GenerateJSONRequest) { this.last = req; if (this.error) throw this.error; return this.next; }
  async probe() { if (this.error) throw this.error; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-test-'));
const cfg = { ...baseConfig, dataDir: tmp, publicUrl: 'https://notes.example' };

async function setup(ai: AIProvider, search = new BraveSearch({ apiKey: '', baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 })) {
  const store = await createStore(fs.mkdtempSync(path.join(tmp, 's-')));
  return createApp({ ai, search, store, config: cfg });
}
const form = (buf: Buffer, name = 'diagram.png', type = 'image/png') => { const f = new FormData(); f.append('image', new File([new Uint8Array(buf)], name, { type })); return f; };

describe('image sniffing (content, not extension)', () => {
  it('reads PNG dimensions', () => expect(sniffImage(makePng(320, 240))).toEqual({ mime: 'image/png', width: 320, height: 240 }));
  it('rejects text pretending to be an image', () => expect(sniffImage(Buffer.from('<?php echo 1; ?>'.padEnd(64, ' ')))).toBeNull());
});

describe('/api/analyze', () => {
  it('returns a validated interpretation and keeps unreadable values null', async () => {
    const ai = new FakeAI(); const app = await setup(ai);
    const res = await app.request('/api/analyze', { method: 'POST', body: form(makePng(400, 300)) });
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.interpretation.circuit.resistors[1].value.value).toBeNull();
    expect(j.image.stored).toBe(false);
    // the image is sent as inline data and the system prompt marks it as untrusted
    expect(ai.last!.system).toMatch(/untrusted/i);
    expect(ai.last!.parts.some((p) => 'image' in p)).toBe(true);
  });
  it('rejects files whose content is not an image even if named .png', async () => {
    const app = await setup(new FakeAI());
    const res = await app.request('/api/analyze', { method: 'POST', body: form(Buffer.from('not an image at all'.repeat(10)), 'x.png') });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe('bad_type');
  });
  it('rejects images that are too small to read', async () => {
    const res = await (await setup(new FakeAI())).request('/api/analyze', { method: 'POST', body: form(makePng(120, 90)) });
    expect(((await res.json()) as any).code).toBe('too_small');
  });
  it('discards model output that fails the schema (nothing invented)', async () => {
    const ai = new FakeAI(); ai.next = { experimentType: 'circuit', summary: 'x' };
    const res = await (await setup(ai)).request('/api/analyze', { method: 'POST', body: form(makePng(400, 300)) });
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).code).toBe('ai_invalid_output');
  });
  it('downgrades an inconsistent topology to unknown', async () => {
    const ai = new FakeAI();
    ai.next = { ...circuitInterpretation, circuit: { ...circuitInterpretation.circuit, resistors: circuitInterpretation.circuit.resistors.slice(0, 2) } };
    const j: any = await (await (await setup(ai)).request('/api/analyze', { method: 'POST', body: form(makePng(400, 300)) })).json();
    expect(j.interpretation.circuit.topology).toBe('unknown');
    expect(j.interpretation.needsReview).toContain('topology');
  });
  it('reports provider failures honestly', async () => {
    const ai = new FakeAI(); ai.error = new ProviderError('quota', 'The AI provider rate limit or quota was reached.');
    const app = await setup(ai);
    const res = await app.request('/api/analyze', { method: 'POST', body: form(makePng(400, 300)) });
    expect(res.status).toBe(429);
    const h: any = await (await app.request('/api/health')).json();
    expect(h.ai.lastError.kind).toBe('quota');
    expect(h.ai.lastOkAt).toBeNull();
  });
  it('says setup is required when no key is configured', async () => {
    const ai = new FakeAI(); ai.configured = false;
    const res = await (await setup(ai)).request('/api/analyze', { method: 'POST', body: form(makePng(400, 300)) });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).code).toBe('ai_not_configured');
  });
});

describe('/api/tutor', () => {
  const body = { config: { type: 'circuit', topology: 'series', voltage: 12, resistors: [4, 8] }, question: 'Why did the current decrease?', mode: 'short', language: 'en' };
  it('sends engine-computed results and filters invalid suggestions', async () => {
    const ai = new FakeAI();
    ai.next = { answerMarkdown: 'The current is $I = 1$ A.', suggestions: [
      { label: 'Set R2 to 24 Ω', param: 'r2', value: 24 },
      { label: 'Set R3 to 5 Ω', param: 'r3', value: 5 }, // no R3 in this circuit
      { label: 'Set R1 to -2 Ω', param: 'r1', value: -2 }, // invalid
      ] };
    const res = await (await setup(ai)).request('/api/tutor', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.suggestions).toEqual([{ label: 'Set R2 to 24 Ω', param: 'r2', value: 24 }]);
    const sent = (ai.last!.parts[0] as { text: string }).text;
    expect(sent).toMatch(/"totalCurrent": 1/); // 12 V / 12 Ω from the physics engine
    expect(sent).toMatch(/untrusted/);
  });
  it('validates the request', async () => {
    const res = await (await setup(new FakeAI())).request('/api/tutor', { method: 'POST', body: JSON.stringify({ ...body, config: { type: 'circuit', topology: 'mixed', voltage: 1, resistors: [1] } }), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
  });
});

describe('/api/solve', () => {
  const plan = {
    understood: true, notUnderstoodReason: null, subject: 'physics', topic: 'Simple pendulum', questionText: 'L = 1.2 m, find T',
    givens: [{ symbol: 'L', name: 'Length', value: 1.2, unit: 'm', sourceText: '1.2 m' }, { symbol: 'g', name: 'Gravity', value: 9.8, unit: 'm/s^2', sourceText: null }],
    steps: [{ title: 'Period', explanationMarkdown: 'Use $T = 2\\pi\\sqrt{L/g}$', target: 'T', expression: '2*pi*sqrt(L/g)', unit: 's' },
            { title: 'Bad', explanationMarkdown: 'x', target: 'X', expression: 'process.exit()', unit: null }],
    answers: [{ label: 'Period', symbol: 'T', expression: 'T', unit: 's', textAnswer: null }],
    conceptMarkdown: 'Period depends on L and g.', assumptions: [], warnings: [],
  };
  const post = (app: any, fd: FormData) => app.request('/api/solve', { method: 'POST', body: fd });
  it('accepts a typed question and strips unparseable formulas with a warning', async () => {
    const ai = new FakeAI(); ai.next = plan;
    const fd = new FormData(); fd.append('question', 'Find the period of a 1.2 m pendulum');
    const res = await post(await setup(ai), fd);
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.plan.steps[0].expression).toBe('2*pi*sqrt(L/g)');
    expect(j.plan.steps[1].expression).toBeNull();
    expect(j.plan.warnings.join(' ')).toMatch(/could not be checked/);
    expect((ai.last!.parts[0] as { text: string }).text).toMatch(/untrusted/);
  });
  it('requires a question or an image', async () => {
    const res = await post(await setup(new FakeAI()), new FormData());
    expect(res.status).toBe(400);
  });
  it('rejects invalid model output', async () => {
    const ai = new FakeAI(); ai.next = { understood: true };
    const fd = new FormData(); fd.append('question', 'What is osmosis?');
    expect((await post(await setup(ai), fd)).status).toBe(502);
  });
});

describe('/api/shares', () => {
  it('creates an unguessable share and reads it back without images by default', async () => {
    const app = await setup(new FakeAI());
    const res = await app.request('/api/shares', { method: 'POST', body: JSON.stringify({ title: 'My lens', config: { type: 'lens', focalLength: 10, objectDistance: 25, objectHeight: 4 } }), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(j.url).toBe(`https://notes.example/s/${j.id}`);
    const got: any = await (await app.request(`/api/shares/${j.id}`)).json();
    expect(got.config.objectDistance).toBe(25);
    expect(got.image).toBeNull();
  });
  it('rejects invalid configs and fake images', async () => {
    const app = await setup(new FakeAI());
    const bad = await app.request('/api/shares', { method: 'POST', body: JSON.stringify({ title: 'x', config: { type: 'lens', focalLength: 0, objectDistance: 1, objectHeight: 1 } }), headers: { 'Content-Type': 'application/json' } });
    expect(bad.status).toBe(400);
    const fake = await app.request('/api/shares', { method: 'POST', body: JSON.stringify({ title: 'x', includeImage: true, image: 'data:image/png;base64,' + Buffer.from('hello world, not a png at all').toString('base64'), config: { type: 'lens', focalLength: 1, objectDistance: 1, objectHeight: 1 } }), headers: { 'Content-Type': 'application/json' } });
    expect(fake.status).toBe(422);
  });
  it('404s for unknown ids', async () => {
    expect((await (await setup(new FakeAI())).request('/api/shares/AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });
});

/* ---------- real adapters against local HTTP mocks of the provider APIs ---------- */
let mock: http.Server; let base = '';
const seen: { path: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
let geminiReply: (body: any) => { status: number; json: any } = () => ({ status: 200, json: {} });
beforeAll(async () => {
  mock = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = data ? JSON.parse(data) : null;
      seen.push({ path: req.url!, headers: req.headers, body });
      if (req.url!.startsWith('/res/v1/web/search')) {
        if (req.headers['x-subscription-token'] !== 'brave-test') { res.writeHead(401); return res.end('{}'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ web: { results: [
          { title: 'Fun <strong>circuits</strong>', url: 'https://www.pinterest.com/x', description: 'pins' },
          { title: 'Series circuits', url: 'https://example-blog.com/series', description: 'A blog post' },
          { title: 'Resistors in Series and Parallel', url: 'https://openstax.org/books/physics/pages/19-3', description: 'In a <strong>series</strong> circuit &amp; more' },
          { title: 'Javascript link', url: 'javascript:alert(1)', description: 'bad' },
        ] } }));
      }
      const r = geminiReply(body);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(mock.address() as any).port}`;
});
afterAll(() => mock.close());

describe('Gemini adapter (HTTP contract)', () => {
  it('sends the documented request shape and parses JSON text parts', async () => {
    geminiReply = () => ({ status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ hello: 'world' }) }] } }] } });
    const g = new GeminiProvider({ apiKey: 'k-test', model: 'gemini-test', baseUrl: base, timeoutMs: 2000 });
    const out = await g.generateJSON({ system: 'sys', parts: [{ text: 'hi' }, { image: { mime: 'image/png', base64: 'AAAA' } }], schema: { type: 'object' } });
    expect(out).toEqual({ hello: 'world' });
    const req = seen.at(-1)!;
    expect(req.path).toBe('/v1beta/models/gemini-test:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('k-test');
    expect(req.body.generationConfig.responseMimeType).toBe('application/json');
    expect(req.body.generationConfig.responseJsonSchema).toEqual({ type: 'object' });
    expect(req.body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'AAAA' });
    expect(req.body.systemInstruction.parts[0].text).toBe('sys');
  });
  it('maps HTTP errors to provider error kinds', async () => {
    const g = new GeminiProvider({ apiKey: 'k', model: 'm', baseUrl: base, timeoutMs: 2000 });
    for (const [status, kind] of [[401, 'auth'], [429, 'quota'], [503, 'unavailable']] as const) {
      geminiReply = () => ({ status, json: { error: { message: 'secret detail' } } });
      await expect(g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).rejects.toMatchObject({ kind });
    }
  });
  it('also falls back when the main model\'s quota is used up (429)', async () => {
    geminiReply = () => { const p = seen.at(-1)!.path; return p.includes('limited-model') ? { status: 429, json: { error: { message: 'quota' } } } : { status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":1}' }] } }] } }; };
    const g = new GeminiProvider({ apiKey: 'k', model: 'limited-model', fallbackModel: 'spare-model', baseUrl: base, timeoutMs: 2000 });
    expect(await g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).toEqual({ ok: 1 });
    expect(g.lastModel).toBe('spare-model');
  });
  it('retries once on the fallback model when the main model is overloaded (503)', async () => {
    geminiReply = () => ({ status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] } });
    const calls: string[] = [];
    const prev = geminiReply;
    geminiReply = () => { const p = seen.at(-1)!.path; calls.push(p); return p.includes('busy-model') ? { status: 503, json: { error: { message: 'high demand' } } } : prev({}); };
    const g = new GeminiProvider({ apiKey: 'k', model: 'busy-model', fallbackModel: 'spare-model', baseUrl: base, timeoutMs: 2000 });
    expect(await g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).toEqual({ ok: true });
    expect(calls.map((c) => c.split('/').pop())).toEqual(['busy-model:generateContent', 'spare-model:generateContent']);
    expect(g.lastModel).toBe('spare-model');
  });
  it('treats blocked prompts and non-JSON answers as failures', async () => {
    const g = new GeminiProvider({ apiKey: 'k', model: 'm', baseUrl: base, timeoutMs: 2000 });
    geminiReply = () => ({ status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } });
    await expect(g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).rejects.toMatchObject({ kind: 'blocked' });
    geminiReply = () => ({ status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] } });
    await expect(g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).rejects.toMatchObject({ kind: 'bad_output' });
  });
  it('times out', async () => {
    const g = new GeminiProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://10.255.255.1', timeoutMs: 300 });
    await expect(g.generateJSON({ system: '', parts: [{ text: 'x' }], schema: {} })).rejects.toMatchObject({ kind: expect.stringMatching(/timeout|unavailable/) });
  });
});

describe('Brave adapter (HTTP contract)', () => {
  it('ranks trusted educational domains first, strips HTML, drops unsafe/social links', async () => {
    const b = new BraveSearch({ apiKey: 'brave-test', baseUrl: base, timeoutMs: 2000 });
    const r = await b.search('circuit', 'series');
    expect(r.query).toMatch(/series/);
    expect(r.results.map((x) => x.domain)).toEqual(['openstax.org', 'example-blog.com']);
    expect(r.results[0]!.title).toBe('Resistors in Series and Parallel');
    expect(r.results[0]!.excerpt).toBe('In a series circuit & more');
    expect(r.results[0]!.trusted).toBe(true);
    expect(r.results[0]!.retrievedAt).toMatch(/^\d{4}-/);
    const req = seen.at(-1)!;
    expect(req.path).toMatch(/^\/res\/v1\/web\/search\?q=/);
  });
  it('reports auth failures', async () => {
    const b = new BraveSearch({ apiKey: 'wrong', baseUrl: base, timeoutMs: 2000 });
    await expect(b.search('lens')).rejects.toMatchObject({ kind: 'auth' });
  });
});
