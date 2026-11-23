import type { ExperimentConfig, CircuitConfig } from '../../shared/schema';
import { activeParams, paramValue, setParam, compute, fmt, PRESETS, equations } from '../../shared/experiment';
import { TOPOLOGY_LABEL, type CircuitResult, type Topology } from '../../shared/physics/circuit';
import type { LensResult } from '../../shared/physics/lens';
import type { ProjectileResult } from '../../shared/physics/projectile';
import { ParamField, Readout, Alert } from '../components/ui';
import { TeX } from '../components/Math';

export function ParamControls({ config, onChange, disabled }: { config: ExperimentConfig; onChange: (c: ExperimentConfig) => void; disabled?: boolean }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      {config.type === 'circuit' && <CircuitShape config={config} onChange={onChange} disabled={disabled} />}
      {activeParams(config).map((p) => (
        <ParamField key={p.key} id={`param-${p.key}`} label={p.label} symbol={p.symbol} unit={p.unit} min={p.min} max={p.max} step={p.step}
          value={paramValue(config, p.key) ?? 0} disabled={disabled}
          onChange={(v) => { const r = setParam(config, p.key, v); if ('error' in r) return r.error; onChange(r.config); return null; }} />
      ))}
    </div>
  );
}

const DEFAULT_R = 10;
export function withTopology(c: CircuitConfig, t: Topology): CircuitConfig {
  let rs = c.resistors.slice();
  if (t === 'mixed') while (rs.length < 3) rs.push(DEFAULT_R);
  if (t === 'mixed') rs = rs.slice(0, 3);
  if (t === 'parallel' && rs.length < 2) rs.push(DEFAULT_R);
  return { ...c, topology: t, resistors: rs };
}
export function withCount(c: CircuitConfig, n: number): CircuitConfig {
  const rs = c.resistors.slice(0, n);
  while (rs.length < n) rs.push(DEFAULT_R);
  return { ...c, resistors: rs };
}

function CircuitShape({ config, onChange, disabled }: { config: CircuitConfig; onChange: (c: ExperimentConfig) => void; disabled?: boolean }) {
  const n = config.resistors.length;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="label">Arrangement</span>
      <div className="seg" role="group" aria-label="Circuit arrangement">
        {(['series', 'parallel', 'mixed'] as Topology[]).map((t) => (
          <button key={t} aria-pressed={config.topology === t} disabled={disabled} onClick={() => onChange(withTopology(config, t))}>{t === 'mixed' ? 'R1 + (R2 || R3)' : TOPOLOGY_LABEL[t]}</button>
        ))}
      </div>
      {config.topology !== 'mixed' && (
        <div className="row" role="group" aria-label="Number of resistors">
          <span className="muted" style={{ fontSize: 13 }}>Resistors</span>
          {[1, 2, 3].map((k) => (
            <button key={k} className="btn btn-sm" style={{ minWidth: 44 }} aria-pressed={n === k} disabled={disabled || (config.topology === 'parallel' && k < 2)}
              onClick={() => onChange(withCount(config, k))}>{n === k ? <b className="lime">{k}</b> : k}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Presets({ type, onPick, disabled }: { type: ExperimentConfig['type']; onPick: (c: ExperimentConfig) => void; disabled?: boolean }) {
  return (
    <div className="chips" role="group" aria-label="Presets">
      {PRESETS[type].map((p) => <button key={p.label} disabled={disabled} onClick={() => onPick(p.config)}>{p.label}</button>)}
    </div>
  );
}

export function Measurements({ config }: { config: ExperimentConfig }) {
  const r = compute(config);
  if (!r.result.ok) return <Alert tone="coral"><p>{r.result.errors.join(' ')}</p></Alert>;
  if (r.type === 'circuit') {
    const x = r.result as CircuitResult;
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="readouts">
          <Readout k="Total resistance" v={fmt(x.totalResistance)} unit="Ω" />
          <Readout k="Total current" v={fmt(x.totalCurrent)} unit="A" hl />
          <Readout k="Total power" v={fmt(x.totalPower)} unit="W" />
          {x.parallelBlockResistance != null && <Readout k="R2 || R3" v={fmt(x.parallelBlockResistance)} unit="Ω" />}
        </div>
        <table className="data">
          <caption className="sr-only">Per-resistor current, voltage and power</caption>
          <thead><tr><th scope="col">Resistor</th><th scope="col">Current</th><th scope="col">Voltage</th><th scope="col">Power</th></tr></thead>
          <tbody>{x.resistors.map((ri) => <tr key={ri.index}><td>R{ri.index + 1} <span className="muted" style={{ fontWeight: 400 }}>{fmt(ri.resistance)} Ω</span></td><td>{fmt(ri.current)} A</td><td>{fmt(ri.voltage)} V</td><td>{fmt(ri.power)} W</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (r.type === 'lens') {
    const x = r.result as LensResult;
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="readouts">
          <Readout k="Image distance v" v={x.image ? fmt(x.image.distance) : '∞'} unit={x.image ? 'cm' : ''} hl />
          <Readout k="Magnification m" v={x.image ? fmt(x.image.magnification) : '→ ∞'} />
          <Readout k="Image height h′" v={x.image ? fmt(x.image.height) : '—'} unit={x.image ? 'cm' : ''} />
          <Readout k="Image" v={x.image ? `${x.image.nature}` : 'at infinity'} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{x.description}{x.image ? ` It is ${x.image.orientation} and ${x.image.size}.` : ''}</p>
      </div>
    );
  }
  const x = r.result as ProjectileResult;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="readouts">
        <Readout k="Time of flight" v={fmt(x.timeOfFlight)} unit="s" />
        <Readout k="Max height" v={fmt(x.maxHeight)} unit="m" />
        <Readout k="Range" v={fmt(x.range)} unit="m" hl />
        <Readout k="v_x (constant)" v={fmt(x.vx)} unit="m/s" />
        <Readout k="v_y at launch" v={fmt(x.vy0)} unit="m/s" />
      </div>
      {x.note && <Alert tone="amber"><p>{x.note}</p></Alert>}
    </div>
  );
}

export function Equations({ config }: { config: ExperimentConfig }) {
  const eq = equations(config);
  if (!eq.length) return <p className="muted">Equations appear once all values are valid.</p>;
  return <div>{eq.map((e) => <div className="eq" key={e.label}><span className="label">{e.label}</span><TeX tex={e.tex} /></div>)}</div>;
}
