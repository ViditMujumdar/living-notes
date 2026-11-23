// Real end-to-end check against the REAL Gemini and Brave services, through a running Living Notes server.
// Usage:  npm run verify:live -- [server-url] [path/to/diagram.jpg]
// Example: npm run verify:live -- http://localhost:8787 ./my-circuit-photo.jpg
import fs from 'node:fs';
const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const imgPath = process.argv[3];
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.log(`  ✗ ${m}`); };
const j = async (path, init) => { const r = await fetch(base + path, init); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; };

console.log(`Checking ${base}`);
const h = await j('/api/health');
if (h.status !== 200) { console.log('Server not reachable.'); process.exit(1); }
console.log(`  AI configured: ${h.body.ai.configured} (${h.body.ai.model}) · search configured: ${h.body.search.configured} · storage: ${h.body.storage}`);

const p = await j('/api/health/probe', { method: 'POST' });
p.body?.ai?.lastOkAt ? ok('AI provider accepted the key and model') : bad(`AI probe failed: ${p.body?.ai?.lastError?.message ?? 'not configured'}`);
p.body?.search?.lastOkAt ? ok('Search provider accepted the key') : bad(`Search probe failed: ${p.body?.search?.lastError?.message ?? 'not configured'}`);

const t = await j('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { type: 'circuit', topology: 'series', voltage: 12, resistors: [4, 8] }, question: 'Why is the current 1 A?', mode: 'short', language: 'en' }) });
t.status === 200 && t.body.answerMarkdown ? ok(`Tutor answered (${t.body.answerMarkdown.length} chars): ${t.body.answerMarkdown.slice(0, 90).replace(/\n/g, ' ')}…`) : bad(`Tutor failed: ${t.status} ${t.body?.message}`);

const s = await j('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lens' }) });
s.status === 200 && s.body.results?.length ? ok(`Sources returned ${s.body.results.length} results, first: ${s.body.results[0].domain}`) : bad(`Sources failed: ${s.status} ${s.body?.message}`);

if (imgPath) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(imgPath)]), 'diagram');
  const a = await j('/api/analyze', { method: 'POST', body: fd });
  a.status === 200 ? ok(`Diagram analysed as "${a.body.interpretation.experimentType}": ${a.body.interpretation.summary}`) : bad(`Analyze failed: ${a.status} ${a.body?.message}`);
} else console.log('  · Skipped image analysis (pass a diagram path to test it).');

console.log(failures ? `\n${failures} live check(s) failed.` : '\nAll live checks passed with real services.');
process.exit(failures ? 1 : 0);
