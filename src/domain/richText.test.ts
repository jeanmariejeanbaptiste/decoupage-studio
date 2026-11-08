import { describe, expect, it } from 'vitest';
import { richImageKeys, richToText, sanitizeRich, textToRich } from './richText';
import { mediaKeys } from './serialize';
import { createProjectDoc } from './factory';

describe('note d’intention mise en forme', () => {
  it('garde la mise en forme prévue et retire le reste', () => {
    const dirty = '<h1 onclick="x()">Titre</h1><p style="text-align: center; color: red; line-height: 1.5">Un <b>mot</b> <strong>fort</strong>, <i>penché</i>, <u>souligné</u>, <strike>barré</strike>, H<sub>2</sub>O, m<sup>2</sup>.</p><script>alert(1)</script><p><a href="javascript:x">lien</a></p>';
    expect(sanitizeRich(dirty)).toBe('<h1>Titre</h1><p style="text-align: center; line-height: 1.5">Un <b>mot</b> <b>fort</b>, <i>penché</i>, <u>souligné</u>, <s>barré</s>, H<sub>2</sub>O, m<sup>2</sup>.</p><p>lien</p>');
  });

  it('convertit les anciennes balises du navigateur (font, div) et ne garde que les polices proposées', () => {
    expect(sanitizeRich('<div><font face="Courier Prime" size="5">Grand</font> <span style="font-family: Comic Sans MS; font-size: 13.333px">petit</span></div>')).toBe(
      '<p><span style="font-family: \'Courier Prime\'; font-size: 18pt">Grand</span> <span style="font-size: 10pt">petit</span></p>',
    );
  });

  it('listes, retrait, saut de page et images du projet', () => {
    const html = '<ul><li>Un</li><li>Deux<ol><li>Deux A</li></ol></li></ul><p style="margin-left: 2.5cm">Retrait</p><hr class="page-break"><hr><p><img data-blob="img:1" alt="Repérage" style="width: 60%"><img src="https://x/y.png"></p>';
    const clean = sanitizeRich(html);
    expect(clean).toBe('<ul><li>Un</li><li>Deux<ol><li>Deux A</li></ol></li></ul><p style="margin-left: 2.5cm">Retrait</p><hr class="page-break"><p><img data-blob="img:1" alt="Repérage" style="width: 60%"></p>');
    expect(richImageKeys(clean)).toEqual(['img:1']);
    expect(richToText(clean)).toBe('• Un\n\n• Deux\n\n  1. Deux A\n\nRetrait');
  });

  it('reprend une ancienne note en texte brut', () => {
    expect(textToRich('Le ton.\nLa lumière.\n\nLe rythme & les références')).toBe('<p>Le ton.<br>La lumière.</p><p>Le rythme &amp; les références</p>');
    expect(richToText(textToRich('Le ton.\nLa lumière.\n\nLe rythme'))).toBe('Le ton.\nLa lumière.\n\nLe rythme');
  });

  it('les images de la note comptent parmi les médias du projet (exports, ménage)', () => {
    const doc = createProjectDoc({ title: 'T', format: 'fiction' });
    doc.intentionHtml = '<p><img data-blob="note-img-1" alt=""></p>';
    expect(mediaKeys(doc)).toContain('note-img-1');
  });
});
