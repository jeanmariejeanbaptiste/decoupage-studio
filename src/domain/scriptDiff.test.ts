import { describe, expect, it } from 'vitest';
import { countWordsOf, diffBlocks, edges, diffItems, diffScripts, tokenize, wordDiff, type Seg } from './scriptDiff';
import { blocksFromSource } from './screenplay';

const text = (segs: Seg[], op?: Seg['op']) => segs.filter((s) => !op || s.op === op).map((s) => s.text).join('');
/** Texte d'une version recomposé à partir des morceaux (avant : sans les ajouts ; après : sans les retraits). */
const side = (segs: Seg[], which: 'before' | 'after') => segs.filter((s) => s.op === 'eq' || s.op === (which === 'before' ? 'del' : 'add')).map((s) => s.text).join('');

const V1 = `Title: La Consigne

1. INT. GARE — HALL - JOUR

Le hall bruisse, les annonces se succèdent.

Léa traverse le hall en tirant une valise cabossée.

2. INT. GARE — CONSIGNE AUTOMATIQUE - JOUR

Léa pose la valise sur le comptoir.

GUICHETIER
C'est pour longtemps ?

LÉA
Je ne sais pas encore. Une nuit, peut-être deux.

3. EXT. PARVIS DE LA GARE - NUIT

Marc attend sous la pluie, une cigarette éteinte aux lèvres.

MARC
Tu l'as laissée ?

4. INT. BUREAU DES OBJETS TROUVÉS - JOUR

Une employée trie des parapluies oubliés, l'un après l'autre, sans lever les yeux.
`;

describe('mots', () => {
  it('découpe en mots et signes, l’espace suit le mot', () => {
    const t = tokenize('Léa, l’air las : « peut-être ».');
    expect(t.map((x) => x.core)).toEqual(['Léa', ',', 'l’air', 'las', ':', '«', 'peut-être', '»', '.']);
    expect(t.map((x) => x.text).join('')).toBe('Léa, l’air las : « peut-être ».');
    expect(countWordsOf('Léa, l’air las : « peut-être ».')).toBe(4);
  });

  it('un mot changé : barré puis souligné, le reste intact', () => {
    const d = wordDiff('Léa pose la valise sur le comptoir.', 'Léa pose la grosse valise sur le guichet.');
    expect(d.filter((s) => s.op === 'add').map((s) => s.text.trim())).toEqual(['grosse', 'guichet']);
    expect(d.filter((s) => s.op === 'del').map((s) => s.text.trim())).toEqual(['comptoir']);
    expect(side(d, 'before')).toBe('Léa pose la valise sur le comptoir.');
    expect(side(d, 'after')).toBe('Léa pose la grosse valise sur le guichet.');
  });

  it('un mot retiré garde son espace ; les bords ne se marquent pas', () => {
    const d = wordDiff('un deux trois', 'un trois');
    expect(d).toEqual([
      { op: 'eq', text: 'un ' },
      { op: 'del', text: 'deux ' },
      { op: 'eq', text: 'trois' },
    ]);
    expect(edges(' deux  ')).toEqual([' ', 'deux', '  ']);
  });

  it('les petits îlots inchangés entre deux changements sont fondus (lecture d’un seul tenant)', () => {
    const d = wordDiff('Il marche vite vers la gare du nord ce matin.', 'Elle court lentement vers la place du sud ce soir.');
    // « vers la » (deux mots) entre deux changements plus longs : fondu ; « du » aussi.
    const dels = d.filter((s) => s.op === 'del');
    expect(dels.length).toBeLessThanOrEqual(2);
    expect(side(d, 'before')).toBe('Il marche vite vers la gare du nord ce matin.');
    expect(side(d, 'after')).toBe('Elle court lentement vers la place du sud ce soir.');
  });

  it('un îlot long reste inchangé', () => {
    const d = wordDiff('Avant. Le hall bruisse, les annonces se succèdent sans fin. Après.', 'Plus tôt. Le hall bruisse, les annonces se succèdent sans fin. Ensuite.');
    expect(d.find((s) => s.op === 'eq' && s.text.includes('les annonces se succèdent'))).toBeTruthy();
  });

  it('textes identiques : un seul morceau', () => {
    expect(wordDiff('Même texte.', 'Même texte.')).toEqual([{ op: 'eq', text: 'Même texte.' }]);
  });

  it('texte vide d’un côté', () => {
    expect(wordDiff('', 'Nouveau.')).toEqual([{ op: 'add', text: 'Nouveau.' }]);
    expect(wordDiff('Ancien.', '')).toEqual([{ op: 'del', text: 'Ancien.' }]);
  });
});

