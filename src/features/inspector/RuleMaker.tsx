import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { editableText } from '../../domain/cells';
import { columnMenuLabel } from '../../domain/columns';
import { newId } from '../../domain/factory';
import { sequenceNumber } from '../../domain/numbering';
import { RULE_COLUMNS, ruleSentence } from '../../domain/rules';
import type { ColumnKey, ID, ProjectDoc } from '../../domain/types';
import { mutateDoc } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import s from './Inspector.module.css';

const NONE = '';

/**
 * Règles « si… alors… » : préremplies d'après les cellules sélectionnées du plan (la première pour la
 * condition, la dernière pour le résultat), puis la liste des règles du projet.
 */
export function RuleMaker({ doc, shotId }: { doc: ProjectDoc; shotId: ID }) {
  const sel = useUi((u) => u.selection);
  const shot = doc.shots[shotId];
  const cols = doc.project.settings.gridColumns;
  // Colonnes sélectionnées sur la ligne du plan (dans l'ordre du tableau).
  const picked = useMemo(() => {
    if (!sel || sel.anchor.row !== sel.focus.row) return [] as ColumnKey[];
    const a = cols.indexOf(sel.anchor.col);
    const b = cols.indexOf(sel.focus.col);
    if (a < 0 || b < 0) return [];
    return cols.slice(Math.min(a, b), Math.max(a, b) + 1).filter((c) => RULE_COLUMNS.includes(c));
  }, [sel, cols]);
  const initial = () => {
    const whenCol = picked.length >= 2 ? picked[0] : 'value';
    const thenCol = picked.length >= 2 ? picked[picked.length - 1] : 'focal';
    return {
      whenCol: whenCol as ColumnKey | typeof NONE,
      whenValue: shot ? editableText(doc, shot.id, whenCol) : '',
      thenCol,
      thenValue: shot ? editableText(doc, shot.id, thenCol) : '',
    };
  };
  const [f, setF] = useState(initial);
  const [scope, setScope] = useState<'project' | 'sequence'>('project');
  useEffect(() => setF(initial()), [shotId, picked.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const rules = doc.rules ?? [];
  const ok = !!f.thenValue.trim() && (!f.whenCol || !!f.whenValue.trim()) && f.whenCol !== f.thenCol;
  const create = () =>
    mutateDoc((d) => {
      (d.rules ??= []).push({
        id: newId(),
        seqId: scope === 'sequence' ? shot?.sequenceId : undefined,
        when: f.whenCol ? { col: f.whenCol, value: f.whenValue.trim() } : undefined,
        then: { col: f.thenCol, value: f.thenValue.trim() },
      });
    });
  const colSelect = (value: string, onChange: (v: string) => void, label: string, allowNone = false) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {allowNone && <option value={NONE}>Toujours</option>}
      {RULE_COLUMNS.map((c) => (
        <option key={c} value={c}>
          {columnMenuLabel(c)}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <div className={[s.cell, s.full, s.ruleHead].join(' ')}>
        <span className={s.k}>Nouvelle règle</span>
        {picked.length >= 2 && <span className={s.k}>{picked.length} cellules</span>}
      </div>
      <div className={[s.cell, s.span2, s.field].join(' ')}>
        <span className={s.k}>Si</span>
        {colSelect(f.whenCol, (v) => setF({ ...f, whenCol: v as ColumnKey, whenValue: v && shot ? editableText(doc, shot.id, v as ColumnKey) : '' }), 'Colonne de la condition', true)}
        {f.whenCol && <input value={f.whenValue} onChange={(e) => setF({ ...f, whenValue: e.target.value })} aria-label="Valeur de la condition" />}
      </div>
      <div className={[s.cell, s.field].join(' ')}>
        <span className={s.k}>Alors</span>
        {colSelect(f.thenCol, (v) => setF({ ...f, thenCol: v as ColumnKey, thenValue: shot ? editableText(doc, shot.id, v as ColumnKey) : '' }), 'Colonne du résultat')}
        <input value={f.thenValue} onChange={(e) => setF({ ...f, thenValue: e.target.value })} aria-label="Valeur du résultat" />
      </div>
      <div className={[s.cell, s.full, s.rowCell].join(' ')}>
        <span className={s.k}>Portée</span>
        <div className={s.seg} role="radiogroup" aria-label="Portée de la règle">
          <button type="button" role="radio" aria-checked={scope === 'project'} className={scope === 'project' ? s.segOn : ''} onClick={() => setScope('project')}>
            Projet
          </button>
          <button type="button" role="radio" aria-checked={scope === 'sequence'} className={scope === 'sequence' ? s.segOn : ''} onClick={() => setScope('sequence')}>
            Séquence {shot ? sequenceNumber(doc, shot.sequenceId) : ''}
          </button>
        </div>
      </div>
      <button type="button" className={[s.cell, s.full, s.create].join(' ')} disabled={!ok} onClick={create} data-testid="rule-create">
        Créer la règle
      </button>
      {rules.length > 0 && (
        <ul className={[s.cell, s.full, s.rules].join(' ')} aria-label="Règles du projet" data-testid="rules">
          {rules.map((r) => (
            <li key={r.id} className={r.off ? s.ruleOff : ''}>
              <label>
                <input type="checkbox" checked={!r.off} onChange={(e) => mutateDoc((d) => void (d.rules!.find((x) => x.id === r.id)!.off = !e.target.checked || undefined))} aria-label="Règle active" />
                <span>{ruleSentence(doc, r)}</span>
              </label>
              <button type="button" aria-label="Supprimer la règle" title="Supprimer" onClick={() => mutateDoc((d) => void (d.rules = d.rules!.filter((x) => x.id !== r.id)))}>
                <X size={12} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
