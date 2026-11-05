import { describe, expect, it } from 'vitest';
import { createProjectDoc } from './factory';
import { addInterviewee, ensureInterview, moveQuestion, questionsFor, removeInterviewee } from './interview';

describe('interview institutionnelle', () => {
  it('un intervenant par défaut, deux caméras, regards alternés', () => {
    const doc = createProjectDoc({ title: 't', format: 'institutionnel' });
    const itw = ensureInterview(doc);
    expect(itw.subjects).toHaveLength(1);
    expect(itw.subjects[0].cameras.map((c) => c.name)).toEqual(['A', 'B']);
    addInterviewee(doc);
    expect(itw.subjects[1].eyeline).not.toBe(itw.subjects[0].eyeline);
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
});