describe('blocs', () => {
  const blocks = (src: string) => blocksFromSource(src).blocks;

  it('réplique insérée, action modifiée, personnage retiré', () => {
    const a = blocks('Léa pose la valise.\n\nGUICHETIER\nC’est pour longtemps ?\n\nMARC\nAlors ?');
    const b = blocks('Léa pose la grosse valise.\n\nGUICHETIER\nC’est pour longtemps ?\n\nLÉA\nUne nuit.');
    const d = diffBlocks(a, b);
    expect(d.slice(0, 3).map((x) => `${x.op}:${x.type}`)).toEqual(['mod:action', 'eq:character', 'eq:dialogue']);
    expect(text(d[0].segs, 'add').trim()).toBe('grosse');
    // MARC → LÉA : aucun mot commun, retiré puis ajouté.
    expect(d.slice(3).map((x) => x.op)).toEqual(['del', 'del', 'add', 'add']);
  });

  it('la casse d’un en-tête ou d’un personnage ne compte pas (ils s’impriment en capitales)', () => {
    const d = diffBlocks(blocks('@Léa\nBonjour.'), blocks('@LÉA\nBonjour.'));
    expect(d.every((x) => x.op === 'eq')).toBe(true);
  });

  it('les marques d’emphase et les notes ne sont pas des changements', () => {
    const d = diffScripts('INT. GARE - JOUR\n\nLéa attend.\n', 'INT. GARE - JOUR\n\nLéa **attend**.\n\n[[note de travail]]\n');
    expect(d.scenes[0].status).toBe('same');
    expect(d.changes).toEqual([]);
  });

  it('bloc déplacé à l’intérieur d’une séquence : retiré ici, ajouté là', () => {
    const d = diffBlocks(blocks('Un.\n\nDeux.\n\nTrois.'), blocks('Deux.\n\nTrois.\n\nUn.'));
    expect(d.map((x) => x.op)).toEqual(['del', 'eq', 'eq', 'add']);
  });
});

describe('séquences', () => {
  it('versions identiques : rien ne change, mesures égales', () => {
    const d = diffScripts(V1, V1);
    expect(d.scenes.every((s) => s.status === 'same')).toBe(true);
    expect(d.changes).toEqual([]);
    expect(d.stats).toMatchObject({ added: 0, removed: 0, changed: 0, moved: 0, wordsAdded: 0, wordsRemoved: 0 });
    expect(d.stats.before).toEqual(d.stats.after);
    expect(d.stats.after.scenes).toBe(4);
  });

  it('ajout, retrait, modification et déplacement', () => {
    const v2 = `Title: La Consigne

1. INT. GARE — HALL - JOUR

Le hall bruisse, les annonces se succèdent.

Léa traverse le hall en tirant une valise cabossée dont une roue grince.

2. INT. BUREAU DES OBJETS TROUVÉS - JOUR

Une employée trie des parapluies oubliés, l'un après l'autre, sans lever les yeux.

3. INT. TRAIN - JOUR

Un contrôleur remonte le couloir.

4. INT. GARE — CONSIGNE AUTOMATIQUE - JOUR

Léa pose la valise sur le comptoir.

GUICHETIER
C'est pour longtemps ?

LÉA
Je ne sais pas encore. Une nuit, peut-être deux.
`;
    const d = diffScripts(V1, v2);
    const brief = d.scenes.map((s) => `${s.status}:${s.before ?? '-'}>${s.after ?? '-'}`);
    expect(brief).toEqual(['changed:1>1', 'moved:4>2', 'added:->3', 'same:2>4', 'removed:3>-']);
    expect(d.stats).toMatchObject({ added: 1, removed: 1, changed: 1, moved: 1 });
    // Mots : « dont une roue grince » (4) + la séquence du train ; retirés : tout le parvis.
    expect(d.stats.wordsAdded).toBe(4 + 3 + 5);
    expect(d.stats.wordsRemoved).toBe(countWordsOf('EXT. PARVIS DE LA GARE - NUIT Marc attend sous la pluie, une cigarette éteinte aux lèvres. MARC Tu l\'as laissée ?'));
    expect(d.stats.before.scenes).toBe(4);
    expect(d.stats.after.scenes).toBe(4);
    // Un point de passage par changement : modification, déplacement, ajout, retrait.
    expect(d.changes.map((c) => c.scene)).toEqual([0, 1, 2, 4]);
    expect(d.scenes[0].blocks.map((b) => b.op)).toEqual(['eq', 'eq', 'mod']);
  });

  it('une renumérotation ou un en-tête retouché ne fait pas une nouvelle séquence', () => {
    const v2 = V1.replace('3. EXT. PARVIS DE LA GARE - NUIT', '3. EXT. PARVIS DE LA GARE DU NORD - NUIT').replace(/^(\d)\. /gm, '$1A. ');
    const d = diffScripts(V1, v2);
    expect(d.scenes.map((s) => s.status)).toEqual(['same', 'same', 'changed', 'same']);
    const head = d.scenes[2].blocks[0];
    expect(head.op).toBe('mod');
    expect(text(head.segs, 'add').trim()).toBe('DU NORD');
  });

  it('le texte avant la première séquence est comparé à part', () => {
    const d = diffScripts('FONDU ENCHAÎNÉ :\n\nINT. GARE - JOUR\n\nLéa.', 'Noir.\n\nINT. GARE - JOUR\n\nLéa.');
    expect(d.scenes[0].prelude).toBe(true);
    expect(d.scenes[0].status).toBe('changed');
    expect(d.stats.changed).toBe(0);
    expect(d.scenes[1].status).toBe('same');
  });

  it('versions vides ou sans séquence', () => {
    expect(diffScripts('', '').scenes).toEqual([]);
    const d = diffScripts('', V1);
    expect(d.stats.added).toBe(4);
    expect(d.scenes.filter((s) => !s.prelude).every((s) => s.status === 'added')).toBe(true);
    expect(diffScripts(V1, '').stats.removed).toBe(4);
  });

  it('les séquences retirées s’affichent à leur place d’origine', () => {
    const v2 = V1.replace(/2\. INT\. GARE — CONSIGNE[\s\S]*?(?=3\. EXT)/, '');
    const d = diffScripts(V1, v2);
    expect(d.scenes.map((s) => `${s.status}:${s.before ?? '-'}>${s.after ?? '-'}`)).toEqual(['same:1>1', 'removed:2>-', 'same:3>2', 'same:4>3']);
  });

  it('pages et durée : celles du minutage du projet', () => {
    const d = diffScripts(V1, V1 + '\n5. EXT. QUAI - NUIT\n\n' + 'Un train passe. '.repeat(400) + '\n', { method: 'pages', pageSec: 60 });
    expect(d.stats.after.pages).toBeGreaterThan(d.stats.before.pages);
    expect(d.stats.after.seconds).toBeGreaterThan(d.stats.before.seconds);
    const c = diffScripts(V1, V1, { method: 'characters', chars: 1000, charsSec: 60 });
    expect(c.stats.after.seconds).toBeGreaterThan(0);
  });
});

