// Local stand-in for the Gemini and Brave HTTP APIs, used ONLY by automated tests.
// It follows the documented request/response shapes so the real adapters are exercised.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const Q = (value, unit = null) => ({ value, unit, sourceText: value == null ? null : `${value} ${unit ?? ''}`.trim(), inferred: false });
const interpretation = {
  experimentType: 'circuit',
  summary: 'A 12 V battery with R1 in series with R2 and R3 in parallel.',
  unsupportedReason: null, imageQuality: 'clear',
  components: [
    { kind: 'battery', label: 'E', valueText: '12 V', box: [380, 40, 620, 140] },
    { kind: 'resistor', label: 'R1', valueText: '4 Ω', box: [80, 300, 200, 520] },
    { kind: 'resistor', label: 'R2', valueText: null, box: [380, 600, 640, 700] },
    { kind: 'resistor', label: 'R3', valueText: '12 Ω', box: [380, 820, 640, 920] },
  ],
  circuit: { topology: 'mixed', voltage: Q(12, 'V'), resistors: [{ label: 'R1', value: Q(4, 'Ω') }, { label: 'R2', value: Q(null) }, { label: 'R3', value: Q(12, 'Ω') }] },
  lens: null, projectile: null,
  missing: ['The value of R2 is not readable.'], assumptions: [], warnings: ['R2 label is smudged.'], needsReview: ['R2 value'],
};

export const control = { fail: null, lastHadImage: false }; // fail: 'gemini' | 'brave' | null
export function startMock(port = 0) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__last') return send(200, { lastHadImage: control.lastHadImage });
      if (req.url === '/__fail' ) { control.fail = JSON.parse(body || '{}').fail ?? null; return send(200, { ok: true }); }
      if (req.url.startsWith('/res/v1/web/search')) {
        if (control.fail === 'brave') return send(503, {});
        if (req.headers['x-subscription-token'] !== 'test-brave') return send(401, {});
        return send(200, { web: { results: [
          { title: 'Resistors in Series and Parallel', url: 'https://openstax.org/books/college-physics-2e/pages/21-1-resistors-in-series-and-parallel', description: 'Total resistance in <strong>series</strong> is the sum…' },
          { title: 'Series and parallel circuits', url: 'https://www.physicsclassroom.com/class/circuits', description: 'Combination circuits explained.' },
        ] } });
      }
      if (req.headers['x-goog-api-key'] !== 'test-gemini') return send(403, { error: { message: 'bad key' } });
      if (control.fail === 'gemini') return send(503, { error: { message: 'overloaded' } });
      if (req.method === 'GET') return send(200, { name: 'models/test' });
      const j = JSON.parse(body || '{}');
      control.lastHadImage = Boolean(j.contents?.[0]?.parts?.some((p) => p.inlineData));
      if ((j.systemInstruction?.parts?.[0]?.text || '').includes('SCIENCE SOLVER')) {
        const plan = { understood: true, notUnderstoodReason: null, subject: 'physics', topic: 'Simple pendulum', questionText: 'A simple pendulum is 1.2 m long. Find its period.',
          givens: [{ symbol: 'L', name: 'Length', value: 1.2, unit: 'm', sourceText: '1.2 m' }, { symbol: 'g', name: 'Gravitational acceleration', value: 9.8, unit: 'm/s^2', sourceText: '9.8 m/s²' }],
          steps: [{ title: 'Use the pendulum formula', explanationMarkdown: 'For small swings, $T = 2\\pi\\sqrt{L/g}$.', target: 'T', expression: '2*pi*sqrt(L/g)', unit: 's' }],
          answers: [{ label: 'Period of the pendulum', symbol: 'T', expression: 'T', unit: 's', textAnswer: null }],
          conceptMarkdown: 'The period depends only on length and gravity.', assumptions: ['Small-angle approximation.'], warnings: [],
          diagram: { title: 'Pendulum', height: 60, caption: 'A bob on a string of length L.', elements: [
            { kind: 'line', x: 30, y: 8, x2: 70, y2: 8, r: null, a0: null, a1: null, points: null, text: 'support', color: 'muted', fill: null, step: null },
            { kind: 'line', x: 50, y: 8, x2: 62, y2: 44, r: null, a0: null, a1: null, points: null, text: 'L', color: 'ink', fill: null, step: null },
            { kind: 'circle', x: 62, y: 46, x2: null, y2: null, r: 3, a0: null, a1: null, points: null, text: 'bob', color: 'accent', fill: true, step: null },
            { kind: 'arrow', x: 62, y: 50, x2: 62, y2: 58, r: null, a0: null, a1: null, points: null, text: 'mg', color: 'measure', fill: null, step: 1 },
            { kind: 'arc', x: 50, y: 8, x2: null, y2: null, r: 10, a0: 72, a1: 90, points: null, text: 'θ', color: 'measure', fill: null, step: 1 },
            { kind: 'polyline', x: null, y: null, x2: null, y2: null, r: null, a0: null, a1: null, points: [1, 2, 3], text: null, color: 'ink', fill: null, step: null },
          ] } };
        return send(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(plan) }] } }] });
      }
      const hasImage = j.contents?.[0]?.parts?.some((p) => p.inlineData);
      const text = hasImage ? JSON.stringify(interpretation) : JSON.stringify({
        answerMarkdown: 'The current decreased because the **total resistance** increased: $I = V/R_{eq}$. In this circuit $R_{eq} = 8\\,\\Omega$.',
        suggestions: [{ label: 'Set R2 to 12 Ω', param: 'r2', value: 12 }],
      });
      send(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startMock(Number(process.env.MOCK_PORT || 8899));
  console.log('mock upstream on', s.address().port);
}
