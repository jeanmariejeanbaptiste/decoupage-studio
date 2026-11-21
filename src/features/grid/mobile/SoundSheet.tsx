import { useCallback, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { editableText } from '../../../domain/cells';
import { scriptPieces } from '../../../domain/phoneCut';
import { composeSound, parseSound, replyMention, SOUND_KINDS, type SoundKind } from '../../../domain/soundField';
import { fold } from '../../../domain/text';
import type { ID, ProjectDoc } from '../../../domain/types';
import { commitCell } from '../actions';
import { Sheet, sheetStyles as s } from './Sheet';

/**
 * Feuille Son : ce qu'on enregistre (son direct, ambiance, réplique, musique, effets), les répliques
 * de la séquence à toucher (le nom n'est écrit que si ce n'est pas le sujet qui parle), l'ambiance et
 * une note. Le champ reste un texte : ce qu'il contenait d'autre est gardé dans la note.
 */
export function SoundSheet({ doc, shotId, onClose }: { doc: ProjectDoc; shotId: ID; onClose: () => void }) {
  const shot = doc.shots[shotId];
  const initial = editableText(doc, shotId, 'sound');
  const [parts, setParts] = useState(() => parseSound(initial));
  const replies = useMemo(() => scriptPieces(doc, shot.sequenceId).filter((p) => p.kind === 'reply'), [doc, shot.sequenceId]);
  const done = useCallback(() => {
    const next = composeSound(parts);
    if (next !== initial) commitCell(shotId, 'sound', next);
    onClose();
  }, [initial, onClose, parts, shotId]);

  const has = (k: SoundKind) => parts.kinds.includes(k);
  const toggle = (k: SoundKind) => setParts((p) => ({ ...p, kinds: has(k) ? p.kinds.filter((x) => x !== k) : [...p.kinds, k] }));
  const mention = (who: string, text: string) => replyMention(who, text, shot.subject);
  const toggleReply = (m: string) =>
    setParts((p) => {
      const on = p.replies.includes(m);
      const list = on ? p.replies.filter((x) => x !== m) : [...p.replies, m];
      return { ...p, replies: list, kinds: p.kinds.includes('Réplique') ? p.kinds : [...p.kinds, 'Réplique'] };
    });

  return (
    <Sheet label="Son" onDone={done} tall testId="sheet-sound">
      <div className={[s.chips, s.soundKinds].join(' ')} role="group" aria-label="Enregistrement">
        {SOUND_KINDS.map((k) => (
          <button key={k} type="button" className={has(k) ? s.on : ''} aria-pressed={has(k)} onClick={() => toggle(k)} data-sound-kind={k}>
            {has(k) && <Check size={15} strokeWidth={1.6} aria-hidden="true" />}
            {k}
          </button>
        ))}
      </div>
      <div className={s.soundBody}>
        {has('Réplique') && replies.length > 0 && (
          <section>
            <p className={s.soundLabel}>Réplique</p>
            <div className={s.lines}>
              {replies.map((r) => {
                const m = mention(r.who ?? '', r.text);
                const on = parts.replies.includes(m);
                const off = !!shot.subject.trim() && fold(r.who ?? '') !== fold(shot.subject);
                return (
                  <button key={r.start} type="button" className={[s.line, on ? s.lineOn : ''].join(' ')} aria-pressed={on} onClick={() => toggleReply(m)} data-reply>
                    <span className={s.lineWho}>
                      {r.who}
                      {off && <em>hors champ</em>}
                    </span>
                    {r.text}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {has('Ambiance') && (
          <label className={s.soundField}>
            <span className={s.soundLabel}>Ambiance</span>
            <input value={parts.ambiance} placeholder="—" onChange={(e) => setParts((p) => ({ ...p, ambiance: e.target.value }))} data-testid="sound-ambiance" />
          </label>
        )}
        <label className={s.soundField}>
          <span className={s.soundLabel}>Note</span>
          <input value={parts.note} placeholder="—" onChange={(e) => setParts((p) => ({ ...p, note: e.target.value }))} data-testid="sound-note" />
        </label>
      </div>
    </Sheet>
  );
}
