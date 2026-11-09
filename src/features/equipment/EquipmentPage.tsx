import { fold } from '../../domain/text';
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TabExport } from '../export/TabExport';
import { equipmentDocument } from '../../domain/documents';
import { equipmentCsv } from '../../domain/exports';
import { aggregateEquipment, equipmentCategories, removeBreakdownEquipment } from '../../domain/equipment';
import { newId } from '../../domain/factory';
import { shotCode } from '../../domain/numbering';
import type { EquipmentCategory, ProjectDoc } from '../../domain/types';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { ask } from '../../ui/dialogStore';
import { Hand } from '../../ui/Hand';
import { goToShot } from '../registry/RegistryPage';
import s from './EquipmentPage.module.css';


const LEAD: Record<string, string> = {
  Image: 'chef opérateur',
  Machinerie: 'chef machiniste',
  Lumière: 'chef électricien',
  Son: 'chef opérateur du son',
};

/** Listes de matériel par chef de poste (§10). */
export function EquipmentPage({ doc }: { doc: ProjectDoc }) {
  const lists = useMemo(() => aggregateEquipment(doc), [doc]);
  const [showShots, setShowShots] = useState(true);
  const [query, setQuery] = useState('');
  const [picked, setOnly] = useState<string | null>(null);
  const q = fold(query.trim());
  const title = doc.project.title || 'projet';
  const cats = equipmentCategories(doc);
  // Poste retiré entre-temps (ici ou par un autre participant) : retour à tous les postes.
  const only = picked && cats.includes(picked) ? picked : null;
  const visible = (c: string) => lists[c].filter((l) => !q || fold(l.label).includes(q) || l.shotIds.some((id) => fold(shotCode(doc, id)).includes(q)));
  const [draft, setDraft] = useState<Record<EquipmentCategory, string>>({ Image: '', Machinerie: '', Lumière: '', Son: '' });
  const [newPost, setNewPost] = useState('');
  /** Nouveau poste ; un nom déjà pris (sans casse ni accents) mène au poste existant. */
  const addPost = () => {
    const name = newPost.trim();
    if (!name) return;
    const existing = cats.find((c) => fold(c) === fold(name));
    if (existing) setOnly(existing);
    else mutateDoc((d) => void (d.equipmentExtra = [...(d.equipmentExtra ?? []), name]));
    setNewPost('');
  };

  return (
    <div className="page page--wide">
      <header className={['page-head', s.head].join(' ')}>
        <nav className={[s.summary, 'no-print'].join(' ')} aria-label="Postes" data-view>
          <button type="button" className={only === null ? s.chipOn : s.chip} onClick={() => setOnly(null)}>
            Tous <em>{cats.reduce((n, c) => n + lists[c].length, 0)}</em>
          </button>
          {cats.map((c) => (
            <button key={c} type="button" className={only === c ? s.chipOn : s.chip} onClick={() => setOnly(only === c ? null : c)}>
              <i aria-hidden="true" />
              {c} <em>{lists[c].length}</em>
            </button>
          ))}
        </nav>
        <div className={[s.actions, 'no-print'].join(' ')}>
          <input data-view className={s.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher du matériel" />
          <label className={s.toggle} data-view>
            <input type="checkbox" checked={showShots} onChange={(e) => setShowShots(e.target.checked)} data-testid="show-shots" />
            Afficher les plans concernés
          </label>
          <TabExport
            id="equipment"
            orientation="portrait"
            doc={() => equipmentDocument(useProjectStore.getState().doc ?? doc, showShots)}
            fileBase={`${title}-materiel`}
            file={{ label: 'CSV', name: `${title}-materiel.csv`, content: () => equipmentCsv(useProjectStore.getState().doc ?? doc) }}
          />
        </div>
      </header>
      <div className={s.grid}>
        {cats.filter((c) => !only || c === only).map((c) => (
          <section key={c} className={['card', s.list].join(' ')} data-testid={`equipment-${c}`}>
            <h2 className={s.h2}>
              {c}
              <span className={s.count}>{lists[c].length}</span>
              {!(c in LEAD) && (
                <Button
                  variant="icon"
                  size="sm"
                  className="no-print"
                  aria-label={`Supprimer le poste ${c}`}
                  icon={<Trash2 size={12} />}
                  onClick={async () => {
                    if (lists[c].length && !(await ask({ title: `Supprimer le poste « ${c} » ?`, body: 'Son matériel disparaît avec lui.', confirmLabel: 'Supprimer', danger: true })).ok) return;
                    mutateDoc((d) => {
                      d.equipmentExtra = (d.equipmentExtra ?? []).filter((x) => x !== c);
                      d.manualEquipment = d.manualEquipment.filter((m) => m.category !== c);
                    });
                  }}
                />
              )}
            </h2>
            {c in LEAD && <Hand>{LEAD[c]}</Hand>}
            {visible(c).length === 0 ? (
              <p className={s.empty}>{q ? 'Aucun résultat.' : 'Rien de déduit pour l’instant.'}</p>
            ) : (
              <ul>
                {visible(c).map((l) => (
                  <li key={l.key}>
                    <span className={s.label}>
                      {l.label}
                      {(l.manual || l.fromBreakdown) && <span className={s.manual}>ajout</span>}
                    </span>
                    <span className={s.nb}>{l.shotIds.length ? `${l.shotIds.length} plan${l.shotIds.length > 1 ? 's' : ''}` : ''}</span>
                    {showShots && (
                    <span className={s.shots} data-view>
                      {l.shotIds.map((id) => (
                        <button key={id} type="button" onClick={() => goToShot(doc, id)}>
                          {shotCode(doc, id)}
                        </button>
                      ))}
                    </span>
                    )}
                    {(l.manual || l.fromBreakdown) && (
                      <Button
                        variant="icon"
                        size="sm"
                        className="no-print"
                        aria-label={`Retirer ${l.label}`}
                        icon={<Trash2 size={12} />}
                        onClick={() =>
                          mutateDoc((d) => {
                            // Saisi au dépouillement : il en sort aussi (une seule liste).
                            if (l.fromBreakdown) removeBreakdownEquipment(d, l.category, l.label);
                            else d.manualEquipment = d.manualEquipment.filter((m) => `manual-${m.id}` !== l.key);
                          })
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form
              className={[s.add, 'no-print'].join(' ')}
              onSubmit={(e) => {
                e.preventDefault();
                const label = (draft[c] ?? '').trim();
                if (!label) return;
                mutateDoc((d) => void d.manualEquipment.push({ id: newId(), category: c, label, shotIds: [] }));
                setDraft({ ...draft, [c]: '' });
              }}
            >
              <input value={draft[c] ?? ''} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} placeholder="Ajouter du matériel…" aria-label={`Ajouter du matériel (${c})`} />
              <Button type="submit" variant="icon" size="sm" aria-label="Ajouter" icon={<Plus size={14} />} />
            </form>
          </section>
        ))}
        <form
          className={[s.newPost, 'no-print'].join(' ')}
          onSubmit={(e) => {
            e.preventDefault();
            addPost();
          }}
        >
          <input
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              setNewPost('');
              e.currentTarget.blur();
            }}
            placeholder="Nouveau poste…"
            aria-label="Nouveau poste"
            data-testid="add-equipment-category"
          />
        </form>
      </div>
    </div>
  );
}
