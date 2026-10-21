import type { DocPage } from '../../domain/documents';
import { downloadBlob } from '../../store/persistence';

/** Document Word (.doc) : HTML que Word, Pages et LibreOffice ouvrent directement. */
export function downloadWord(page: DocPage, fileBase: string): void {
  const html = page.html.replace('<html lang="fr">', '<html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  downloadBlob(new Blob(['\uFEFF', html], { type: 'application/msword' }), `${fileBase}.doc`);
}
