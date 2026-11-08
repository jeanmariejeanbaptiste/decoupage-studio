import { Component, type ReactNode } from 'react';
import { rememberLastProject } from '../store/persistence';

interface Props {
  children: ReactNode;
  /** Retour à l'accueil (le projet n'est plus rouvert automatiquement). */
  onHome: () => void;
}

/**
 * Une page qui plante n'emporte plus toute l'application : un message, et le projet n'est plus
 * rouvert d'office au prochain démarrage (on revient à l'accueil au lieu d'une page blanche).
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
    rememberLastProject(null);
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
            <button type="button" className="btn-outline" onClick={() => window.location.reload()}>
              Recharger
            </button>
          </p>
        </div>
      </div>
    );
  }
}
