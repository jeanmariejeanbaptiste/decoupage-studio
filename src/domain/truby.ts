/**
 * Les vingt-deux étapes de John Truby (L'Anatomie du scénario), dans l'ordre du livre. Les étapes
 * clés (`key`) sont les sept qui portent la structure. Aucun ordre n'est imposé au séquencier :
 * plusieurs séquences peuvent avoir la même étape, et une étape peut manquer.
 */
export interface TrubyStep {
  n: number;
  label: string;
  key: boolean;
}

const KEYS = new Set([3, 5, 7, 10, 19, 20, 22]);

const LABELS = [
  'Révélation de soi, besoin et désir',
  'Fantôme et monde de l’histoire',
  'Faiblesse et besoin',
  'Événement déclencheur',
  'Désir',
  'Allié(s)',
  'Opposant et/ou mystère',
  'Faux allié opposant',
  'Première révélation et décision',
  'Plan',
  'Plan et contre-attaque de l’opposant',
  'Élan',
  'Attaque de l’allié',
  'Défaite apparente',
  'Deuxième révélation et décision',
  'Révélation au public',
  'Troisième révélation et décision',
  'Porte, épreuve, visite de la mort',
  'Bataille',
  'Révélation de soi',
  'Décision morale',
  'Nouvel équilibre',
];

export const TRUBY_STEPS: ReadonlyArray<TrubyStep> = LABELS.map((label, i) => ({ n: i + 1, label, key: KEYS.has(i + 1) }));

/** Libellé d'une étape (numéro ou texte de la note) ; une valeur inconnue est rendue telle quelle. */
export function stepLabel(v: number | string): string {
  const n = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return TRUBY_STEPS.find((s) => s.n === n)?.label ?? String(v);
}
