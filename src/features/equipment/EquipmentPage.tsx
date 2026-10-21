import { useMemo, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { TabExport } from '../export/TabExport';
import { equipmentDocument } from '../../domain/documents';
import { aggregateEquipment, equipmentCategories } from '../../domain/equipment';
import { newId } from '../../domain/factory';
import { shotCode } from '../../domain/numbering';
import type { EquipmentCategory, ProjectDoc } from '../../domain/types';
import { downloadBlob } from '../../store/persistence';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
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
  const [draft, setDraft] = useState<Record<EquipmentCategory, string>>({ Image: '', Machinerie: '', Lumière: '', Son: '' });

  const csv = () => {
    const lines = ['Poste;Matériel;Plans;Ajout manuel'];
    for (const c of equipmentCategories(doc))
      for (const l of lists[c]) lines.push([c, l.label, l.shotIds.map((id) => shotCode(doc, id)).join(' '), l.manual ? 'oui' : ''].map((v) => `"${v.replace(/"/g, '""')}"`).join(';'));
    downloadBlob(new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `${doc.project.title || 'projet'}-materiel.csv`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className={[s.actions, 'no-print'].join(' ')}>
          <label className={s.toggle}>
            <input type="checkbox" checked={showShots} onChange={(e) => setShowShots(e.target.checked)} data-testid="show-shots" />
            Afficher les plans concernés
          </label>
          <Button
            variant="ghost"
            icon={<Plus size={15} strokeWidth={1.25} />}
            data-testid="add-equipment-category"
            onClick={() => {
              const name = window.prompt('Nom du nouveau poste (ex. Décoration, Régie, Effets spéciaux)')?.trim();
              if (name) mutateDoc((d) => void (d.equipmentExtra = [...new Set([...(d.equipmentExtra ?? []), name])]));
            }}
          >
            Poste
          </Button>
          <TabExport doc={() => equipmentDocument(doc, showShots)} fileBase={`${doc.project.title || 'projet'}-materiel`} />
          <Button variant="ghost" icon={<Download size={15} strokeWidth={1.25} />} onClick={csv}>
            CSV
          </Button>
        </div>
      </header>
      <div className={s.grid}>
        {equipmentCategories(doc).map((c) => (
          <section key={c} className={['card', s.list].join(' ')} data-testid={`equipment-${c}`}>
            <h2 className={s.h2}>
              {c}
              {!(c in LEAD) && (
                <Button
                  variant="icon"
                  size="sm"
                  className="no-print"
                  aria-label={`Supprimer le poste ${c}`}
                  icon={<Trash2 size={12} />}
                  onClick={() => {
                    if (lists[c].length && !window.confirm(`Supprimer le poste « ${c} » et son matériel ? (annulable avec ⌘Z)`)) return;
                    mutateDoc((d) => {
                      d.equipmentExtra = (d.equipmentExtra ?? []).filter((x) => x !== c);
                      d.manualEquipment = d.manualEquipment.filter((m) => m.category !== c);
                    });
                  }}
                />
              )}
            </h2>
            {c in LEAD && <Hand>{LEAD[c]}</Hand>}
            {lists[c].length === 0 ? (
              <p className={s.empty}>Rien de déduit pour l’instant.</p>
            ) : (
              <ul>
                {lists[c].map((l) => (
                  <li key={l.key}>
                    <span className={s.label}>{l.label}</span>
                    {showShots && (
                    <span className={s.shots}>
                      {l.shotIds.map((id) => (
                        <button key={id} type="button" onClick={() => goToShot(doc, id)}>
                          {shotCode(doc, id)}
                        </button>
                      ))}
                    </span>
                    )}
                    {l.manual && (
                      <Button
                        variant="icon"
                        size="sm"
                        className="no-print"
                        aria-label={`Retirer ${l.label}`}
                        icon={<Trash2 size={12} />}
                        onClick={() => mutateDoc((d) => void (d.manualEquipment = d.manualEquipment.filter((m) => `manual-${m.id}` !== l.key)))}
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
      </div>
    </div>
  );
}
