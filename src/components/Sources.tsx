import { useState } from 'react';
import type { ExperimentConfig, SourceResult } from '../../shared/schema';
import { api, type ApiError } from '../lib/api';
import { useConnection, svcStatus } from '../lib/connection';
import { Alert } from './ui';

const CONCEPTS: Record<ExperimentConfig['type'], [string, string][]> = {
  circuit: [['default', "Ohm's law & combinations"], ['series', 'Series circuits'], ['parallel', 'Parallel circuits'], ['mixed', 'Series–parallel'], ['power', 'Electrical power']],
  lens: [['default', 'Convex lens images'], ['virtual', 'Virtual images'], ['magnification', 'Magnification']],
  projectile: [['default', 'Projectile equations'], ['angle', 'Launch angle & range'], ['components', 'Velocity components']],
};

export function Sources({ config }: { config: ExperimentConfig }) {
  const conn = useConnection();
  const [concept, setConcept] = useState(config.type === 'circuit' ? config.topology : 'default');
  const [state, setState] = useState<{ loading: boolean; results?: SourceResult[]; query?: string; err?: ApiError; note?: string }>({ loading: false });
  const se = svcStatus(conn.health?.search);
  const run = async () => {
    setState({ loading: true });
    const r = await api.sources(config.type, concept);
    if (r.ok) { conn.report('search', true); setState({ loading: false, results: r.data.results, query: r.data.query, note: r.data.note }); }
    else { if (!['offline', 'backend_unreachable', 'search_not_configured', 'rate_limited'].includes(r.error.code)) conn.report('search', false, r.error.message); setState({ loading: false, err: r.error }); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Searches the web for the <b>concept</b> you choose, never your image or personal details. Universities, open textbooks and science institutions are listed first.</p>
      <div className="chips" role="group" aria-label="Concept">{CONCEPTS[config.type].map(([k, l]) => <button key={k} aria-pressed={concept === k} style={concept === k ? { borderColor: 'var(--lime)', color: 'var(--paper)' } : undefined} onClick={() => setConcept(k)}>{l}</button>)}</div>
      {se === 'not_configured' && <Alert tone="amber"><p><b>Source search: setup required.</b> Add a Brave Search API key on the server to enable this.</p></Alert>}
      <button className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }} onClick={run} disabled={state.loading || se === 'not_configured'}>{state.loading ? 'Searching…' : 'Find supporting sources'}</button>
      {state.err && <Alert tone="coral"><p>{state.err.message}</p><p><button className="linkbtn" onClick={run}>Retry</button></p></Alert>}
      {state.results && (
        state.results.length === 0 ? <p className="muted">The search returned no usable results for this concept.</p> : (
          <div className="srcs">
            {state.results.map((s) => (
              <article className="src-item" key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a>
                <div className="meta"><span>{s.domain}</span>{s.trusted && <span className="badge cyan">educational source</span>}<span>retrieved {new Date(s.retrievedAt).toLocaleString()}</span></div>
                {s.excerpt && <p>“{s.excerpt}”</p>}
              </article>
            ))}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{state.note} Query: <span className="mono">{state.query}</span> · via Brave Search.</p>
          </div>
        )
      )}
    </div>
  );
}
