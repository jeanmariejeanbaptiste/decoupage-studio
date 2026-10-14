import { sequenceCharacterIds } from './characters';
import { aggregateEquipment } from './equipment';
import { escapeRegExp, fold } from './text';
import type { ID, ProjectDoc } from './types';

export const BREAKDOWN_CATEGORIES = [
  'personnages',
  'figurants',
  'accessoires',
  'costumes',
  'maquillage',
  'effets',
  'vehicules',
  'machinerie',
  'lumiere',
  'son',
] as const;

export type BreakdownCategory = (typeof BREAKDOWN_CATEGORIES)[number];
export type SequenceBreakdown = Partial<Record<BreakdownCategory, string[]>>;

export const BREAKDOWN_LABELS: Readonly<Record<BreakdownCategory, string>> = {
  personnages: 'Personnages',
  figurants: 'Figurants',
  accessoires: 'Accessoires',
  costumes: 'Costumes',
  maquillage: 'Maquillage, coiffure',
  effets: 'Effets',
  vehicules: 'Véhicules',
  machinerie: 'Machinerie',
  lumiere: 'Lumière',
  son: 'Son',
};

/** Lexique de détection : terme canonique → formes reconnues (sans accents, pluriels admis). */
const LEXICON: Partial<Record<BreakdownCategory, Record<string, string[]>>> = {
  accessoires: {
    Affiche: ['affiche'],
    Valise: ['valise'],
    Ticket: ['ticket'],
    Piano: ['piano'],
    Lunettes: ['lunettes'],
    Bagues: ['bague'],
    Cigarette: ['cigarette'],
    Téléphone: ['telephone', 'portable', 'smartphone'],
    Verre: ['verre'],
    Livre: ['livre'],
    Clés: ['cle', 'clef', 'trousseau'],
    Sac: ['sac'],
    Lettre: ['lettre', 'enveloppe'],
    Journal: ['journal'],
    Photo: ['photo', 'photographie'],
    Bouquet: ['bouquet', 'fleurs'],
    Couteau: ['couteau'],
    Arme: ['arme', 'pistolet', 'revolver', 'fusil'],
    Ordinateur: ['ordinateur'],
    Tasse: ['tasse', 'cafe'],
    Bouteille: ['bouteille'],
    Parapluie: ['parapluie'],
    Micro: ['micro', 'microphone'],
    Guitare: ['guitare'],
    Carnet: ['carnet', 'cahier'],
    Comptoir: ['comptoir'],
    Banc: ['banc'],
    Lit: ['lit'],
    Miroir: ['miroir'],
  },
  costumes: {
    Robe: ['robe'],
    Manteau: ['manteau', 'imper', 'impermeable'],
    Chapeau: ['chapeau', 'casquette'],
    Veste: ['veste', 'blouson'],
    Costume: ['costume'],
    Uniforme: ['uniforme'],
    Écharpe: ['echarpe'],
    Chaussures: ['chaussure', 'talons'],
  },
  maquillage: {
    'Rouge à lèvres': ['rouge a levres'],
    Maquillage: ['maquille', 'maquillage', 'maquilleuse', 'cils'],
    Coiffure: ['coiffe', 'cheveux', 'perruque'],
    Larmes: ['larme', 'pleure'],
    Sang: ['sang', 'blessure', 'cicatrice'],
  },
  effets: {
    Pluie: ['pluie', 'pleut'],
    Neige: ['neige'],
    Fumée: ['fumee', 'brouillard'],
    Vent: ['vent'],
    'Lever de soleil': ['soleil se leve', 'lever du soleil', 'aube'],
    'Coucher de soleil': ['soleil se couche', 'coucher du soleil'],
    Feu: ['feu', 'flammes', 'incendie'],
  },
  vehicules: {
    Voiture: ['voiture', 'auto'],
    Taxi: ['taxi'],
    Moto: ['moto', 'scooter'],
    Vélo: ['velo', 'bicyclette'],
    Bus: ['bus', 'autobus'],
    Train: ['train', 'tgv'],
  },
};

/** Termes détectés dans un texte, par catégorie. */
export function detectInText(text: string): Partial<Record<BreakdownCategory, string[]>> {
  const t = ` ${fold(text).replace(/[^a-z0-9' ]+/g, ' ')} `;
  const out: Partial<Record<BreakdownCategory, string[]>> = {};
  for (const [cat, dict] of Object.entries(LEXICON) as Array<[BreakdownCategory, Record<string, string[]>]>) {
    for (const [canon, forms] of Object.entries(dict)) {
      if (forms.some((f) => new RegExp(`[ ']${escapeRegExp(f)}(s|x)?[ ']`).test(t))) (out[cat] ??= []).push(canon);
    }
  }
  return out;
}

export function breakdownOf(doc: ProjectDoc, seqId: ID): SequenceBreakdown {
  return doc.breakdown?.[seqId] ?? {};
}

/** Éléments déduits du découpage (non modifiables ici) : personnages, figurants, matériel. */
export function derivedBreakdown(doc: ProjectDoc, seqId: ID): Partial<Record<BreakdownCategory, string[]>> {
  const chars = sequenceCharacterIds(doc, seqId).map((id) => doc.characters[id]).filter(Boolean);
  const shotIds = new Set(doc.sequences[seqId]?.shotIds ?? []);
  const eq = aggregateEquipment(doc);
  const pick = (c: 'Machinerie' | 'Lumière' | 'Son') => eq[c].filter((l) => !l.manual && l.shotIds.some((id) => shotIds.has(id))).map((l) => l.label);
  return {
    personnages: chars.filter((c) => c.kind !== 'figurant' && c.kind !== 'silhouette').map((c) => c.name),
    figurants: chars.filter((c) => c.kind === 'figurant' || c.kind === 'silhouette').map((c) => c.name),
    machinerie: pick('Machinerie'),
    lumiere: pick('Lumière'),
    son: pick('Son'),
  };
}

/** Suggestions détectées dans les actions et dialogues de la séquence, absentes du dépouillement. */
export function breakdownSuggestions(doc: ProjectDoc, seqId: ID): Partial<Record<BreakdownCategory, string[]>> {
  const seq = doc.sequences[seqId];
  if (!seq) return {};
  const texts = seq.actionBlockIds.map((id) => `${doc.blocks[id]?.text ?? ''} ${doc.blocks[id]?.dialogue ?? ''}`);
  texts.push(...seq.shotIds.map((id) => doc.shots[id]?.subject ?? ''));
  const found = detectInText(texts.join(' . '));
  const current = breakdownOf(doc, seqId);
  const out: Partial<Record<BreakdownCategory, string[]>> = {};
  for (const [cat, items] of Object.entries(found) as Array<[BreakdownCategory, string[]]>) {
    const have = new Set((current[cat] ?? []).map(fold));
    const rest = items.filter((i) => !have.has(fold(i)));
    if (rest.length) out[cat] = rest;
  }
  return out;
}

export function addBreakdownItems(doc: ProjectDoc, seqId: ID, cat: BreakdownCategory, items: readonly string[]): void {
  doc.breakdown ??= {};
  const b = (doc.breakdown[seqId] ??= {});
  const list = (b[cat] ??= []);
  for (const raw of items) {
    const item = raw.trim();
    if (item && !list.some((x) => fold(x) === fold(item))) list.push(item);
  }
}

export function removeBreakdownItem(doc: ProjectDoc, seqId: ID, cat: BreakdownCategory, item: string): void {
  const list = doc.breakdown?.[seqId]?.[cat];
  if (list) doc.breakdown![seqId][cat] = list.filter((x) => x !== item);
}
