import { addCharacter, addShot, addSequence } from '../src/domain/ops';
import { createProjectDoc, newId } from '../src/domain/factory';
import { parseRange } from '../src/domain/timecode';
import { parseTokens } from '../src/domain/tokens';
import type { CharacterKind, ColumnKey, Effect, IntExt, ProjectDoc, ProjectFormat, ProjectSettings, ShotStatus } from '../src/domain/types';

export interface SeedShot {
  s: string;
  v: string;
  a: string;
  m: string;
  f?: number | [number, number];
  brk?: ColumnKey[];
  status?: ShotStatus;
  sound?: string;
}

export interface SeedAction {
  /** Plans couverts, 1-based inclusifs. */
  shots: [number, number];
  text: string;
  dialogue?: string;
  tc?: string;
}

export interface SeedSequence {
  label: string;
  intExt?: IntExt;
  effect?: Effect;
  est?: number;
  summary?: string;
  shots: SeedShot[];
  actions: SeedAction[];
}

export interface SeedProject {
  id: string;
  title: string;
  format: ProjectFormat;
  version: string;
  director?: string;
  dop?: string;
  settings?: Partial<ProjectSettings>;
  characters: Array<{ name: string; kind: CharacterKind; aliases?: string[]; color?: string; actor?: string }>;
  sequences: SeedSequence[];
}

export function buildSeed(spec: SeedProject): ProjectDoc {
  const doc = createProjectDoc({ title: spec.title, format: spec.format, id: spec.id, director: spec.director, dop: spec.dop });
  doc.project.version = spec.version;
  Object.assign(doc.project.settings, spec.settings ?? {});
  for (const c of spec.characters) addCharacter(doc, c);
  for (const seqSpec of spec.sequences) {
    const decorId = newId();
    doc.decors[decorId] = { id: decorId, name: seqSpec.label, intExt: seqSpec.intExt };
    const seqId = addSequence(
      doc,
      undefined,
      { label: seqSpec.label, decorId, intExt: seqSpec.intExt, effect: seqSpec.effect, estimatedSec: seqSpec.est, summary: seqSpec.summary },
      false,
    );
    for (const action of seqSpec.actions) {
      let blockId: string | undefined;
      for (let n = action.shots[0]; n <= action.shots[1]; n++) {
        const sh = seqSpec.shots[n - 1];
        if (!sh) throw new Error(`Seed : plan ${n} absent de ${seqSpec.label}`);
        const angle = sh.a === '-' ? ['-'] : parseTokens(sh.a).tokens;
        const mv = parseTokens(sh.m);
        const focal = sh.f === undefined ? {} : Array.isArray(sh.f) ? { from: sh.f[0], to: sh.f[1] } : { from: sh.f };
        const shotId = addShot(doc, seqId, {
          blockId,
          action: { text: action.text, dialogue: action.dialogue, tc: action.tc ? (parseRange(action.tc) ?? undefined) : undefined },
          init: {
            subject: sh.s,
            value: sh.v,
            angle,
            movement: mv.tokens,
            movementSep: mv.sep,
            focal,
            mergeBreak: sh.brk,
            status: sh.status ?? 'à tourner',
            sound: sh.sound,
          },
        });
        blockId = doc.shots[shotId].actionBlockId;
      }
    }
  }
  return doc;
}
