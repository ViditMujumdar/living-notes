# Living Notes

**Your notes. Now in motion.** Photograph a textbook physics diagram and turn it into an interactive experiment: DC resistor circuits, thin convex lenses and projectile motion.

Upload → AI reads the diagram → **you review and correct every value** → the diagram becomes a working simulation → change variables and ask an AI tutor why.

---

## Quick start (local)

Requirements: **Node.js 22.13 or newer** (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # add your keys (optional, see below)
npm run dev                 # app on http://localhost:5173 (API on :8787)
```

Production-style run:

```bash
npm run build               # builds the React app (dist/) and the server (dist-server/)
npm start                   # one Node process serves the app + API on $PORT (default 8787)
```

The examples and manual simulations work **with no keys at all**. AI diagram reading, the tutor and source search show a clear "setup required" state until you add keys.

## Enabling real AI and search

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini key ([AI Studio](https://aistudio.google.com/apikey)). Enables diagram reading and the tutor. |
| `GEMINI_MODEL` | Multimodal model code (default `gemini-3.6-flash`). Check current codes on the [models page](https://aistudio.google.com/docs/models). |
| `GEMINI_FALLBACK_MODEL` | Optional. Retried once when the main model returns 503 (overloaded), e.g. `gemini-3.5-flash-lite`. |
| `BRAVE_SEARCH_API_KEY` | [Brave Search API](https://api-dashboard.search.brave.com/) key. Enables "Find supporting sources". |
| `PUBLIC_APP_URL` | Your public URL, used in share links and poster QR codes. |
| `DATA_DIR` | Folder for the SQLite database (share links). Set automatically on Embarko. |

Then verify against the **real** services:

```bash
npm start &                                   # with keys in the environment
npm run verify:live -- http://localhost:8787 ./a-photo-of-a-circuit.jpg
```

The app only shows **"Fully connected"** after real AI and search requests have succeeded. Being online, or having a key set, is not treated as proof.

## Deploying on Embarko

Embarko runs one Node process: it installs dependencies, runs `npm run build`, then `npm start`. The server reads `PORT` and binds `0.0.0.0` ([Embarko deploy docs](https://embarko.ai/docs/deploy)).

1. Deploy the `living-notes/` folder (leave out `node_modules`, `dist`, `dist-server`, `.data`, `.env`).
2. Set the environment variables above (`GEMINI_API_KEY`, `GEMINI_MODEL`, `BRAVE_SEARCH_API_KEY`, `PUBLIC_APP_URL`) in the app's settings ([Embarko env vars](https://embarko.ai/docs/env-vars)). Secrets never go in the upload.
3. **Storage:** share links are stored in SQLite at `$DATA_DIR/living-notes.db`. Embarko's `DATA_DIR` survives redeploys and restarts ([Embarko data docs](https://embarko.ai/docs/data)). Embarko notes that this data is **not backed up**. If `node:sqlite` is unavailable (Node < 22.13), the server falls back to an atomic JSON file in the same folder.
4. Memory: Embarko apps get 256 MB. Living Notes holds uploads only in memory while analysing (8 MB max).
5. After deploying, run `npm run verify:live -- https://<your-app>.embarko.app` from your machine.

Build tools (Vite, esbuild) are listed under `dependencies` on purpose, so the build works even if the host installs production dependencies only.

## Supported experiments (and limits)

| Experiment | Supported | Not supported |
|---|---|---|
| **DC circuits** | One ideal battery; 1–3 resistors in **series**, 2–3 in **parallel**, or **R1 in series with (R2 ∥ R3)** | Other networks, multiple sources, capacitors, bridges, internal resistance |
| **Convex lens** | Ideal thin convex lens; object on the axis; real and virtual images; object at F (image at infinity) | Concave lenses, mirrors, thick lenses, multiple lenses |
| **Projectile** | No air resistance; launch and landing at the same height; 0°–90°; any positive g | Air resistance, launch from a height, inclined ground |

Conventions: lens at x = 0, real object at x = −u with u > 0, f > 0, `1/f = 1/u + 1/v`, `m = −v/u`. The object is treated as "at F" within ±0.5% of f.

Unsupported uploads are flagged with the reason, and the user can choose a supported experiment and enter values manually.

## How it stays honest

- **The AI never runs code or computes results.** Gemini returns structured JSON, validated with a strict Zod schema (`shared/schema.ts`). Anything that fails validation is discarded. Simulations run from a separate, tested physics module (`shared/physics/`).
- **Unreadable values stay missing.** The model is instructed to return `null` rather than guess. Missing, inferred and "no unit shown" fields are flagged in the review screen, and nothing launches until the user confirms. Unrecognised units are not converted.
- **Images are untrusted.** The system prompt treats text inside images as data, never instructions. The server validates image bytes (JPEG/PNG/WebP magic numbers and dimensions), not file extensions.
- **Tutor answers explain engine numbers.** The tutor receives the confirmed parameters plus results computed by the physics engine. Suggested changes are re-validated on the server, shown with a preview computed by the engine, and only applied when the student clicks.
- **Sources are real search results.** Brave Search results are shown with title, domain, URL, the search excerpt and retrieval time. Pages are not fetched, and the UI says so. Queries come from a fixed concept list, never from image contents.
- **No fabricated success.** When a service is missing or failing, the UI says which one and offers a retry. Simulations keep working offline.

## Privacy & data retention

- Uploaded images are compressed in the browser (max 2000 px), sent to the server, forwarded to Google Gemini for analysis, then discarded. They are **not stored or logged** by Living Notes. Google's processing is subject to Google's API terms.
- Saved experiments live in the browser's `localStorage` (no account).
- Public share links store only the title, validated settings, summary and assumptions, under a 24-character random ID. The uploaded image is stored **only if the user ticks "include my image"**.
- Server logs record method, path, status and duration only.

## Security

API keys are server-only. The server enforces request size limits, per-IP rate limits on paid routes (analyse 10/10 min, tutor 30/10 min, sources 20/10 min), timeouts (45 s AI, 10 s search) and safe error messages. It also sends a strict CSP and sanitizes model text: Markdown is rendered with an allow-list via DOMPurify, and equations go through KaTeX with `trust: false`.

## Project layout

```
shared/physics/     pure physics (circuit, lens, projectile)
shared/schema.ts    runtime schemas for configs, AI output, tutor, shares
shared/experiment.ts parameters, results, equations, AI→draft conversion, examples
server/             Hono API: analyze, tutor, sources, shares, health; Gemini + Brave adapters; SQLite store
src/                React app: landing, upload, review, workspace, saved, shared view
tests/              unit + API tests (Vitest)
e2e/                browser tests (Playwright) + local mock of the Gemini/Brave HTTP APIs
```

## Tests

```bash
npm test             # 68 unit + API tests
npx playwright test  # 11 browser workflows (desktop + phone), uses the installed Chrome
```

The browser tests run the **real** Gemini and Brave adapters against a local mock that follows their documented HTTP formats (`e2e/mock-upstream.mjs`). Real-service checks need credentials and are run with `npm run verify:live`.
