import { buildSeed, type SeedProject } from './builder';

/** Second projet de démonstration : fiction courte, minutage cumulatif automatique (§12). */
export const FICTION: SeedProject = {
  id: 'seed-fiction',
  title: 'La Consigne',
  format: 'fiction',
  version: 'V1',
  director: 'Réalisation',
  dop: 'Image',
  settings: { tcMode: 'cumulatif', tcGranularity: 'sequence' },
  characters: [
    { name: 'Léa', kind: 'principal', color: '#9C3D2B', actor: '' },
    { name: 'Marc', kind: 'principal', color: '#2E4263', actor: '' },
    { name: 'Guichetier', kind: 'secondaire', color: '#5E7B4C' },
  ],
  sequences: [
    {
      label: 'GARE — HALL',
      intExt: 'INT',
      effect: 'JOUR',
      est: 25,
      summary: 'Léa arrive à la consigne avec une valise trop lourde.',
      shots: [
        { s: 'Hall de gare', v: 'Général', a: 'Face, Plongée', m: 'Fixe', f: 24 },
        { s: 'Léa', v: 'Moyen', a: '3/4 Face, Hauteur regard', m: 'Trav arrière', f: 35 },
        { s: 'Léa', v: 'Rapproché', a: '3/4 Face, Hauteur regard', m: 'Trav arrière', f: 50 },
        { s: 'Valise', v: 'Insert', a: 'Profil gauche, Low angle', m: 'Suivi', f: 35 },
      ],
      actions: [
        { shots: [1, 1], text: 'Le hall bruisse, les annonces se succèdent.' },
        { shots: [2, 4], text: 'Léa traverse le hall en tirant une valise cabossée dont une roue grince à chaque pas.' },
      ],
    },
    {
      label: 'GARE — CONSIGNE',
      intExt: 'INT',
      effect: 'JOUR',
      est: 40,
      shots: [
        { s: 'Léa, Guichetier', v: 'Américain', a: 'Profil droit, Hauteur regard', m: 'Fixe', f: 35 },
        { s: 'Guichetier', v: 'Rapproché', a: '3/4 Face, Hauteur regard', m: 'Fixe', f: 85 },
        { s: 'Léa', v: 'Rapproché', a: '3/4 Face, Hauteur regard', m: 'Fixe', f: 85 },
        { s: 'Léa', v: 'Gros plan', a: 'Face, Hauteur regard', m: 'Zoom avant', f: [50, 85] },
      ],
      actions: [
        {
          shots: [1, 3],
          text: 'Léa pose la valise sur le comptoir.',
          dialogue:
            "GUICHETIER : C'est pour combien de temps ? LÉA : Je ne sais pas encore. Une nuit, peut-être deux. GUICHETIER : Alors on dira trois.",
        },
        { shots: [4, 4], text: 'Elle hésite, puis glisse le ticket dans sa poche intérieure.' },
      ],
    },
    {
      label: 'PARVIS DE LA GARE',
      intExt: 'EXT',
      effect: 'NUIT',
      est: 20,
      shots: [
        { s: 'Marc', v: 'Ensemble', a: 'Dos, Hauteur regard', m: 'Steadicam', f: 24 },
        { s: 'Léa, Marc', v: 'Moyen', a: 'Profil gauche, Hauteur regard', m: 'Trav latéral droit', f: 35 },
        { s: 'Marc', v: 'Gros plan', a: '3/4 Face, Contre-plongée', m: 'Fixe', f: 85 },
      ],
      actions: [
        { shots: [1, 1], text: 'Marc attend sous la pluie, une cigarette éteinte aux lèvres.' },
        { shots: [2, 3], text: 'Léa le rejoint.', dialogue: "MARC : Tu l'as laissée ? LÉA : Elle est en sécurité. Pour l'instant." },
      ],
    },
  ],
};

export const buildFiction = () => buildSeed(FICTION);
