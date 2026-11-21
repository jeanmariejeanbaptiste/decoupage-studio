import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cutDiff } from '../../domain/cutDiff';
import { activeVersion } from '../../domain/versions';
import type { ProjectDoc } from '../../domain/types';
import s from './CutCompare.module.css';

const MARK = { added: 'Ajouté', removed: 'Retiré', changed: 'Modifié' } as const;

/**
 * Comparer le découpage de deux versions : séquences et plans ajoutés, retirés ou modifiés, champ
 * par champ (avant → après). Par défaut, la version courante face à celle dont elle est partie.
 */
export function CutCompare({ doc, onClose }: { doc: ProjectDoc; onClose: () => void }) {
  const versions = doc.versions ?? [];
  const cur = activeVersion(doc);
  const [b, setB] = useState(cur?.id ?? versions.at(-1)?.id ?? '');
  const [a, setA] = useState(() => cur?.from ?? versions.find((v) => v.id !== b)?.id ?? '');
  const diff = useMemo(() => (a && b ? cutDiff(doc, a, b) : []), [doc, a, b]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className={s.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={s.panel} role="dialog" aria-modal="true" aria-label="Comparer le découpage" data-testid="cut-compare">
        <header className={s.head}>
          <h2>
            Comparer le découpage {pick(a, setA, 'Version de départ')} avec {pick(b, setB, 'Version comparée')}
          </h2>
          <button type="button" className={s.close} onClick={onClose} aria-label="Fermer">
            <X size={16} strokeWidth={1.4} />
          </button>
        </header>
        <div className={s.body}>
          {!diff.length && <p className={s.none}>Aucune différence de découpage.</p>}
          {diff.map((q, i) => (
            <div key={i} className={s.seq} data-status={q.status}>
              <h3>
                {q.heading}
                {q.status !== 'changed' && <em>{MARK[q.status]}</em>}
              </h3>
              {q.shots.map((sh, k) => (
                <div key={k} className={s.shot} data-status={sh.status} data-testid="cut-change">
                  <div className={s.line}>
                    <b>{sh.code}</b>
                    <span>{sh.label}</span>
                    <em>{MARK[sh.status]}</em>
                  </div>
                  {sh.fields.map((f, j) => (
                    <div key={j} className={s.field}>
                      <span className={s.k}>{f.label}</span>
                      <del>{f.before || '—'}</del>
                      <span className={s.arrow}>→</span>
                      <ins>{f.after || '—'}</ins>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
