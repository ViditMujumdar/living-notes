import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import type { SharePayload } from '../../shared/schema';
import { TITLES, ASSUMPTIONS, summarize } from '../../shared/experiment';
import { saveCurrent, newId } from '../lib/docs';
import { navigate } from '../lib/router';
import { Sim } from './Workspace';
import { Measurements, Equations } from '../experiments/panels';
import { Alert, Panel, Fold } from '../components/ui';

export default function Shared({ id }: { id: string }) {
  const [state, setState] = useState<{ data?: SharePayload; err?: ApiError; loading: boolean }>({ loading: true });
  const load = async () => {
    setState({ loading: true });
    const r = await api.getShare(id);
    setState(r.ok ? { loading: false, data: r.data } : { loading: false, err: r.error });
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <div className="page"><p className="label">Loading shared experiment…</p></div>;
  if (state.err || !state.data) return (
    <div className="page"><div className="stack" style={{ maxWidth: 620 }}>
      <Alert tone="coral"><p>{state.err?.status === 404 ? 'This shared experiment does not exist or the link is incomplete.' : state.err?.message}</p>{state.err?.status !== 404 && <p><button className="linkbtn" onClick={load}>Retry</button></p>}</Alert>
      <a className="btn btn-primary" href="/" style={{ justifySelf: 'start' }}>Go to Living Notes</a>
    </div></div>
  );
  const d = state.data;
  const copy = () => {
    const now = new Date().toISOString();
    saveCurrent({ localId: newId(), title: d.title, config: d.config, source: 'shared', interpretation: d.summary ? { summary: d.summary, assumptions: d.assumptions ?? [], warnings: [], confirmed: [] } : undefined, image: d.image ?? undefined, createdAt: now, updatedAt: now });
    navigate('/lab');
  };
  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Shared experiment · read-only · {TITLES[d.config.type]}</span>
          <h1 className="h2">{d.title}</h1>
          <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>Shared {new Date(d.createdAt).toLocaleString()}</span>
        </div>
        <button className="btn btn-primary" onClick={copy}>Open a copy in the lab →</button>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', alignItems: 'start' }}>
        <section className="panel simcard" aria-label="Simulation">
          <div className="sim-stage"><Sim config={d.config} /></div>
          <div className="sim-foot">{summarize(d.config)}</div>
        </section>
        <div className="stack">
          {d.image && <Panel title="Original diagram"><img src={d.image} alt="Diagram shared by the author" style={{ borderRadius: 10 }} /></Panel>}
          <Panel title="Measurements"><Measurements config={d.config} /></Panel>
          <Fold title="Equations"><Equations config={d.config} /></Fold>
          <Fold title="Assumptions"><ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 13.5 }}>{[...ASSUMPTIONS[d.config.type], ...(d.assumptions ?? [])].map((a) => <li key={a}>{a}</li>)}</ul></Fold>
        </div>
      </div>
    </div>
  );
}
