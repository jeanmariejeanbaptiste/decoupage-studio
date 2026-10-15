import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';

/** Imprime (PDF) un document autonome dans un cadre invisible : aucune interface de l'application. */
export function printDocument(page: DocPage): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  const win = frame.contentWindow!;
  win.document.open();
  win.document.write(page.html);
  win.document.close();
  const go = () => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  if (win.document.readyState === 'complete') setTimeout(go, 150);
  else frame.addEventListener('load', () => setTimeout(go, 150));
}

/** Document Word (.doc) : HTML que Word, Pages et LibreOffice ouvrent directement. */
export function downloadWord(page: DocPage, fileBase: string): void {
  const html = page.html.replace('<html lang="fr">', '<html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  downloadBlob(new Blob(['\uFEFF', html], { type: 'application/msword' }), `${fileBase}.doc`);
}
