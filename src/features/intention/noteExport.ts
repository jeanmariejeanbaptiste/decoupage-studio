/**
 * Exports de la note d'intention : les pages exactes de l'éditeur (PDF, images A4), toujours sur
 * papier blanc quel que soit le thème, et un document Word qui garde la mise en forme.
 */
import { getBlob } from '../../store/db';
import { downloadBlob } from '../../store/persistence';
import { finish, type PageExportOptions } from '../export/imageExport';
import { NOTE_PAGE } from './RichEditor';

/** Couleurs du papier, imposées le temps de la capture (le thème encre ne s'imprime pas). */
const LIGHT = '--paper:#ffffff;--paper-card:#ffffff;--sheet:#ffffff;--ink:#111318;--ink-soft:#6b7079;--rule:#e6e8ec;--kraft:#f5f6f8;--hover:transparent;';

/** Une image A4 par page, prise sur les pages de l'éditeur. */
export async function exportNotePages(stack: HTMLElement, pages: number, base: string, opts: PageExportOptions): Promise<void> {
  const { toCanvas } = await import('html-to-image');
  const clone = stack.cloneNode(true) as HTMLElement;
  clone.style.zoom = '1';
  clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
  // Bords et ombres des feuilles à l'écran : absents du papier.
  clone.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div').forEach((e) => {
    e.style.border = '0';
    e.style.boxShadow = 'none';
  });
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${NOTE_PAGE.w}px;${LIGHT}`;
  const frame = document.createElement('div');
  frame.style.cssText = `width:${NOTE_PAGE.w}px;height:${NOTE_PAGE.h}px;overflow:hidden;background:#fff;${LIGHT}`;
  frame.appendChild(clone);
  host.appendChild(frame);
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const ratio = 2.5;
    const canvases: HTMLCanvasElement[] = [];
    // Passe à blanc : Safari n'applique les polices intégrées qu'au second rendu.
    await toCanvas(frame, { pixelRatio: 0.1, backgroundColor: '#ffffff' }).catch(() => undefined);
    for (let i = 0; i < pages; i++) {
      clone.style.marginTop = `${-i * (NOTE_PAGE.h + NOTE_PAGE.gap)}px`;
      canvases.push(await toCanvas(frame, { pixelRatio: ratio, backgroundColor: '#ffffff', width: Math.round(NOTE_PAGE.w), height: Math.round(NOTE_PAGE.h) }));
    }
    await finish(canvases, base, opts);
  } finally {
    host.remove();
  }
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(b);
  });

/** Document Word (HTML que Word, Pages et LibreOffice ouvrent) : styles, images et sauts de page gardés. */
export async function downloadNoteWord(html: string, title: string, fileBase: string): Promise<void> {
  let body = html;
  for (const m of new Set([...html.matchAll(/data-blob="([^"]+)"/g)].map((x) => x[1]))) {
    const b = await getBlob(m);
    if (b) body = body.split(`data-blob="${m}"`).join(`src="${await blobToDataUrl(b)}"`);
  }
  body = body.replace(/<hr class="page-break">/g, '<br clear="all" style="page-break-before: always">');
  const css = `@page WordSection { size: 21cm 29.7cm; margin: 2.5cm; } div.WordSection { page: WordSection; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111318; }
p { margin: 0 0 6pt; } h1 { font-size: 24pt; font-weight: 600; margin: 0 0 10pt; } h4 { font-size: 13pt; font-weight: 400; color: #6b7079; margin: 0 0 12pt; }
h2 { font-size: 15pt; font-weight: 600; margin: 6pt 0 6pt; } h3 { font-size: 12.5pt; font-weight: 600; margin: 4pt 0 4pt; }
blockquote { margin: 0 0 8pt; padding-left: 14pt; border-left: 2px solid #111318; font-style: italic; } img { max-width: 100%; }`;
  const doc = `<!doctype html><html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>${css}</style></head><body><div class="WordSection">${body}</div></body></html>`;
  downloadBlob(new Blob(['﻿', doc], { type: 'application/msword' }), `${fileBase}.doc`);
}
