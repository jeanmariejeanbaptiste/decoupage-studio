/**
 * Scénario mis en page pour l'export (Word, PDF de secours) : mêmes retraits que l'éditeur,
 * numéros de séquence dans la marge, page de titre à part.
 */
import { esc, type DocPage } from './documents';
import { blocksFromSource, headingNumbers, isEmptyBlock } from './screenplay';
import type { ProjectDoc } from './types';

const CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111318; font-family: 'Inter Variable', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; line-height: 1.3; }
table.sheet { width: 100%; border: 0; border-collapse: collapse; } table.sheet td { padding: 0 22mm 0 37mm; border: 0; } .pad { height: 12mm; }
p { margin: 0; white-space: pre-wrap; }
.heading { font-weight: 600; text-transform: uppercase; margin-top: 2.6em; position: relative; break-after: avoid; }
.heading .n { position: absolute; left: -15mm; width: 10mm; text-align: right; color: #6b7079; }
.action, .transition, .note, .centered, .section, .synopsis { margin-top: 1.3em; }
.character { margin: 1.3em 0 0 56mm; text-transform: uppercase; break-after: avoid; }
.parenthetical { margin-left: 40mm; max-width: 54mm; break-after: avoid; }
.dialogue { margin-left: 25mm; max-width: 92mm; }
.transition { text-align: right; text-transform: uppercase; }
.centered { text-align: center; }
.note, .section, .synopsis { color: #6b7079; font-style: italic; }
.titlepage { text-align: center; padding-top: 80mm; break-after: page; min-height: 250mm; }
.titlepage p { margin-bottom: 1em; }
.titlepage .t { font-size: 18pt; font-weight: 600; text-transform: uppercase; margin-bottom: 2em; }
.pagebreak { break-after: page; }
`;

/** Document du scénario : HTML autonome (ouvert par Word, Pages, LibreOffice). */
export function scriptDocument(doc: ProjectDoc): DocPage {
  const { blocks } = blocksFromSource(doc.scenario ?? '');
  const numbers = headingNumbers(blocks);
  const parts: string[] = [];
  for (const b of blocks) {
    if (isEmptyBlock(b)) continue;
    if (b.type === 'title') {
      const lines = b.text.split('\n').map((l) => {
        const m = /^([^:]+):\s*(.*)$/.exec(l);
        return m ? { key: m[1].trim().toLowerCase(), value: m[2] } : { key: '', value: l };
      });
      parts.push(`<div class="titlepage">${lines.map((l) => `<p class="${l.key === 'title' || l.key === 'titre' ? 't' : ''}">${esc(l.value)}</p>`).join('')}</div>`);
      continue;
    }
    if (b.type === 'pagebreak') {
      parts.push('<div class="pagebreak"></div>');
      continue;
    }
    const n = numbers.get(b.id);
    parts.push(`<p class="${b.type}">${n ? `<span class="n">${n}</span>` : ''}${esc(b.text)}</p>`);
  }
  const title = doc.project.title || 'Scénario';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><table class="sheet"><thead><tr><td><div class="pad"></div></td></tr></thead><tbody><tr><td>${parts.join('')}</td></tr></tbody><tfoot><tr><td><div class="pad"></div></td></tr></tfoot></table></body></html>`;
  return { title: 'Scénario', html };
}
