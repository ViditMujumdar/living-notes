import { useState } from 'react';
import { listSaved, deleteSaved } from '../lib/docs';
import { TITLES, summarize } from '../../shared/experiment';
import { Link } from '../lib/router';
import { toast } from '../components/ui';

export default function Saved() {
  const [items, setItems] = useState(listSaved);
  return (
    <div className="page">
      <div className="stack" style={{ gap: 6, marginBottom: 20 }}>
        <span className="label">Saved on this device</span>
        <h1 className="h2">Your experiments</h1>
        <p className="muted" style={{ margin: 0 }}>Stored in this browser only. No account needed. Clearing site data removes them.</p>
      </div>
      {items.length === 0 ? (
        <div className="panel empty">
          <b>No saved experiments yet</b>
          <span>Open an example or upload a diagram, then press <b>Save</b> in the lab.</span>
          <div className="row" style={{ justifyContent: 'center' }}><Link href="/new" className="btn btn-primary">Upload a diagram</Link><Link href="/lab?example=lens-2f" className="btn">Try an example</Link></div>
        </div>
      ) : (
        <div className="saved-grid">
          {items.map((d) => (
            <article key={d.localId} className="panel saved-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="label">{TITLES[d.config.type]}</span>
                <span className="badge">{d.source === 'upload' ? 'upload' : d.source}</span>
              </div>
              <h2 className="h3">{d.title}</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{summarize(d.config)}</p>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--faint)' }}>Updated {new Date(d.updatedAt).toLocaleString()}{d.share ? ' · shared' : ''}</span>
              <div className="row">
                <Link href={`/lab?saved=${encodeURIComponent(d.localId)}`} className="btn btn-sm btn-primary">Open</Link>
                <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete “${d.title}” from this device?`)) { deleteSaved(d.localId); setItems(listSaved()); toast('Deleted'); } }}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
