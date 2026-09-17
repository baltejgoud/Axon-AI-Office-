import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import 'highlight.js/styles/github-dark.css';

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

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
