import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addComment, deleteComment, replyComment, type ReviewComment } from './comments';
import { driveAttachmentKeys, LIMITS, mergeDriveComments, mergeSnapshotComments, WITHDRAWN, type DriveComment, type MergeOptions } from './reviewMerge';
import { encodeComment } from './reviewTrailer';
import { parseReviewSnapshot, reviewSnapshot } from './reviewSnapshot';
import type { ProjectDoc } from './types';
import { createVersion, ensureVersions } from './versions';

const base = () =>
  produce(buildFiction(), (d) => {
    ensureVersions(d);
    d.review = { fileId: 'file123456', publishedVersionId: d.activeVersionId!, publishedAt: '2026-11-09T10:00:00Z' };
  });

const merge = (doc: ProjectDoc, remote: DriveComment[], opts: MergeOptions = {}) => {
  let changed = false;
  const next = produce(doc, (d) => void (changed = mergeDriveComments(d, remote, { versionId: doc.review?.publishedVersionId, dismissed: doc.review?.dismissed, now: '2026-11-09T12:00:00Z', ...opts })));
  return { next, changed };
};

const dc = (id: string, content: string, extra: Partial<DriveComment> = {}): DriveComment => ({ id, content, author: { displayName: 'Nina Relectrice' }, createdTime: `2026-11-09T11:00:0${id.length % 10}Z`, ...extra });

