import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addComment, commentsOf, cutComments, deleteComment, replyComment, setResolved, shownComments } from './comments';
import { mediaKeys } from './serialize';
import { shiftAnchors } from './fountain';
import { reviseScenario } from './revision';
import { createVersion } from './versions';

describe('commentaires de relecture', () => {
  it('un passage commenté suit le texte quand il change, et après un nouveau texte', () => {
    const base = buildFiction();
    const src = base.scenario!;
    const at = src.indexOf('valise cabossée');
    const doc = produce(base, (d) => void addComment(d, { kind: 'script', start: at, end: at + 'valise cabossée'.length, quote: 'valise cabossée' }, 'Nina', 'Quelle valise ?'));
    const edited = produce(doc, (d) => {
      const next = `${src.slice(0, 10)}Ajout en tête. ${src.slice(10)}`;
      shiftAnchors(d, src, next);
      d.scenario = next;
    });
    const a = edited.comments![0].anchor;
    expect(a.kind === 'script' && edited.scenario!.slice(a.start, a.end)).toBe('valise cabossée');
    const revised = produce(edited, (d) => void reviseScenario(d, `INT. TRAIN - JOUR\n\nUn contrôleur passe.\n\n${d.scenario}`));
    const b = revised.comments![0].anchor;
    expect(b.kind === 'script' && revised.scenario!.slice(b.start, b.end)).toBe('valise cabossée');
  });

  it('réponses, réglé, retiré ; marques du découpage ; une version nouvelle a les siens', () => {
    const base = buildFiction();
    const shotId = base.sequences[base.project.sequenceIds[0]].shotIds[0];
    let id = '';
    const doc = produce(base, (d) => {
      id = addComment(d, { kind: 'shot', shotId, col: 'value' }, 'Nina', 'Plan large ?')!;
      replyComment(d, id, 'Moi', 'Oui.');
    });
    expect(doc.comments![0].replies[0].text).toBe('Oui.');
    expect(cutComments(doc).get(`${shotId}:value`)).toHaveLength(1);
    expect(cutComments(produce(doc, (d) => setResolved(d, id, true))).size).toBe(0);
    expect(produce(doc, (d) => deleteComment(d, id)).comments).toEqual([]);
    // Après une nouvelle version, les commentaires de la précédente restent les siens.
    const v2 = produce(doc, (d) => void createVersion(d));
    expect(commentsOf(v2)).toHaveLength(0);
    expect(commentsOf(v2, v2.versions![0].id)).toHaveLength(1);
  });

  it('en V2, les commentaires encore ouverts de la V1 se retrouvent à leur place ; la réponse porte sa version', () => {
    const base = buildFiction();
    const shotId = base.sequences[base.project.sequenceIds[0]].shotIds[0];
    const src = base.scenario!;
    const at = src.indexOf('valise cabossée');
    let a = '';
    const v2 = produce(base, (d) => {
      a = addComment(d, { kind: 'shot', shotId, col: 'value' }, 'Nina', 'Plan large ?', { attachments: ['p:schema'], marks: { surface: 'cut', paths: ['M0 0 L10 10'] } })!;
      addComment(d, { kind: 'script', start: at, end: at + 15, quote: 'valise cabossée' }, 'Nina', 'Quelle valise ?');
      createVersion(d);
      const s = d.scenario!;
      d.scenario = `INT. TRAIN - JOUR\n\nUn contrôleur passe.\n\n${s}`;
      replyComment(d, a, 'Moi', 'En V2, c’est un plan large.', ['p:croquis']);
    });
    const shown = shownComments(v2);
    expect(shown.map((x) => x.from)).toEqual([v2.versions![0].id, v2.versions![0].id]);
    const script = shown.find((x) => x.anchor.kind === 'script')!;
    expect(script.anchor.kind === 'script' && v2.scenario!.slice(script.anchor.start, script.anchor.end)).toBe('valise cabossée');
    expect(cutComments(v2).get(`${shotId}:value`)?.[0].from).toBe(v2.versions![0].id);
    const reply = v2.comments!.find((c) => c.id === a)!.replies[0];
    expect(reply.versionId).toBe(v2.activeVersionId);
    // Les fichiers joints ne partent jamais au ménage.
    expect(mediaKeys(v2)).toEqual(expect.arrayContaining(['p:schema', 'p:croquis']));
  });
});
