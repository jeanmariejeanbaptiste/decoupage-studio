import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SBlock } from '../../domain/screenplay';
import { characterReports, locationReports, matchesName, renameCharacter, renameDecor, sceneReports, sidesOf, type SceneInfo } from '../../domain/scriptReports';
import { addCharacter } from '../../domain/ops';
// Arrondi à la seconde avant de découper (59,6 s font « 1:00 », jamais « 0:60 »).
import { mmss } from '../../domain/chronometry';
import { addDecor } from '../../domain/registry';
import { newId } from '../../domain/factory';
import { fold } from '../../domain/text';
import type { Character, Decor, FilmingLocation, ProjectDoc } from '../../domain/types';
import { decorLocation, setDecorLocation } from '../../domain/locations';
import { mutateDoc, useProjectStore } from '../../store/projectStore';
import { registerFlush } from '../../store/persistence';
import s from './ResearchPanels.module.css';

/** « LA MÈRE » → « La Mère » (nom d'une fiche créée depuis le texte). */
const titleCase = (s: string) => s.toLocaleLowerCase('fr').replace(/(^|[\s'’-])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('fr'));

/**
 * Champ saisi d'un trait, enregistré en quittant le champ (une seule étape d'annulation) — ou avant un
 * enregistrement, un changement de version, et quand il disparaît sans perdre le focus (panneau masqué
 * au clavier, page quittée par Précédent) : rien de ce qui est tapé ne se perd.
 */
function Field({ label, value, onCommit, multiline, readOnly, placeholder }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; readOnly?: boolean; placeholder?: string }) {
  const [draft, setDraftState] = useState(value);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
  };
  useEffect(() => {
    draftRef.current = value;
    setDraftState(value);
  }, [value]);
  const commit = useCallback(() => {
    if (readOnly || draftRef.current === valueRef.current) return;
    valueRef.current = draftRef.current;
    commitRef.current(draftRef.current);
  }, [readOnly]);
  useEffect(() => {
    // Le projet ouvert au montage : un brouillon ne doit jamais aller dans un autre projet.
    const project = useProjectStore.getState().doc?.project.id;
    const off = registerFlush(commit);
    return () => {
      off();
      if (useProjectStore.getState().doc?.project.id === project) commit();
    };
  }, [commit]);
  const common = {
    value: draft,
    readOnly,
    placeholder: readOnly ? '' : placeholder,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  return (
    <label className={s.field}>
      <span>{label}</span>
      {multiline ? <textarea rows={Math.max(3, Math.ceil(draft.length / 42))} {...common} /> : <input {...common} />}
    </label>
  );
}

function useScenes(doc: ProjectDoc, blocks: readonly SBlock[]): SceneInfo[] {
  const names = useMemo(() => Object.values(doc.characters).flatMap((c) => [c.name, ...(c.aliases ?? [])]), [doc.characters]);
  return useMemo(() => sceneReports(blocks, names, doc.project.settings.scriptChrono), [blocks, names, doc.project.settings.scriptChrono]);
}

// Par nom, ou par un ancien nom : une version figée écrit encore le nom d'avant un renommage.
const findCharacter = (doc: ProjectDoc, name: string): Character | undefined =>
  Object.values(doc.characters).find((c) => fold(c.name) === fold(name)) ?? Object.values(doc.characters).find((c) => matchesName(c, name));
const findDecor = (doc: ProjectDoc, name: string): Decor | undefined => Object.values(doc.decors).find((d) => fold(d.name) === fold(name)) ?? Object.values(doc.decors).find((d) => matchesName(d, name));

type Sort = 'first' | 'alpha' | 'replies' | 'scenes';

/** Personnages : tirés du texte, avec répliques, présence au fil du film et fiche. */
export function CharactersPanel({ doc, blocks, readOnly, onGo }: { doc: ProjectDoc; blocks: readonly SBlock[]; readOnly: boolean; onGo: (headingId: string) => void }) {
  const scenes = useScenes(doc, blocks);
  const [sort, setSort] = useState<Sort>('first');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const r = characterReports(scenes);
    if (sort === 'alpha') r.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (sort === 'replies') r.sort((a, b) => b.replies - a.replies);
    if (sort === 'scenes') r.sort((a, b) => b.total - a.total);
    return r;
  }, [scenes, sort]);
  if (!list.length) return <p className={s.empty}>Aucun personnage dans le texte.</p>;
  const edit = (name: string, patch: Partial<Character>) =>
    mutateDoc((d) => {
      const c = findCharacter(d, name) ?? d.characters[addCharacter(d, { name: titleCase(name), kind: 'secondaire' })];
      Object.assign(c, patch);
    });
  return (
    <div className={s.panel} data-testid="scenario-characters">
      <label className={s.sort}>
        <span>Trier</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier les personnages">
          <option value="first">par ordre d’apparition</option>
          <option value="alpha">par ordre alphabétique</option>
          <option value="replies">du plus au moins de répliques</option>
          <option value="scenes">du plus au moins de séquences</option>
        </select>
      </label>
      <ul className={s.list}>
        {list.map((c) => {
          const fiche = findCharacter(doc, c.name);
          const on = open === c.name;
          return (
            <li key={c.name} className={on ? s.open : ''}>
              <button type="button" className={s.row} aria-expanded={on} onClick={() => setOpen(on ? null : c.name)} data-testid="character-row">
                <span className={s.name}>{c.name}</span>
                <span className={s.meta}>
                  {c.replies} répl. · {c.total} séq.{c.silent ? ` (${c.silent} muette${c.silent > 1 ? 's' : ''})` : ''} · dès la séq. {c.first}
                </span>
                {/* Présence au fil du film : plein = parle, gris = présent sans parler. */}
                <span className={s.strip} aria-label={`Présence de ${c.name}`}>
                  {scenes.map((sc) => (
                    <i key={sc.n} className={sc.replies.get(c.name) ? s.speaks : sc.present.has(c.name) ? s.here : ''} title={`${sc.n}. ${sc.heading}`} />
                  ))}
                </span>
              </button>
              {on && (
                <div className={s.fiche}>
                  <Field
                    label="Nom"
                    value={c.name}
                    readOnly={readOnly}
                    onCommit={(v) => {
                      if (!v.trim()) return;
                      mutateDoc((d) => renameCharacter(d, c.name, v));
                      setOpen(v.trim().toLocaleUpperCase('fr'));
                    }}
                  />
                  <Field label="Interprète" value={fiche?.actor ?? ''} readOnly={readOnly} onCommit={(v) => edit(c.name, { actor: v.trim() || undefined })} />
                  <div className={s.two}>
                    <Field label="Âge" value={fiche?.age ?? ''} readOnly={readOnly} onCommit={(v) => edit(c.name, { age: v.trim() || undefined })} />
                    <Field label="Costume" value={fiche?.costume ?? ''} readOnly={readOnly} onCommit={(v) => edit(c.name, { costume: v.trim() || undefined })} />
                  </div>
                  <Field label="Description" multiline value={fiche?.notes ?? ''} readOnly={readOnly} placeholder="Fonction, situation, désir, besoin, arc, jeu…" onCommit={(v) => edit(c.name, { notes: v.trim() || undefined })} />
                  <Sides blocks={blocks} name={c.name} scenes={scenes} onGo={onGo} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Répliques d'un rôle, séquence par séquence. */
function Sides({ blocks, name, scenes, onGo }: { blocks: readonly SBlock[]; name: string; scenes: readonly SceneInfo[]; onGo: (id: string) => void }) {
  const sides = useMemo(() => sidesOf(blocks, name), [blocks, name]);
  if (!sides.length) return null;
  return (
    <div className={s.sides}>
      <p className={s.label}>Répliques</p>
      {sides.map((sc) => (
        <div key={sc.n}>
          <button type="button" className={s.sceneLink} onClick={() => scenes[sc.n - 1] && onGo(scenes[sc.n - 1].id)}>
            {sc.n}. {sc.heading}
          </button>
          {sc.lines.map((l, k) => (
            <p key={k} className={s.line}>
              {l.paren && <em>{l.paren} </em>}
              {l.text}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Décors : lieux des en-têtes, séquences regroupées, durée cumulée, fiche. */
export function DecorsPanel({ doc, blocks, readOnly, onGo }: { doc: ProjectDoc; blocks: readonly SBlock[]; readOnly: boolean; onGo: (headingId: string) => void }) {
  const scenes = useScenes(doc, blocks);
  const list = useMemo(() => locationReports(scenes), [scenes]);
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return <p className={s.empty}>Aucun décor dans le texte.</p>;
  const edit = (name: string, intExt: string, patch: Partial<Decor>) =>
    mutateDoc((d) => {
      const dec = findDecor(d, name) ?? d.decors[addDecor(d, { name, intExt: intExt === 'EXT' ? 'EXT' : intExt === 'INT/EXT' ? 'INT/EXT' : 'INT' })];
      Object.assign(dec, patch);
    });
  const editLocation = (name: string, intExt: string, patch: Partial<FilmingLocation>) =>
    mutateDoc((d) => {
      const dec = findDecor(d, name) ?? d.decors[addDecor(d, { name, intExt: intExt === 'EXT' ? 'EXT' : intExt === 'INT/EXT' ? 'INT/EXT' : 'INT' })];
      setDecorLocation(d, dec.id, patch);
    });
  return (
    <div className={s.panel} data-testid="scenario-decors">
      <ul className={s.list}>
        {list.map((l) => {
          const fiche = findDecor(doc, l.location);
          const on = open === l.location;
          return (
            <li key={l.location} className={on ? s.open : ''}>
              <button type="button" className={s.row} aria-expanded={on} onClick={() => setOpen(on ? null : l.location)} data-testid="decor-row">
                <span className={s.name}>{l.location || 'Lieu non précisé'}</span>
                <span className={s.meta}>
                  {[l.intExt.join('/'), l.effects.join(', ').toLocaleLowerCase('fr')].filter(Boolean).join(' · ')}
                  {' · '}
                  {l.scenes.length} séq. · {mmss(l.durationSec)}
                </span>
              </button>
              {on && (
                <div className={s.fiche}>
                  <Field
                    label="Nom du décor"
                    value={l.location}
                    readOnly={readOnly}
                    onCommit={(v) => {
                      if (!v.trim()) return;
                      mutateDoc((d) => renameDecor(d, l.location, v));
                      setOpen(v.trim().toLocaleUpperCase('fr'));
                    }}
                  />
                  <p className={s.scenes}>
                    {l.scenes.map((n) => (
                      <button key={n} type="button" className={s.sceneLink} onClick={() => scenes[n - 1] && onGo(scenes[n - 1].id)}>
                        {n}. {scenes[n - 1]?.heading}
                      </button>
                    ))}
                  </p>
                  <Field label="Adresse de tournage" value={decorLocation(fiche).address ?? ''} readOnly={readOnly} onCommit={(v) => editLocation(l.location, l.intExt[0] ?? '', { address: v })} />
                  <Field label="Description" multiline value={fiche?.notes ?? ''} readOnly={readOnly} placeholder="Surface, disposition, ambiance sonore, évolution, accessoires…" onCommit={(v) => edit(l.location, l.intExt[0] ?? '', { notes: v.trim() || undefined })} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Recherche : genre, logline, synopsis et documents libres du projet. */
export function ResearchPanel({ doc, readOnly }: { doc: ProjectDoc; readOnly: boolean }) {
  const r = doc.research ?? {};
  const set = (patch: Partial<NonNullable<ProjectDoc['research']>>) => mutateDoc((d) => void Object.assign((d.research ??= {}), patch));
  return (
    <div className={s.panel} data-testid="scenario-research">
      <div className={s.two}>
        <Field label="Genre" value={r.genre ?? ''} readOnly={readOnly} placeholder="Thriller psychologique" onCommit={(v) => set({ genre: v.trim() || undefined })} />
        <Field label="Année" value={r.year ?? ''} readOnly={readOnly} onCommit={(v) => set({ year: v.trim() || undefined })} />
      </div>
      <Field label="Logline" multiline value={r.logline ?? ''} readOnly={readOnly} placeholder="Le film en une phrase." onCommit={(v) => set({ logline: v.trim() || undefined })} />
      <Field label="Synopsis" multiline value={r.synopsis ?? ''} readOnly={readOnly} onCommit={(v) => set({ synopsis: v.trim() || undefined })} />
      <p className={s.label}>Documents</p>
      {(r.docs ?? []).map((d) => (
        <div key={d.id} className={s.doc}>
          <Field label="Titre" value={d.title} readOnly={readOnly} onCommit={(v) => mutateDoc((x) => void (x.research!.docs!.find((y) => y.id === d.id)!.title = v))} />
          <Field label="Texte" multiline value={d.text} readOnly={readOnly} placeholder="Références, repérages, liens, notes…" onCommit={(v) => mutateDoc((x) => void (x.research!.docs!.find((y) => y.id === d.id)!.text = v))} />
          {!readOnly && (
            <button type="button" className={s.ghost} onClick={() => mutateDoc((x) => void (x.research!.docs = x.research!.docs!.filter((y) => y.id !== d.id)))}>
              <Trash2 size={13} strokeWidth={1.4} /> Retirer
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className={s.ghost} onClick={() => mutateDoc((x) => void ((x.research ??= {}).docs ??= []).push({ id: newId(), title: 'Document', text: '' }))} data-testid="research-add-doc">
          <Plus size={13} strokeWidth={1.4} /> Document
        </button>
      )}
    </div>
  );
}
