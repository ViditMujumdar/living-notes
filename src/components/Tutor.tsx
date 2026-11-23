import { useState } from 'react';
import type { ExperimentConfig, LanguageCode, TutorSuggestion } from '../../shared/schema';
import { LANGUAGES } from '../../shared/schema';
import { compute, fmt, setParam, PARAMS } from '../../shared/experiment';
import type { CircuitResult } from '../../shared/physics/circuit';
import type { LensResult } from '../../shared/physics/lens';
import type { ProjectileResult } from '../../shared/physics/projectile';
import { api, type ApiError } from '../lib/api';
import { useConnection, svcStatus } from '../lib/connection';
import { Markdown } from './Math';
import { Alert } from './ui';

const QUESTIONS: Record<ExperimentConfig['type'], string[]> = {
  circuit: ['Why did the current decrease?', 'What changes if I double R2?', 'Why do parallel branches get the same voltage?', 'Which resistor gets the hottest, and why?'],
  lens: ['Why is the image inverted?', 'What happens as the object moves towards F?', 'When is the image virtual?', 'Why does the image get bigger?'],
  projectile: ['What affects the projectile’s range?', 'Why does 45° give the longest range here?', 'Why is the horizontal velocity constant?', 'How would the flight change on the Moon?'],
};

interface Turn { q: string; a?: string; suggestions?: TutorSuggestion[]; err?: ApiError; meta?: string; pending?: boolean; mode: 'short' | 'steps'; lang: LanguageCode }

/** One-line deterministic preview of what a suggestion would do. Computed by the physics engine, not the model. */
function preview(cfg: ExperimentConfig, s: TutorSuggestion): string | null {
  const r = setParam(cfg, s.param, s.value);
  if ('error' in r) return null;
  const a = compute(cfg), b = compute(r.config);
  if (!a.result.ok || !b.result.ok) return null;
  if (a.type === 'circuit' && b.type === 'circuit') return `I: ${fmt((a.result as CircuitResult).totalCurrent)} → ${fmt((b.result as CircuitResult).totalCurrent)} A`;
  if (a.type === 'lens' && b.type === 'lens') { const x = a.result as LensResult, y = b.result as LensResult; return `v: ${x.image ? fmt(x.image.distance) : '∞'} → ${y.image ? fmt(y.image.distance) : '∞'} cm`; }
  if (a.type === 'projectile' && b.type === 'projectile') return `range: ${fmt((a.result as ProjectileResult).range)} → ${fmt((b.result as ProjectileResult).range)} m`;
  return null;
}

export function Tutor({ config, title, assumptions, source, onApply }: { config: ExperimentConfig; title: string; assumptions?: string[]; source: 'example' | 'upload' | 'manual' | 'shared'; onApply: (c: ExperimentConfig, label: string) => void }) {
  const conn = useConnection();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'short' | 'steps'>('short');
  const [lang, setLang] = useState<LanguageCode>('en');
  const [turns, setTurns] = useState<Turn[]>([]);
  const ai = svcStatus(conn.health?.ai);
  const busy = turns.some((t) => t.pending);

  const ask = async (question: string, idx?: number) => {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    const turn: Turn = { q: text, pending: true, mode, lang };
    setTurns((ts) => (idx != null ? ts.map((t, i) => (i === idx ? turn : t)) : [...ts, turn]));
    setQ('');
    const r = await api.tutor({ config, question: text, mode, language: lang, context: { title, assumptions, source } });
    const done: Turn = r.ok
      ? { ...turn, pending: false, a: r.data.answerMarkdown, suggestions: r.data.suggestions, meta: `${r.data.provider} · ${r.data.model} · explains values computed by the app` }
      : { ...turn, pending: false, err: r.error };
    if (r.ok) conn.report('ai', true); else if (!['offline', 'backend_unreachable', 'rate_limited', 'bad_request', 'ai_not_configured'].includes(r.error.code)) conn.report('ai', false, r.error.message);
    setTurns((ts) => ts.map((t) => (t === turn ? done : t)));
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {ai === 'not_configured' && <Alert tone="amber"><p><b>AI tutor: setup required.</b> The server has no AI key yet, so questions can't be answered. Everything else in the lab still works.</p></Alert>}
      {!conn.browserOnline && <Alert tone="coral"><p>You are offline. The tutor needs a connection; your experiment keeps working.</p></Alert>}
      <div className="chips" aria-label="Example questions">{QUESTIONS[config.type].map((s) => <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
      {turns.length > 0 && (
        <div className="chat" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className="stack" style={{ gap: 8 }}>
              <div className="msg q">{t.q}</div>
              {t.pending && <div className="msg a"><span className="muted">Thinking about your experiment…</span></div>}
              {t.a && (
                <div className="msg a">
                  <Markdown md={t.a} />
                  {t.suggestions && t.suggestions.length > 0 && (
                    <div className="sugg" aria-label="Suggested changes. Nothing changes until you choose one.">
                      {t.suggestions.map((s, k) => {
                        const pv = preview(config, s);
                        const meta = PARAMS[config.type].find((p) => p.key === s.param);
                        return (
                          <button key={k} onClick={() => { const r = setParam(config, s.param, s.value); if ('config' in r) onApply(r.config, s.label); }}>
                            {s.label}<small>{meta ? `${meta.symbol} = ${fmt(s.value)} ${meta.unit}` : ''}{pv ? ` · ${pv}` : ''}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="src">{t.meta}</div>
                </div>
              )}
              {t.err && (
                <Alert tone="coral">
                  <p>{t.err.message}</p>
                  {t.err.code !== 'ai_not_configured' && <p><button className="linkbtn" onClick={() => ask(t.q, i)}>Try again</button></p>}
                </Alert>
              )}
            </div>
          ))}
        </div>
      )}
      <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label htmlFor="tutor-q" className="sr-only">Ask about this experiment</label>
        <textarea id="tutor-q" className="text-in" placeholder="Ask about this experiment…" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(q); }} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="seg" role="group" aria-label="Explanation style">
            <button type="button" aria-pressed={mode === 'short'} onClick={() => setMode('short')}>Short</button>
            <button type="button" aria-pressed={mode === 'steps'} onClick={() => setMode('steps')}>Step by step</button>
          </div>
          <label className="row" style={{ gap: 6 }}><span className="sr-only">Language</span>
            <select className="text-in" style={{ width: 'auto', minHeight: 40 }} value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)} aria-label="Answer language">
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || q.trim().length < 2}>Ask</button>
        </div>
      </form>
    </div>
  );
}
