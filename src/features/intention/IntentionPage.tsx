import { useEffect, useState } from 'react';
import type { ProjectDoc } from '../../domain/types';
import { countWords } from '../../domain/text';
import { mutateDoc } from '../../store/projectStore';
import { Hand } from '../../ui/Hand';
import s from './IntentionPage.module.css';

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
        <div>
          <p className="page-kicker">Étape 1 · Note d’intention</p>
          <h1 className="page-title">Ce que le film veut dire</h1>
        </div>
        <Hand>
          {words} mot{words > 1 ? 's' : ''}
        </Hand>
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
