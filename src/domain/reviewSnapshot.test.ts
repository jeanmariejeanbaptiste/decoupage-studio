import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildFiction } from '../../seed/fiction';
import { addComment, shownComments } from './comments';
import { parseReviewSnapshot, reviewMediaKeys, reviewSnapshot, withComments } from './reviewSnapshot';
import type { ProjectDoc } from './types';
import { createVersion, ensureVersions } from './versions';

/** Projet de démonstration chargé de tout ce qui ne doit jamais sortir. */
function privateDoc(): ProjectDoc {
  return produce(buildFiction(), (d) => {
    ensureVersions(d);
    const decor = Object.values(d.decors)[0];
    decor.location = { address: '12 rue Secrète, Paris', contact: 'Régisseur 06 00 00 00 00', access: 'Badge', name: 'Lycée Voltaire' };
    decor.notes = 'Note de repérage';
    const lea = Object.values(d.characters)[0];
    lea.actor = 'Alice Martin';
    lea.notes = 'Agent : 01 23 45 67 89';
    lea.costume = 'Manteau rouge';
    d.research = { synopsis: 'Synopsis confidentiel', docs: [{ id: 'r1', title: 'Doc', text: 'Recherche confidentielle' }] };
    d.calendar = [{ id: 'c1', title: 'Rendez-vous banque', start: '2026-11-10T10:00:00Z' } as never];
    d.schedule = { days: [{ id: 'j1', date: '2026-11-20', seqIds: [] }] } as never;
    d.clearedScenarios = [{ id: 'x', at: '2026-01-01', versionId: 'v', text: 'Ancien texte effacé' } as never];
    d.breakdown = { [d.project.sequenceIds[0]]: { items: [{ id: 'b', cat: 'Accessoires', label: 'Pistolet secret' }] } } as never;
    d.floorPlans = { [d.project.sequenceIds[0]]: { items: [], bg: { blobKey: 'p:plan-sol' } } } as never;
    d.project.settings.audioTrack = { name: 'Morceau inédit.mp3', durationSec: 180, blobKey: 'p:audio' };
    d.project.dop = 'Chef op privé';
    const sh = Object.values(d.shots)[0];
    sh.storyboard = { blobKey: 'p:story', baseKey: 'p:base', sketch: [] };
  });
}

