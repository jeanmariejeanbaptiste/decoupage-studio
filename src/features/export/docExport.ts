import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';

/** Document Word (.doc) : HTML que Word, Pages et LibreOffice ouvrent directement. */
export function downloadWord(page: DocPage, fileBase: string, orientation?: 'portrait' | 'landscape'): void {
  let html = page.html.replace('<html lang="fr">', '<html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  // Word ne lit pas `@page { size }` seul : la section reçoit aussi son orientation (mso).
  if (orientation === 'landscape')
    html = html.replace('</style>', '@page WordSection { size: 29.7cm 21cm; mso-page-orientation: landscape; margin: 1.5cm; } body { page: WordSection; } div.WordSection { page: WordSection; }</style>').replace(/<body([^>]*)>/, '<body$1><div class="WordSection">').replace('</body>', '</div></body>');
  downloadBlob(new Blob(['\uFEFF', html], { type: 'application/msword' }), `${fileBase}.doc`);
}
