/** Production entry: one Node process serving the API and the built frontend. */
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config';
import { createApp } from './app';
import { GeminiProvider } from './ai/gemini';
import { BraveSearch } from './search/brave';
import { createStore } from './store';

const store = await createStore(config.dataDir);
const ai = new GeminiProvider({ apiKey: config.ai.apiKey, model: config.ai.model, fallbackModel: config.ai.fallbackModel, baseUrl: config.ai.baseUrl, timeoutMs: config.ai.timeoutMs });
const search = new BraveSearch({ apiKey: config.search.apiKey, baseUrl: config.search.baseUrl, timeoutMs: config.search.timeoutMs });
const app = createApp({ ai, search, store, config });

const root = path.relative(process.cwd(), config.staticDir) || '.';
if (fs.existsSync(config.staticDir)) {
  app.use('/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  app.use('*', serveStatic({ root }));
  const indexHtml = fs.readFileSync(path.join(config.staticDir, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(indexHtml)); // SPA fallback for /lab, /saved, /s/:id …
} else {
  console.warn(`No built frontend at ${config.staticDir}. Run "npm run build" (API still works).`);
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Living Notes listening on http://${config.host}:${info.port}`);
  console.log(`AI: ${ai.configured ? `${ai.name} (${ai.model})` : 'not configured'} · Search: ${search.configured ? 'Brave Search' : 'not configured'} · Storage: ${store.kind} in ${config.dataDir}`);
});
