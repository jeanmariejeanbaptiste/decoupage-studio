import { describe, expect, it } from 'vitest';
import { composeSound, parseSound, replyMention } from './soundField';

describe('champ Son par morceaux', () => {
  it('lit et réécrit à l’identique', () => {
    const t = 'Son direct · Ambiance : le hall, étouffé · Rép. « Je ne sais pas encore » · Laisser durer le silence';
    const p = parseSound(t);
    expect(p).toEqual({ kinds: ['Son direct', 'Ambiance', 'Réplique'], ambiance: 'le hall, étouffé', replies: ['Rép. « Je ne sais pas encore »'], note: 'Laisser durer le silence' });
    expect(composeSound(p)).toBe(t);
  });
  it('garde un texte libre ancien en note, sans rien perdre', () => {
    const p = parseSound('Son direct, ambiance du hall, roue qui grince');
    expect(p.kinds).toEqual([]);
    expect(composeSound(p)).toBe('Son direct, ambiance du hall, roue qui grince');
  });
  it('une pastille sans détail s’écrit seule ; retirée, son détail part', () => {
    expect(composeSound({ kinds: ['Musique', 'Ambiance', 'Réplique'], ambiance: '', replies: [], note: '' })).toBe('Ambiance · Réplique · Musique');
    expect(composeSound({ kinds: ['Effets'], ambiance: 'pluie', replies: ['Rép. « x »'], note: '' })).toBe('Effets');
  });
  it('mention de réplique : le nom seulement si ce n’est pas le sujet', () => {
    expect(replyMention('Léa', 'Je ne sais pas encore.', 'Léa')).toBe('Rép. « Je ne sais pas encore. »');
    expect(replyMention('Guichetier', 'Alors on dira trois.', 'Léa')).toBe('Rép. GUICHETIER « Alors on dira trois. »');
  });
});
