import { fold } from '../../domain/text';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
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
import { goToShot } from '../grid/goTo';
import s from './EquipmentPage.module.css';
import { exportBase } from '../../domain/serialize';
import { plural } from '../../domain/schedule';

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
  const q = fold(query.trim());
  const cats = equipmentCategories(doc);
  const visible = (c: string) => lists[c].filter((l) => !q || fold(c).includes(q) || fold(l.label).includes(q) || l.shotIds.some((id) => fold(shotCode(doc, id)).includes(q)));
  const [draft, setDraft] = useState<Record<EquipmentCategory, string>>({ Image: '', Machinerie: '', Lumière: '', Son: '' });
  const [newPost, setNewPost] = useState('');
  const addRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Poste qu'on vient de créer ou de retrouver : visible même pendant une recherche, sa saisie prend la main.
  const [focus, setFocus] = useState<{ cat: string; n: number } | null>(null);
  const focusCat = focus?.cat ?? null;
  useEffect(() => {
    if (!focus) return;
    const el = addRefs.current[focus.cat];
    el?.scrollIntoView({ block: 'nearest' });
    el?.focus();
  }, [focus]);
  /** Nouveau poste ; un nom déjà pris (sans casse ni accents) mène au poste existant. */
  const addPost = () => {
    const name = newPost.trim();
    if (!name) return;
    const existing = cats.find((c) => fold(c) === fold(name));
    if (!existing) mutateDoc((d) => void (d.equipmentExtra = [...(d.equipmentExtra ?? []), name]));
    setFocus((f) => ({ cat: existing ?? name, n: (f?.n ?? 0) + 1 }));
    setNewPost('');
  };

  const total = cats.reduce((n, c) => n + lists[c].length, 0);
  const shown = cats.filter((c) => c === focusCat || !q || visible(c).length > 0);

  return (
    <div className="page page--wide">
      <div className={s.wrap}>
        <header className={[s.head, 'no-print'].join(' ')}>
          <label className={s.search} data-view>
            <Search size={14} strokeWidth={1.4} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => (setQuery(e.target.value), setFocus(null))} placeholder="Rechercher" aria-label="Rechercher du matériel" />
          </label>
          <label className={s.toggle} data-view>
            <input type="checkbox" checked={showShots} onChange={(e) => setShowShots(e.target.checked)} data-testid="show-shots" />
            Plans concernés
          </label>
          <span className={s.total}>{plural(total, 'élément')}</span>
          <TabExport
            id="equipment"
            orientation="portrait"
            doc={() => equipmentDocument(useProjectStore.getState().doc ?? doc, showShots)}
            fileBase={`${exportBase(doc)}-materiel`}
            file={{ label: 'CSV', name: `${exportBase(doc)}-materiel.csv`, content: () => equipmentCsv(useProjectStore.getState().doc ?? doc) }}
          />
        </header>
        {q && shown.length === 0 && <p className={s.none}>Aucun résultat.</p>}
        {shown.map((c) => (
          <section key={c} className={['card', s.post].join(' ')} data-testid={`equipment-${c}`} aria-label={c}>
            <h2 className={s.postHead}>
              <span className={s.name}>{c}</span>
              {c in LEAD && <span className={s.lead}>{LEAD[c]}</span>}
              <span className={s.count}>{lists[c].length || ''}</span>
              {!(c in LEAD) && (
                <Button
                  variant="icon"
                  size="sm"
                  className="no-print"
                  aria-label={`Supprimer le poste ${c}`}
                  icon={<Trash2 size={13} strokeWidth={1.3} />}
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
            <ul className={showShots ? s.rows : [s.rows, s.noShots].join(' ')}>
              {visible(c).map((l) => (
                <li key={l.key} className={s.row}>
                  <span className={s.label}>
                    {l.label}
                    {(l.manual || l.fromBreakdown) && <span className={s.manual}>ajouté</span>}
                  </span>
                  <span className={s.nb}>{l.shotIds.length ? plural(l.shotIds.length, 'plan') : ''}</span>
                  {showShots && (
                    <span className={s.shots} data-view>
                      {l.shotIds.map((id) => (
                        <button key={id} type="button" onClick={() => goToShot(doc, id)} title="Ouvrir dans le découpage">
                          {shotCode(doc, id)}
                        </button>
                      ))}
                    </span>
                  )}
                  <span className={s.act}>
                    {(l.manual || l.fromBreakdown) && (
                      <Button
                        variant="icon"
                        size="sm"
                        className="no-print"
                        aria-label={`Retirer ${l.label}`}
                        icon={<X size={13} strokeWidth={1.3} />}
                        onClick={() =>
                          mutateDoc((d) => {
                            // Saisi au dépouillement : il en sort aussi (une seule liste).
                            if (l.fromBreakdown) removeBreakdownEquipment(d, l.category, l.label);
                            else d.manualEquipment = d.manualEquipment.filter((m) => `manual-${m.id}` !== l.key);
                          })
                        }
                      />
                    )}
                  </span>
                </li>
              ))}
              <li className={[s.row, s.addRow, 'no-print'].join(' ')} data-edit>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const label = (draft[c] ?? '').trim();
                    if (!label) return;
                    mutateDoc((d) => void d.manualEquipment.push({ id: newId(), category: c, label, shotIds: [] }));
                    setDraft({ ...draft, [c]: '' });
                  }}
                >
                  <Plus size={14} strokeWidth={1.3} aria-hidden="true" />
                  <input
                    ref={(el) => void (addRefs.current[c] = el)}
                    value={draft[c] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && (setDraft({ ...draft, [c]: '' }), e.currentTarget.blur())}
                    placeholder="Ajouter du matériel"
                    aria-label={`Ajouter du matériel (${c})`}
                  />
                </form>
              </li>
            </ul>
          </section>
        ))}
        <form
          className={[s.newPost, 'no-print'].join(' ')}
          data-edit
          onSubmit={(e) => {
            e.preventDefault();
            addPost();
          }}
        >
          <Plus size={14} strokeWidth={1.3} aria-hidden="true" />
          <input
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              setNewPost('');
              e.currentTarget.blur();
            }}
            placeholder="Nouveau poste"
            aria-label="Nouveau poste"
            data-testid="add-equipment-category"
          />
        </form>
      </div>
    </div>
  );
}
