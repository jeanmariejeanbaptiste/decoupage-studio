import { Component, type ReactNode } from 'react';
import { flushSave } from '../store/persistence';
import { recoverStaleChunk } from './staleChunk';

interface Props {
  children: ReactNode;
  /** Retour à l'accueil (le projet n'est plus rouvert automatiquement). */
  onHome: () => void;
}

/**
 * Une page qui plante n'emporte plus toute l'application : un message, la cause en petit (à
 * transmettre), et « Recharger » rouvre le même projet. Un module disparu après une mise en ligne
 * recharge l'application d'office.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    recoverStaleChunk(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="card empty" role="alert" data-testid="page-error">
          <span className="hand">Cette page n’a pas pu s’afficher</span>
          <p>Le projet est intact. Revenez à l’accueil, ou rechargez l’application.</p>
          <p style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn-outline" onClick={this.props.onHome}>
              Accueil
            </button>
            <button type="button" className="btn-outline" onClick={() => void flushSave().finally(() => window.location.reload())}>
              Recharger
            </button>
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', userSelect: 'text', overflowWrap: 'anywhere' }} data-testid="page-error-detail">
            {this.state.error.message}
          </p>
        </div>
      </div>
    );
  }
}
