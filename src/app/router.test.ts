import { describe, expect, it } from 'vitest';
import { isScenarioView, parseHash, scenarioHref, scenarioLocation } from './router';

describe('adresse du Scénario', () => {
  const at = (h: string) => scenarioLocation(parseHash(h).params);
  it('sous-page, séquence et rapport', () => {
    expect(at('#/scenario?view=outline')).toEqual({ view: 'outline', seq: undefined, report: undefined });
    expect(at('#/scenario?view=stats&report=structure')).toEqual({ view: 'stats', seq: undefined, report: 'structure' });
    expect(at('#/scenario?view=outline&seq=4')).toEqual({ view: 'outline', seq: 4, report: undefined });
  });
  it('?seq=N seul mène au texte ; rien, ou une sous-page inconnue : pas de sous-page imposée', () => {
    expect(at('#/scenario?seq=7').view).toBe('script');
    expect(at('#/scenario').view).toBeUndefined();
    expect(at('#/scenario?view=plans').view).toBeUndefined();
    expect(at('#/scenario?seq=abc').seq).toBeUndefined();
    expect(at('#/scenario?seq=-2').seq).toBeUndefined();
  });
  it('aller-retour', () => {
    expect(scenarioHref('script', { seq: 3 })).toBe('#/scenario?view=script&seq=3');
    expect(scenarioHref('stats', { report: 'activity' })).toBe('#/scenario?view=stats&report=activity');
    expect(at(scenarioHref('cut'))).toEqual({ view: 'cut', seq: undefined, report: undefined });
    expect(isScenarioView('stats')).toBe(true);
    expect(isScenarioView(null)).toBe(false);
  });
});

describe('parseHash', () => {
  it('reconnaît une route et ses paramètres', () => {
    const l = parseHash('#/grid?seq=abc');
    expect(l.route).toBe('grid');
    expect(l.params.get('seq')).toBe('abc');
  });
  it('retombe sur l’accueil pour une route inconnue', () => {
    expect(parseHash('#/nimporte').route).toBe('home');
    expect(parseHash('').route).toBe('home');
  });
  it('lien de relecture : le fichier (et sa clé) dans le chemin', () => {
    const l = parseHash('#/review/1AbC-def_9~0-KeY');
    expect(l.route).toBe('review');
    expect(l.params.get('file')).toBe('1AbC-def_9~0-KeY');
    expect(parseHash('#/grid/x').route).toBe('home');
  });
});