describe('instantané de relecture', () => {
  it('rien de privé ne sort : lieux, contacts, préparation, note d’intention, piste, dessins modifiables', () => {
    const doc = privateDoc();
    const snap = reviewSnapshot(doc, { 'p:story': { type: 'image/jpeg', data: 'AAA' }, 'p:base': { type: 'image/jpeg', data: 'BBB' }, 'p:audio': { type: 'audio/mpeg', data: 'CCC' } }, '2026-11-09T10:00:00Z');
    const text = JSON.stringify(snap);
    for (const secret of ['12 rue Secrète', 'Régisseur', 'Lycée Voltaire', 'Note de repérage', 'Alice Martin', 'Agent :', 'Manteau rouge', 'Synopsis confidentiel', 'Recherche confidentielle', 'Rendez-vous banque', '2026-11-20', 'Ancien texte effacé', 'Pistolet secret', 'p:plan-sol', 'Morceau inédit', 'p:audio', 'p:base', 'Chef op privé', 'Une gare, une valise, une décision'])
      expect(text, secret).not.toContain(secret);
    expect(snap.doc.intentionHtml).toBeUndefined();
    expect(snap.doc.schedule).toBeUndefined();
    expect(snap.doc.review).toBeUndefined();
    // Ce qui sert à relire est là.
    expect(snap.doc.scenario).toBe(doc.scenario);
    expect(Object.keys(snap.doc.shots)).toEqual(Object.keys(doc.shots));
    expect(Object.values(snap.doc.characters).map((c) => c.name)).toEqual(Object.values(doc.characters).map((c) => c.name));
    expect(Object.values(snap.doc.decors).map((c) => c.name)).toEqual(Object.values(doc.decors).map((c) => c.name));
    expect(snap.doc.project.settings.gridColumns).toEqual(doc.project.settings.gridColumns);
    expect(snap.doc.project.settings.audioTrack).toEqual({ name: '', durationSec: 180 });
    expect(snap.media).toEqual({ 'p:story': { type: 'image/jpeg', data: 'AAA' } });
    expect(snap.versionId).toBe(doc.activeVersionId);
  });

  it('la version publiée seule : les précédentes réduites à leur texte, les suivantes absentes', () => {
    let doc = privateDoc();
    const v1 = doc.activeVersionId!;
    doc = produce(doc, (d) => {
      const shotId = Object.keys(d.shots)[0];
      addComment(d, { kind: 'shot', shotId, col: 'value' }, 'Nina', 'En V1');
      createVersion(d);
      d.scenario = `${d.scenario}\nINT. AJOUT V2 - JOUR\n`;
    });
    const v2 = doc.activeVersionId!;
    // V3 créée puis l'auteur revient à V2 : V3 et ses commentaires ne partent pas.
    doc = produce(doc, (d) => {
      createVersion(d);
      d.scenario = `${d.scenario}\nINT. BROUILLON V3 - NUIT\n`;
      addComment(d, { kind: 'script', start: 0, end: 5, quote: 'Title' }, 'Moi', 'Note sur la V3');
    });
    const v3 = doc.activeVersionId!;
    doc = produce(doc, (d) => {
      const v2s = d.versions!.find((v) => v.id === v2)!;
      // switchVersion sans dépendre de l'interface
      const cur = d.versions!.find((v) => v.id === v3)!;
      cur.slice = { scenario: d.scenario, sequenceIds: d.project.sequenceIds, sequences: d.sequences, shots: d.shots, blocks: d.blocks };
      d.scenario = v2s.slice!.scenario;
      v2s.slice = undefined;
      d.activeVersionId = v2;
    });
    const snap = reviewSnapshot(doc, {});
    expect(snap.doc.versions!.map((v) => v.id)).toEqual([v1, v2]);
    expect(snap.doc.versions![0].slice).toEqual({ scenario: expect.stringContaining('INT. GARE'), sequenceIds: [], sequences: {}, shots: {}, blocks: {} });
    expect(snap.doc.versions![1].slice).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain('BROUILLON V3');
    expect(snap.doc.comments!.map((c) => c.text)).toEqual(['En V1']);
    // Le commentaire de V1 se reprend en V2 chez le relecteur.
    const read = parseReviewSnapshot(JSON.stringify(snap));
    expect(shownComments(read.doc).map((x) => [x.c.text, x.from])).toEqual([['En V1', v1]]);
  });

  it('commentaires remis à jour sans toucher au texte publié ; passages recalés sur le texte publié', () => {
    let doc = privateDoc();
    const src = doc.scenario!;
    const at = src.indexOf('valise cabossée');
    doc = produce(doc, (d) => void addComment(d, { kind: 'script', start: at, end: at + 15, quote: 'valise cabossée' }, 'Nina', 'Quelle valise ?'));
    const snap = reviewSnapshot(doc, {});
    // L'auteur continue d'écrire la version publiée : le brouillon ne part pas, le passage reste juste.
    const draft = produce(doc, (d) => {
      d.scenario = `BROUILLON EN TÊTE\n${d.scenario}`;
      const a = d.comments![0].anchor as { start: number; end: number };
      a.start += 18;
      a.end += 18;
      d.comments![0].replies.push({ id: 'r1', author: 'Moi', text: 'Oui, on change.', at: '2026-11-09T11:00:00Z', attachments: ['p:reply-img'] });
    });
    const next = withComments(snap, draft, { 'p:reply-img': { type: 'image/png', data: 'RRR' } });
    expect(JSON.stringify(next)).not.toContain('BROUILLON');
    expect(next.doc.scenario).toBe(src);
    const a = next.doc.comments![0].anchor as { start: number; end: number };
    expect(src.slice(a.start, a.end)).toBe('valise cabossée');
    expect(next.doc.comments![0].replies[0].text).toBe('Oui, on change.');
    expect(next.media['p:reply-img']).toEqual({ type: 'image/png', data: 'RRR' });
    expect(reviewMediaKeys(next.doc)).toContain('p:reply-img');
  });

  it('lecture : format vérifié, médias filtrés, commentaires abîmés écartés', () => {
    const snap = reviewSnapshot(privateDoc(), { 'p:story': { type: 'image/jpeg', data: 'AAA' } });
    const raw = JSON.parse(JSON.stringify(snap)) as Record<string, unknown> & { doc: ProjectDoc; media: Record<string, unknown> };
    raw.media.evil = { type: 'text/html', data: 'PHNjcmlwdD4=' };
    raw.doc.comments = [{ id: 'ok', anchor: { kind: 'sequence', seqId: 'x' }, author: 'A', text: 'T', at: '', replies: [null] }, null, { id: 3 }] as never;
    raw.doc.review = { fileId: 'x' } as never;
    const read = parseReviewSnapshot(JSON.stringify(raw));
    expect(Object.keys(read.media)).toEqual(['p:story']);
    expect(read.doc.comments).toHaveLength(1);
    expect(read.doc.comments![0].replies).toEqual([]);
    expect(read.doc.review).toBeUndefined();
    expect(() => parseReviewSnapshot('{"format":"decoupage-studio"}')).toThrow('Ce lien ne mène pas à une relecture.');
    expect(() => parseReviewSnapshot('pas du json')).toThrow();
    expect(() => parseReviewSnapshot(JSON.stringify({ ...raw, schemaVersion: 99 }))).toThrow('plus récente');
  });
});
