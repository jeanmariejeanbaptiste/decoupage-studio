import { useMemo, useState } from 'react';
import { Download, Plus, Printer, Trash2 } from 'lucide-react';
import { aggregateEquipment, EQUIPMENT_CATEGORIES } from '../../domain/equipment';
import { newId } from '../../domain/factory';
import { shotCode } from '../../domain/numbering';
import type { EquipmentCategory, ProjectDoc } from '../../domain/types';
import { downloadBlob } from '../../store/persistence';
import { mutateDoc } from '../../store/projectStore';
import { Button } from '../../ui/Button';
import { Hand } from '../../ui/Hand';
import { goToShot } from '../registry/RegistryPage';
import s from './EquipmentPage.module.css';

const LEAD: Record<EquipmentCategory, string> = {
  Image: 'chef opérateur',
  Machinerie: 'chef machiniste',
  Lumière: 'chef électricien',
  Son: 'chef opérateur du son',
};

/** Listes de matériel par chef de poste (§10). */
export function EquipmentPage({ doc }: { doc: ProjectDoc }) {
  const lists = useMemo(() => aggregateEquipment(doc), [doc]);
  const [draft, setDraft] = useState<Record<EquipmentCategory, string>>({ Image: '', Machinerie: '', Lumière: '', Son: '' });
  const total = EQUIPMENT_CATEGORIES.reduce((n, c) => n + lists[c].length, 0);

  const csv = () => {
    const lines = ['Poste;Matériel;Plans;Ajout manuel'];
    for (const c of EQUIPMENT_CATEGORIES)
      for (const l of lists[c]) lines.push([c, l.label, l.shotIds.map((id) => shotCode(doc, id)).join(' '), l.manual ? 'oui' : ''].map((v) => `"${v.replace(/"/g, '""')}"`).join(';'));
    downloadBlob(new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `${doc.project.title || 'projet'}-materiel.csv`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-kicker">Étape 7 · Listes de matériel</p>
          <h1 className="page-title">
            Les <em>{total}</em> lignes de matériel
          </h1>
        </div>
        <div className={[s.actions, 'no-print'].join(' ')}>
          <Button variant="outline" icon={<Download size={15} strokeWidth={1.25} />} onClick={csv}>
            CSV
          </Button>
          <Button variant="outline" icon={<Printer size={15} strokeWidth={1.25} />} onClick={() => window.print()}>
            PDF
          </Button>
        </div>
      </header>
      <div className={s.grid}>
        {EQUIPMENT_CATEGORIES.map((c) => (
          <section key={c} className={['card', s.list].join(' ')} data-testid={`equipment-${c}`}>
            <h2 className={s.h2}>{c}</h2>
            <Hand>{LEAD[c]}</Hand>
            {lists[c].length === 0 ? (
              <p className={s.empty}>Rien de déduit pour l’instant.</p>
            ) : (
              <ul>
                {lists[c].map((l) => (
                  <li key={l.key}>
                    <span className={s.label}>{l.label}</span>
                    <span className={s.shots}>
                      {l.shotIds.slice(0, 18).map((id) => (
                        <button key={id} type="button" onClick={() => goToShot(doc, id)}>
                          {shotCode(doc, id)}
                        </button>
                      ))}
                      {l.shotIds.length > 18 && <em>+{l.shotIds.length - 18}</em>}
                    </span>
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
                const label = draft[c].trim();
                if (!label) return;
                mutateDoc((d) => void d.manualEquipment.push({ id: newId(), category: c, label, shotIds: [] }));
                setDraft({ ...draft, [c]: '' });
              }}
            >
              <input value={draft[c]} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} placeholder="Ajouter du matériel…" aria-label={`Ajouter du matériel (${c})`} />
              <Button type="submit" variant="icon" size="sm" aria-label="Ajouter" icon={<Plus size={14} />} />
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
