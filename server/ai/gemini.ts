/**
 * Google Gemini adapter (REST, models.generateContent).
 * Docs: https://aistudio.google.com/api-reference/generate-content
 *  - POST {base}/v1beta/models/{model}:generateContent, header x-goog-api-key
 *  - generationConfig.responseMimeType = application/json + responseJsonSchema for structured output
 *  - images as parts[].inlineData { mimeType, data(base64) }
 */
import { type AIProvider, type GenerateJSONRequest, ProviderError } from './provider';

interface Opts { apiKey: string; model: string; fallbackModel?: string; baseUrl: string; timeoutMs: number }

function stripSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(stripSchema);
  if (s && typeof s === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      // Not sent to the provider: $schema; string lengths (ignored by the API); array lengths
      // (verified live in Nov 2026: minItems/maxItems on this schema make generateContent return 400).
      // All of these limits are still enforced on our side by the Zod schema after the response.
      if (k === '$schema' || k === 'minLength' || k === 'maxLength' || k === 'minItems' || k === 'maxItems') continue;
      out[k] = stripSchema(v);
    }
    return out;
  }
  return s;
}

export class GeminiProvider implements AIProvider {
  readonly name = 'Google Gemini';
  constructor(private o: Opts) {}
  /** Model that answered the most recent successful request (main or fallback). */
  lastModel: string | null = null;
  get model() { return this.o.model; }
  get configured() { return Boolean(this.o.apiKey); }

  private async call(path: string, init: RequestInit): Promise<unknown> {
    if (!this.configured) throw new ProviderError('not_configured', 'AI provider key is not set.');
    let res: Response;
    try {
      res = await fetch(`${this.o.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.o.apiKey, ...(init.headers || {}) },
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new ProviderError('timeout', 'The AI provider took too long to respond.');
      throw new ProviderError('unavailable', 'Could not reach the AI provider.');
    }
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const status = res.status;
      if (status === 400) throw new ProviderError('bad_request', 'The AI provider rejected the request.', status);
      if (status === 401 || status === 403) throw new ProviderError('auth', 'The AI provider rejected the API key.', status);
      if (status === 404) throw new ProviderError('bad_request', 'The configured AI model was not found.', status);
      if (status === 429) throw new ProviderError('quota', 'The AI usage limit for this server’s key has been reached (free keys allow a small number of requests per day). Try again later, or the site owner can upgrade the key.', status);
      throw new ProviderError('unavailable', status === 503 ? 'The AI model is overloaded right now. Please try again in a minute.' : `The AI provider returned an error (${status}).`, status);
    }
    return body;
  }

  async generateJSON(req: GenerateJSONRequest): Promise<unknown> {
    const parts = req.parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: p.image.base64 } }));
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        responseMimeType: 'application/json',
        responseJsonSchema: stripSchema(req.schema),
      },
    };
    const send = (model: string) => this.call(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
    let data: any, used = this.o.model;
    try {
      data = await send(this.o.model);
    } catch (e) {
      // Overload (503) and per-model quota (429) are model-specific: retry once on the fallback model.
      const fb = this.o.fallbackModel;
      if (!(e instanceof ProviderError) || (e.status !== 503 && e.status !== 429) || !fb || fb === this.o.model) throw e;
      data = await send(fb); used = fb;
    }
    this.lastModel = used;
    if (data?.promptFeedback?.blockReason) throw new ProviderError('blocked', 'The AI provider declined to process this input.');
    const cand = data?.candidates?.[0];
    if (!cand) throw new ProviderError('bad_output', 'The AI provider returned no answer.');
    if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) throw new ProviderError('blocked', `The AI provider stopped early (${cand.finishReason}).`);
    const text = (cand.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' && !p.thought ? p.text : '')).join('');
    if (!text) throw new ProviderError('bad_output', 'The AI provider returned an empty answer.');
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('bad_output', cand.finishReason === 'MAX_TOKENS' ? 'The AI answer was cut off.' : 'The AI answer was not valid JSON.');
    }
  }

  async probe(): Promise<void> {
    await this.call(`/v1beta/models/${encodeURIComponent(this.o.model)}`, { method: 'GET' });
  }
}
