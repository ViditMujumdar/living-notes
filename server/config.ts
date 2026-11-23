/** Server configuration from environment variables. Secrets never leave the server. */
import path from 'node:path';

const env = process.env;
const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export const config = {
  port: int(env.PORT, 8787),
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_APP_URL || '').replace(/\/+$/, ''),
  dataDir: env.DATA_DIR || path.resolve('.data'),
  staticDir: env.STATIC_DIR || path.resolve('dist'),

  ai: {
    provider: (env.AI_PROVIDER || 'gemini') as 'gemini',
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.6-flash',
    fallbackModel: env.GEMINI_FALLBACK_MODEL || '',
    /** Override only for tests (points the real adapter at a local mock server). */
    baseUrl: (env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45_000),
  },
  search: {
    provider: 'brave' as const,
    apiKey: env.BRAVE_SEARCH_API_KEY || '',
    baseUrl: (env.BRAVE_API_BASE || 'https://api.search.brave.com').replace(/\/+$/, ''),
    timeoutMs: int(env.SEARCH_TIMEOUT_MS, 10_000),
  },
  limits: {
    uploadBytes: int(env.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
    minDim: 200,
    maxDim: 8000,
    shareImageBytes: 2 * 1024 * 1024,
  },
};

export type AppConfig = typeof config;
