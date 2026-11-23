import { Component, lazy, Suspense, type ReactNode } from 'react';
import { ConnectionProvider } from './lib/connection';
import { useLocation } from './lib/router';
import { TopBar } from './components/TopBar';
import { Toaster } from './components/ui';
import Landing from './pages/Landing';

const Upload = lazy(() => import('./pages/Upload'));
const Review = lazy(() => import('./pages/Review'));
const Workspace = lazy(() => import('./pages/Workspace'));
const Saved = lazy(() => import('./pages/Saved'));
const Shared = lazy(() => import('./pages/Shared'));
const Solve = lazy(() => import('./pages/Solve'));

class Boundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) return (
      <div className="page"><div className="panel panel-pad stack">
        <h1 className="h2">Something went wrong on this screen.</h1>
        <p className="muted">Your saved experiments are safe. Reload the page or go back home.</p>
        <div className="row"><button className="btn btn-primary" onClick={() => location.reload()}>Reload</button><a className="btn" href="/">Home</a></div>
      </div></div>
    );
    return this.props.children;
  }
}

function Routes() {
  const { path } = useLocation();
  let page: ReactNode;
  if (path === '/') page = <Landing />;
  else if (path === '/new') page = <Upload />;
  else if (path === '/review') page = <Review />;
  else if (path === '/lab') page = <Workspace />;
  else if (path === '/saved') page = <Saved />;
  else if (path === '/solve') page = <Solve />;
  else if (path.startsWith('/s/')) page = <Shared id={decodeURIComponent(path.slice(3))} />;
  else page = (
    <div className="page"><div className="panel panel-pad stack" style={{ maxWidth: 560 }}>
      <span className="label">404</span><h1 className="h2">This page is not part of the lab.</h1>
      <a className="btn btn-primary" href="/" style={{ justifySelf: 'start' }}>Go home</a>
    </div></div>
  );
  return <Boundary key={path}><Suspense fallback={<div className="page"><p className="label">Loading…</p></div>}>{page}</Suspense></Boundary>;
}

export default function App() {
  return (
    <ConnectionProvider>
      <a href="#main" className="sr-only">Skip to content</a>
      <TopBar />
      <main id="main"><Routes /></main>
      <Toaster />
    </ConnectionProvider>
  );
}
