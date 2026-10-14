import { useUi } from '../../store/uiStore';
import { Hand } from '../../ui/Hand';
import s from './CommandPalette.module.css';

const SHORTCUTS: Array<[string, string]> = [
  ['↑ ↓ ← →', 'Se déplacer entre les cellules'],
  ['Entrée', 'Éditer / valider et descendre'],
  ['Tab / ⇧Tab', 'Cellule suivante / précédente'],
  ['Échap', 'Annuler l’édition'],
  ['Une lettre', 'Remplacer le contenu de la cellule'],
  ['⇧ + flèches, ⇧ + clic', 'Étendre la sélection'],
  ['⌘↵', 'Nouveau plan (hérite sujet, focale, angle)'],
  ['⌘⇧↵', 'Nouvelle séquence'],
  ['⌘D', 'Dupliquer le plan'],
  ['⌘⌫', 'Supprimer le plan'],
  ['Suppr', 'Vider les cellules sélectionnées'],
  ['⌥↑ / ⌥↓', 'Déplacer le plan'],
  ['⌥⇧↑ / ⌥⇧↓', 'Déplacer la séquence'],
  ['⌘⇧↓', 'Recopier vers le bas'],
  ['⌘C / ⌘V', 'Copier / coller (compatible Excel, Sheets)'],
  ['⌘Z / ⌘⇧Z', 'Annuler / rétablir'],
  ['⌘S', 'Enregistrer le fichier .decoupage'],
  ['⌘K', 'Palette de commandes'],
  ['↓ puis Entrée', 'Choisir une suggestion'],
  [', ou +', 'Séparer les jetons d’angle ou de mouvement'],
];

export function HelpDialog() {
  const open = useUi((u) => u.helpOpen);
  const set = useUi((u) => u.set);
  if (!open) return null;
  const close = () => set({ helpOpen: false });
  return (
    <div className={s.backdrop} onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={[s.palette, s.help].join(' ')} role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(e) => e.stopPropagation()}>
        <Hand>⌘ = Ctrl sous Windows et Linux</Hand>
        <h2 id="help-title">Raccourcis clavier</h2>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" autoFocus className="visually-hidden" onClick={close}>
          Fermer
        </button>
      </div>
    </div>
  );
}
