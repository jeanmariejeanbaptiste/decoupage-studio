import { sequenceCharacterIds } from './characters';
import { aggregateEquipment } from './equipment';
import { displayName } from './fountain';
import { addCharacter } from './ops';
import { escapeRegExp, fold } from './text';
import type { Character, ID, ProjectDoc, Sequence, Shot } from './types';

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

type BaseCategory = (typeof BREAKDOWN_CATEGORIES)[number];
/** Catégorie de base, ou catégorie ajoutée (clé `perso:Libellé`). */
export type BreakdownCategory = BaseCategory | (string & {});
export type SequenceBreakdown = Partial<Record<BreakdownCategory, string[]>>;

const CUSTOM = 'perso:';

/** Catégories du projet : celles de base, puis les catégories ajoutées. */
export function breakdownCategories(doc: ProjectDoc): BreakdownCategory[] {
  return [...BREAKDOWN_CATEGORIES, ...(doc.breakdownExtra ?? []).map((l) => CUSTOM + l)];
}

export function breakdownLabel(cat: BreakdownCategory): string {
  return cat.startsWith(CUSTOM) ? cat.slice(CUSTOM.length) : (BREAKDOWN_LABELS[cat as BaseCategory] ?? cat);
}

export function isCustomCategory(cat: BreakdownCategory): boolean {
  return cat.startsWith(CUSTOM);
}