describe('seulement les changements', () => {
  it('les séquences identiques qui se suivent se replient en une ligne', () => {
    const v2 = V1.replace('sans lever les yeux', 'sans un regard');
    const d = diffScripts(V1, v2);
    const items = diffItems(d, true);
    expect(items).toEqual([
      { kind: 'fold', scenes: [0, 1, 2], from: 1, to: 3 },
      { kind: 'scene', index: 3 },
    ]);
    expect(diffItems(d, false)).toHaveLength(4);
  });
});

/** Scénario long : `n` séquences d'environ une page chacune. */
function longScript(n: number, twist = (_k: number, s: string) => s): string {
  const lieux = ['GARE', 'QUAI', 'TRAIN', 'BUREAU', 'PARVIS', 'CAFÉ', 'HÔTEL', 'RUE'];
  const out: string[] = ['Title: Long'];
  for (let k = 0; k < n; k++) {
    const body = [
      `INT. ${lieux[k % lieux.length]} ${k} - ${k % 2 ? 'NUIT' : 'JOUR'}`,
      `Séquence ${k} : ${'Léa marche le long du quai, regarde les trains partir un à un et compte les wagons. '.repeat(3)}`,
      'MARC',
      `Il faut qu'on parle de la valise numéro ${k}, celle de la consigne automatique.`,
      'LÉA',
      '(sans le regarder)',
      `Plus tard. ${'Elle est en sécurité pour l’instant, je te le promets. '.repeat(2)}`,
      `${'Un temps. La pluie redouble sur la verrière, les annonces se succèdent sans relâche. '.repeat(4)}`,
      'MARC',
      `D'accord, mais demain matin, à la première heure, nous irons la chercher ensemble, ${k}.`,
    ].join('\n\n');
    out.push(twist(k, body));
  }
  return out.join('\n\n') + '\n';
}

describe('performance', () => {
  it('scénario de 120 pages : comparaison en moins d’une seconde et demie', () => {
    const before = longScript(200);
    const after = longScript(200, (k, s) => (k % 7 === 0 ? s.replace('regarde les trains', 'observe les trains') : k % 11 === 0 ? `${s}\n\nUne ligne de plus pour la ${k}.` : s));
    const t0 = performance.now();
    const d = diffScripts(before, after);
    const ms = performance.now() - t0;
    expect(d.stats.before.pages).toBeGreaterThanOrEqual(120);
    expect(d.stats.changed).toBe(new Set([...Array(200).keys()].filter((k) => k % 7 === 0 || k % 11 === 0)).size);
    expect(ms).toBeLessThan(1500);
  });
});
