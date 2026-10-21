import { useEffect, useState } from 'react';
import type { ProjectDoc } from '../../domain/types';
import { countWords } from '../../domain/text';
import { mutateDoc } from '../../store/projectStore';
import { Hand } from '../../ui/Hand';
import s from './IntentionPage.module.css';
import { TabExport } from '../export/TabExport';
import { intentionDocument } from '../../domain/documents';

/** Note d'intention : un texte libre, enregistré dans le projet (validé au bout de la frappe). */
export function IntentionPage({ doc }: { doc: ProjectDoc }) {
  const [text, setText] = useState(doc.intention ?? '');
  useEffect(() => setText(doc.intention ?? ''), [doc.project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (text === (doc.intention ?? '')) return;
    const t = setTimeout(() => mutateDoc((d) => void (d.intention = text)), 500);
    return () => clearTimeout(t);
  }, [text, doc.intention]);
  const words = countWords(text);
  return (
    <div className="page">
      <header className="page-head">
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
          <Hand>
            {words} mot{words > 1 ? 's' : ''}
          </Hand>
          <TabExport doc={() => intentionDocument({ ...doc, intention: text })} fileBase={`${doc.project.title || 'projet'}-note-d-intention`} file={{ label: 'Texte', type: 'text/plain;charset=utf-8', name: `${doc.project.title || 'projet'}-note-d-intention.txt`, content: () => text }} />
        </span>
      </header>
      <div className={['card', s.sheet].join(' ')}>
        <textarea
          className={s.text}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Le point de vue, le ton, la lumière, le rythme, les références… Ce texte guide le découpage et sera partagé avec l’équipe."
          aria-label="Note d’intention"
        />
      </div>
    </div>
  );
}
