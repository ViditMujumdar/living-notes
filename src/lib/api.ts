/** Thin API client. Distinguishes "backend unreachable" from service errors. */
import type { Interpretation, SourceResult, TutorSuggestion, ExperimentConfig, LanguageCode, SharePayload } from '../../shared/schema';

export interface ApiError { code: string; message: string; status: number; network?: boolean }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const NETWORK: ApiError = { code: 'backend_unreachable', message: 'Could not reach the Living Notes server. Check your connection and try again.', status: 0, network: true };

async function request<T>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<ApiResult<T>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: { ...NETWORK, code: 'offline', message: 'You are offline. Simulations still work; AI and search need a connection.' } };
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') return { ok: false, error: { code: 'timeout', message: 'The request took too long. Please try again.', status: 0 } };
    return { ok: false, error: NETWORK };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    // A proxy error page (no JSON) means our server is not answering.
    if (!body && (res.status === 502 || res.status === 503 || res.status === 504)) return { ok: false, error: { ...NETWORK, status: res.status } };
    return { ok: false, error: { code: body?.code || 'error', message: body?.message || `Request failed (${res.status}).`, status: res.status } };
  }
  return { ok: true, data: body as T };
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface ServiceHealth { configured: boolean; lastOkAt: string | null; lastError: { at: string; kind: string; message: string } | null; provider: string; model?: string }
export interface Health { ok: true; ai: ServiceHealth; search: ServiceHealth; storage: string }

export const api = {
  health: () => request<Health>('/api/health', undefined, 10_000),
  probe: () => request<{ ai: ServiceHealth; search: ServiceHealth }>('/api/health/probe', { method: 'POST' }, 30_000),
  tutor: (body: { config: ExperimentConfig; question: string; mode: 'short' | 'steps'; language: LanguageCode; context?: { title?: string; assumptions?: string[]; source?: 'example' | 'upload' | 'manual' | 'shared' } }) =>
    request<{ answerMarkdown: string; suggestions: TutorSuggestion[]; model: string; provider: string; answeredAt: string }>('/api/tutor', json(body), 70_000),
  sources: (type: ExperimentConfig['type'], concept?: string) =>
    request<{ query: string; results: SourceResult[]; provider: string; note: string }>('/api/sources', json({ type, concept }), 20_000),
  createShare: (body: { title: string; config: ExperimentConfig; summary?: string; assumptions?: string[]; includeImage: boolean; image?: string }) =>
    request<{ id: string; url: string; includesImage: boolean }>('/api/shares', json(body), 30_000),
  getShare: (id: string) => request<SharePayload>(`/api/shares/${encodeURIComponent(id)}`, undefined, 15_000),
};

export interface AnalyzeResponse { interpretation: Interpretation; model: string; provider: string; analyzedAt: string; image: { width: number; height: number; mime: string; stored: boolean } }

/** Upload with real progress events (XHR), so the progress bar reflects actual bytes sent. */
export function analyzeImage(blob: Blob, onProgress: (sentFraction: number) => void, onUploaded: () => void): { promise: Promise<ApiResult<AnalyzeResponse>>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ApiResult<AnalyzeResponse>>((resolve) => {
    if (navigator.onLine === false) { resolve({ ok: false, error: { ...NETWORK, code: 'offline', message: 'You are offline. Connect to analyse a diagram, or set up an experiment manually.' } }); return; }
    const fd = new FormData();
    fd.append('image', blob, 'diagram.jpg');
    xhr.open('POST', '/api/analyze');
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onUploaded();
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve({ ok: true, data: body });
      else if (!body) resolve({ ok: false, error: { ...NETWORK, status: xhr.status } });
      else resolve({ ok: false, error: { code: body.code || 'error', message: body.message || 'Analysis failed.', status: xhr.status } });
    };
    xhr.onerror = () => resolve({ ok: false, error: NETWORK });
    xhr.ontimeout = () => resolve({ ok: false, error: { code: 'timeout', message: 'The analysis took too long. Please try again.', status: 0 } });
    xhr.onabort = () => resolve({ ok: false, error: { code: 'aborted', message: 'Analysis cancelled.', status: 0 } });
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}
