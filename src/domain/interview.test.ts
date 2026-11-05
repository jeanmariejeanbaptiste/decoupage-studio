import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addInterviewee, ensureInterview, moveQuestion, questionsFor, removeInterviewee } from './interview';

describe('interview institutionnelle', () => {
  it('un intervenant par défaut, deux caméras, regards alternés', () => {
    const doc = createProjectDoc({ title: 't', format: 'institutionnel' });
    const itw = ensureInterview(doc);
    expect(itw.subjects).toHaveLength(1);
    expect(itw.subjects[0].setups[0].cameras.map((c) => c.name)).toEqual(['A', 'B']);
    addInterviewee(doc);
    expect(itw.subjects[1].setups[0].eyeline).not.toBe(itw.subjects[0].setups[0].eyeline);
  });
  it('questions communes et propres, ordre modifiable', () => {
    const doc = createProjectDoc({ title: 't', format: 'institutionnel' });
    const itw = ensureInterview(doc);
    const b = addInterviewee(doc);
    const a = itw.subjects[0].id;
    itw.questions.push({ id: '1', text: 'Commune' }, { id: '2', text: 'Pour B', subjectId: b }, { id: '3', text: 'Pour A', subjectId: a });
    expect(questionsFor(itw, a).map((q) => q.text)).toEqual(['Commune', 'Pour A']);
    moveQuestion(itw, a, '3', -1);
    expect(questionsFor(itw, a).map((q) => q.text)).toEqual(['Pour A', 'Commune']);
    removeInterviewee(doc, b);
    expect(itw.questions.map((q) => q.id)).not.toContain('2');
  });
  it('plusieurs cadres pour une même personne, questions propres à un cadre', async () => {
    const { addSetup, removeSetup } = await import('./interview');
    const doc = createProjectDoc({ title: 't', format: 'institutionnel' });
    const itw = ensureInterview(doc);
    const s = itw.subjects[0];
    const second = addSetup(doc, s.id)!;
    expect(s.setups).toHaveLength(2);
    expect(s.setups[1].cameras[0].id).not.toBe(s.setups[0].cameras[0].id);
    itw.questions.push({ id: 'q', text: 'Atelier', subjectId: s.id, setupId: second });
    expect(questionsFor(itw, s.id, s.setups[0].id)).toHaveLength(0);
    expect(questionsFor(itw, s.id, second)).toHaveLength(1);
    removeSetup(doc, s.id, second);
    expect(itw.questions).toHaveLength(0);
  });
});
