import { describe, expect, it } from 'vitest';
import { richImageKeys, richToText, sanitizeRich, textToRich, shrunkImageSize, wordFontStacks, wordImageBox } from './richText';
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

  it('texte brut : la mise en forme d’une puce n’est pas répétée', () => {
    expect(richToText('<ul><li>Un <i>mot</i></li><li>Deux<ol><li>A <b>b</b></li></ol></li></ul>')).toBe('• Un mot\n\n• Deux\n\n  1. A b');
  });

  it('collage depuis Word ou LibreOffice : l’en-tête du document ne passe pas', () => {
    const word = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><title>Document1</title><style>p.MsoNormal{margin:0}</style><!--[if gte mso 9]><xml><w:WordDocument></w:WordDocument></xml><![endif]--></head><body lang="FR"><p class="MsoNormal"><span style=\'font-size:12.0pt;font-family:"Times New Roman"\'>Texte Word<o:p></o:p></span></p></body></html>';
    const clean = sanitizeRich(word);
    expect(clean).not.toContain('Document1');
    expect(clean).toBe('<p><span style="font-size: 12pt">Texte Word</span></p>');
  });

  it('collage d’un tableau : une ligne par rangée, cellules séparées', () => {
    expect(sanitizeRich('<table><tr><td>Rôle</td><td>Comédien</td></tr><tr><td>Léa</td><td>Anna M.</td></tr></table>')).toBe('<p>Rôle · Comédien</p><p>Léa · Anna M.</p>');
    expect(sanitizeRich('<p>Avant</p><table><thead><tr><th><b>Rôle</b></th><th></th></tr></thead><tbody><tr><td><p>Léa</p></td><td>Anna</td></tr></tbody></table>')).toBe('<p>Avant</p><p><b>Rôle</b></p><p>Léa · Anna</p>');
  });

  it('collage depuis Google Docs : ni tout en gras, ni aplati', () => {
    const gdocs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;">Intention</span></h2>' +
      '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;">Premier paragraphe.</span></p>' +
      '<p dir="ltr" style="margin-top:0pt;"><span style="font-size:11pt;font-weight:700;">Gras voulu</span><span style="font-size:11pt;font-weight:400;"> et </span><span style="font-size:11pt;font-weight:400;font-style:italic;text-decoration:underline;">penché</span></p>' +
      '<ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;"><p dir="ltr" role="presentation"><span style="font-weight:400;">Puce un</span></p></li></ul></b><br class="Apple-interchange-newline">';
    expect(sanitizeRich(gdocs)).toBe(
      '<h2 style="line-height: 1.38"><span style="font-size: 16pt">Intention</span></h2><p style="line-height: 1.38"><span style="font-size: 11pt">Premier paragraphe.</span></p>' +
        '<p><span style="font-size: 11pt"><b>Gras voulu</b></span><span style="font-size: 11pt"> et </span><span style="font-size: 11pt"><i><u>penché</u></i></span></p><ul><li>Puce un</li></ul>',
    );
  });

  it('un vrai gras autour du texte reste du gras ; le nettoyage est stable', () => {
    expect(sanitizeRich('<p>Un <b>mot</b> et <span style="font-weight: bold">deux</span></p>')).toBe('<p>Un <b>mot</b> et <b>deux</b></p>');
    const once = sanitizeRich('<b style="font-weight:normal"><p><span style="font-weight:700;font-size:14pt">A</span></p></b><table><tr><td>x</td><td>y</td></tr></table>');
    expect(sanitizeRich(once)).toBe(once);
  });

  it('export Word : polices de secours et images à la bonne taille', () => {
    const html = sanitizeRich('<p><span style="font-family: \'Inter Variable\'">A</span> <span style="font-family: \'Courier Prime\'; font-size: 12pt">B</span></p>');
    const word = wordFontStacks(html);
    expect(word).toContain("font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif");
    expect(word).toContain("font-family: 'Courier Prime', 'Courier New', monospace; font-size: 12pt");
    expect(word).not.toContain('Inter Variable');
    expect(wordImageBox(2000, 1000, 50)).toEqual({ width: 303, height: 151 });
    expect(wordImageBox(2000, 1000)).toEqual({ width: 605, height: 303 });
    // Image en hauteur : plafonnée à 230 mm, proportions gardées.
    const tall = wordImageBox(1000, 4000);
    expect(tall.height).toBe(869);
    expect(Math.abs(tall.width / tall.height - 0.25)).toBeLessThan(0.01);
  });

  it('images importées : réduites au-delà de 2400 px, proportions gardées', () => {
    expect(shrunkImageSize(6000, 4000)).toEqual({ w: 2400, h: 1600 });
    expect(shrunkImageSize(1000, 3000)).toEqual({ w: 800, h: 2400 });
    expect(shrunkImageSize(2400, 1000)).toBeNull();
    expect(shrunkImageSize(0, 0)).toBeNull();
  });

  it('une puce indentée par le navigateur (sous-liste à côté de la puce) n’est pas perdue', () => {
    const chrome = '<ul><li>Un</li><ul><li>Deux</li></ul><li>Trois</li></ul>';
    expect(sanitizeRich(chrome)).toBe('<ul><li>Un<ul><li>Deux</li></ul></li><li>Trois</li></ul>');
    expect(richToText(sanitizeRich(chrome))).toBe('• Un\n\n  • Deux\n\n• Trois');
    // Désindentation : la puce rangée dans une autre la suit.
    expect(sanitizeRich('<ul><li>Un<ul><li>Deux</li></ul><li>Trois</li></li><li>Quatre</li></ul>')).toBe('<ul><li>Un<ul><li>Deux</li></ul></li><li>Trois</li><li>Quatre</li></ul>');
  });
});
