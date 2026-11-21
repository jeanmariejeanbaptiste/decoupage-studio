import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let fail = true;
function Flaky() {
  if (fail) throw new Error('boum');
  return <p>Page affichée</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    fail = true;
    vi.restoreAllMocks();
  });

  it('« Accueil » retente la page même sans changement de route', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onHome = vi.fn(() => {
      fail = false;
    });
    render(
      <ErrorBoundary onHome={onHome}>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('page-error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accueil' }));
    expect(onHome).toHaveBeenCalledOnce();
    expect(screen.getByText('Page affichée')).toBeTruthy();
  });

  it('une nouvelle adresse réarme la page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary onHome={() => undefined} resetKey="#/scenario?compare=a~b">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('page-error')).toBeTruthy();
    fail = false;
    rerender(
      <ErrorBoundary onHome={() => undefined} resetKey="#/scenario">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Page affichée')).toBeTruthy();
  });
});
