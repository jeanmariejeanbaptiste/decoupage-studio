import { formatCombo, SHORTCUTS } from '../../domain/shortcuts';
import { useShortcuts } from '../../store/shortcuts';
import { navigate } from '../../app/router';
import { useUi } from '../../store/uiStore';
import { Hand } from '../../ui/Hand';
import { useReturnFocus } from './useReturnFocus';
import s from './CommandPalette.module.css';

// Touches de saisie, fixes ; les raccourcis d'action viennent des Paramètres.
const FIXED: Array<[string, string]> = [
  ['↑ ↓ ← →', 'Se déplacer entre les cellules'],
  ['Entrée', 'Éditer / valider et descendre'],
  ['Tab / ⇧Tab', 'Cellule suivante / précédente'],
  ['Échap', 'Annuler l’édition'],
  ['Une lettre', 'Remplacer le contenu de la cellule'],
  ['⇧ + flèches, ⇧ + clic', 'Étendre la sélection'],
  ['Suppr', 'Vider les cellules sélectionnées'],
  ['⌘C / ⌘V', 'Copier / coller (compatible Excel, Sheets)'],
  ['↓ puis Entrée', 'Choisir une suggestion'],
  [', ou +', 'Séparer les jetons d’angle ou de mouvement'],
];

export function HelpDialog() {
  const open = useUi((u) => u.helpOpen);
  return open ? <HelpBody /> : null;
}

function HelpBody() {
  const map = useShortcuts((x) => x.map);
  const set = useUi((u) => u.set);
  const keepFocus = useReturnFocus();
  const close = () => set({ helpOpen: false });
  return (
    <div className={s.backdrop} onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={[s.palette, s.help].join(' ')} role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(e) => e.stopPropagation()}>
        <Hand>⌘ = Ctrl sous Windows et Linux</Hand>
        <h2 id="help-title">Raccourcis clavier</h2>
        <dl>
          {[...SHORTCUTS.map((d): [string, string] => [formatCombo(map[d.id]), d.label]), ...FIXED].map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className={s.helpLink} onClick={() => { keepFocus.active = false; close(); navigate('settings', { section: 'raccourcis' }); }}>
          Modifier les raccourcis
        </button>
        <button type="button" autoFocus className="visually-hidden" onClick={close}>
          Fermer
        </button>
      </div>
    </div>
  );
}