describe('retours de la relecture en ligne', () => {
  it('importe une fois (idempotent), avec l’auteur Google, la version et l’endroit', () => {
    const doc = base();
    const shotId = Object.keys(doc.shots)[0];
    const remote = [dc('d1', encodeComment('Plutôt un plan large ?', { i: 'loc111', v: doc.activeVersionId, a: { kind: 'shot', shotId, col: 'value' } }))];
    const a = merge(doc, remote);
    expect(a.changed).toBe(true);
    const c = a.next.comments![0];
    expect(c).toMatchObject({ id: 'loc111', author: 'Nina Relectrice', text: 'Plutôt un plan large ?', versionId: doc.activeVersionId, anchor: { kind: 'shot', shotId, col: 'value' }, remoteId: 'd1' });
    const b = merge(a.next, remote);
    expect(b.changed).toBe(false);
    expect(b.next).toBe(a.next);
  });

  it('modifié dans Drive : mis à jour ; supprimé : retiré, sauf le fil où l’auteur a répondu', () => {
    const doc = base();
    const seqId = doc.project.sequenceIds[1];
    const one = merge(doc, [dc('d1', encodeComment('Trop long', { a: { kind: 'sequence', seqId } })), dc('d2', encodeComment('Coupe ici', { a: { kind: 'sequence', seqId } }))]).next;
    const edited = merge(one, [dc('d1', encodeComment('Trop long, vraiment', { a: { kind: 'sequence', seqId } }))]).next;
    expect(edited.comments!.find((c) => c.remoteId === 'd1')!.text).toBe('Trop long, vraiment');
    // L'auteur répond à d2.
    const answered = produce(edited, (d) => void replyComment(d, d.comments!.find((c) => c.remoteId === 'd2')!.id, 'Moi', 'D’accord.'));
    const gone = merge(answered, [dc('d1', '', { deleted: true }), dc('d2', '', { deleted: true })]).next;
    expect(gone.comments!.map((c) => c.remoteId)).toEqual(['d2']);
    expect(gone.comments![0].text).toBe(WITHDRAWN);
    expect(gone.comments![0].replies[0].text).toBe('D’accord.');
    expect(merge(gone, [dc('d2', '', { deleted: true })]).changed).toBe(false);
  });

  it('jamais un commentaire de l’auteur : seuls les éléments importés sont retirés ou modifiés', () => {
    let doc = base();
    let mine = '';
    doc = produce(doc, (d) => void (mine = addComment(d, { kind: 'sequence', seqId: d.project.sequenceIds[0] }, 'Moi', 'Note de l’auteur')!));
    // Une traîne qui se fait passer pour le commentaire de l'auteur ne le touche pas.
    const r = merge(doc, [dc('d9', encodeComment('Remplacé ?', { i: mine, a: { kind: 'sequence', seqId: doc.project.sequenceIds[0] } })), dc('d8', '', { deleted: true })]);
    const own = r.next.comments!.find((c) => c.id === mine)!;
    expect(own.text).toBe('Note de l’auteur');
    const imported = r.next.comments!.find((c) => c.remoteId === 'd9')!;
    expect(imported.id).not.toBe(mine);
  });

  it('réponse à un fil (identifiant local, ou commentaire Drive), et fil disparu : rien ne se perd', () => {
    const doc = base();
    const seqId = doc.project.sequenceIds[0];
    let authorNote = '';
    const withNote = produce(doc, (d) => void (authorNote = addComment(d, { kind: 'sequence', seqId }, 'Moi', 'Qu’en pensez-vous ?')!));
    const r = merge(withNote, [
      dc('d1', encodeComment('Très bien.', { r: authorNote })),
      dc('d22', encodeComment('Je trouve aussi.', { rr: 'd1x' })),
      dc('d333', encodeComment('Question ?', { a: { kind: 'sequence', seqId } })),
      dc('d4444', encodeComment('Réponse à la question', { rr: 'd333' })),
      dc('d55555', encodeComment('Réponse orpheline', { r: 'disparu' })),
    ]);
    const note = r.next.comments!.find((c) => c.id === authorNote)!;
    expect(note.replies.map((x) => [x.text, x.author, x.remoteId])).toEqual([['Très bien.', 'Nina Relectrice', 'd1']]);
    expect(r.next.comments!.find((c) => c.remoteId === 'd333')!.replies.map((x) => x.text)).toEqual(['Réponse à la question']);
    // Parents introuvables : posés comme commentaires, sur la première séquence.
    const orphans = r.next.comments!.filter((c) => c.remoteId === 'd22' || c.remoteId === 'd55555');
    expect(orphans.map((c) => c.anchor)).toEqual([
      { kind: 'sequence', seqId },
      { kind: 'sequence', seqId },
    ]);
  });

  it('validation : endroit inexistant, textes et tracés bornés, chemins douteux écartés', () => {
    const doc = base();
    const len = doc.scenario!.length;
    const long = 'x'.repeat(LIMITS.text + 50);
    const paths = Array.from({ length: 60 }, (_, i) => `M${i} 0 L10 10`);
    const r = merge(doc, [
      dc('d1', encodeComment(long, { a: { kind: 'shot', shotId: 'inconnu' }, m: { surface: 'cut', paths: [...paths, 'M0 0"/><script>', 'M'.repeat(LIMITS.path + 1)] } })),
      dc('d22', encodeComment('Hors bornes', { a: { kind: 'script', start: len + 10, end: len + 20, quote: 'introuvable' } })),
      dc('d333', encodeComment('Recalé', { a: { kind: 'script', start: 0, end: 15, quote: 'valise cabossée' } })),
      dc('d4444', encodeComment('Colonne inconnue', { a: { kind: 'shot', shotId: Object.keys(doc.shots)[0], col: 'pirate' as never } })),
    ]);
    const [a, b, c, d] = r.next.comments!;
    expect(a.text).toHaveLength(LIMITS.text);
    expect(a.anchor).toEqual({ kind: 'sequence', seqId: doc.project.sequenceIds[0] });
    expect(a.marks!.paths).toHaveLength(LIMITS.paths);
    expect(a.marks!.paths.every((p) => /^M\d+ 0 L10 10$/.test(p))).toBe(true);
    expect(b.anchor.kind).toBe('sequence');
    expect(c.anchor.kind === 'script' && r.next.scenario!.slice(c.anchor.start, c.anchor.end)).toBe('valise cabossée');
    expect(d.anchor).toEqual({ kind: 'shot', shotId: Object.keys(doc.shots)[0] });
  });

  it('commentaire écrit dans Drive (sans traîne) : texte brut sur la première séquence de la version publiée', () => {
    const doc = base();
    const r = merge(doc, [dc('d1', 'Bravo pour le film !')]);
    expect(r.next.comments![0]).toMatchObject({ text: 'Bravo pour le film !', anchor: { kind: 'sequence', seqId: doc.project.sequenceIds[0] }, versionId: doc.activeVersionId });
  });

  it('versions : la version de la traîne si elle existe, sinon la publiée ; endroit vérifié dans cette version', () => {
    let doc = base();
    const v1 = doc.activeVersionId!;
    const removed = doc.project.sequenceIds[2];
    doc = produce(doc, (d) => {
      createVersion(d);
      d.project.sequenceIds = d.project.sequenceIds.filter((id) => id !== removed);
      delete d.sequences[removed];
    });
    // Publiée : V1 (rangée) ; la séquence retirée en V2 existe encore en V1.
    const r = merge(doc, [dc('d1', encodeComment('Sur V1', { v: v1, a: { kind: 'sequence', seqId: removed } })), dc('d22', encodeComment('Version inconnue', { v: 'zzz', a: { kind: 'sequence', seqId: removed } }))], { versionId: v1 });
    expect(r.next.comments!.map((c) => [c.versionId, c.anchor])).toEqual([
      [v1, { kind: 'sequence', seqId: removed }],
      [v1, { kind: 'sequence', seqId: removed }],
    ]);
  });

  it('retiré par l’auteur : jamais réimporté ; pièces jointes en clés drive:', () => {
    const doc = base();
    const seqId = doc.project.sequenceIds[0];
    const remote = [dc('d1', encodeComment('', { a: { kind: 'sequence', seqId }, f: [{ id: 'imgfile123', rk: 'rk-12345' }, { id: '../bad' }] }))];
    expect(driveAttachmentKeys(remote)).toEqual(['drive:imgfile123~rk-12345']);
    const one = merge(doc, remote).next;
    expect(one.comments![0].attachments).toEqual(['drive:imgfile123~rk-12345']);
    expect(one.comments![0].text).toBe('');
    const dismissed = produce(one, (d) => deleteComment(d, d.comments![0].id));
    expect(dismissed.review!.dismissed).toEqual(['d1']);
    expect(merge(dismissed, remote).changed).toBe(false);
  });

  it('chez le relecteur : son envoi resté sans réponse est reconnu, pas dupliqué', () => {
    let doc = base();
    let id = '';
    doc = produce(doc, (d) => void (id = addComment(d, { kind: 'sequence', seqId: d.project.sequenceIds[0] }, 'Vous', 'Envoyé')!));
    const remote = [dc('d1', encodeComment('Envoyé', { i: id, a: { kind: 'sequence', seqId: doc.project.sequenceIds[0] } }), { author: { displayName: 'Nina', me: true } })];
    const r = merge(doc, remote, { pending: new Set([id]) });
    expect(r.next.comments).toHaveLength(1);
    expect(r.next.comments![0]).toMatchObject({ id, remoteId: 'd1', author: 'Nina' });
  });

  it('instantané republié chez le relecteur : il fait foi, les envois d’ici non repris restent', () => {
    const c = (id: string, extra: Partial<ReviewComment> = {}): ReviewComment => ({ id, anchor: { kind: 'sequence', seqId: 's' }, author: 'A', text: id, at: '', replies: [], ...extra });
    const prev = [c('a'), c('gone')];
    const next = [c('a', { replies: [{ id: 'ra', author: 'Moi', text: 'Réponse', at: '' }] }), c('b', { remoteId: 'd2' })];
    const local = [c('a', { replies: [{ id: 'mine', author: 'Vous', text: 'En cours', at: '' }] }), c('gone'), c('local'), c('b2', { remoteId: 'd2' })];
    const out = mergeSnapshotComments(local, prev, next);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'local']);
    expect(out[0].replies.map((r) => r.id)).toEqual(['ra', 'mine']);
  });

  it('chez le relecteur (V1 réduite à son texte) : un plan commenté en V1 garde sa place', () => {
    let doc = base();
    const v1 = doc.activeVersionId!;
    const shotId = Object.keys(doc.shots)[0];
    doc = produce(doc, (d) => void createVersion(d));
    const snap = parseReviewSnapshot(JSON.stringify(reviewSnapshot(doc, {})));
    const r = merge(snap.doc, [dc('d1', encodeComment('Sur V1', { v: v1, a: { kind: 'shot', shotId, col: 'value' } }))], { versionId: snap.versionId });
    expect(r.next.comments![0]).toMatchObject({ versionId: v1, anchor: { kind: 'shot', shotId, col: 'value' } });
  });
});
