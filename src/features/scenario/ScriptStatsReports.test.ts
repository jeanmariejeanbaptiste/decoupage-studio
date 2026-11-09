import { describe, expect, it } from 'vitest';
import { printable } from './ScriptStatsReports';

describe('rapport imprimé', () => {
  it('sans les contrôles de l’écran ; le tri choisi en une ligne, la légende réduite aux courbes affichées', () => {
    const box = document.createElement('div');
    box.innerHTML = `
      <div data-no-print><label data-print="Trié"><span>Trier</span><select><option>par ordre du scénario</option><option>par ordre alphabétique</option></select></label><label><input type="checkbox" checked> Personnages</label></div>
      <div data-legend><label><input type="checkbox"> Durée</label><label><input type="checkbox"> Répliques</label></div>
      <table><tr><td>INT. GARE</td></tr></table>`;
    const [a, b] = Array.from(box.querySelectorAll<HTMLInputElement>('[data-legend] input'));
    a.checked = true;
    b.checked = false;
    const html = printable(box);
    expect(html).not.toMatch(/<select|<input|Trier|Personnages/);
    expect(html).toContain('INT. GARE');
    expect(html).toContain('Durée');
    expect(html).not.toContain('Répliques');
    // Ordre du scénario : rien à dire ; un autre tri est écrit.
    expect(html).not.toContain('Trié');
    box.querySelector('select')!.selectedIndex = 1;
    expect(printable(box)).toContain('Trié par ordre alphabétique');
  });
});