export const BREAKDOWN_LABELS: Readonly<Record<BaseCategory, string>> = {
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
const LEXICON: Partial<Record<BaseCategory, Record<string, string[]>>> = {
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

/** Expressions trompeuses retirées avant la détection (« en train de », « feu rouge »…). */
const STOP_PHRASES = [/en train de/g, /feux? (rouges?|verts?|orange)/g, /mettre le feu|prendre feu/g, /au cafe\b/g, /au lit\b/g];
/** Mots ambigus (verbes ou sens courant) : retenus seulement après un déterminant (« un livre », « le lit »). */
const AMBIGUOUS = new Set(['lit', 'livre', 'train', 'cafe', 'feu', 'verre', 'banc', 'bus', 'auto', 'sac', 'cle', 'pleure', 'larme', 'vent', 'photo']);
const DETERMINER = "(?:le|la|les|l'|un|une|des|du|de la|sa|son|ses|mon|ma|mes|ton|ta|tes|notre|votre|leur|leurs|ce|cet|cette|ces)";

/** Termes détectés dans un texte, par catégorie. */
export function detectInText(text: string): Partial<Record<BreakdownCategory, string[]>> {
  let t = ` ${fold(text).replace(/[^a-z0-9' ]+/g, ' ')} `;
  for (const re of STOP_PHRASES) t = t.replace(re, ' ');
  const out: Partial<Record<BreakdownCategory, string[]>> = {};
  for (const [cat, dict] of Object.entries(LEXICON) as Array<[BreakdownCategory, Record<string, string[]>]>) {
    for (const [canon, forms] of Object.entries(dict)) {
      const hit = forms.some((f) => {
        const word = `${escapeRegExp(f)}(s|x)?[ ']`;
        return AMBIGUOUS.has(f) ? new RegExp(`[ ']${DETERMINER} ?${word}`).test(t) : new RegExp(`[ ']${word}`).test(t);
      });
      if (hit) (out[cat] ??= []).push(canon);
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
  // Déduit des plans, ou ajouté aux listes de matériel pour des plans de la séquence ; pas ce qui vient
  // déjà du dépouillement (compté une fois).
  const own = (cat: BreakdownCategory) => new Set((doc.breakdown?.[seqId]?.[cat] ?? []).map(fold));
  const pick = (c: 'Machinerie' | 'Lumière' | 'Son', cat: BreakdownCategory) => eq[c].filter((l) => !l.fromBreakdown && !own(cat).has(fold(l.label)) && l.shotIds.some((id) => shotIds.has(id))).map((l) => l.label);
  return {
    personnages: chars.filter((c) => c.kind !== 'figurant' && c.kind !== 'silhouette').map((c) => c.name),
    figurants: chars.filter((c) => c.kind === 'figurant' || c.kind === 'silhouette').map((c) => c.name),
    machinerie: pick('Machinerie', 'machinerie'),
    lumiere: pick('Lumière', 'lumiere'),
    son: pick('Son', 'son'),
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

/**
 * Personnages et figurants ne sont pas du texte libre : ils renvoient aux fiches du projet
 * (doc.characters) et à la séquence (characterIds). Renommages, fusions, plan de travail et feuille
 * de service suivent ainsi ce qu'on saisit au dépouillement.
 */
export const isCharacterCategory = (cat: BreakdownCategory): boolean => cat === 'personnages' || cat === 'figurants';

const named = (c: Character, key: string) => [c.name, ...(c.aliases ?? [])].some((n) => fold(n) === key);

/** Fiche d'un nom saisi au dépouillement : nom ou alias existant, sinon une fiche neuve. */
export function characterForName(doc: ProjectDoc, raw: string, cat: BreakdownCategory): ID | undefined {
  const name = raw.trim();
  if (!name) return undefined;
  const found = Object.values(doc.characters).find((c) => named(c, fold(name)));
  if (found) return found.id;
  // « MARC » (repris d'une réplique) devient « Marc », comme à l'import du scénario.
  const display = name === name.toLocaleUpperCase('fr') ? displayName(name) : name;
  return addCharacter(doc, { name: display, kind: cat === 'figurants' ? 'figurant' : 'secondaire' });
}

/** Personnages que nomment les plans d'une séquence (d'après une copie quelconque : projet ou version rangée). */
const fromShots = (seq: Sequence, shots: Record<ID, Shot>) => new Set(seq.shotIds.flatMap((id) => shots[id]?.characterIds ?? []));

/**
 * Personnages et figurants ajoutés à la séquence (au dépouillement), hors ceux que
 * nomment ses plans : ceux-là se retirent depuis le dépouillement.
 */
export function addedCharacters(doc: ProjectDoc, seqId: ID): Partial<Record<BreakdownCategory, string[]>> {
  const seq = doc.sequences[seqId];
  if (!seq) return {};
  const shots = fromShots(seq, doc.shots);
  const chars = seq.characterIds.filter((id) => !shots.has(id)).map((id) => doc.characters[id]).filter(Boolean);
  const extra = (c: Character) => c.kind === 'figurant' || c.kind === 'silhouette';
  return { personnages: chars.filter((c) => !extra(c)).map((c) => c.name), figurants: chars.filter(extra).map((c) => c.name) };
}

export function addBreakdownItems(doc: ProjectDoc, seqId: ID, cat: BreakdownCategory, items: readonly string[]): void {
  if (isCharacterCategory(cat)) {
    const seq = doc.sequences[seqId];
    if (!seq) return;
    for (const raw of items) {
      const id = characterForName(doc, raw, cat);
      if (id && !sequenceCharacterIds(doc, seqId).includes(id)) seq.characterIds.push(id);
    }
    return;
  }
  doc.breakdown ??= {};
  const b = (doc.breakdown[seqId] ??= {});
  const list = (b[cat] ??= []);
  for (const raw of items) {
    const item = raw.trim();
    if (item && !list.some((x) => fold(x) === fold(item))) list.push(item);
  }
}

export function removeBreakdownItem(doc: ProjectDoc, seqId: ID, cat: BreakdownCategory, item: string): void {
  const seq = doc.sequences[seqId];
  // Un personnage se retire de la séquence (pas de ses plans, qui le nomment dans leur sujet).
  if (isCharacterCategory(cat) && seq) seq.characterIds = seq.characterIds.filter((id) => !doc.characters[id] || !named(doc.characters[id], fold(item)));
  const list = doc.breakdown?.[seqId]?.[cat];
  if (list) doc.breakdown![seqId][cat] = list.filter((x) => x !== item);
}

/**
 * Projets d'avant le lien aux fiches : les noms rangés en texte dans les catégories Personnages et
 * Figurants deviennent des fiches (existantes ou neuves) rattachées à la séquence, dans chaque
 * version qui la garde.
 */
export function migrateBreakdownCharacters(doc: ProjectDoc): void {
  for (const [seqId, b] of Object.entries(doc.breakdown ?? {})) {
    for (const cat of ['personnages', 'figurants'] as const) {
      const list = b?.[cat];
      if (!list?.length) continue;
      const copies: Array<[Sequence, Record<ID, Shot>]> = [];
      if (doc.sequences[seqId]) copies.push([doc.sequences[seqId], doc.shots]);
      for (const v of doc.versions ?? []) if (v.slice?.sequences[seqId]) copies.push([v.slice.sequences[seqId], v.slice.shots]);
      if (!copies.length) continue;
      for (const name of list) {
        const id = characterForName(doc, name, cat);
        if (!id) continue;
        for (const [q, shots] of copies) {
          q.characterIds ??= [];
          if (!q.characterIds.includes(id) && !fromShots(q, shots).has(id)) q.characterIds.push(id);
        }
      }
      delete b[cat];
    }
  }
}
