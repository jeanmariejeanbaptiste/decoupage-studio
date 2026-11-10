import { describe, expect, it } from 'vitest';
import { fdxToFountain, parseFdx, scriptToFdx } from './fdx';
import { parseFountain } from './fountain';
import { carryOutline } from './outline';
import { blocksFromSource, parseTitlePage, serialize, setBlockType } from './screenplay';
import completFdx from './__fixtures__/kit/modele-complet.fdx?raw';
import completFountain from './__fixtures__/kit/modele-complet.fountain?raw';
import repliquesFdx from './__fixtures__/kit/repliques.fdx?raw';

const types = (src: string) => blocksFromSource(src).blocks.map((b) => b.type);

describe('Final Draft', () => {
  it('lit le type exact de chaque paragraphe du modèle', () => {
    const { paragraphs } = parseFdx(completFdx);
    expect(paragraphs).toHaveLength(403);
    expect(paragraphs[0]).toEqual({ type: 'heading', text: 'LOR. LOREM IPSUM DOLOR - ELIT' });
    expect(paragraphs.filter((p) => p.type === 'character')).toHaveLength(125);
  });

  it('donne le même scénario que l’export Fountain de KIT', () => {
    expect(types(fdxToFountain(completFdx))).toEqual(types(completFountain));
    const a = blocksFromSource(fdxToFountain(completFdx)).blocks.map((b) => b.text);
    const b = blocksFromSource(completFountain).blocks.map((b) => b.text);
    expect(a).toEqual(b);
  });

  it('garde les répliques sans personnage (« @ » seul en Fountain)', () => {
    const src = fdxToFountain(repliquesFdx);
    expect(src.startsWith('@\n')).toBe(true);
    expect(types(src)).toEqual(['dialogue', 'parenthetical', 'dialogue']);
    // Aucun personnage vide pour le reste de l'outil (séquences, registre).
    expect(parseFountain(src).some((e) => e.type === 'character')).toBe(false);
  });

  it('écrit puis relit le scénario sans perte (types, emphase, sauts de page, page de titre)', () => {
    const src = 'Title: La Consigne\nAuthor: Léa Martin\n\nINT. GARE - JOUR\n\nLéa entre, **essoufflée**.\n\nLÉA\n(bas)\nOn y va ?\n\n===\n\nEXT. QUAI - NUIT\n\n> FONDU AU NOIR.\n';
    const fdx = scriptToFdx(blocksFromSource(src).blocks);
    expect(fdx).toContain('<Paragraph Number="1" Type="Scene Heading"><Text>INT. GARE - JOUR</Text></Paragraph>');
    expect(fdx).toContain('<Text Style="Bold">essoufflée</Text>');
    expect(fdx).toContain('StartsNewPage="Yes" Type="Scene Heading"');
    const back = parseFdx(fdx);
    expect(back.paragraphs.map((p) => p.type)).toEqual(['heading', 'action', 'character', 'parenthetical', 'dialogue', 'pagebreak', 'heading', 'transition']);
    expect(back.paragraphs[1].text).toBe('Léa entre, **essoufflée**.');
    expect(back.title).toMatchObject({ Title: 'LA CONSIGNE', Author: 'Léa Martin' });
  });

  it('lit une page de titre Final Draft (titre, crédit, auteurs, contact, date)', () => {
    const xml = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content><Paragraph Type="Scene Heading"><Text>INT. A - JOUR</Text></Paragraph></Content>
      <TitlePage><Content>
        <Paragraph Alignment="Center" Type="General"><Text>LUNDI</Text></Paragraph>
        <Paragraph Alignment="Center" Type="General"><Text>Écrit par</Text></Paragraph>
        <Paragraph Alignment="Center" Type="General"><Text>Collectif Vox</Text></Paragraph>
        <Paragraph Alignment="Left" Type="General"><Text>contact@exemple.fr</Text></Paragraph>
        <Paragraph Alignment="Right" Type="General"><Text>Version du 20/10/2026</Text></Paragraph>
      </Content></TitlePage></FinalDraft>`;
    const src = fdxToFountain(xml);
    const title = parseTitlePage(blocksFromSource(src).blocks.find((b) => b.type === 'title')!.text);
    expect(title).toEqual({ Title: 'LUNDI', Credit: 'Écrit par', Author: 'Collectif Vox', Contact: 'contact@exemple.fr', 'Draft date': 'Version du 20/10/2026' });
  });

  it('la phrase du séquencier devient le résumé de la scène, et revient en ligne « = » (sans sa note)', () => {
    const src = 'INT. GARE - JOUR\n\n= Léa trouve la *lettre*. [[ds:etape=9;intrigue=B]]\n\nLéa entre.\n\nEXT. QUAI - NUIT\n\nLe train part.\n\n= Résumé libre.\n';
    const fdx = scriptToFdx(blocksFromSource(src).blocks);
    expect(fdx).toContain(
      '<Paragraph Number="1" Type="Scene Heading"><SceneProperties><Summary><Paragraph Type="General"><Text>Léa trouve la </Text><Text Style="Italic">lettre</Text><Text>.</Text></Paragraph></Summary></SceneProperties><Text>INT. GARE - JOUR</Text></Paragraph>',
    );
    expect(fdx).not.toContain('etape');
    expect(fdx.match(/<Summary>/g)).toHaveLength(1);
    expect(parseFdx(fdx).paragraphs.map((p) => p.type)).toEqual(['heading', 'synopsis', 'action', 'heading', 'action']);
    const back = fdxToFountain(fdx);
    expect(back).toBe('INT. GARE - JOUR\n\n= Léa trouve la *lettre*.\n\nLéa entre.\n\nEXT. QUAI - NUIT\n\nLe train part.\n');
    // Réimporté par-dessus le texte d'origine, la note revient par le report du séquencier.
    expect(carryOutline(src, back)).toContain('= Léa trouve la *lettre*. [[ds:etape=9;intrigue=B]]\n');
  });

  it('refuse un fichier qui n’est pas du Final Draft', () => {
    expect(() => parseFdx('<html><body>non</body></html>')).toThrow('Final Draft');
  });
});

describe('réplique sans personnage dans l’éditeur', () => {
  it('reste une réplique après enregistrement (elle était relue comme une action)', () => {
    const doc = blocksFromSource('INT. A - JOUR\n\nUne action.\n');
    const id = doc.blocks[1].id;
    const { doc: next } = setBlockType(doc, id, 'dialogue');
    const src = serialize(next).source;
    expect(src).toBe('INT. A - JOUR\n\n@\nUne action.\n');
    expect(types(src)).toEqual(['heading', 'dialogue']);
  });

  it('perd son « @ » quand un personnage vient se placer au-dessus', () => {
    const doc = blocksFromSource('INT. A - JOUR\n\n@\nBonjour.\n');
    const blocks = doc.blocks.slice();
    blocks.splice(1, 0, { id: 'c', type: 'character', text: 'LÉA' });
    const src = serialize({ ...doc, blocks }).source;
    expect(src).toBe('INT. A - JOUR\n\nLÉA\nBonjour.\n');
  });
});
