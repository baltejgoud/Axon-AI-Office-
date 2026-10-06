import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/google-sans-flex';
import './style.css';
import 'highlight.js/styles/github-dark.css';
import { connectBrowserPlatform } from './browserPlatform';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: boolean }> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="startup">
        <h1>Something went wrong</h1>
        <p>Your saved data has not been deleted.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Reload Axon
        </button>
      </div>
    );
  }
}

const root = createRoot(document.getElementById('root')!);
void connectBrowserPlatform().then(() => {
  root.render(<ErrorBoundary><App /></ErrorBoundary>);
}).catch(() => {
  root.render(
    <div className="startup">
      <h1>Connect to Axon desktop</h1>
      <p>This browser needs a connection to the running Axon desktop app.</p>
      <p>Local browser control must be enabled when starting the development app.</p>
      <button className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
    </div>
  );
});
